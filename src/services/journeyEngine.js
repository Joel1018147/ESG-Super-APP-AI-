'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// THE JOURNEY ENGINE                                              (Run 52)
//
// Where a company is on the journey, which missions it has completed and how
// much XP it has are COMPUTED HERE, FROM ROWS THAT ALREADY EXIST, every time
// they are asked for. Nothing in this platform stores them.
//
// An `xp` integer that a route increments will drift from reality the first
// time a request dies between the write and the commit — and once it has
// drifted, nothing in the system can tell you. Derived from the rows the
// company actually wrote, it is correct by construction, recomputable at any
// moment, and falsifiable against its own sources. That is the same rule
// scoringEngine.js runs on, applied one layer up: an executor computes the
// figure and nothing else is allowed to author one.
//
// Two consequences that shape the whole file:
//
//   1. THIS FILE WRITES NOTHING. No INSERT, no UPDATE, no DELETE — asserted in
//      test/journey-test.js against the source, because "I did not mean to"
//      is not a guard.
//   2. THIS FILE CALLS NO MODEL. `generateWithGroq` does not appear — also
//      asserted. XP is arithmetic over committed facts; a model has nothing to
//      contribute to it and everything to lose by being near it.
//
// Every XP award carries its PROVENANCE: which mission it came from, the
// source table and row id that satisfied it, and the timestamp taken from THAT
// SOURCE ROW. That is what makes "+130 this week" computable without a ledger —
// the week filter applies to the source row's own timestamp, so deleting the
// row removes the award and moves the total, which is exactly what a derived
// figure is supposed to do.
//
// Structured like scoringEngine.js on purpose: gatherFacts() is the only part
// that touches the database, and computeJourney / computeMissions / computeXp
// are PURE — no query, no clock, no randomness — which is what makes them
// testable against hand-built fixtures.
// ═══════════════════════════════════════════════════════════════════════════

const { query } = require('../db');

const ENGINE_VERSION = '1.0.0';

// The four states a stage can be in. `blocked` is the one that matters:
// pending means YOUR TURN NEXT, blocked means THIS CANNOT HAPPEN YET AND HERE
// IS WHY. Rendering them the same way is the same error class as a failed AI
// call rendering like an empty one.
const STATES = Object.freeze(['completed', 'in_progress', 'pending', 'blocked']);

/** A fact, in the one shape every predicate answers in.
 *
 *  `satisfied` is explicit rather than derived from `done >= total` because two
 *  predicates legitimately need more than a ratio: the review queue is only
 *  satisfied when it is empty AND at least one proposal was accepted, and an
 *  assessment with no indicators at all has done === total === 0 and is not
 *  complete. A ratio alone would call both of those done. */
function fact(done, total, satisfied, source) {
  return Object.freeze({
    done: Number(done) || 0,
    total: Number(total) || 0,
    satisfied: Boolean(satisfied),
    source: source ? Object.freeze({ ...source }) : null,
  });
}

const NOTHING = fact(0, 1, false, null);

/** The one-row-plus-count shape used by most predicates: the EARLIEST row that
 *  satisfies it, so the award is dated when the thing actually happened, plus
 *  how many such rows exist. Zero rows means the predicate is unsatisfied. */
function firstRowFact(rows, sourceTable) {
  const r = rows[0];
  if (!r) return NOTHING;
  return fact(1, 1, true, { source_table: sourceTable, source_id: r.id, earned_at: r.earned_at });
}

// ── The predicate vocabulary ────────────────────────────────────────────────
//
// A CLOSED SET. `factFor` throws on anything else rather than treating it as
// unsatisfied: an unrecognised predicate is a seed/code mismatch, and scoring
// it "pending" would hide it behind a state that looks perfectly normal, which
// is RULE 6a — a substitute standing in for logic that was never written.
//
// `never` is not that. It is implemented, on purpose, as a predicate that is
// never satisfied, so that a stage which cannot happen yet still has an honest
// NOT NULL predicate_code and carries its reason in blocked_reason instead.
const PREDICATE_CODES = Object.freeze([
  'never',
  'company_profile_complete',
  'documents_uploaded',
  'extraction_run',
  'proposals_reviewed',
  'assessment_answered',
  'assessment_scored',
  'carbon_entries_present',
  'recommendations_present',
  'green_project_defined',
  'carbon_baselined',
]);

function factFor(facts, predicateCode) {
  if (predicateCode === 'never') return NOTHING;
  if (!PREDICATE_CODES.includes(predicateCode)) {
    throw new Error(`unimplemented predicate: ${predicateCode}`);
  }
  const f = facts && facts.predicates && facts.predicates[predicateCode];
  if (!f) throw new Error(`gatherFacts did not produce a fact for predicate: ${predicateCode}`);
  return f;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DATABASE SIDE — the only part of this file that touches Postgres
//
// EVERY statement below carries a company predicate. Where the table has no
// company_id of its own (esg_responses, esg_scores, esg_recommendations and
// esg_green_project_baselines are all scoped through their parent) it joins to
// the parent that does and filters there. The two reference reads —
// esg_indicators for the denominator, and the three Run 52 definition tables —
// carry no tenant filter because they hold no tenant data; they are the only
// two, and test/journey-test.js enumerates them by SHAPE rather than by name.
// ═══════════════════════════════════════════════════════════════════════════

/** The live assessment: the most recent non-archived one. There is deliberately
 *  no default when a company has none — the answering and scoring predicates
 *  are simply unsatisfied, which is true. */
async function loadLiveAssessment(companyId) {
  const { rows } = await query(
    `SELECT id, framework_id, framework_code, framework_version, reporting_year, status
       FROM esg_assessments
      WHERE company_id = $1 AND status <> 'archived'
      ORDER BY reporting_year DESC, created_at DESC
      LIMIT 1`, [companyId]);
  return rows[0] || null;
}

async function gatherFacts(companyId) {
  if (!companyId) throw new Error('gatherFacts: a company id is required');

  const assessment = await loadLiveAssessment(companyId);

  // THREE WAVES, NOT SEVENTEEN ROUND TRIPS. Everything except the live
  // assessment lookup is independent, so it issues together — the same shape
  // scoringEngine.scoreAssessment() already uses. Read sequentially this page
  // cost six seconds over a proxied connection, which is a real number measured
  // in the smoke test rather than a guess.
  const [
    { rows: profileRows },
    { rows: docRows },
    { rows: extractedRows },
    { rows: queueRows },
    { rows: acceptedRows },
    { rows: carbonRows },
    { rows: recRows },
    { rows: projectRows },
    { rows: baselineRows },
  ] = await Promise.all([
  // ── company profile ──────────────────────────────────────────────────────
  // Five fields, counted in SQL so the ratio the page shows ("3 of 5") and the
  // satisfied flag come from one place. `updated_at` is the row's own
  // timestamp and is what an award made from this fact is dated by.
    query(
      `SELECT id,
            (CASE WHEN name           IS NOT NULL AND btrim(name) <> '' THEN 1 ELSE 0 END
           + CASE WHEN ssm_number     IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN msic_code      IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN employee_count IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN grid_region    IS NOT NULL THEN 1 ELSE 0 END)::int AS filled,
            updated_at AS earned_at
       FROM esg_companies WHERE id = $1`, [companyId]),

  // ── documents ────────────────────────────────────────────────────────────
    query(
      `SELECT id, created_at AS earned_at
       FROM esg_documents WHERE company_id = $1
      ORDER BY created_at, id LIMIT 1`, [companyId]),

    query(
      `SELECT id, updated_at AS earned_at
       FROM esg_documents WHERE company_id = $1 AND text_status = 'extracted'
      ORDER BY updated_at, id LIMIT 1`, [companyId]),

  // ── the review queue ─────────────────────────────────────────────────────
  // Auto-rejected proposals never reach a human, so they are outside both the
  // numerator and the denominator: counting them would show a queue a reviewer
  // can never clear.
    query(
      `SELECT count(*)::int AS live,
            count(*) FILTER (WHERE e.status IN ('accepted','rejected'))::int AS reviewed,
            count(*) FILTER (WHERE e.status = 'pending')::int  AS pending,
            count(*) FILTER (WHERE e.status = 'accepted')::int AS accepted
       FROM esg_document_extractions e
       JOIN esg_documents d ON d.id = e.document_id
      WHERE d.company_id = $1 AND e.status <> 'auto_rejected'`, [companyId]),

    query(
      `SELECT e.id, e.reviewed_at AS earned_at
       FROM esg_document_extractions e
       JOIN esg_documents d ON d.id = e.document_id
      WHERE d.company_id = $1 AND e.status = 'accepted' AND e.reviewed_at IS NOT NULL
      ORDER BY e.reviewed_at, e.id LIMIT 1`, [companyId]),

  // ── carbon, roadmap, projects, baselines ─────────────────────────────────
    query(
      `SELECT id, created_at AS earned_at
       FROM esg_carbon_entries WHERE company_id = $1
      ORDER BY created_at, id LIMIT 1`, [companyId]),

    query(
      `SELECT r.id, r.created_at AS earned_at
       FROM esg_recommendations r
       JOIN esg_assessments a ON a.id = r.assessment_id
      WHERE a.company_id = $1
      ORDER BY r.created_at, r.id LIMIT 1`, [companyId]),

    query(
      `SELECT id, created_at AS earned_at
       FROM esg_green_projects WHERE company_id = $1
      ORDER BY created_at, id LIMIT 1`, [companyId]),

    query(
      `SELECT b.id, b.computed_at AS earned_at
       FROM esg_green_project_baselines b
       JOIN esg_green_projects p ON p.id = b.project_id
      WHERE p.company_id = $1
      ORDER BY b.computed_at, b.id LIMIT 1`, [companyId]),
  ]);

  const PROFILE_FIELDS = 5;
  const profile = profileRows[0]
    ? fact(profileRows[0].filled, PROFILE_FIELDS, profileRows[0].filled >= PROFILE_FIELDS,
      { source_table: 'esg_companies', source_id: profileRows[0].id, earned_at: profileRows[0].earned_at })
    : NOTHING;

  const q = queueRows[0] || { live: 0, reviewed: 0, pending: 0, accepted: 0 };
  const proposals = q.live > 0 && q.pending === 0 && q.accepted > 0
    ? fact(q.reviewed, q.live, true, acceptedRows[0]
      ? { source_table: 'esg_document_extractions', source_id: acceptedRows[0].id, earned_at: acceptedRows[0].earned_at }
      : null)
    : fact(q.reviewed, q.live || 1, false, null);

  // ── the assessment ───────────────────────────────────────────────────────
  // THE DENOMINATOR IS COMPUTED, NEVER HARDCODED. MODUS_SEDG_ALIGNED carries 40
  // indicators and SEDG@2.0 carries 38; the reference dashboard's "32" is right
  // for neither. Indicators the company marked not applicable leave the
  // denominator, exactly as they do in the scoring engine.
  let answers = NOTHING;
  let scored = NOTHING;
  if (assessment) {
    const [{ rows: indRows }, { rows: respRows }, { rows: lastAnswer }, { rows: scoreRows }] =
      await Promise.all([
        query(
          `SELECT count(*)::int AS n FROM esg_indicators
        WHERE framework_id = $1 AND is_active`, [assessment.framework_id]),

        query(
          `SELECT count(*) FILTER (WHERE NOT r.is_na)::int AS answered,
              count(*) FILTER (WHERE r.is_na)::int     AS na
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
        WHERE a.company_id = $1 AND r.assessment_id = $2`, [companyId, assessment.id]),

        // The LAST answer is what completed the set, so it is the honest date
        // for a mission only satisfied once every indicator is answered.
        query(
          `SELECT r.id, r.updated_at AS earned_at
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
        WHERE a.company_id = $1 AND r.assessment_id = $2 AND NOT r.is_na
        ORDER BY r.updated_at DESC, r.id DESC LIMIT 1`, [companyId, assessment.id]),

        query(
          `SELECT s.id, s.computed_at AS earned_at
         FROM esg_scores s
         JOIN esg_assessments a ON a.id = s.assessment_id
        WHERE a.company_id = $1 AND s.assessment_id = $2 AND s.scope = 'OVERALL'
        ORDER BY s.computed_at, s.id LIMIT 1`, [companyId, assessment.id]),
      ]);

    const applicable = Math.max(0, (indRows[0] ? indRows[0].n : 0) - (respRows[0] ? respRows[0].na : 0));
    const answered = respRows[0] ? respRows[0].answered : 0;
    answers = fact(answered, applicable || 1, applicable > 0 && answered >= applicable,
      lastAnswer[0]
        ? { source_table: 'esg_responses', source_id: lastAnswer[0].id, earned_at: lastAnswer[0].earned_at }
        : null);

    scored = firstRowFact(scoreRows, 'esg_scores');
  }

  return Object.freeze({
    engine_version: ENGINE_VERSION,
    company_id: companyId,
    assessment: assessment ? Object.freeze({ ...assessment }) : null,
    predicates: Object.freeze({
      never: NOTHING,
      company_profile_complete: profile,
      documents_uploaded:       firstRowFact(docRows, 'esg_documents'),
      extraction_run:           firstRowFact(extractedRows, 'esg_documents'),
      proposals_reviewed:       proposals,
      assessment_answered:      answers,
      assessment_scored:        scored,
      carbon_entries_present:   firstRowFact(carbonRows, 'esg_carbon_entries'),
      recommendations_present:  firstRowFact(recRows, 'esg_recommendations'),
      green_project_defined:    firstRowFact(projectRows, 'esg_green_projects'),
      carbon_baselined:         firstRowFact(baselineRows, 'esg_green_project_baselines'),
    }),
  });
}

/** The definition tables. Reference data, no tenant scope, one read. */
async function loadDefinitions() {
  const [{ rows: stages }, { rows: missions }, { rows: levels }] = await Promise.all([
    query(`SELECT code, sort_order, label_en, label_bm, label_zh, description_en,
                  group_code, predicate_code, blocked_reason
             FROM esg_journey_stages WHERE is_active ORDER BY sort_order, code`),
    query(`SELECT code, stage_code, label_en, description_en, predicate_code,
                  xp_award, sort_order
             FROM esg_missions WHERE is_active ORDER BY sort_order, code`),
    query(`SELECT level, min_xp, label_en FROM esg_xp_levels ORDER BY min_xp, level`),
  ]);
  return { stages, missions, levels };
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE — no query, no clock, no randomness, from here down
// ═══════════════════════════════════════════════════════════════════════════

/** One state rule, used by both stages and missions, so the two can never
 *  disagree about what "in progress" means. A blocked_reason wins over the
 *  predicate whatever the predicate says. */
function stateFor(f, blockedReason) {
  if (blockedReason) return 'blocked';
  if (f.satisfied) return 'completed';
  if (f.done > 0) return 'in_progress';
  return 'pending';
}

function computeJourney(facts, stages) {
  const out = (stages || []).map((s) => {
    const f = factFor(facts, s.predicate_code);
    const state = stateFor(f, s.blocked_reason);
    return Object.freeze({
      stage_code: s.code,
      sort_order: s.sort_order,
      group_code: s.group_code,
      predicate_code: s.predicate_code,
      state,
      // Reported for every stage, because the UI needs "18 of 32" and a binary
      // predicate is honestly 0 of 1 or 1 of 1.
      done: f.done,
      total: f.total,
      blocked: state === 'blocked',
      blocked_reason: s.blocked_reason || null,
      label_en: s.label_en,
      description_en: s.description_en || null,
    });
  });
  const counts = Object.freeze(STATES.reduce((acc, st) => {
    acc[st] = out.filter((s) => s.state === st).length;
    return acc;
  }, {}));
  // The stage a user should look at next: the first that is neither finished
  // nor impossible. Null when there is nothing left to do, which is a real and
  // different answer from "the first one".
  const active = out.find((s) => s.state === 'in_progress' || s.state === 'pending') || null;
  return Object.freeze({
    stages: Object.freeze(out),
    counts,
    active_stage_code: active ? active.stage_code : null,
    total_stages: out.length,
  });
}

function computeMissions(facts, missions) {
  const out = (missions || []).map((m) => {
    const f = factFor(facts, m.predicate_code);
    return Object.freeze({
      mission_code: m.code,
      stage_code: m.stage_code,
      predicate_code: m.predicate_code,
      state: stateFor(f, null),
      done: f.done,
      total: f.total,
      xp_award: m.xp_award,
      label_en: m.label_en,
      description_en: m.description_en || null,
    });
  });
  return Object.freeze({
    missions: Object.freeze(out),
    completed: out.filter((m) => m.state === 'completed').length,
    total: out.length,
  });
}

/**
 * XP, with provenance on every award.
 *
 * An award names the row that earned it and is dated by THAT ROW'S OWN
 * TIMESTAMP. Two things follow, and both are the point: "+130 this week" is
 * computable without a ledger, because the week filter applies to the source
 * row's date; and deleting the source row removes the award, because the award
 * was never stored anywhere else.
 *
 * A satisfied mission with no resolvable source row THROWS. It would be an XP
 * award nobody could trace, which is the one thing this whole design exists to
 * make impossible — reporting it as unearned would hide the fault, and awarding
 * it anyway would put an untraceable number on a page next to an ESG score.
 */
function computeXp(facts, missions, levels) {
  const ladder = (levels || []).slice().sort((a, b) => a.min_xp - b.min_xp);
  if (!ladder.length) throw new Error('No XP levels seeded — seed.sql has not run');

  const awards = [];
  for (const m of missions || []) {
    const f = factFor(facts, m.predicate_code);
    if (!f.satisfied) continue;
    if (!f.source) {
      throw new Error(
        `mission ${m.code} is satisfied but its predicate resolved no source row — ` +
        'an XP award with no provenance cannot be shown');
    }
    awards.push(Object.freeze({
      mission_code: m.code,
      xp: m.xp_award,
      earned_at: f.source.earned_at,
      source_table: f.source.source_table,
      source_id: f.source.source_id,
    }));
  }

  const total = awards.reduce((n, a) => n + a.xp, 0);
  let current = ladder[0];
  for (const l of ladder) if (total >= l.min_xp) current = l;
  const next = ladder.find((l) => l.min_xp > total) || null;

  return Object.freeze({
    awards: Object.freeze(awards),
    total,
    level: current.level,
    label: current.label_en,
    level_min_xp: current.min_xp,
    next_level: next ? next.level : null,
    next_level_min_xp: next ? next.min_xp : null,
    // Everything a mission could still pay, so a progress bar has an honest
    // denominator instead of the current total pretending to be one.
    max_xp: (missions || []).reduce((n, m) => n + m.xp_award, 0),
  });
}

/** Pure. The clock belongs to the caller, so this stays testable and so
 *  computeXp keeps no notion of "now". */
function xpSince(awards, sinceIso) {
  const cut = new Date(sinceIso).getTime();
  if (!Number.isFinite(cut)) throw new Error(`xpSince: ${sinceIso} is not a date`);
  return (awards || [])
    .filter((a) => new Date(a.earned_at).getTime() >= cut)
    .reduce((n, a) => n + a.xp, 0);
}

module.exports = {
  ENGINE_VERSION,
  STATES,
  PREDICATE_CODES,
  gatherFacts,
  loadDefinitions,
  loadLiveAssessment,
  computeJourney,
  computeMissions,
  computeXp,
  xpSince,
  stateFor,
  factFor,
};

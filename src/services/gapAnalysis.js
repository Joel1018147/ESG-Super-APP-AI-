'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GAP ANALYSIS — WHY THE SCORE IS WHAT IT IS                      (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   A number on its own is not a diagnosis. "68 / 100" tells a company nothing
   it can act on; what it needs is which disclosures cost it points, why each
   one costs what it costs, and what would resolve it.

   THIS FILE COMPUTES NO SCORE AND NO POINT VALUE. Every figure it carries was
   written by scoringEngine.js into esg_recommendations.points_missed at score
   time, at the weighting version stamped on the score row, and is passed
   through untouched. Re-deriving "what this gap is worth" here would be a
   second scoring path — the one thing CLAUDE.md #2 forbids — and it would
   silently disagree with the published figure the day a weight changed.

   ── THE FIVE QUESTIONS EVERY GAP ANSWERS ─────────────────────────────────
     what      what is missing, in the disclosure's own words
     why       why it matters — the points it is costing, from the engine
     evidence  what would resolve it. From the indicator's CONFIGURED guidance,
               or the honest statement that none is configured. This file
               NEVER invents an example list.
     action    what to do, derived from WHICH KIND of gap it is
     who       who should act. The platform records no owner, so for most gaps
               the honest answer is that nobody is assigned — and it says so
               rather than nominating a role it cannot see.

   ── THE THREE KINDS OF GAP, WHICH ARE GENUINELY DIFFERENT ────────────────
     unanswered      no esg_responses row. Not scored, not scored as zero.
     unevidenced     answered, and nothing is attached. The answer counts; the
                     scheme's evidence multiplier is what decides for how much,
                     and that multiplier is READ from the scheme, never assumed.
     partial         answered with an option worth less than the full weight.
                     The company said something short of the full disclosure.

   Collapsing these into "missing" is what the directive's evidence rule bans:
   a company that answered honestly and has no certificate is in a different
   position from one that has not looked at the question.

   NOTHING HERE WRITES, AND NOTHING HERE CALLS A MODEL. The narrative on a
   recommendation row was written by aiAdvisor at score time under its own five
   guards; this file renders it and does not generate one.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

const PILLAR_NAME = Object.freeze({ E: 'Environmental', S: 'Social', G: 'Governance' });

const KIND = Object.freeze({
  UNANSWERED:  'unanswered',
  UNEVIDENCED: 'unevidenced',
  PARTIAL:     'partial',
});

/** How a gap reads, by kind. The `action` is a VERB with the disclosure in it,
 *  never "View details" — and `who` is the same honest answer in all three
 *  cases because the platform genuinely has no owner column. */
const KIND_COPY = Object.freeze({
  [KIND.UNANSWERED]: {
    label: 'Not answered',
    what: 'This disclosure has no answer on file.',
    action: 'Answer it in the assessment',
    href: (a) => `/assessment/${a}`,
  },
  [KIND.UNEVIDENCED]: {
    label: 'Answered, nothing attached',
    what: 'You answered this and no document supports it, so it is scored as self-declared.',
    action: 'Attach the document you already hold',
    href: () => '/documents',
  },
  [KIND.PARTIAL]: {
    label: 'Partly met',
    what: 'The answer on file is worth less than the full weight of this disclosure.',
    action: 'Revisit the answer',
    href: (a) => `/assessment/${a}`,
  },
});

/** The one sentence this file is allowed to say about who acts.
 *
 *  esg_responses.answered_by is a real column and names the person who last
 *  answered, which is a fact. There is NO owner, assignee or approver anywhere
 *  in this schema, so anything stronger than this would be a role invented on
 *  a page. */
const NO_OWNER =
  'Nobody is assigned. This platform records who last answered a question and has no owner, '
  + 'reviewer or approver field, so it cannot tell you whose job this is.';

/* ═══════════════════════════════════════════════════════════════════════════
   THE READ

   One wave. Every statement carries the company predicate; esg_responses,
   esg_scores and esg_recommendations have no company_id of their own and are
   scoped through esg_assessments, which does.
   ═══════════════════════════════════════════════════════════════════════════ */
async function gather(companyId, assessmentId) {
  const [
    { rows: scores }, { rows: bands }, { rows: recs },
    { rows: responses }, { rows: scheme }, { rows: assessment },
  ] = await Promise.all([
    query(
      `SELECT s.scope, s.score_0_100, s.band_code, s.points_earned, s.points_available,
              s.indicators_total, s.indicators_answered, s.indicators_na,
              s.weighting_version, s.framework_version, s.engine_version, s.computed_at
         FROM esg_scores s
         JOIN esg_assessments a ON a.id = s.assessment_id
        WHERE a.company_id = $1 AND s.assessment_id = $2`, [companyId, assessmentId]),

    query(
      `SELECT b.band_code, b.band_label, b.min_score, b.max_score, b.sort_order
         FROM esg_rating_bands b
         JOIN esg_assessments a ON a.weighting_scheme_id = b.scheme_id
        WHERE a.id = $1 AND a.company_id = $2
        ORDER BY b.sort_order`, [assessmentId, companyId]),

    /* ONE ROW PER INDICATOR, not one per recommendation row.
       esg_recommendations holds up to two rows for the same indicator — the
       ENGINE row, which owns points_missed, and an ai_phrasing/fallback row,
       which owns the narrative and COPIES the points across. Joining them
       naively double-counts every gap, which is the defect this DISTINCT ON
       exists to prevent. The engine row is authoritative for the number and
       the phrased row supplies the sentence, so both are read and merged by
       indicator below rather than being one query. */
    query(
      `SELECT r.indicator_id, r.pillar, r.points_missed, r.priority, r.source, r.narrative_en,
              i.code, i.question_en, i.guidance_en, i.weight, i.tier, i.response_type,
              i.mapping_status
         FROM esg_recommendations r
         JOIN esg_assessments a ON a.id = r.assessment_id
         LEFT JOIN esg_indicators i ON i.id = r.indicator_id
        WHERE a.company_id = $1 AND r.assessment_id = $2
        ORDER BY r.points_missed DESC NULLS LAST, r.indicator_id`, [companyId, assessmentId]),

    query(
      `SELECT r.indicator_id, r.evidence_tier, r.is_na, r.option_code, r.document_id,
              r.updated_at, u.name AS answered_by_name
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
         LEFT JOIN esg_users u ON u.id = r.answered_by
        WHERE a.company_id = $1 AND r.assessment_id = $2`, [companyId, assessmentId]),

    /* THE MULTIPLIERS ARE READ, NEVER ASSUMED. "Attaching a document raises
       this" is only true because the scheme says so, and the scheme on the
       ASSESSMENT is the one that scored it — not whichever scheme is active
       today, which may be a later version. */
    query(
      `SELECT w.version, w.mult_self_declared, w.mult_documented, w.mult_verified
         FROM esg_weighting_schemes w
         JOIN esg_assessments a ON a.weighting_scheme_id = w.id
        WHERE a.id = $2 AND a.company_id = $1`, [companyId, assessmentId]),

    query(
      `SELECT id, framework_code, framework_version, reporting_year, status
         FROM esg_assessments WHERE company_id = $2 AND id = $1`, [assessmentId, companyId]),
  ]);

  return { scores, bands, recs, responses, scheme: scheme[0] || null, assessment: assessment[0] || null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PURE — no query, no clock, from here down
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which kind of gap this is.
 *
 *  Order matters and is not arbitrary: an unanswered indicator cannot also be
 *  unevidenced, and an answer that is BOTH partial and self-declared is
 *  reported as unevidenced, because attaching a document is the cheaper of the
 *  two moves and the one the company can make today without changing anything
 *  about how it operates. */
function kindOf(response) {
  if (!response || response.is_na) return KIND.UNANSWERED;
  if (response.evidence_tier === 'self_declared') return KIND.UNEVIDENCED;
  return KIND.PARTIAL;
}

/** What would resolve this gap.
 *
 *  Returns `{ configured, text }`. `configured:false` is the load-bearing case
 *  and it is the truth for any indicator seeded without guidance — the
 *  directive is explicit that examples must only be shown where the
 *  requirement actually configures them, so this file has NO example list to
 *  fall back to and says so instead. */
function evidenceFor(rec, kind, scheme) {
  const guidance = rec.guidance_en && String(rec.guidance_en).trim();
  if (kind === KIND.UNEVIDENCED) {
    const mults = scheme
      ? `Under weighting version ${scheme.version} a documented answer is multiplied by `
        + `${Number(scheme.mult_documented)} and a self-declared one by `
        + `${Number(scheme.mult_self_declared)}. Those two figures are the scheme's, read from `
        + 'the row that scored this assessment.'
      : 'The weighting scheme that scored this assessment could not be read, so the exact '
        + 'multipliers are not stated here rather than being guessed.';
    return {
      configured: Boolean(guidance),
      text: guidance
        ? `${guidance} ${mults}`
        : `No evidence requirement is configured for this disclosure, so the platform cannot tell `
          + `you which document would satisfy it. What it can tell you is what attaching one is `
          + `worth: ${mults}`,
    };
  }
  return {
    configured: Boolean(guidance),
    text: guidance || 'No guidance is configured for this disclosure on this framework. The '
      + 'question itself is the whole of what is being asked.',
  };
}

/** One gap, fully answered.
 *
 *  `points` is copied from the engine row. `narrative` is whatever the AI
 *  layer wrote at score time, or null — never generated here. */
function describe(rec, response, scheme, assessmentId) {
  const kind = kindOf(response);
  const copy = KIND_COPY[kind];
  const evidence = evidenceFor(rec, kind, scheme);

  return Object.freeze({
    indicator_id: rec.indicator_id,
    code: rec.code || null,
    pillar: rec.pillar,
    pillar_name: PILLAR_NAME[rec.pillar] || rec.pillar,
    question: rec.question_en || null,
    tier: rec.tier || null,
    kind,
    kind_label: copy.label,
    priority: rec.priority,
    // FROM THE ENGINE. Never computed in this file.
    points_missed: rec.points_missed === null ? null : Number(rec.points_missed),
    indicator_weight: rec.weight === null || rec.weight === undefined ? null : Number(rec.weight),
    // Draft mappings are badged everywhere else in this product and this is no
    // exception: a gap against a question nobody has reconciled line-by-line
    // against the publisher's document is still a gap, and it still says so.
    mapping_status: rec.mapping_status || null,

    what: copy.what,
    why: rec.points_missed === null
      ? 'The scoring engine recorded this gap without a point value, which means the recommendation '
        + 'row predates the figure. Nothing here will invent one.'
      : `${Number(rec.points_missed)} of this disclosure's ${
        rec.weight === null || rec.weight === undefined ? 'weight' : Number(rec.weight)} weighted points `
        + 'are not currently earned. The scoring engine computed that at score time; no part of it '
        + 'is generated by AI.',
    evidence,
    action: copy.action,
    href: copy.href(assessmentId),
    who: response && response.answered_by_name
      ? `${response.answered_by_name} last answered this. ${NO_OWNER}`
      : NO_OWNER,
    narrative: rec.narrative_en || null,
    narrative_source: rec.narrative_en ? rec.source : null,
  });
}

/** Pillar-level position: which areas are strong, which are the priority.
 *
 *  STRONG and PRIORITY are decided against the pillar's own scored figure and
 *  the points actually missed in it — not against a threshold invented here.
 *  A pillar with nothing scorable is neither: it is reported as its own state,
 *  because `no_scorable_indicators` and "scored zero" are different facts and
 *  the scoring engine already keeps them apart. */
function pillars(scores, gaps) {
  const byScope = Object.fromEntries(scores.map((s) => [s.scope, s]));
  const out = [];
  for (const p of ['E', 'S', 'G']) {
    const s = byScope[p];
    if (!s) continue;
    const own = gaps.filter((g) => g.pillar === p);
    const missed = own.reduce((n, g) => n + (g.points_missed || 0), 0);
    const applicable = Number(s.indicators_total) - Number(s.indicators_na || 0);
    out.push(Object.freeze({
      pillar: p,
      name: PILLAR_NAME[p],
      score: Number(s.score_0_100),
      answered: Number(s.indicators_answered),
      applicable,
      na: Number(s.indicators_na || 0),
      gaps: own.length,
      points_missed: Math.round(missed * 100) / 100,
      unanswered: own.filter((g) => g.kind === KIND.UNANSWERED).length,
      unevidenced: own.filter((g) => g.kind === KIND.UNEVIDENCED).length,
      partial: own.filter((g) => g.kind === KIND.PARTIAL).length,
    }));
  }
  // The priority pillar is the one carrying the most unearned points. Ties keep
  // E/S/G order, which is stable and therefore does not jitter between loads.
  const ranked = [...out].sort((a, b) => b.points_missed - a.points_missed);
  return {
    all: Object.freeze(out),
    // STRONG is a claim, so it needs a floor that is stated rather than felt:
    // every applicable indicator answered AND no unearned points left in the
    // pillar. That is a pillar with genuinely nothing outstanding — not a
    // pillar that merely scored well.
    strong: Object.freeze(out.filter((p) => p.applicable > 0 && p.answered >= p.applicable && p.points_missed === 0)),
    priority: Object.freeze(ranked.filter((p) => p.points_missed > 0)),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The gap analysis for one company's live assessment.
 *
 * FOUR DISTINCT ANSWERS, and a caller must render them differently:
 *   null                  no company
 *   state:'no_assessment' nothing has been started
 *   state:'not_scored'    an assessment exists and has never been scored, so
 *                         there are no engine-computed points to explain
 *   state:'ok'            a score exists and the gaps behind it are enumerated
 *
 * A scored assessment with NO recommendation rows is still state:'ok' with an
 * empty gap list — that is a real and different result from "not scored", and
 * it means every scorable point was earned.
 */
async function analyse(companyId, assessmentId) {
  if (!companyId) return null;
  if (!assessmentId) {
    return Object.freeze({
      state: 'no_assessment',
      detail: 'No assessment exists for this company, so there is no score to explain and no gap '
            + 'to enumerate. Scoring is switched on and working; there is simply nothing to score.',
    });
  }

  const { scores, bands, recs, responses, scheme, assessment } = await gather(companyId, assessmentId);

  if (!scores.length) {
    return Object.freeze({
      state: 'not_scored',
      assessment,
      detail: 'This assessment has not been scored yet. Gaps are the scoring engine\'s own output — '
            + 'until it runs there is nothing to explain, and this platform will not estimate a '
            + 'provisional set.',
    });
  }

  /* ── Merge the engine row and its phrased sibling ──────────────────────
     The engine row owns points_missed; the ai_phrasing (or fallback_template)
     row owns the sentence and copies the number across. One gap per indicator,
     with the engine's figure and the phrased row's words. */
  const byIndicator = new Map();
  for (const r of recs) {
    const key = r.indicator_id;
    const prev = byIndicator.get(key);
    if (!prev) { byIndicator.set(key, { ...r }); continue; }
    if (r.source === 'engine') {
      // The engine's number wins; whatever narrative is already held stays.
      byIndicator.set(key, { ...r, narrative_en: prev.narrative_en, source: prev.source });
    } else {
      prev.narrative_en = r.narrative_en;
      prev.source = r.source;
    }
  }

  const responseBy = new Map(responses.map((r) => [r.indicator_id, r]));
  const gaps = [...byIndicator.values()]
    .map((r) => describe(r, responseBy.get(r.indicator_id) || null, scheme, assessmentId))
    .sort((a, b) => (b.points_missed || 0) - (a.points_missed || 0));

  /* `ok` REQUIRES AN OVERALL ROW, and P10 made that explicit.
     `state: 'ok'` was returned whenever esg_scores held ANY row for the
     assessment, while `overall` was null unless one of them was the OVERALL
     scope. Two consumers then disagreed about what `ok` promised:
     roadmapService re-checked `gaps.overall` before reading it, and
     /improvement did not — so a score set with pillar rows and no OVERALL
     rendered the roadmap fine and 500'd the page beside it.

     scoringEngine always writes all four scopes in one transaction, so this is
     a broken-write shape rather than a routine one. That is exactly why it
     gets its own state instead of a guard at each call site: a caller can
     render it, and no caller has to remember. */
  const overall = scores.find((s) => s.scope === 'OVERALL') || null;
  if (!overall) {
    return Object.freeze({
      state: 'incomplete_score',
      assessment,
      detail: `This assessment has ${scores.length} score row${scores.length === 1 ? '' : 's'} and `
            + 'no overall figure among them. The scoring engine writes every scope together, so a '
            + 'set missing the overall one is an interrupted write rather than a normal state — '
            + 'nothing here will add up the pillars to stand in for it.',
    });
  }
  const band = bands.find((b) => b.band_code === overall.band_code) || null;

  return Object.freeze({
    state: 'ok',
    assessment,
    // Non-null by construction: the branch above returns before this point.
    overall: Object.freeze({
      score: Number(overall.score_0_100),
      band_code: overall.band_code,
      band_label: band ? band.band_label : null,
      answered: Number(overall.indicators_answered),
      applicable: Number(overall.indicators_total) - Number(overall.indicators_na || 0),
      na: Number(overall.indicators_na || 0),
      weighting_version: overall.weighting_version,
      framework_version: overall.framework_version,
      engine_version: overall.engine_version,
      computed_at: overall.computed_at,
    }),
    bands: Object.freeze(bands),
    scheme: scheme ? Object.freeze({ ...scheme }) : null,
    gaps: Object.freeze(gaps),
    pillars: pillars(scores, gaps),
    counts: Object.freeze({
      total: gaps.length,
      unanswered: gaps.filter((g) => g.kind === KIND.UNANSWERED).length,
      unevidenced: gaps.filter((g) => g.kind === KIND.UNEVIDENCED).length,
      partial: gaps.filter((g) => g.kind === KIND.PARTIAL).length,
      // The total unearned points, summed from ENGINE figures. Rounded once,
      // here, so a page cannot render a different total from the same list.
      points_missed: Math.round(gaps.reduce((n, g) => n + (g.points_missed || 0), 0) * 100) / 100,
    }),
  });
}

module.exports = { analyse, gather, describe, kindOf, evidenceFor, pillars, KIND, KIND_COPY, PILLAR_NAME, NO_OWNER };

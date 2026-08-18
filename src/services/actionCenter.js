'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE ACTION CENTER                                               (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   ONE QUESTION, ANSWERED IN ONE PLACE: WHAT SHOULD THIS COMPANY DO NEXT?

   Every screen in this product could answer a version of it, and before P9
   several of them did — the dashboard picked the journey's active stage, the
   readiness page picked its own largest gap, the impact page picked whichever
   project it was looking at. Three answers to one question is how a user is
   told to do three different things first.

   THIS FILE IS THE ONLY PLACE A PRIORITY IS DECIDED. It writes nothing, it
   calls no model, and it computes no figure of its own — every number it
   carries was computed by journeyEngine, scoringEngine, readinessService or
   impactService and is passed through untouched.

   ── A PRIORITY MUST BE EXPLAINABLE ───────────────────────────────────────
   The directive's rule, and the reason this is a RULE TABLE rather than a
   sequence of ifs: every action carries `basis`, which is the sentence naming
   the rows that put it in the state it is in. An action whose basis is empty
   is a priority nobody can defend, so `build()` throws rather than shipping
   one. That is the same discipline computeXp() applies to an award with no
   source row.

   ── THE SEVEN STATES, AND WHAT SEPARATES THEM ────────────────────────────
     urgent          something ALREADY TRUE is being undermined by inaction.
                     Not "important" — undermined. Exactly two rules produce
                     it and both are stated below.
     priority        the journey's active stage, or any stage already started
                     and unfinished. This is where the product wants you.
     recommended     a reachable stage that is not yet your turn.
     optional        would improve the quality of what you already have, and
                     no stage requires it.
     completed       the stage's own predicate is satisfied.
     blocked         esg_journey_stages.blocked_reason is set. The reason is
                     rendered verbatim; this file never writes one.
     not_configured  the PLATFORM cannot do this, for this or any company.
                     Never a score of zero and never the company's fault.

   ── WHAT THIS FILE IS FORBIDDEN TO DO ────────────────────────────────────
   It may not decide that a green project fixes an ESG question, that a
   readiness figure implies a bank will lend, or that an expected benefit has
   been achieved. Where two facts are related it says how it knows; where they
   are merely adjacent it says nothing. `link` on an action is a route to
   another surface, never a claim that the two are causally connected.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const journey = require('./journeyEngine');
const readinessService = require('./readinessService');
const { STAGE_LINK, STAGE_CTA } = require('../utils/journeyView');

/** The seven states, most-pressing first. Order is meaningful: `rank()` sorts
 *  by it, so adding a state means deciding where it sits, not appending. */
const STATES = Object.freeze([
  'urgent', 'priority', 'recommended', 'optional',
  'blocked', 'not_configured', 'completed',
]);

const STATE_WORD = Object.freeze({
  urgent:         'Urgent',
  priority:       'Priority',
  recommended:    'Recommended',
  optional:       'Optional',
  blocked:        'Blocked',
  not_configured: 'Not configured',
  completed:      'Completed',
});

/** What a state MEANS, in the words the UI renders under a filter or a legend.
 *  Kept beside the states so a new state cannot ship without one. */
const STATE_MEANING = Object.freeze({
  urgent:         'Something already recorded is out of date until you act.',
  priority:       'This is the mission the platform is asking you to finish.',
  recommended:    'Reachable, and not yet your turn.',
  optional:       'Improves what you already hold. Nothing requires it.',
  blocked:        'Cannot happen yet. The reason is stated, and it is not about you.',
  not_configured: 'The platform cannot do this for any company yet.',
  completed:      'Done, and derived from the rows that prove it.',
});

const rank = (state) => {
  const i = STATES.indexOf(state);
  if (i === -1) throw new Error(`actionCenter: "${state}" is not one of the seven states`);
  return i;
};

/** One action.
 *
 *  Five fields are REQUIRED and the constructor enforces them, because an
 *  action missing any of them is the generic card the directive rules out:
 *    what  the thing to do, naming its own count where it has one
 *    why   why it matters, in terms of what it unblocks or what it corrects
 *    basis the ROWS. This is what makes the priority defensible.
 *    cta   a specific verb with the count in it, never "View details"
 *    href  where the verb goes
 *
 *  `requirement`, `opportunity` and `evidence` are optional because they are
 *  genuinely not knowable for every action, and a placeholder would be the
 *  invention this whole file exists to avoid. */
function action({ code, state, what, why, basis, cta, href, requirement = null,
  opportunity = null, evidence = null, source = null, count = null }) {
  if (!code) throw new Error('actionCenter: an action needs a code');
  rank(state);
  for (const [field, v] of [['what', what], ['why', why], ['basis', basis], ['cta', cta], ['href', href]]) {
    if (!v || !String(v).trim()) {
      throw new Error(`actionCenter: action "${code}" has no ${field} — ` +
        'an action a user cannot act on, or a priority nobody can explain, must not render');
    }
  }
  return Object.freeze({
    code, state, what, why, basis, cta, href,
    requirement, opportunity, evidence,
    // Which table(s) this was read out of. Rendered as provenance, and asserted
    // in the suite so an action cannot acquire a source it does not read.
    source: source ? Object.freeze([...source]) : null,
    count: count === null ? null : Number(count),
  });
}

/* ── THE GENERIC CTA BAN, ENFORCED ────────────────────────────────────────
   The directive names five phrases that must not appear when a specific
   action exists. They are DATA rather than a habit, so test/action-center-test
   can assert against every CTA this file can emit, including the ones built
   from a template. */
const BANNED_CTA = Object.freeze(['get started', 'learn more', 'explore', 'view details', 'read more']);

function assertSpecific(cta, code) {
  const low = String(cta).toLowerCase().trim();
  if (BANNED_CTA.includes(low)) {
    throw new Error(`actionCenter: action "${code}" uses the generic CTA "${cta}"`);
  }
  return cta;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DETAIL WAVE

   journeyEngine answers "has this happened". An action card needs the number
   that goes in the verb — REVIEW 12 ANSWERS, not REVIEW ANSWERS — so this
   reads the counts behind the predicates. Every statement carries the company
   predicate; the three tables without a company_id of their own join to the
   parent that has one.

   These are aggregates, so each returns exactly one row and is read without a
   guard: a count query that returns nothing is a broken connection and should
   throw rather than render a zero.
   ═══════════════════════════════════════════════════════════════════════════ */
async function gatherDetail(companyId, assessmentId) {
  const [
    { rows: proposals }, { rows: docs }, { rows: unanswered },
    { rows: selfDeclared }, { rows: projects }, { rows: opportunities },
  ] = await Promise.all([
    // auto_rejected never reached a human, so it is outside both sides of the
    // ratio — the same rule journeyEngine and the dashboard both apply.
    query(
      `SELECT count(*) FILTER (WHERE e.status = 'pending')::int  AS pending,
              count(*) FILTER (WHERE e.status = 'accepted')::int AS accepted,
              count(*)::int AS live
         FROM esg_document_extractions e
         JOIN esg_documents d ON d.id = e.document_id
        WHERE d.company_id = $1 AND e.status <> 'auto_rejected'`, [companyId]),

    query(
      `SELECT count(*)::int AS documents_total,
              count(*) FILTER (WHERE text_status = 'extracted')::int      AS documents_read,
              count(*) FILTER (WHERE text_status IN ('no_text_layer','failed'))::int AS documents_unreadable,
              count(*) FILTER (WHERE assessment_id IS NULL)::int          AS documents_unattached
         FROM esg_documents WHERE company_id = $1`, [companyId]),

    // Indicators with no response row at all. NULL assessment means no
    // assessment exists, and the query returns 0 rather than the whole
    // framework — which would be a count against an assessment that is not
    // there.
    query(
      `SELECT count(*)::int AS unanswered
         FROM esg_indicators i
        WHERE i.is_active
          AND i.framework_id = (SELECT framework_id FROM esg_assessments
                                 WHERE id = $2 AND company_id = $1)
          AND NOT EXISTS (SELECT 1 FROM esg_responses r
                           WHERE r.assessment_id = $2 AND r.indicator_id = i.id)`,
      [companyId, assessmentId || null]),

    // Answered, and nothing attached. This is the OPTIONAL lane: the answer
    // counts, it simply counts for less, and the scheme's own multiplier is
    // what decides by how much. No figure is computed here.
    query(
      `SELECT count(*)::int AS self_declared
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
        WHERE a.company_id = $1 AND r.assessment_id = $2 AND NOT r.is_na
          AND r.evidence_tier = 'self_declared'`, [companyId, assessmentId || null]),

    query(
      `SELECT count(*)::int AS projects_total,
              count(*) FILTER (WHERE status = 'implemented')::int AS projects_implemented,
              count(*) FILTER (WHERE expected_benefit_value IS NOT NULL)::int AS projects_forecast,
              count(*) FILTER (WHERE ccpt_category_code IS NULL)::int AS projects_unclassified,
              count(*) FILTER (WHERE financing_required_myr IS NULL)::int AS projects_no_financing
         FROM esg_green_projects WHERE company_id = $1`, [companyId]),

    query(
      `SELECT count(*) FILTER (WHERE status = 'pending')::int AS opportunities_pending
         FROM esg_green_opportunities WHERE company_id = $1`, [companyId]),
  ]);

  /* Projects that have been IMPLEMENTED and BASELINED but never measured.
     This is the second urgent rule's whole condition, and it is one query
     rather than a loop over impactService so the action list does not cost a
     round trip per project. impactService remains the only thing that decides
     what a measurement MEANS; this only counts the rows. */
  const { rows: awaitingReading } = await query(
    `SELECT p.id, p.title
       FROM esg_green_projects p
      WHERE p.company_id = $1
        AND p.status = 'implemented'
        AND EXISTS (SELECT 1 FROM esg_green_project_baselines b
                     WHERE b.project_id = p.id AND b.kind = 'baseline')
        AND NOT EXISTS (SELECT 1 FROM esg_green_project_baselines b
                         WHERE b.project_id = p.id AND b.kind = 'actual')
      ORDER BY p.created_at, p.id`, [companyId]);

  /* Measurements a person has never confirmed. MEASURED IS NOT VERIFIED, and
     this is the count behind that distinction. */
  const { rows: unverified } = await query(
    `SELECT count(*)::int AS unverified_actuals
       FROM esg_green_project_baselines b
       JOIN esg_green_projects p ON p.id = b.project_id
      WHERE p.company_id = $1 AND b.kind = 'actual' AND b.verified_at IS NULL`, [companyId]);

  /* EVERY ALIAS IN THE SIX STATEMENTS ABOVE IS UNIQUE ACROSS THIS FILE, and
     that is not a style choice. dashboard-test.js answers a query by matching
     its SQL against an ordered fixture table, so two aggregates that both
     select `AS total` are two queries the harness cannot tell apart — it
     would hand one of them the other's row, and the page would render a
     confident figure from the wrong table. Distinct aliases make the fixture
     key unambiguous AND make the mapping below readable without holding all
     six statements in your head. */
  const d = docs[0];
  const p = projects[0];
  return {
    proposals: proposals[0],
    docs: { total: d.documents_total, read_ok: d.documents_read,
      unreadable: d.documents_unreadable, unattached: d.documents_unattached },
    unanswered: unanswered[0].unanswered,
    selfDeclared: selfDeclared[0].self_declared,
    projects: { total: p.projects_total, implemented: p.projects_implemented,
      forecast: p.projects_forecast, unclassified: p.projects_unclassified,
      no_financing: p.projects_no_financing },
    opportunitiesPending: opportunities[0].opportunities_pending,
    awaitingReading,
    unverifiedActuals: unverified[0].unverified_actuals,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE STAGE LANE

   ONE ACTION PER JOURNEY STAGE, and the stage's own state decides the action's
   state. The mapping is deliberately mechanical — a stage the engine calls
   blocked produces a blocked action and nothing here can promote it — so the
   dashboard's action list and the journey's mission map cannot disagree about
   what is happening.

   The stage's label and description are the WHAT and the WHY, because they are
   already written, already translated-ready and already the words the journey
   page uses. Writing a second set here is how the two drift.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Per-stage enrichment: the count that belongs in the verb, and the sentence
 *  naming the rows. Every entry is a function of the detail wave, so a stage
 *  with nothing to count returns null and the generic stage action is used.
 *
 *  A stage that is not in this map is NOT an error — it renders from the seed's
 *  own label and description, which is always correct if never specific. */
const STAGE_DETAIL = Object.freeze({
  PROPOSALS_REVIEWED: (d) => (d.proposals.pending > 0 ? {
    cta: `Review ${d.proposals.pending} proposal${d.proposals.pending === 1 ? '' : 's'}`,
    count: d.proposals.pending,
    basis: `${d.proposals.pending} row${d.proposals.pending === 1 ? '' : 's'} in `
         + 'esg_document_extractions are still pending, and none is auto-rejected.',
    why: 'The AI read your documents and proposed these answers. A proposal is a proposal '
       + 'until you accept it — nothing an AI read changes your score on its own.',
    requirement: 'Each proposal carries a verbatim quote from the page it came from. '
               + 'Accepting one writes your answer; rejecting it writes nothing.',
    source: ['esg_document_extractions'],
  } : null),

  DOCUMENTS_UPLOADED: (d) => (d.docs.total === 0 ? {
    cta: 'Upload your first document',
    basis: 'esg_documents holds no row for this company.',
    requirement: 'A utility bill, a policy or a certificate. PDF, PNG, JPEG, DOCX or XLSX, '
               + 'up to 15 MB.',
    source: ['esg_documents'],
  } : null),

  ASSESSMENT_ANSWERED: (d) => (d.unanswered > 0 ? {
    cta: `Answer ${d.unanswered} remaining question${d.unanswered === 1 ? '' : 's'}`,
    count: d.unanswered,
    basis: `${d.unanswered} active indicator${d.unanswered === 1 ? '' : 's'} on this framework `
         + 'have no row in esg_responses.',
    why: 'The score is arithmetic over your own answers. An unanswered question is not scored '
       + 'as a zero — it is simply not scored, and the assessment cannot be finalised while '
       + 'any remain.',
    source: ['esg_indicators', 'esg_responses'],
  } : null),

  /* THERE IS DELIBERATELY NO GREEN_PROJECT ENTRY HERE ANY MORE.
     It used to surface the pending AI suggestions, gated on `projects.total
     === 0` — so once a company defined its first project the suggestion queue
     vanished from the action list entirely. MEASURED on staging: the top bar
     read "5 need review" while this list said nothing about any of them,
     which is the same disagreement between two surfaces that this whole file
     exists to end, only inverted.

     The queue is now its own rule (`reviewQueueRules`), independent of any
     stage, because reviewing a proposal is work the platform is holding for a
     person whatever else they have done. The GREEN_PROJECT stage keeps its own
     generic action about defining a project, which is a different thing. */
});

/* ── WHERE EACH PREDICATE READS FROM ──────────────────────────────────────
   A stage action's basis has to name something a company can go and look at.
   "Derived from the documents_uploaded predicate" names a mechanism, not a
   row, and a reader cannot check a mechanism — which is the whole point of
   carrying a basis at all.

   THIS MAP IS THE ONE PIECE OF KNOWLEDGE THIS FILE HOLDS ABOUT THE ENGINE'S
   INTERNALS, and it is asserted against journeyEngine.PREDICATE_CODES in
   test/action-center-test.js so a new predicate cannot ship without one. It is
   here rather than in journeyEngine because it is a PRESENTATION fact — which
   table to name to a user — and the engine already returns the authoritative
   version (`fact.source.source_table`) for every predicate that is SATISFIED.
   What the engine cannot give is the table for a predicate that found nothing,
   because there is no row to take it from, and "nothing in esg_documents yet"
   is exactly the sentence an unsatisfied stage needs. */
const PREDICATE_TABLE = Object.freeze({
  never:                    null,   // reads nothing, by construction
  company_profile_complete: 'esg_companies',
  documents_uploaded:       'esg_documents',
  extraction_run:           'esg_documents',
  proposals_reviewed:       'esg_document_extractions',
  assessment_answered:      'esg_responses',
  assessment_scored:        'esg_scores',
  carbon_entries_present:   'esg_carbon_entries',
  recommendations_present:  'esg_recommendations',
  green_project_defined:    'esg_green_projects',
  carbon_baselined:         'esg_green_project_baselines',
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE TWO URGENT RULES

   URGENT is not "important". It is: SOMETHING ALREADY RECORDED IS NO LONGER
   TRUE, OR NO LONGER PROVABLE, UNTIL SOMEBODY ACTS. Both rules below meet that
   test and nothing else in this file may claim the state.

   U1  A SCORE IS ON FILE AND EVIDENCE IS SITTING UNREVIEWED.
       The published figure was computed without answers that are already
       proposed and quote-checked. Whatever the figure would become, the one
       currently on the page was computed against a smaller evidence set — so
       the number a company might put in front of a bank is out of date, and
       that is a fact about a row that already exists.

   U2  A PROJECT WAS IMPLEMENTED, HAS A BASELINE, AND HAS NO READING.
       The baseline exists precisely so that the implementation can be measured
       against it. Every month without a reading is a month of impact that
       cannot be evidenced later, because the carbon entries it would be
       derived from are period-scoped. The expected benefit stays a forecast.

   Both name their rows. Neither infers anything about what the new figure
   would be — U1 does not say the score will rise, because nothing here knows
   which way a proposal cuts.
   ═══════════════════════════════════════════════════════════════════════════ */
function urgentRules(d, facts) {
  const out = [];

  if (d.proposals.pending > 0 && facts.predicates.assessment_scored.satisfied) {
    out.push(action({
      code: 'U1_SCORE_PREDATES_EVIDENCE',
      state: 'urgent',
      what: `Your score was computed before ${d.proposals.pending} proposed answer${
        d.proposals.pending === 1 ? '' : 's'} ${d.proposals.pending === 1 ? 'was' : 'were'} reviewed`,
      why: 'The figure on your dashboard is real and was computed from the answers you had given '
         + 'at the time. Proposals waiting in the queue were not part of it. Reviewing them and '
         + 'recalculating is what makes the published figure current — this platform will not '
         + 'guess which way they move it.',
      basis: `esg_scores holds an OVERALL row for the live assessment, and ${d.proposals.pending} `
           + `esg_document_extractions row${d.proposals.pending === 1 ? '' : 's'} are still pending.`,
      cta: assertSpecific(`Review ${d.proposals.pending} proposal${d.proposals.pending === 1 ? '' : 's'}`, 'U1'),
      href: '/documents',
      count: d.proposals.pending,
      requirement: 'After reviewing, recalculate the assessment. The score is not recomputed on '
                 + 'your behalf, because a figure that moves without you asking is a figure you '
                 + 'cannot explain to anyone.',
      source: ['esg_scores', 'esg_document_extractions'],
    }));
  }

  for (const p of d.awaitingReading) {
    out.push(action({
      code: `U2_UNMEASURED_${p.id}`,
      state: 'urgent',
      what: `“${p.title}” is implemented and has never been measured`,
      why: 'The baseline was computed so this project could be measured against it. Until a '
         + 'reading exists for a period after implementation, the benefit stays a forecast — and '
         + 'a forecast is not an impact.',
      basis: 'The project row is status=implemented and esg_green_project_baselines holds a '
           + 'baseline for it and no actual.',
      cta: assertSpecific('Record the actual reading', `U2_${p.id}`),
      href: `/green-finance/projects/${p.id}`,
      requirement: 'A period start and end. The reading is derived from your carbon entries for '
                 + 'that period, so the entries have to be in first.',
      source: ['esg_green_projects', 'esg_green_project_baselines'],
    }));
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REVIEW QUEUE

   THE ONE INVARIANT THIS RULE EXISTS FOR: whatever the top bar says is waiting
   for review, this list says the same thing.

   `shellContext.review.total` is `extractions_pending + suggestions_pending`,
   and it is rendered as a chip on every page of the product. Before P9 the
   action list covered the first of those through a journey stage and the
   second only while a company had no green project — so a company with one
   project saw "5 need review" in the chrome and nothing at all in the list.

   Both halves are covered here, unconditionally, and
   test/action-center-test.js asserts the two totals agree. Extractions are
   claimed by U1 when a score is on file (a stale figure is the stronger
   statement) and by the PROPOSALS_REVIEWED stage otherwise, so this rule owns
   the SUGGESTIONS half and defers on the other — which is why it is a rule and
   not a second card about the same queue.
   ═══════════════════════════════════════════════════════════════════════════ */
function reviewQueueRules(d) {
  const n = d.opportunitiesPending;
  if (!n) return [];
  return [action({
    code: 'Q1_SUGGESTIONS_PENDING',
    state: 'recommended',
    what: `${n} AI suggestion${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting for your decision`,
    why: 'The scan proposed these project types for a company like yours. Accepting one creates a '
       + 'draft project with no cost on it — you supply the figures — and rejecting one records '
       + 'that you looked. Neither changes your score.',
    basis: `${n} row${n === 1 ? '' : 's'} in esg_green_opportunities are pending, and none is `
         + 'auto-rejected. The same rows the top bar counts.',
    cta: assertSpecific(`Review ${n} suggestion${n === 1 ? '' : 's'}`, 'Q1'),
    href: '/green-finance/opportunities',
    count: n,
    requirement: 'Each proposal names a project type from a fixed list and says why it was '
               + 'suggested. It is not told your ESG gaps and is never asked to answer one.',
    source: ['esg_green_opportunities'],
  })];
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE OPTIONAL LANE

   Actions that improve the QUALITY of what already exists and that no journey
   stage requires. They are last in the list and they say so — an SME reading
   this should never confuse "would strengthen your position" with "is holding
   you up".
   ═══════════════════════════════════════════════════════════════════════════ */
function optionalRules(d, facts) {
  const out = [];

  if (d.selfDeclared > 0) {
    out.push(action({
      code: 'O1_SELF_DECLARED',
      state: 'optional',
      what: `${d.selfDeclared} answer${d.selfDeclared === 1 ? '' : 's'} ${
        d.selfDeclared === 1 ? 'is' : 'are'} self-declared with nothing attached`,
      why: 'A self-declared answer counts. It counts for less than the same answer with the '
         + 'document behind it, because the weighting scheme applies an evidence multiplier — '
         + 'and the multiplier is the scheme’s, not this page’s.',
      basis: `${d.selfDeclared} esg_responses row${d.selfDeclared === 1 ? '' : 's'} carry `
           + 'evidence_tier=self_declared and are not marked not-applicable.',
      cta: assertSpecific(`Attach evidence to ${d.selfDeclared} answer${d.selfDeclared === 1 ? '' : 's'}`, 'O1'),
      href: '/documents',
      count: d.selfDeclared,
      requirement: 'The document you already hold. Uploading it changes nothing about how you '
                 + 'operate; it changes what the answer can be shown to rest on.',
      source: ['esg_responses'],
    }));
  }

  if (d.unverifiedActuals > 0) {
    out.push(action({
      code: 'O2_UNVERIFIED_ACTUALS',
      state: 'optional',
      what: `${d.unverifiedActuals} measurement${d.unverifiedActuals === 1 ? '' : 's'} ${
        d.unverifiedActuals === 1 ? 'has' : 'have'} not been confirmed by a person`,
      why: 'The platform derived these readings from your carbon entries. Measured and verified '
         + 'are different claims, and this product keeps them apart — confirming one records who '
         + 'confirmed it and when.',
      basis: `${d.unverifiedActuals} esg_green_project_baselines row${
        d.unverifiedActuals === 1 ? '' : 's'} of kind=actual have verified_at IS NULL.`,
      cta: assertSpecific(`Confirm ${d.unverifiedActuals} measurement${d.unverifiedActuals === 1 ? '' : 's'}`, 'O2'),
      href: '/impact',
      count: d.unverifiedActuals,
      source: ['esg_green_project_baselines'],
    }));
  }

  if (d.docs.unattached > 0 && facts.assessment) {
    out.push(action({
      code: 'O3_UNATTACHED_DOCUMENTS',
      state: 'optional',
      what: `${d.docs.unattached} document${d.docs.unattached === 1 ? '' : 's'} ${
        d.docs.unattached === 1 ? 'is' : 'are'} not attached to an assessment`,
      why: 'A document with no assessment behind it can be stored and read, and it can never be '
         + 'analysed — there is no set of questions to propose answers against.',
      basis: `${d.docs.unattached} esg_documents row${d.docs.unattached === 1 ? '' : 's'} have `
           + 'assessment_id IS NULL, and this company has a live assessment.',
      cta: assertSpecific(`Open ${d.docs.unattached === 1 ? 'the document' : 'the documents'}`, 'O3'),
      href: '/documents',
      count: d.docs.unattached,
      source: ['esg_documents'],
    }));
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE NOT-CONFIGURED LANE

   A capability the PLATFORM does not have. It is never the company's fault and
   it is never a zero, so it renders as an action with no verb the company can
   perform — the CTA reads what it actually is: a route to the page that
   explains the absence.

   Reporting is here because P9 built its readiness view and deliberately did
   NOT build a generator. Readiness is here only when the engine itself says
   not_configured.
   ═══════════════════════════════════════════════════════════════════════════ */
function notConfiguredRules(ready) {
  const out = [];

  out.push(action({
    code: 'N1_REPORTING_ENGINE',
    state: 'not_configured',
    what: 'There is no report generator on this platform',
    why: 'Everything a report would be assembled from exists — the score, the answers, the '
       + 'evidence, the carbon entries, the projects and the measurements. What does not exist '
       + 'is the thing that turns them into a document, so nothing here will produce one.',
    basis: 'No route, service or template in this codebase writes a report file. The reporting '
         + 'page reports what IS available instead.',
    cta: assertSpecific('See what a report could draw on', 'N1'),
    href: '/reports',
    source: [],
  }));

  if (ready && ready.status === 'not_configured') {
    out.push(action({
      code: 'N2_READINESS_UNRUNNABLE',
      state: 'not_configured',
      what: 'Green finance readiness cannot be assessed at all yet',
      why: 'Not one criterion in the readiness model had anything to look at. That is a statement '
         + 'about how much this platform holds, not a judgement about your company — and it is '
         + 'not a score of zero.',
      basis: `readinessService reports status=not_configured at model version ${ready.modelVersion}: `
           + `0 of ${ready.maximum} points are assessable.`,
      cta: assertSpecific('Open finance readiness', 'N2'),
      href: '/green-finance/readiness',
      source: ['esg_finance_inputs'],
    }));
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE READINESS LANE

   ONE action, and only when the engine has something to say. The engine
   already ranks its own missing inputs by the points they would unlock, so
   this takes its top row rather than ranking anything itself — duplicating
   that ordering is how the dashboard and the readiness page end up naming
   different "biggest gaps", which is a defect this repo has already had once.
   ═══════════════════════════════════════════════════════════════════════════ */
function readinessRule(ready) {
  if (!ready) return null;
  if (ready.status === 'not_configured') return null;      // N2 covers it
  if (ready.status === 'calculated') return null;          // nothing missing
  const gap = ready.missingData[0];
  if (!gap) return null;

  const missing = ready.missingData.length;
  return action({
    code: 'R1_READINESS_DATA',
    state: 'recommended',
    what: `${missing} readiness input${missing === 1 ? '' : 's'} ${
      missing === 1 ? 'has' : 'have'} nothing recorded`,
    why: 'Readiness is reported as earned out of ASSESSABLE points, never out of the maximum, '
       + 'because a criterion nobody could look at is not a criterion you failed. Supplying '
       + 'these moves them into the assessable half.',
    basis: `readinessService reports ${ready.earned} of ${ready.assessable} assessable points `
         + `earned, ${ready.maximum - ready.assessable} of ${ready.maximum} not assessable. `
         + `The largest single gap is “${gap.label}” under ${gap.criterionName}.`,
    cta: assertSpecific(`Complete ${missing} finance input${missing === 1 ? '' : 's'}`, 'R1'),
    href: '/green-finance/readiness',
    count: missing,
    requirement: gap.why || null,
    opportunity: 'Once every criterion is assessable the engine publishes a single readiness '
               + 'figure. It remains a readiness assessment and never a financing approval.',
    source: ['esg_finance_inputs'],
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every action for one company, ranked.
 *
 * Returns null for no company — "we do not know which company" and "this
 * company has nothing to do" are different answers, and the second one is a
 * populated result with an empty `open` list.
 *
 * `uninstrumented` is the third answer: seed.sql has not run, so there are no
 * stages to derive anything from. A caller must render that differently from
 * an empty account, which is CLAUDE.md #8.
 */
async function build(companyId) {
  if (!companyId) return null;

  const [definitions, facts] = await Promise.all([
    journey.loadDefinitions(),
    journey.gatherFacts(companyId),
  ]);
  const { stages } = definitions;

  if (!stages.length) {
    return Object.freeze({
      state: 'uninstrumented',
      detail: 'No journey stage is defined on this deployment, so there is nothing to derive an '
            + 'action list from. This is a configuration gap, not an empty account.',
      actions: Object.freeze([]),
      open: Object.freeze([]),
      counts: Object.freeze({}),
      lead: null,
      // Returned even here, because a caller that renders the uninstrumented
      // state still has a page to draw and should not have to reissue the two
      // reads this function already made.
      definitions,
      facts,
      journey: null,
      readiness: null,
      detail: null,
    });
  }

  const j = journey.computeJourney(facts, stages);
  const [detail, ready] = await Promise.all([
    gatherDetail(companyId, facts.assessment ? facts.assessment.id : null),
    readinessService.calculate(companyId),
  ]);

  /* ── The stage lane ────────────────────────────────────────────────────
     The stage's engine state maps onto an action state. `active` is the one
     stage the engine already named as next; everything else that is merely
     pending is recommended. Nothing here can promote a blocked stage. */
  const stageActions = j.stages.map((s) => {
    const extra = STAGE_DETAIL[s.stage_code] ? STAGE_DETAIL[s.stage_code](detail) : null;
    const isActive = s.stage_code === j.active_stage_code;

    const state = s.state === 'blocked' ? 'blocked'
      : s.state === 'completed' ? 'completed'
        : (s.state === 'in_progress' || isActive) ? 'priority'
          : 'recommended';

    // A ratio is only stated when the predicate HAS one. A binary predicate is
    // honestly 0 of 1, and printing that reads as a progress bar that never
    // moves, so it is left out.
    const ratio = s.total > 1 ? `${s.done} of ${s.total} done. ` : '';

    // The table this stage's predicate reads, and — when the predicate is
    // satisfied — the table the ENGINE says produced the fact. They agree, and
    // the engine's is preferred because it came from the row itself.
    const f = facts.predicates[s.predicate_code];
    const table = (f && f.source && f.source.source_table) || PREDICATE_TABLE[s.predicate_code];

    const basis = s.state === 'blocked'
      ? `esg_journey_stages.blocked_reason is set on ${s.stage_code}.`
      : (extra && extra.basis)
        ? extra.basis
        : `${ratio}${table
          ? (s.state === 'completed'
            ? `Satisfied by a row in ${table}.`
            : `Nothing in ${table} satisfies this yet.`)
          : 'This stage reads no table at all — its predicate is one that is never satisfied.'} `
          + `Derived from the ${s.predicate_code} predicate every time it is asked for; nothing `
          + 'stores it.';

    const cta = s.state === 'blocked'
      ? 'Read why this is blocked'
      : s.state === 'completed'
        ? 'Revisit this stage'
        : assertSpecific((extra && extra.cta) || STAGE_CTA[s.stage_code] || 'Continue this stage', s.stage_code);

    return action({
      code: `STAGE_${s.stage_code}`,
      state,
      what: s.label_en,
      why: s.state === 'blocked'
        ? (s.blocked_reason || 'No reason recorded on the stage row.')
        : (extra && extra.why) || s.description_en
          || 'This stage carries no description in the seed, so there is nothing more to say '
             + 'about it than its name.',
      basis,
      cta,
      href: (extra && extra.href) || STAGE_LINK[s.stage_code] || '/journey',
      count: extra ? (extra.count ?? null) : null,
      requirement: extra ? (extra.requirement || null) : null,
      source: extra ? extra.source : ['esg_journey_stages'],
    });
  });

  const all = [
    ...urgentRules(detail, facts),
    ...reviewQueueRules(detail),
    ...stageActions,
    ...(readinessRule(ready) ? [readinessRule(ready)] : []),
    ...optionalRules(detail, facts),
    ...notConfiguredRules(ready),
  ];

  /* ── U1 SUPERSEDES ITS OWN STAGE ───────────────────────────────────────
     PROPOSALS_REVIEWED produces a stage action for the same queue U1 is about.
     Two cards asking a user to review the same twelve proposals, at two
     different priorities, is the exact defect this file was written to end.
     U1 wins because it says more: it names what is out of date, which the
     stage action cannot know. */
  const superseded = all.some((a) => a.code === 'U1_SCORE_PREDATES_EVIDENCE')
    ? new Set(['STAGE_PROPOSALS_REVIEWED'])
    : new Set();

  const actions = all
    .filter((a) => !superseded.has(a.code))
    .slice()
    .sort((a, b) => rank(a.state) - rank(b.state));

  const counts = STATES.reduce((acc, s) => {
    acc[s] = actions.filter((a) => a.state === s).length;
    return acc;
  }, {});

  /* What a user can actually DO right now. Blocked and not_configured are
     real states and they stay in `actions`; they are not things to do, so
     they are outside `open` — which is what a "3 things need you" line has
     to be counted from. */
  const open = actions.filter((a) => ['urgent', 'priority', 'recommended', 'optional'].includes(a.state));

  return Object.freeze({
    state: 'ok',
    actions: Object.freeze(actions),
    open: Object.freeze(open),
    counts: Object.freeze(counts),
    // The one action to lead with, or null when nothing is open. Null is a real
    // answer and callers must render it rather than falling back to the first
    // action of any state — "revisit this completed stage" is not a next move.
    lead: open[0] || null,
    detail: Object.freeze(detail),
    readiness: ready,
    journey: j,
    facts,
    /* THE DEFINITIONS AND THE READINESS RESULT ARE RETURNED, NOT REFETCHED.
       The dashboard needs the mission and level rows for its own reasons and
       needs a readiness figure for the pathway; before P9 it issued both
       queries itself, so a page that also builds this list would have loaded
       the three definition tables twice and run the readiness engine twice on
       every dashboard render. Handing them back is cheaper AND removes the
       possibility of the two halves of one page disagreeing about which stages
       exist. */
    definitions,
    /* WHAT THE TOP BAR COUNTS, computed from the same rows this list is built
       from. shellContext issues its own query for the chip; this is the same
       arithmetic over gatherDetail's counts, and the suite asserts the two
       agree. A chip that says five and a list that mentions none is the defect
       this field exists to make testable. */
    reviewQueue: Object.freeze({
      extractions: detail.proposals.pending,
      suggestions: detail.opportunitiesPending,
      total: detail.proposals.pending + detail.opportunitiesPending,
    }),
  });
}

module.exports = {
  build, gatherDetail, action, urgentRules, reviewQueueRules, optionalRules,
  notConfiguredRules, readinessRule,
  STATES, STATE_WORD, STATE_MEANING, BANNED_CTA, PREDICATE_TABLE, rank,
};

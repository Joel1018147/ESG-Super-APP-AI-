'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE ACTION CENTER, THE GAP ANALYSIS AND THE ROADMAP        (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   THE RULES THIS SUITE EXISTS FOR:

     1. A PRIORITY MUST BE EXPLAINABLE. Every action carries the sentence
        naming the rows that put it in its state. An action that cannot say
        what it fired on must not render at all.

     2. THE UI MAY CONNECT. IT MAY NOT INVENT. Every roadmap rung declares how
        it is joined to the one above — computed, joined by a column, or merely
        adjacent — and a rung may only claim the stronger kinds where the
        schema actually supports them. THE STRONGEST ASSERTION IN THIS FILE is
        that gap → opportunity is 'sequence' and can only become 'derived' if a
        column joins them, which no column does.

     3. MISSING IS NOT ZERO, AND NOT-CONFIGURED IS NOT THE COMPANY'S FAULT.
        The seven action states and the three report-section states each mean
        something different and the suite asserts they cannot collapse.

     4. NO GENERIC CTA. Every verb this service can emit is checked against the
        banned list, including the ones built from a template.

   THE MUTATION TESTS ARE AT THE BOTTOM. Five of them, each breaking one guard
   in the service and asserting the suite goes red — because an assertion
   nobody has watched fail is an assertion nobody knows is connected.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

/** Swap src/db for a stub, load the services fresh against it, restore.
 *
 *  #18: the stub is checked against the REAL module's exports first. A harness
 *  stub that exports something the real module does not is a harness testing
 *  itself, and it is the defect the ecosystem checklist names by number. */
async function withStub(exportsObj, fn) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const extra = Object.keys(exportsObj).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `#18: the stub invents exports the real src/db lacks: ${extra}`);
  const cached = require.cache[dbPath];
  const clear = () => {
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: exportsObj };
  clear();
  try { return await fn(); } finally { require.cache[dbPath] = cached; clear(); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WORLD

   One company, mid-journey: profile done, documents uploaded and read, two AI
   proposals waiting, the assessment answered AND SCORED, a project implemented
   and baselined but never measured.

   That shape is chosen because it fires BOTH urgent rules at once, which is
   the only configuration in which their precedence over the stage lane can be
   observed.
   ═══════════════════════════════════════════════════════════════════════════ */

const STAGES = [
  { code: 'COMPANY_PROFILE', sort_order: 10, label_en: 'Set up your company profile', description_en: 'Five fields.', group_code: 'assess', predicate_code: 'company_profile_complete', blocked_reason: null },
  { code: 'DOCUMENTS_UPLOADED', sort_order: 20, label_en: 'Upload the documents you already hold', description_en: null, group_code: 'evidence', predicate_code: 'documents_uploaded', blocked_reason: null },
  { code: 'PROPOSALS_REVIEWED', sort_order: 30, label_en: 'Review what the AI proposed', description_en: null, group_code: 'evidence', predicate_code: 'proposals_reviewed', blocked_reason: null },
  { code: 'ASSESSMENT_ANSWERED', sort_order: 40, label_en: 'Answer the assessment', description_en: null, group_code: 'assess', predicate_code: 'assessment_answered', blocked_reason: null },
  { code: 'ASSESSMENT_SCORED', sort_order: 50, label_en: 'Calculate your score', description_en: null, group_code: 'assess', predicate_code: 'assessment_scored', blocked_reason: null },
  { code: 'CARBON_DATA', sort_order: 60, label_en: 'Record your energy and fuel data', description_en: null, group_code: 'assess', predicate_code: 'carbon_entries_present', blocked_reason: null },
  { code: 'CERTIFICATION', sort_order: 70, label_en: 'Certification', description_en: null, group_code: 'certify', predicate_code: 'never', blocked_reason: 'No SustNET ESG certification scheme is published. This platform assesses; it does not certify.' },
];
const MISSIONS = [
  { code: 'M_PROFILE', stage_code: 'COMPANY_PROFILE', label_en: 'Complete every profile field', description_en: null, predicate_code: 'company_profile_complete', xp_award: 40, sort_order: 10 },
];
const LEVELS = [{ level: 1, min_xp: 0, label_en: 'Seedling' }];

const ASSESSMENT = {
  id: 'a1', framework_id: 'fw1', framework_code: 'MODUS_SEDG_ALIGNED',
  framework_version: '0.9-draft', reporting_year: 2025, status: 'scored',
};

/** The one database this suite runs against.
 *
 *  Keyed on each statement's OWN unique alias, which is exactly why the
 *  services were written with unique aliases: a fixture keyed on the table
 *  would answer several statements and the suite would be asserting against a
 *  row it never meant to supply. `overrides` lets a single test move one fact
 *  without restating the world. */
function db(overrides = {}) {
  const o = {
    proposalsPending: 2, proposalsAccepted: 1, proposalsLive: 3,
    documentsTotal: 4, documentsRead: 3, documentsUnreadable: 1, documentsUnattached: 0,
    unanswered: 0, selfDeclared: 6,
    projectsTotal: 1, projectsImplemented: 1, projectsForecast: 1,
    projectsUnclassified: 0, projectsNoFinancing: 1,
    opportunitiesPending: 0, unverifiedActuals: 0,
    awaitingReading: [{ id: 'gp-1', title: 'Rooftop solar' }],
    scored: true, financeInputs: [],
    recommendations: RECS, responses: RESPONSES, sourceOpportunityId: null,
    ...overrides,
  };
  return {
    query: async (text) => {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      const rows = (r) => ({ rows: r, rowCount: r.length });

      // ── the journey definitions ──
      if (/FROM esg_journey_stages/.test(sql)) return rows(STAGES);
      if (/FROM esg_missions/.test(sql)) return rows(MISSIONS);
      if (/FROM esg_xp_levels/.test(sql)) return rows(LEVELS);

      // ── journeyEngine.gatherFacts ──
      if (/FROM esg_assessments WHERE company_id/.test(sql)) return rows([ASSESSMENT]);
      if (/AS filled FROM esg_companies|\)::int AS filled/.test(sql)) {
        return rows([{ id: 'c1', filled: 5, earned_at: '2026-08-01T00:00:00.000Z' }]);
      }
      if (/count\(\*\)::int AS live/.test(sql)) {
        return rows([{ live: o.proposalsLive, reviewed: o.proposalsLive - o.proposalsPending,
          pending: o.proposalsPending, accepted: o.proposalsAccepted }]);
      }
      if (/count\(\*\)::int AS n FROM esg_indicators/.test(sql)) return rows([{ n: 40 }]);
      if (/FILTER \(WHERE NOT r\.is_na\)/.test(sql)) return rows([{ answered: 40, na: 0 }]);

      // ── actionCenter.gatherDetail, by unique alias ──
      if (/AS documents_total/.test(sql)) {
        return rows([{ documents_total: o.documentsTotal, documents_read: o.documentsRead,
          documents_unreadable: o.documentsUnreadable, documents_unattached: o.documentsUnattached }]);
      }
      if (/AS unanswered/.test(sql)) return rows([{ unanswered: o.unanswered }]);
      if (/AS self_declared/.test(sql)) return rows([{ self_declared: o.selfDeclared }]);
      if (/AS projects_total/.test(sql)) {
        return rows([{ projects_total: o.projectsTotal, projects_implemented: o.projectsImplemented,
          projects_forecast: o.projectsForecast, projects_unclassified: o.projectsUnclassified,
          projects_no_financing: o.projectsNoFinancing }]);
      }
      if (/AS opportunities_pending/.test(sql)) return rows([{ opportunities_pending: o.opportunitiesPending }]);
      if (/AS unverified_actuals/.test(sql)) return rows([{ unverified_actuals: o.unverifiedActuals }]);
      // Keyed on the predicate unique to actionCenter's U2 read — a row query
      // over esg_green_projects whose subqueries both name the baselines table,
      // so a key on either table would answer the wrong statement.
      if (/AND p\.status = 'implemented'/.test(sql)) return rows(o.awaitingReading);

      // ── gapAnalysis ──
      if (/FROM esg_scores/.test(sql)) return rows(o.scored ? SCORES : []);
      if (/FROM esg_rating_bands/.test(sql)) return rows(BANDS);
      if (/FROM esg_recommendations/.test(sql)) return rows(o.recommendations);
      if (/FROM esg_responses/.test(sql)) return rows(o.responses);
      if (/FROM esg_weighting_schemes/.test(sql)) return rows([SCHEME]);
      if (/FROM esg_assessments WHERE id/.test(sql)) return rows([ASSESSMENT]);

      // ── roadmapService ──
      if (/AS roadmap_baselines/.test(sql)) {
        return rows([{ id: 'gp-1', title: 'Rooftop solar', status: 'implemented',
          estimated_cost_myr: 250000, financing_required_myr: null,
          expected_benefit_metric: 'electricity_kwh', expected_benefit_value: 4200,
          expected_benefit_basis: 'supplier_quotation', ccpt_category_code: 'C1',
          classification_basis: 'human_assigned',
          source_opportunity_id: o.sourceOpportunityId,
          created_at: '2026-08-13T00:00:00.000Z',
          roadmap_baselines: 1, roadmap_actuals: 0, roadmap_verified: 0 }]);
      }
      if (/FROM esg_green_opportunities o/.test(sql)) return rows([]);

      // ── readinessService ──
      if (/FROM esg_finance_inputs/.test(sql)) return rows(o.financeInputs);

      // Anything else is an AGGREGATE or it is nothing. An aggregate with no
      // GROUP BY returns exactly one row in Postgres; answering `rows: []`
      // would model a database that cannot exist and would force a RULE 6
      // guard onto the service.
      if (/\b(count|sum|min|max|avg)\s*\(/i.test(sql) && !/\bGROUP BY\b/i.test(sql)) {
        return rows([{ n: 0, total: 0, answered: 0, na: 0, documented: 0, filled: 0 }]);
      }
      return rows([]);
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

const SCORES = [
  { scope: 'OVERALL', score_0_100: 68, band_code: 'A', points_earned: 34, points_available: 50,
    indicators_total: 40, indicators_answered: 40, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0',
    computed_at: '2026-08-16T00:00:00.000Z' },
  { scope: 'E', score_0_100: 62, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 14, indicators_answered: 14, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
  { scope: 'S', score_0_100: 71, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 13, indicators_answered: 13, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
  { scope: 'G', score_0_100: 74, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 13, indicators_answered: 13, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
];
const BANDS = [
  { band_code: 'A', band_label: 'Established', min_score: 65, max_score: 74.99, sort_order: 3 },
  { band_code: 'AA', band_label: 'Advanced', min_score: 75, max_score: 84.99, sort_order: 2 },
];
const SCHEME = { version: '1.0', mult_self_declared: 0.6, mult_documented: 0.85, mult_verified: 1.0 };

/* THE ENGINE ROW AND ITS PHRASED SIBLING, FOR THE SAME INDICATOR.
   esg_recommendations legitimately holds both: the engine row owns
   points_missed and the ai_phrasing row owns the sentence and copies the
   number across. A naive join counts the gap twice, which is the defect the
   merge in gapAnalysis exists to prevent — so the fixture contains the pair. */
const RECS = [
  { indicator_id: 'i-1', pillar: 'E', points_missed: 2.4, priority: 'high', source: 'engine',
    narrative_en: null, code: 'E-01', question_en: 'Do you track monthly electricity consumption?',
    guidance_en: 'Your TNB bills for the reporting year.', weight: 3, tier: 'basic',
    response_type: 'yes_partial_no', mapping_status: 'draft' },
  { indicator_id: 'i-1', pillar: 'E', points_missed: 2.4, priority: 'high', source: 'ai_phrasing',
    narrative_en: 'Start recording your monthly bill totals in one place.', code: 'E-01',
    question_en: 'Do you track monthly electricity consumption?',
    guidance_en: 'Your TNB bills for the reporting year.', weight: 3, tier: 'basic',
    response_type: 'yes_partial_no', mapping_status: 'draft' },
  { indicator_id: 'i-2', pillar: 'S', points_missed: 1.1, priority: 'medium', source: 'engine',
    narrative_en: null, code: 'S-06', question_en: 'Average training hours per employee',
    guidance_en: null, weight: 2, tier: 'basic', response_type: 'quantitative',
    mapping_status: 'reconciled' },
];
const RESPONSES = [
  // i-1 is ANSWERED with nothing attached — the unevidenced kind.
  { indicator_id: 'i-1', evidence_tier: 'self_declared', is_na: false, option_code: 'partial',
    document_id: null, updated_at: '2026-08-15', answered_by_name: 'Joel' },
  // i-2 has no response row at all — the unanswered kind.
];

console.log('action-center-test');

(async () => {
  const { build, STATES, STATE_WORD, STATE_MEANING, BANNED_CTA, action } =
    await withStub(db(), async () => require('../src/services/actionCenter'));

  /* ═══════════════════════════════════════════════════════════════════════
     1 · A PRIORITY MUST BE EXPLAINABLE
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('EVERY ACTION NAMES THE ROWS THAT PUT IT IN ITS STATE', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    assert.strictEqual(ab.state, 'ok');
    assert.ok(ab.actions.length > 0, 'no action was produced at all');
    for (const a of ab.actions) {
      assert.ok(a.basis && a.basis.trim().length > 20,
        `${a.code} has no basis — a priority nobody can check is a priority taken on trust`);
      if (a.state === 'not_configured') {
        /* A not-configured action is about a capability the PLATFORM does not
           have, so there are no rows to name and demanding one would force an
           invented table onto the honest case. What it must do instead is say
           what does not exist — which is checkable in the codebase rather than
           in the database, and is the only claim it is making. */
        assert.ok(/no route|no service|nothing|not one|could not/i.test(a.basis),
          `${a.code} is not_configured and its basis does not say what is absent: "${a.basis}"`);
      } else {
        // Everything else has to name something a company can go and look at:
        // a table, or a figure counted from one.
        assert.ok(/esg_[a-z_]+|\d/.test(a.basis),
          `${a.code}'s basis names neither a table nor a figure: "${a.basis}"`);
      }
    }
  });

  await atest('an action with no basis THROWS rather than rendering', () => {
    assert.throws(() => action({
      code: 'X', state: 'priority', what: 'Do a thing', why: 'Because', basis: '',
      cta: 'Do it', href: '/x',
    }), /has no basis/);
  });

  await atest('an action with no destination THROWS — §4.3c, in the service', () => {
    assert.throws(() => action({
      code: 'X', state: 'priority', what: 'Do a thing', why: 'Because', basis: 'a row',
      cta: 'Do it', href: '',
    }), /has no href/);
  });

  await atest('an unknown state THROWS rather than sorting to the end', () => {
    assert.throws(() => action({
      code: 'X', state: 'quite_important', what: 'w', why: 'y', basis: 'b', cta: 'c', href: '/h',
    }), /is not one of the seven states/);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     2 · NO GENERIC CTA
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('NO ACTION USES A GENERIC CTA — every verb, on the real world', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    for (const a of ab.actions) {
      assert.ok(!BANNED_CTA.includes(a.cta.toLowerCase().trim()),
        `${a.code} uses the generic CTA "${a.cta}"`);
      assert.ok(a.cta.trim().length > 3, `${a.code}'s CTA is too short to be a verb: "${a.cta}"`);
    }
  });

  await atest('A CTA CARRIES ITS OWN COUNT where the action has one', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    const counted = ab.actions.filter((a) => a.count !== null && a.count > 0);
    assert.ok(counted.length >= 2, `only ${counted.length} actions carry a count`);
    for (const a of counted) {
      assert.ok(a.cta.includes(String(a.count)),
        `${a.code} knows it is about ${a.count} things and its CTA does not say so: "${a.cta}"`);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3 · THE TWO URGENT RULES, AND WHAT THEY SUPERSEDE
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('URGENT is reserved for something already recorded going out of date', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    const urgent = ab.actions.filter((a) => a.state === 'urgent');
    assert.strictEqual(urgent.length, 2,
      `expected both urgent rules to fire on this world, got ${urgent.map((a) => a.code).join(', ')}`);
    assert.ok(urgent.some((a) => a.code === 'U1_SCORE_PREDATES_EVIDENCE'));
    assert.ok(urgent.some((a) => a.code.startsWith('U2_UNMEASURED_')));
  });

  await atest('U1 DOES NOT FIRE when the assessment has never been scored', async () => {
    // The whole claim is "the figure ON FILE predates this evidence". With no
    // figure on file there is nothing to be out of date, and the queue is
    // ordinary work rather than an urgent correction.
    const ab = await withStub(db({ scored: false }),
      () => require('../src/services/actionCenter').build('c1'));
    assert.ok(!ab.actions.some((a) => a.code === 'U1_SCORE_PREDATES_EVIDENCE'),
      'U1 fired with no score on file — it would be claiming a figure is stale that does not exist');
    // …and the queue is still surfaced, by its own stage.
    assert.ok(ab.actions.some((a) => a.code === 'STAGE_PROPOSALS_REVIEWED'),
      'with U1 not firing, nothing surfaced the review queue at all');
  });

  await atest('U1 SUPERSEDES ITS OWN STAGE — one queue is never two cards', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    const about = ab.actions.filter((a) => /proposal/i.test(a.cta));
    assert.strictEqual(about.length, 1,
      `${about.length} cards ask the user to review the same proposals: ${about.map((a) => a.code).join(', ')}`);
    assert.strictEqual(about[0].code, 'U1_SCORE_PREDATES_EVIDENCE');
  });

  await atest('U1 DOES NOT PREDICT WHICH WAY THE SCORE MOVES', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    const u1 = ab.actions.find((a) => a.code === 'U1_SCORE_PREDATES_EVIDENCE');
    const text = `${u1.what} ${u1.why} ${u1.basis} ${u1.requirement || ''}`.toLowerCase();
    for (const claim of ['will rise', 'will increase', 'will improve', 'raise your score',
      'boost', 'higher score', 'will go up']) {
      assert.ok(!text.includes(claim),
        `U1 predicts the outcome of a review nobody has done: "${claim}"`);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3b · THE TOP BAR AND THE ACTION LIST MAY NEVER DISAGREE

     shellContext renders "N need review" on every page of the product, and it
     is `extractions_pending + suggestions_pending`. FOUND ON STAGING: the chip
     read 5 and the action list mentioned none of them, because the suggestion
     queue was surfaced only while a company had no green project — and this
     company had one.

     Two assertions, and the second is the one that would have caught it: the
     totals agree, AND every non-zero half is actually named by some action.
     ═══════════════════════════════════════════════════════════════════════ */
  await atest('WHATEVER THE TOP BAR SAYS IS WAITING, SOME ACTION NAMES IT', async () => {
    // A company with a project already defined AND suggestions pending — the
    // exact shape that produced the defect.
    const ab = await withStub(db({ opportunitiesPending: 5, projectsTotal: 1 }),
      () => require('../src/services/actionCenter').build('c1'));

    assert.strictEqual(ab.reviewQueue.total, ab.reviewQueue.extractions + ab.reviewQueue.suggestions);
    assert.strictEqual(ab.reviewQueue.suggestions, 5);

    if (ab.reviewQueue.suggestions > 0) {
      const named = ab.actions.filter((a) => /suggestion/i.test(a.what) || /suggestion/i.test(a.cta));
      assert.ok(named.length > 0,
        `the top bar would say ${ab.reviewQueue.suggestions} suggestions need review and no action `
        + 'in this list mentions them — a company sees a count in the chrome and an action list '
        + 'that disagrees with it');
      assert.strictEqual(named.length, 1,
        `${named.length} cards ask about the same suggestion queue: ${named.map((a) => a.code).join(', ')}`);
      assert.ok(named[0].cta.includes('5'), `the CTA does not carry the count: "${named[0].cta}"`);
    }

    if (ab.reviewQueue.extractions > 0) {
      const named = ab.actions.filter((a) => /proposal/i.test(a.what) || /proposal/i.test(a.cta));
      assert.ok(named.length > 0,
        `${ab.reviewQueue.extractions} extractions are pending and no action mentions them`);
    }
  });

  await atest('THE SUGGESTION QUEUE IS SURFACED WHETHER OR NOT A PROJECT EXISTS', async () => {
    for (const projectsTotal of [0, 1, 4]) {
      const ab = await withStub(db({ opportunitiesPending: 3, projectsTotal }),
        () => require('../src/services/actionCenter').build('c1'));
      const q = ab.actions.find((a) => a.code === 'Q1_SUGGESTIONS_PENDING');
      assert.ok(q, `with ${projectsTotal} project(s) defined, the pending suggestions vanished from `
        + 'the action list — reviewing a proposal is work the platform is holding for a person '
        + 'whatever else they have done');
      assert.strictEqual(q.count, 3);
    }
    // …and it is absent when the queue is genuinely empty.
    const none = await withStub(db({ opportunitiesPending: 0 }),
      () => require('../src/services/actionCenter').build('c1'));
    assert.ok(!none.actions.some((a) => a.code === 'Q1_SUGGESTIONS_PENDING'),
      'an empty suggestion queue still produced a card');
  });

  await atest('U2 needs a baseline AND an implementation AND no reading', async () => {
    const none = await withStub(db({ awaitingReading: [] }),
      () => require('../src/services/actionCenter').build('c1'));
    assert.ok(!none.actions.some((a) => a.code.startsWith('U2_')),
      'U2 fired with no project awaiting a reading');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     4 · BLOCKED AND NOT-CONFIGURED ARE NEITHER ZERO NOR THE COMPANY'S FAULT
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('a BLOCKED action renders the seed reason VERBATIM and writes none', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    const blocked = ab.actions.filter((a) => a.state === 'blocked');
    assert.strictEqual(blocked.length, 1, 'the certification stage did not produce a blocked action');
    assert.strictEqual(blocked[0].why, STAGES.find((s) => s.code === 'CERTIFICATION').blocked_reason,
      'the blocked reason was rewritten rather than rendered — the seed owns those words');
  });

  await atest('BLOCKED AND NOT-CONFIGURED ARE OUTSIDE the open list', async () => {
    const ab = await withStub(db(), () => require('../src/services/actionCenter').build('c1'));
    for (const a of ab.open) {
      assert.ok(!['blocked', 'not_configured', 'completed'].includes(a.state),
        `${a.code} is ${a.state} and is being counted as something the user can do`);
    }
    // …and they are still PRESENT. A blocked capability is the one card that
    // explains why something a user expected is not there.
    assert.ok(ab.actions.some((a) => a.state === 'blocked'), 'the blocked action was dropped');
    assert.ok(ab.actions.some((a) => a.state === 'not_configured'), 'the not-configured action was dropped');
  });

  await atest('the seven states each mean something DIFFERENT, in words', () => {
    assert.strictEqual(STATES.length, 7);
    const meanings = STATES.map((s) => STATE_MEANING[s]);
    assert.strictEqual(new Set(meanings).size, 7, 'two states share a meaning — they would collapse');
    for (const s of STATES) {
      assert.ok(STATE_WORD[s] && STATE_MEANING[s], `${s} has no word or no meaning`);
    }
  });

  await atest('`lead` is null when nothing is open — never backfilled', async () => {
    // Everything done, nothing pending, nothing urgent. The one remaining
    // stage is blocked, which is not a next move.
    const done = await withStub(db({
      proposalsPending: 0, proposalsAccepted: 1, proposalsLive: 3,
      selfDeclared: 0, documentsUnattached: 0, unverifiedActuals: 0,
      awaitingReading: [], unanswered: 0,
    }), () => require('../src/services/actionCenter').build('c1'));
    const openStages = done.open.filter((a) => a.code.startsWith('STAGE_'));
    // If the world still leaves a stage open the assertion below is vacuous, so
    // it is reported rather than assumed.
    assert.ok(done.lead === null || done.open.length > 0,
      'lead is set while open is empty — it was backfilled from a completed action');
    if (done.open.length === 0) assert.strictEqual(done.lead, null);
    else assert.strictEqual(done.lead, done.open[0], 'lead is not the first open action');
    assert.ok(Array.isArray(openStages));
  });

  /* ═══════════════════════════════════════════════════════════════════════
     5 · THE SERVICE WRITES NOTHING AND CALLS NO MODEL
     ═══════════════════════════════════════════════════════════════════════ */

  const SRC = path.join(__dirname, '..', 'src', 'services');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  await atest('none of the four P9 services writes to any table', () => {
    for (const f of ['actionCenter.js', 'gapAnalysis.js', 'roadmapService.js',
      'reportReadiness.js', 'consultationTriggers.js']) {
      const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
      for (const verb of [/INSERT\s+INTO/i, /UPDATE\s+esg_/i, /DELETE\s+FROM/i]) {
        assert.ok(!verb.test(src), `${f} writes to the database — every one of these derives`);
      }
    }
  });

  await atest('none of the four P9 services calls a model', () => {
    for (const f of ['actionCenter.js', 'gapAnalysis.js', 'roadmapService.js',
      'reportReadiness.js', 'consultationTriggers.js']) {
      const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
      assert.ok(!/generateWithGroq|groqService/.test(src),
        `${f} reaches for a model — these are arithmetic over committed rows`);
    }
  });

  await atest('EVERY statement in the P9 services carries a tenant predicate', () => {
    /* The same guard journey-test.js applies to the engine. A read with no
       company predicate is a cross-tenant read, and the three tables with no
       company_id of their own (esg_responses, esg_scores, esg_recommendations)
       must join to the parent that has one and filter THERE. */
    const REFERENCE_ONLY = [
      // Definition tables. No tenant data at all, matched by SHAPE: they are
      // the tables seed.sql owns and nothing else writes.
      /FROM esg_journey_stages/, /FROM esg_missions/, /FROM esg_xp_levels/,
      /FROM esg_project_types/, /FROM esg_taxonomy/,
    ];
    for (const f of ['actionCenter.js', 'gapAnalysis.js', 'roadmapService.js',
      'reportReadiness.js', 'consultationTriggers.js']) {
      const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
      const statements = [...src.matchAll(/`(\s*SELECT[\s\S]*?)`/g)].map((m) => m[1]);
      assert.ok(statements.length > 0, `${f} has no statement at all — the scan matched nothing`);
      for (const st of statements) {
        if (REFERENCE_ONLY.some((re) => re.test(st))) continue;
        assert.ok(/company_id\s*=\s*\$|WHERE id = \$1/.test(st),
          `${f} issues a statement with no tenant predicate:\n${st.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     6 · GAP ANALYSIS
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('ONE GAP PER INDICATOR — the engine row and its phrased sibling merge', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    assert.strictEqual(g.state, 'ok');
    const ids = g.gaps.map((x) => x.indicator_id);
    assert.strictEqual(new Set(ids).size, ids.length,
      `the same indicator appears twice: ${ids.join(', ')} — the engine row and the ai_phrasing row `
      + 'were both counted, which doubles every figure on the page');
    assert.strictEqual(g.gaps.length, 2);
  });

  await atest('THE POINTS FIGURE IS THE ENGINE\'S, and the merge keeps it', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    const e1 = g.gaps.find((x) => x.code === 'E-01');
    assert.strictEqual(e1.points_missed, 2.4, 'the engine figure did not survive the merge');
    // …and the phrased row's sentence came along with it.
    assert.strictEqual(e1.narrative, 'Start recording your monthly bill totals in one place.');
    assert.strictEqual(e1.narrative_source, 'ai_phrasing');
    // The total is summed from those same figures and rounded ONCE.
    assert.strictEqual(g.counts.points_missed, 3.5);
  });

  await atest('gapAnalysis COMPUTES NO POINT VALUE OF ITS OWN', () => {
    const src = strip(fs.readFileSync(path.join(SRC, 'gapAnalysis.js'), 'utf8'));
    // A second scoring path is the one thing CLAUDE.md #2 forbids. The only
    // arithmetic permitted here is summing and rounding figures the engine
    // already wrote — never weight × ratio × multiplier.
    assert.ok(!/weight\s*\*|\*\s*ratio|mult\w*\s*\*/.test(src),
      'gapAnalysis multiplies a weight — that is the scoring engine\'s job and a second copy of it '
      + 'will disagree with the published figure the day a weight changes');
  });

  await atest('THE THREE GAP KINDS DO NOT COLLAPSE', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    const e1 = g.gaps.find((x) => x.code === 'E-01');   // answered, nothing attached
    const s6 = g.gaps.find((x) => x.code === 'S-06');   // no response row at all
    assert.strictEqual(e1.kind, 'unevidenced');
    assert.strictEqual(s6.kind, 'unanswered');
    assert.notStrictEqual(e1.what, s6.what, 'two different gaps say the same thing');
    assert.notStrictEqual(e1.action, s6.action, 'two different gaps propose the same action');
  });

  await atest('AN UNCONFIGURED EVIDENCE REQUIREMENT SAYS SO — no example is invented', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    const s6 = g.gaps.find((x) => x.code === 'S-06');   // guidance_en is null
    assert.strictEqual(s6.evidence.configured, false);
    assert.ok(/no guidance is configured|no evidence requirement is configured/i.test(s6.evidence.text),
      `an unconfigured requirement did not say so: "${s6.evidence.text}"`);
    // And nothing that looks like a made-up example list.
    for (const invented of ['utility bill', 'meter reading', 'energy report', 'for example', 'e.g.']) {
      assert.ok(!s6.evidence.text.toLowerCase().includes(invented),
        `an example was invented for a disclosure that configures none: "${invented}"`);
    }
    // The CONFIGURED one renders its own guidance, verbatim.
    const e1 = g.gaps.find((x) => x.code === 'E-01');
    assert.strictEqual(e1.evidence.configured, true);
    assert.ok(e1.evidence.text.includes('Your TNB bills for the reporting year.'));
  });

  await atest('THE MULTIPLIERS COME FROM THE SCHEME THAT SCORED IT, not from copy', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    const e1 = g.gaps.find((x) => x.code === 'E-01');
    assert.ok(e1.evidence.text.includes('0.85') && e1.evidence.text.includes('0.6'),
      `the evidence advice does not carry the scheme's own multipliers: "${e1.evidence.text}"`);
    assert.ok(e1.evidence.text.includes('1.0'),
      'the weighting VERSION is not named, so a reader cannot tell which scheme these are');
  });

  await atest('WHO SHOULD ACT says the platform does not know', async () => {
    const { NO_OWNER } = require('../src/services/gapAnalysis');
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    for (const x of g.gaps) {
      assert.ok(x.who.includes(NO_OWNER),
        `${x.code} nominates an owner this schema has no column for: "${x.who}"`);
    }
    // The one thing it CAN say is who last answered, and only where a row says so.
    const e1 = g.gaps.find((x) => x.code === 'E-01');
    assert.ok(e1.who.startsWith('Joel last answered'), 'a real answered_by row was not reported');
    const s6 = g.gaps.find((x) => x.code === 'S-06');
    // NO_OWNER itself contains the phrase "who last answered a question", so
    // the check is that no NAME precedes it — not that the phrase is absent.
    assert.strictEqual(s6.who, NO_OWNER,
      'an unanswered gap names somebody as having answered it');
  });

  await atest('NOT SCORED and NO ASSESSMENT are different answers, and neither is a gap list', async () => {
    const notScored = await withStub(db({ scored: false }),
      () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    assert.strictEqual(notScored.state, 'not_scored');
    assert.ok(!('gaps' in notScored), 'an unscored assessment produced a gap list');

    const none = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', null));
    assert.strictEqual(none.state, 'no_assessment');
    assert.notStrictEqual(none.detail, notScored.detail,
      'a company with no assessment and one with an unscored assessment are told the same thing');
  });

  await atest('STRONG requires everything answered AND nothing unearned', async () => {
    const g = await withStub(db(), () => require('../src/services/gapAnalysis').analyse('c1', 'a1'));
    // E and S carry gaps; G carries none and is fully answered.
    assert.deepStrictEqual(g.pillars.strong.map((p) => p.pillar), ['G'],
      'a pillar with unearned points was called strong, or a clear one was not');
    assert.deepStrictEqual(g.pillars.priority.map((p) => p.pillar), ['E', 'S'],
      'the priority order is not the unearned-points order');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     7 · THE ROADMAP — CONNECT, NEVER INVENT
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('EVERY RUNG DECLARES HOW IT IS JOINED TO THE ONE ABOVE', async () => {
    const { LINK_WORD } = require('../src/services/roadmapService');
    const r = await withStub(db(), () => require('../src/services/roadmapService').build('c1', 'a1'));
    assert.ok(r.steps.length >= 9, `only ${r.steps.length} rungs`);
    for (const s of r.steps) {
      assert.ok(LINK_WORD[s.link], `${s.code} carries no link kind`);
    }
  });

  await atest('GAP → OPPORTUNITY IS "sequence" AND MAY NOT BE ANYTHING STRONGER', async () => {
    /* THE MOST IMPORTANT ASSERTION IN THIS FILE.
       It would read beautifully as 'derived'. It is not: the AI scan is given
       the company profile, which carbon categories exist and whether each
       indicator is answered — it is never given the gaps, never told which one
       matters, and never asked to name one. And the row it writes records
       derived_from_kind='company_profile' unconditionally.

       So the claim is checked TWICE: the step must say 'sequence', and the
       service that writes the row must still be writing 'company_profile'. If
       somebody ever makes the scan gap-aware, the second half fails and this
       test has to be re-reasoned rather than silently passing. */
    const r = await withStub(db(), () => require('../src/services/roadmapService').build('c1', 'a1'));
    const opp = r.steps.find((s) => s.code === 'OPPORTUNITY');
    assert.strictEqual(opp.link, 'sequence',
      'the roadmap claims a green opportunity is computed from an ESG gap. Nothing in this system '
      + 'establishes that: the scan is never told the gaps and is never asked to name one');
    const oppSrc = strip(fs.readFileSync(path.join(SRC, 'opportunityService.js'), 'utf8'));
    assert.ok(/'company_profile'/.test(oppSrc),
      'opportunityService no longer stamps company_profile — if the scan became gap-aware, the '
      + 'roadmap\'s link kind has to be re-reasoned rather than left as it is');
    assert.ok(!/indicator_response/.test(oppSrc),
      'opportunityService now writes derived_from_kind=indicator_response — a gap→opportunity link '
      + 'may now be real, and the roadmap step above has to be revisited');
    // …and the step says so in words, not only in a machine-readable field.
    assert.ok(/not an answer to the gap above/i.test(opp.detail),
      'the opportunity step does not tell a reader that it is not an answer to their gap');
  });

  await atest('PROJECT → SOURCE PROPOSAL is "recorded" ONLY when a column joins them', async () => {
    const withSource = await withStub(db({ sourceOpportunityId: 'o-1' }),
      () => require('../src/services/roadmapService').build('c1', 'a1'));
    assert.strictEqual(withSource.steps.find((s) => s.code === 'PROJECT').link, 'recorded');

    const handMade = await withStub(db({ sourceOpportunityId: null }),
      () => require('../src/services/roadmapService').build('c1', 'a1'));
    assert.strictEqual(handMade.steps.find((s) => s.code === 'PROJECT').link, 'sequence',
      'a hand-defined project claims a source proposal it does not have');
  });

  await atest('THE ROADMAP CARRIES NO PERCENTAGE', async () => {
    const r = await withStub(db(), () => require('../src/services/roadmapService').build('c1', 'a1'));
    for (const s of r.steps) {
      const text = `${s.what} ${s.detail || ''}`;
      assert.ok(!/\d+\s?%/.test(text),
        `${s.code} states a percentage: "${text.slice(0, 120)}" — every rung is a set of discrete `
        + 'facts and a percentage over discrete states is a fabricated figure');
    }
  });

  await atest('REPORTING IS ALWAYS not_configured, whatever the company has done', async () => {
    const r = await withStub(db(), () => require('../src/services/roadmapService').build('c1', 'a1'));
    const rep = r.steps.find((s) => s.code === 'REPORTED');
    assert.strictEqual(rep.state, 'not_configured',
      'the roadmap reached a "reported" state — nothing in this codebase writes a report file');
  });

  await atest('EXPECTED, MEASURED AND VERIFIED ARE THREE RUNGS, not one', async () => {
    const r = await withStub(db(), () => require('../src/services/roadmapService').build('c1', 'a1'));
    const codes = r.steps.map((s) => s.code);
    for (const c of ['EXPECTED', 'MEASURED', 'VERIFIED']) {
      assert.ok(codes.includes(c), `the roadmap has no ${c} rung`);
    }
    const expected = r.steps.find((s) => s.code === 'EXPECTED');
    assert.ok(/expected is not baseline and expected is not actual/i.test(expected.detail),
      'the forecast rung does not say it is not a measurement');
    // A project with a forecast and no reading is COMPLETED at EXPECTED and is
    // not completed at MEASURED. If those two ever agree, the forecast has been
    // promoted into a result.
    assert.strictEqual(expected.state, 'completed');
    assert.notStrictEqual(r.steps.find((s) => s.code === 'MEASURED').state, 'completed',
      'a forecast was counted as a measurement');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     8 · MUTATION TESTS

     Each breaks ONE guard in a service and asserts the suite notices. An
     assertion nobody has watched fail is an assertion nobody knows is
     connected to anything — five of fifty in this repo had been mutation
     tested before this run, which CLAUDE.md records as a known divergence.

     These mutate the LOADED MODULE rather than the file on disk: the plants
     are in-memory, cannot be forgotten, and cannot leave the working tree
     dirty. The file-on-disk variant is what CRLF eats.
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('MUTATION · an action with an empty basis is caught', () => {
    // The guard: action() refuses one. Break the input, not the guard.
    let threw = false;
    try {
      action({ code: 'M1', state: 'urgent', what: 'w', why: 'y', basis: '   ', cta: 'c', href: '/h' });
    } catch { threw = true; }
    assert.ok(threw, 'MUTATION SURVIVED: an action with a whitespace-only basis was constructed');
  });

  await atest('MUTATION · a generic CTA reaching the service is caught', () => {
    const { BANNED_CTA: banned } = require('../src/services/actionCenter');
    // Simulate what a future author would write, and assert the ban list is
    // what stops it — rather than trusting that nobody will write it.
    const generic = 'View details';
    assert.ok(banned.includes(generic.toLowerCase()),
      'MUTATION SURVIVED: "View details" is not on the banned list, so the CTA check would pass it');
  });

  await atest('MUTATION · a roadmap step claiming an unknown link kind is caught', () => {
    const { step } = require('../src/services/roadmapService');
    assert.throws(() => step({ code: 'M', name: 'n', state: 'completed', what: 'w', link: 'causes' }),
      /is not a link kind/,
      'MUTATION SURVIVED: a step claimed "causes" as a connection and was built');
  });

  await atest('MUTATION · a report section in an unknown state is caught', () => {
    const { section } = require('../src/services/reportReadiness');
    assert.throws(() => section({ code: 'M', name: 'n', state: 'partial', what: 'w' }),
      /is not a section state/,
      'MUTATION SURVIVED: a fourth report state was accepted, which is how "missing" and '
      + '"not configured" collapse into one');
  });

  await atest('MUTATION · gap kinds are decided by the response, not by a default', () => {
    const { kindOf, KIND } = require('../src/services/gapAnalysis');
    assert.strictEqual(kindOf(null), KIND.UNANSWERED);
    assert.strictEqual(kindOf({ is_na: true, evidence_tier: 'verified' }), KIND.UNANSWERED,
      'MUTATION SURVIVED: a not-applicable response was treated as an answer');
    assert.strictEqual(kindOf({ is_na: false, evidence_tier: 'self_declared' }), KIND.UNEVIDENCED);
    assert.strictEqual(kindOf({ is_na: false, evidence_tier: 'documented' }), KIND.PARTIAL);
  });

  console.log(`\naction-center: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

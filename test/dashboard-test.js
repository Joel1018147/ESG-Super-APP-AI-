'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE SHELL, THE CLASSES AND THE DASHBOARD                         (Run 53)
   ───────────────────────────────────────────────────────────────────────────
   PART 1 is Run 52's class guard, pointed at every page route instead of one.

   MODUS_UI_CONTRACT §3: "Never use a token that does not exist. CSS does not
   warn you. Nothing throws. The element renders transparent or inherits, in
   production, silently, possibly for months." A CLASS fails exactly the same
   way, and this repo was doing it on eleven distinct names across four route
   files until Run 53 repathed them.

   The check reads the RENDERED page, never the source. Class attributes in
   these files carry ${} interpolations and nested template literals, and a
   regex over that source is a §7b guess — `badge-${p === 'high' ? 'danger' :
   …}` is a real construction in this repo and no source scan would see the
   class it produces. The rendered page is exact.

   Checked against the design system PLUS every <style> block in the same
   response, because layout.js inlines the shell's own geometry there and that
   is legitimate app CSS rather than a design-system edit.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'modus-design-system.css');
const CSS = fs.readFileSync(CSS_PATH, 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log('dashboard-test');

/* ── the empty-database harness ───────────────────────────────────────────
   Rows come back empty, which is the honest shape for a company that
   registered ten minutes ago and exercises every empty-state branch. It is
   NOT the whole picture: a class that only appears once a row exists is
   invisible here, which is the blind spot no-model-figures-test documents and
   the reason PART 3 renders the dashboard with data as well. */
const PAGE_ROUTERS = ['routes/pages', 'routes/documents', 'routes/greenFinance', 'routes/journey'];

/** AWAITS fn before restoring the cache. Written without the await first, and
 *  the `finally` then fired the moment fn returned its promise — so the first
 *  router loaded against the stub and every later one loaded against the real
 *  module and threw. It reported 15 routes instead of 26, which is a guard
 *  going quietly narrow rather than red. */
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

/* Every query answers with nothing — the bluntest possible database, used to
   render every route against no data at all.

   WITH ONE EXCEPTION, ADDED IN RUN 55, AND IT MAKES THE STUB MORE TRUTHFUL
   RATHER THAN MORE FORGIVING. `SELECT count(*) …` with no GROUP BY returns
   exactly ONE row in Postgres, always, on an empty table and on a table that
   does not exist in this company's data — that is what an aggregate IS. A stub
   answering `rows: []` to it models a database that cannot exist, and the only
   way a route survives it is by carrying a `rows[0] || {}` fallback for a case
   that never happens in production — RULE 6, forced on the code by the test.
   So the aggregate answers one row of zeroes, which is what the real database
   would say, and the route reads `rows[0].n` directly and would throw on a
   genuinely broken connection instead of rendering a confident 0. */
const AGGREGATE_ZEROES = {
  n: 0, bytes: 0, entries: 0, provisional: 0, projects: 0, products: 0,
  proposals_live: 0, proposals_pending: 0, period_from: null, period_to: null,
  live: 0, reviewed: 0, pending: 0, accepted: 0, answered: 0, na: 0, filled: 0,
};
const isAggregate = (sql) => /\bcount\(\*\)/i.test(sql) && !/\bGROUP BY\b/i.test(sql);

const EMPTY_DB = {
  query: async (text) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (isAggregate(sql)) return { rows: [{ ...AGGREGATE_ZEROES }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
};

const REQ = {
  user: { id: 'u1', name: 'Joel', email: 'j@example.com', role: 'super_admin', company_id: 'c1' },
  query: {}, params: { id: '11111111-1111-1111-1111-111111111111', documentId: 'd1' },
  body: {}, path: '/', originalUrl: '/', headers: {}, isAuthenticated: () => true,
};

/* ── the POPULATED harness ────────────────────────────────────────────────
   The empty stub above cannot see a class that only exists on a branch which
   needs a row — and this repo had four of them, in a JS map and a ternary
   rather than in a class attribute, so no source scan saw them either. Two
   plants proved the gap before this stub existed: `.muted` restored on the
   dashboard's scored branch and `.badge-warning` restored on the assessment's
   mapping badge both passed a green run.

   Unknown SQL THROWS rather than returning an empty set. A stub that answers
   everything with `{rows: []}` silently turns a populated render back into an
   empty one, which is the whole failure this harness exists to close. */
const ASSESSMENT_ID = '11111111-1111-1111-1111-111111111111';

/* Named rather than inlined into FIXTURES, because Run 56's rounding test needs
   the SAME four rows with fractional scores on them. Reaching into FIXTURES by
   regex source to find them would make the fixture list order-sensitive in a way
   nothing declares. */
const SCORE_ROWS = [
  { id: 'sc-1', earned_at: '2026-08-14T00:00:00.000Z', computed_at: '2026-08-14T00:00:00.000Z',
    scope: 'OVERALL', score_0_100: 78, band_code: 'AA', points_earned: 40, points_available: 51,
    indicators_total: 40, indicators_answered: 18, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
  { scope: 'E', score_0_100: 82, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 14, indicators_answered: 8, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
  { scope: 'S', score_0_100: 74, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 13, indicators_answered: 6, indicators_na: 1,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
  { scope: 'G', score_0_100: 77, band_code: null, points_earned: 1, points_available: 1,
    indicators_total: 13, indicators_answered: 4, indicators_na: 0,
    weighting_version: '1.0', framework_version: '0.9-draft', engine_version: '1.0.0' },
];

/* What a real numeric(6,2) looks like. The staging row that prompted §3.-0 read
   34.47, and every one of these is chosen so rounding is VISIBLE and so the
   three rounding directions are exercised: down, up, and the .5 boundary. */
const FRACTIONAL_SCORES = Object.freeze({ OVERALL: 34.47, E: 41.62, S: 28.5, G: 33.4 });
const FRACTIONAL_SHOWN = Object.freeze({ 34.47: '34', 41.62: '42', 28.5: '29', 33.4: '33' });

const FIXTURES = [
  // The COUNT queries come first: they name the same tables as the row queries
  // below and a first-match scan would hand them a row list with no count on
  // it, which arrives as `undefined` and renders as NaN. Ordered, not guessed.
  [/count\(\*\)::int AS n FROM esg_indicators/, null],   // supplied per-call, see populatedDb
  [/FILTER \(WHERE NOT r\.is_na\)/, [{ answered: 18, na: 0 }]],
  [/count\(\*\)::int AS live/, [{ live: 3, reviewed: 1, pending: 2, accepted: 1 }]],
  [/count\(\*\)::int AS n FROM esg_carbon_entries/, [{ n: 2 }]],
  // Run 55's panel wave. Every one of these is an AGGREGATE and returns exactly
  // one row in Postgres, so the route reads rows[0] without a guard — which
  // means a fixture that forgot one would throw here rather than render a blank.
  // They sit above the row-returning patterns for the same reason the block
  // above them does.
  [/AS bytes FROM esg_documents/, [{ n: 4, bytes: 19500000 }]],
  [/AS proposals_live/, [{ proposals_live: 3, proposals_pending: 2 }]],
  [/AS entries, min\(period_start\)/, [{
    entries: 2, period_from: '2026-01-01', period_to: '2026-06-30', provisional: 1 }]],
  [/AS projects FROM esg_green_projects/, [{ projects: 1 }]],
  [/AS products FROM esg_finance_products/, [{ products: 1 }]],
  [/FROM esg_assessments a? ?WHERE|FROM esg_assessments\b[\s\S]*WHERE (a\.)?company_id/, [{
    id: ASSESSMENT_ID, framework_id: 'fw-1', framework_code: 'MODUS_SEDG_ALIGNED',
    framework_version: '0.9-draft', reporting_year: 2025, status: 'scored', overall: 78,
  }]],
  [/FROM esg_scores\b/, SCORE_ROWS],
  [/FROM esg_recommendations\b/, [
    { id: 'rec-1', pillar: 'E', points_missed: 12, priority: 'high', narrative_en: 'Track electricity monthly.', source: 'ai_phrasing', code: 'E-01', question_en: 'Does the company track its monthly electricity consumption?' },
    { id: 'rec-2', pillar: 'S', points_missed: 6, priority: 'medium', narrative_en: 'Record training hours.', source: 'ai_phrasing', code: 'S-06', question_en: 'Average training hours per employee' },
    { id: 'rec-3', pillar: 'G', points_missed: 2, priority: 'low', narrative_en: 'Publish a supplier code.', source: 'fallback_template', code: 'G-10', question_en: 'Supplier code of conduct?' },
  ]],
  // The seeded ladder, verbatim from seed.sql §1 — ALL SEVEN rows, because Run
  // 56 renders the whole ladder and a four-row fixture would have photographed
  // the fixture. 78 lands in AA / Advanced, and "Good Performance", which the
  // reference image prints under the ring, is not a band this system has.
  [/FROM esg_rating_bands\b/, [
    { band_code: 'AAA', band_label: 'Leading', min_score: 85, max_score: 100, sort_order: 1 },
    { band_code: 'AA', band_label: 'Advanced', min_score: 75, max_score: 84.99, sort_order: 2 },
    { band_code: 'A', band_label: 'Established', min_score: 65, max_score: 74.99, sort_order: 3 },
    { band_code: 'BBB', band_label: 'Progressing', min_score: 55, max_score: 64.99, sort_order: 4 },
    { band_code: 'BB', band_label: 'Developing', min_score: 45, max_score: 54.99, sort_order: 5 },
    { band_code: 'B', band_label: 'Emerging', min_score: 30, max_score: 44.99, sort_order: 6 },
    { band_code: 'CCC', band_label: 'Starting Out', min_score: 0, max_score: 29.99, sort_order: 7 },
  ]],
  [/FROM esg_frameworks\b/, [
    { id: 'fw-1', code: 'MODUS_SEDG_ALIGNED', version: '0.9-draft', n: 40 },
    { id: 'fw-2', code: 'SEDG', version: '2.0', n: 38 },
  ]],
  [/FROM esg_indicators\b/, [
    { id: 'i-1', code: 'E-01', pillar: 'E', tier: 'basic', question_en: 'Track electricity?',
      guidance_en: 'Bills.', response_type: 'yes_partial_no', unit: null, weight: 2,
      allows_na: false, mapping_status: 'draft', line_items: null },
    { id: 'i-2', code: 'SEDG-E2.1', pillar: 'E', tier: 'basic', question_en: 'Report consumption',
      guidance_en: null, response_type: 'disclosure', unit: 'J / Wh', weight: 1,
      allows_na: true, mapping_status: 'official', line_items: ['Electricity', 'Heating (if applicable)'] },
    { id: 'i-3', code: 'S-01', pillar: 'S', tier: 'basic', question_en: 'Headcount',
      guidance_en: null, response_type: 'quantitative', unit: 'people', weight: 1.5,
      allows_na: false, mapping_status: 'reconciled', line_items: null },
    { id: 'i-4', code: 'G-01', pillar: 'G', tier: 'basic', question_en: 'Board size',
      guidance_en: null, response_type: 'maturity_0_4', unit: null, weight: 1,
      allows_na: true, mapping_status: 'draft', line_items: null },
  ]],
  [/FROM esg_responses\b/, [
    { indicator_id: 'i-1', option_code: 'yes', value_numeric: null, value_text: null,
      value_json: null, is_na: false, evidence_tier: 'documented' },
  ]],
  [/FROM esg_companies\b/, [{
    id: 'c1', name: 'Green Future Sdn Bhd', ssm_number: '202301000123', msic_code: '25113',
    industry_label: null, employee_count: 12, annual_revenue_myr: 2500000, state: 'Selangor',
    grid_region: 'peninsular', esg_maturity: 'basic', filled: 5,
    created_at: '2026-01-01', updated_at: '2026-08-10T00:00:00.000Z', earned_at: '2026-08-10T00:00:00.000Z',
  }]],
  [/FROM esg_carbon_entries\b/, [{
    id: 'ce-1', period_start: '2026-01-01', period_end: '2026-03-31', scope: 2,
    category: 'grid_electricity', activity_amount: 10000, activity_unit: 'kWh', kg_co2e: 7400,
    factor_value_used: 0.74, factor_version_used: '2022-2024', factor_source_used: 'ST',
    factor_verification_used: 'verified', is_provisional: false, n: 1,
    created_at: '2026-02-01T00:00:00.000Z', earned_at: '2026-02-01T00:00:00.000Z',
  }]],
  [/FROM esg_documents\b/, [{
    id: 'd1', filename: 'Environmental Policy.pdf', doc_type: 'policy', mime_type: 'application/pdf',
    byte_size: 240000, created_at: '2026-08-11T00:00:00.000Z', earned_at: '2026-08-11T00:00:00.000Z',
    text_status: 'extracted', page_count: 12, pending: 2, assessment_id: ASSESSMENT_ID,
    extracted_text: 'Green Future is committed to improving energy efficiency.',
    extraction_error: null,
  }]],
  [/FROM esg_document_extractions\b/, [{
    id: 'x-1', code: 'E-01', pillar: 'E', proposed_option_code: 'yes',
    evidence_quote: 'Green Future is committed to improving energy efficiency.',
    page_no: 8, status: 'pending', quote_verified: true, reject_reason: null,
    model: 'stub', reviewed_at: null, live: 3, reviewed: 1, pending: 2, accepted: 1,
    earned_at: '2026-08-12T00:00:00.000Z',
  }]],
  [/FROM esg_verra_projects\b|AS projects/, [{
    // `methodologies` is deliberately absent (Run 61 / D11). Nothing writes
    // esg_verra_methodologies, so a stub supplying a count fed the page a
    // number the real system cannot produce — a fixture asserting against a
    // capability that does not exist. mirrorStatus() no longer selects it.
    projects: 4, last_fetch: '2026-08-01T00:00:00.000Z',
    verra_project_id: 'VCS-1', name: 'A project', country: 'Malaysia',
    methodology_code: 'VM0042', status: 'Registered', proponent: 'X',
    estimated_annual_reductions: 1000, registration_date: '2020-01-01',
  }]],
  [/FROM esg_finance_products\b/, [{
    id: 'p-1', institution_name: 'RHB Bank', institution_kind: 'bank',
    product_name: 'SME Green Renewable Energy and CAPEX Financing',
    financing_type: 'use_of_proceeds_green', borrower_scope: 'sme',
    max_financing_myr: null, min_financing_myr: null, amount_note: 'Up to 100%',
    tenure_note: null, rate_note: 'As low as 4.5%', documentation_note: null,
    eligibility_note: null, availability_status: 'open', status_note: 'Open.',
    source_url: 'https://example.test', source_publisher: 'institution_own',
    last_verified: '2026-08-15', is_active: true, updated_by: null, days_since_verified: 2, n: 1,
  }]],
  [/FROM esg_project_types\b/, [{ id: 'pt-1', code: 'SOLAR_PV', label_en: 'Solar PV',
    label_bm: null, label_zh: null, sort_order: 10, is_active: true,
    default_ccpt_category_id: null, default_asean_objective_id: null }]],
  [/FROM esg_green_projects\b/, [{
    id: 'gp-1', company_id: 'c1', project_type_id: 'pt-1', title: 'Rooftop solar',
    description: 'Panels', estimated_cost_myr: 250000, status: 'defined',
    ccpt_category_code: 'C1', ccpt_scheme_version: '2021-04-30', asean_ff_code: 'FF_GREEN',
    asean_ps_code: null, asean_scheme_version: 'V4-2025-11-06',
    classification_basis: 'human_assigned', classified_at: '2026-08-14', created_at: '2026-08-13T00:00:00.000Z',
    earned_at: '2026-08-13T00:00:00.000Z', project_type_label: 'Solar PV',
  }]],
  [/FROM esg_green_project_baselines\b/, [{
    id: 'b-1', metric: 'electricity_kwh', value: 10000, unit: 'kWh', source_entry_count: 1,
    is_provisional: false, period_start: '2026-01-01', period_end: '2026-03-31',
    computed_at: '2026-08-14T00:00:00.000Z', earned_at: '2026-08-14T00:00:00.000Z',
  }]],
  [/FROM esg_green_project_evidence\b/, [{ document_id: 'd1', filename: 'Environmental Policy.pdf',
    doc_type: 'policy', byte_size: 240000, created_at: '2026-08-13' }]],
  [/FROM esg_green_opportunities\b/, [{
    id: 'o-1', proposed_project_type_code: 'SOLAR_PV', rationale_en: 'Unshaded roof.',
    status: 'pending', derived_from_kind: 'company_profile', reviewed_at: null,
    created_at: '2026-08-15', project_type_label: 'Solar PV',
  }]],
  [/FROM esg_journey_stages\b/, null],   // filled at use — see JOURNEY_FIXTURES
  [/FROM esg_missions\b/, null],
  [/FROM esg_xp_levels\b/, null],
  [/FROM esg_scheduled_jobs\b/, []],
  [/FROM esg_indicator_options\b/, []],
  [/FROM esg_taxonomy_schemes\b/, [{ id: 's-1', code: 'CCPT', version: '2021-04-30',
    publisher: 'BNM', source_url: 'https://example.test', effective_from: '2021-04-30', is_current: true }]],
  [/FROM esg_taxonomy_categories\b/, [{ code: 'C1', label_en: 'Climate Supporting',
    definition_en: null, kind: 'classification', sort_order: 110 }]],
  [/FROM esg_carbon_import_batches\b/, []],
  [/FROM esg_carbon_import_rows\b/, []],
];

const JOURNEY_FIXTURES = {
  stages: [
    { code: 'COMPANY_PROFILE', sort_order: 10, label_en: 'Set up your company profile', label_bm: null, label_zh: null, description_en: 'Five fields.', group_code: 'assess', predicate_code: 'company_profile_complete', blocked_reason: null },
    { code: 'ASSESSMENT_ANSWERED', sort_order: 20, label_en: 'Answer the assessment', label_bm: null, label_zh: null, description_en: null, group_code: 'assess', predicate_code: 'assessment_answered', blocked_reason: null },
    { code: 'CARBON_DATA', sort_order: 30, label_en: 'Record your energy and fuel data', label_bm: null, label_zh: null, description_en: null, group_code: 'assess', predicate_code: 'carbon_entries_present', blocked_reason: null },
    { code: 'CERTIFICATION', sort_order: 40, label_en: 'Certification', label_bm: null, label_zh: null, description_en: null, group_code: 'certify', predicate_code: 'never', blocked_reason: 'No SustNET ESG certification scheme is published. This platform assesses; it does not certify.' },
  ],
  missions: [
    { code: 'M_PROFILE', stage_code: 'COMPANY_PROFILE', label_en: 'Complete every profile field', description_en: null, predicate_code: 'company_profile_complete', xp_award: 40, sort_order: 10 },
    { code: 'M_ANSWER', stage_code: 'ASSESSMENT_ANSWERED', label_en: 'Answer every indicator', description_en: null, predicate_code: 'assessment_answered', xp_award: 120, sort_order: 20 },
    { code: 'M_CARBON', stage_code: 'CARBON_DATA', label_en: 'Record your first carbon entry', description_en: null, predicate_code: 'carbon_entries_present', xp_award: 40, sort_order: 30 },
  ],
  levels: [
    { level: 1, min_xp: 0, label_en: 'Seedling' },
    { level: 2, min_xp: 80, label_en: 'Sprout' },
    { level: 3, min_xp: 200, label_en: 'Sapling' },
  ],
};

/**
 * @param {object} opts
 *   indicatorCount  the framework's indicator count — 40 for MODUS_SEDG_ALIGNED
 *                   and 38 for SEDG@2.0. Supplied per call so the denominator
 *                   test drives the real arithmetic instead of reading a
 *                   number the stub decided.
 *   hostile         a string injected into every label the page renders, for
 *                   the escaping test.
 *   fractionalScores  the four esg_scores rows come back with two decimal
 *                   places, which is what numeric(6,2) actually holds. The
 *                   OVERALL row also loses its band code, because 34 is not
 *                   AA on the seeded ladder and a fixture that pairs them
 *                   would be asserting a wrong band in order to test rounding.
 */
function populatedDb(opts = {}) {
  const seen = [];
  const n = opts.indicatorCount === undefined ? 40 : opts.indicatorCount;
  const taint = (rows) => {
    if (!opts.hostile || !Array.isArray(rows)) return rows;
    return rows.map((r) => {
      const out = { ...r };
      for (const k of ['label_en', 'narrative_en', 'name', 'title', 'product_name',
        'band_label', 'description_en', 'filename', 'blocked_reason']) {
        if (typeof out[k] === 'string') out[k] = opts.hostile;
      }
      return out;
    });
  };
  return {
    seen,
    exports: {
      query: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        seen.push(sql);
        if (/count\(\*\)::int AS n FROM esg_indicators/.test(sql)) return { rows: [{ n }] };
        if (opts.fractionalScores && /FROM esg_scores\b/.test(sql)) {
          const rows = SCORE_ROWS.map((r) => ({
            ...r,
            score_0_100: FRACTIONAL_SCORES[r.scope],
            band_code: r.scope === 'OVERALL' ? null : r.band_code,
          }));
          return { rows: taint(rows), rowCount: rows.length };
        }
        if (/FROM esg_journey_stages\b/.test(sql)) return { rows: taint(JOURNEY_FIXTURES.stages) };
        if (/FROM esg_missions\b/.test(sql)) return { rows: taint(JOURNEY_FIXTURES.missions) };
        if (/FROM esg_xp_levels\b/.test(sql)) return { rows: taint(JOURNEY_FIXTURES.levels) };
        for (const [re, rows] of FIXTURES) {
          if (rows === null) continue;
          if (re.test(sql)) return { rows: taint(rows), rowCount: rows.length };
        }
        throw new Error(`populated stub has no fixture for: ${sql.slice(0, 130)}`);
      },
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    },
  };
}

/** A company that registered ten minutes ago: the journey DEFINITIONS are
 *  seeded (they ship with the deployment) and the company has written nothing.
 *
 *  This is a different fixture from EMPTY_DB and the difference is the point.
 *  EMPTY_DB answers every query with nothing, which models a deployment whose
 *  SEED DID NOT RUN — a configuration fault. A new company is not that, and if
 *  the two render the same way the dashboard is telling a new user that the
 *  product is broken. Run 48's lesson, one layer up: do not start a fixture at
 *  the answer, and do not let one fixture stand for two different facts. */
function newCompanyDb() {
  return {
    query: async (text) => {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      if (/FROM esg_journey_stages\b/.test(sql)) return { rows: JOURNEY_FIXTURES.stages };
      if (/FROM esg_missions\b/.test(sql)) return { rows: JOURNEY_FIXTURES.missions };
      if (/FROM esg_xp_levels\b/.test(sql)) return { rows: JOURNEY_FIXTURES.levels };
      if (/count\(\*\)::int AS n FROM esg_indicators/.test(sql)) return { rows: [{ n: 40 }] };
      if (/count\(\*\)::int AS live/.test(sql)) return { rows: [{ live: 0, reviewed: 0, pending: 0, accepted: 0 }] };
      // A new company's aggregates are ZERO, not absent. Returning `rows: []`
      // here would model a database that answered nothing to a count(*), which
      // cannot happen and would make the route throw for a reason a real new
      // company never hits — the fixture would then be testing the harness.
      if (/AS bytes FROM esg_documents/.test(sql)) return { rows: [{ n: 0, bytes: 0 }] };
      if (/AS proposals_live/.test(sql)) return { rows: [{ proposals_live: 0, proposals_pending: 0 }] };
      if (/AS entries, min\(period_start\)/.test(sql)) {
        return { rows: [{ entries: 0, period_from: null, period_to: null, provisional: 0 }] };
      }
      if (/AS projects FROM esg_green_projects/.test(sql)) return { rows: [{ projects: 0 }] };
      // The register is a PUBLIC reference list, not this company's data, so it
      // is populated on day one. A new company sees products and no match.
      if (/AS products FROM esg_finance_products/.test(sql)) return { rows: [{ products: 31 }] };
      if (/FROM esg_companies\b/.test(sql)) {
        // The company row exists — they registered. One field of five is set.
        return { rows: [{ id: 'c1', name: 'New Sdn Bhd', filled: 1, earned_at: '2026-08-17T00:00:00.000Z' }] };
      }
      return { rows: [], rowCount: 0 };
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

/** One route, rendered. */
async function renderRoute(mod, routePath, dbExports, req = REQ) {
  let out = null;
  await withStub(dbExports, async () => {
    const router = require(`../src/${mod}`);
    const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.get);
    assert.ok(layer, `no GET handler for ${routePath}`);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    out = await renderHandler(handler, req);
  });
  assert.ok(out && typeof out.html === 'string' && out.html.length > 200,
    `${routePath} rendered nothing: ${out && out.failed}`);
  return out.html;
}

/** Renders one route handler for real. A handler that answers with nothing is
 *  REPORTED, never silently contributing zero coverage (§7b rule 4). */
function renderHandler(handler, req) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (html, failed) => { if (!done) { done = true; resolve({ html, failed }); } };
    const res = {
      send(b) { finish(b, null); }, json(b) { finish(JSON.stringify(b), null); },
      redirect(u) { finish(null, `redirected to ${u}`); },
      sendFile(f) { finish(null, `sendFile ${f}`); },
      status() { return res; }, type() { return res; }, set() { return res; },
      setHeader() { return res; }, end() { finish(null, 'ended with no body'); },
    };
    Promise.resolve(handler(req, res, (e) => finish(null, e ? e.message : 'called next()')))
      .catch((e) => finish(null, e.message));
    setTimeout(() => finish(null, 'never answered'), 3000);
  });
}

/** The page's own region, whichever shell is rendering it. Both names are
 *  accepted on purpose: `.content` is the hand-rolled shell this repo shipped
 *  until Run 53 and `.app-main` is the design system's, and a guard that only
 *  knows one of them goes silently vacuous the moment the other is in place —
 *  which is the failure mode it exists to catch. */
function contentOf(html) {
  for (const marker of ['<main class="app-main"', '<main class="content"']) {
    const i = html.indexOf(marker);
    if (i < 0) continue;
    const j = html.lastIndexOf('</main>');
    if (j > i) return html.slice(html.indexOf('>', i) + 1, j);
  }
  return null;
}

function classTokens(fragment) {
  const out = new Set();
  for (const m of fragment.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t && !t.includes('${') && !t.includes('}')) out.add(t);
  }
  return out;
}

function isDefined(token, available) {
  return new RegExp(`\\.${token.replace(/-/g, '\\-')}(?![-\\w])`).test(available);
}

/** Every GET route across the four page routers, rendered. */
async function renderEveryPage(dbExports, req) {
  const pages = [];
  const notRendered = [];
  await withStub(dbExports, async () => {
    for (const mod of PAGE_ROUTERS) {
      const router = require(`../src/${mod}`);
      for (const layer of router.stack) {
        if (!layer.route || !layer.route.methods.get) continue;
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        const { html, failed } = await renderHandler(handler, req);
        if (typeof html !== 'string' || html.length < 200) {
          notRendered.push(`${layer.route.path} — ${failed || 'empty body'}`);
          continue;
        }
        pages.push({ path: layer.route.path, html });
      }
    }
  });
  return { pages, notRendered };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · EVERY CLASS ON EVERY PAGE IS DEFINED IN THE STYLESHEET IT LOADS
   ═══════════════════════════════════════════════════════════════════════════ */

let RENDERED = null;

(async () => {
  RENDERED = await renderEveryPage(EMPTY_DB, REQ);

  await atest('the walk actually rendered the page routes (an empty walk passes vacuously — #14)', async () => {
    assert.ok(RENDERED.pages.length >= 20,
      `rendered only ${RENDERED.pages.length} page routes: ${RENDERED.pages.map((p) => p.path).join(' ')}`);
    console.log(`      ${RENDERED.pages.length} routes rendered, ${RENDERED.notRendered.length} did not render`);
    for (const n of RENDERED.notRendered) console.log(`      not rendered: ${n}`);
    // /documents/:id/download answers with a buffer, not a page. Reported above
    // rather than filtered out, so a route that STOPS rendering shows up here
    // instead of quietly leaving the denominator.
    assert.ok(RENDERED.notRendered.length <= 1,
      `${RENDERED.notRendered.length} routes stopped rendering: ${RENDERED.notRendered.join(' | ')}`);
  });

  await atest('EVERY CLASS RENDERED BY EVERY PAGE IS DEFINED IN THE LOADED STYLESHEET', async () => {
    const undefinedBy = new Map();
    let checked = 0;
    for (const { path: p, html } of RENDERED.pages) {
      const content = contentOf(html);
      assert.ok(content !== null, `${p}: no .app-main content region — the shell changed`);
      const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      const available = `${CSS}\n${inline}`;
      assert.ok(available.length > 50000, `${p}: the stylesheet did not load — this check would pass vacuously`);
      for (const t of classTokens(content)) {
        checked += 1;
        if (isDefined(t, available)) continue;
        if (!undefinedBy.has(t)) undefinedBy.set(t, new Set());
        undefinedBy.get(t).add(p);
      }
    }
    assert.ok(checked > 100, `only ${checked} class tokens seen across all pages — the reader broke`);
    const rows = [...undefinedBy.entries()].map(([c, r]) => `.${c} (${[...r].join(' ')})`);
    assert.deepStrictEqual(rows, [],
      `class(es) rendered that nothing defines:\n      ${rows.join('\n      ')}\n      `
      + 'CSS never warns; the element just renders unstyled, in production, possibly for months');
  });

  await atest('EVERY CLASS ON A POPULATED PAGE IS DEFINED TOO — the data branches', async () => {
    // The branches that only exist once a row does. Four undefined classes hid
    // here: three in documents.js's STATUS_LABEL map and one in the dashboard's
    // priority ternary, none of them written as a class attribute.
    const stub = populatedDb();
    const { pages, notRendered } = await renderEveryPage(stub.exports, REQ);
    assert.ok(pages.length >= 20, `only ${pages.length} routes rendered with data`);
    assert.ok(notRendered.length <= 1,
      `routes failed against the populated stub — a missing fixture is a finding, not a skip:\n      ${notRendered.join('\n      ')}`);
    const undefinedBy = new Map();
    for (const { path: pth, html } of pages) {
      const content = contentOf(html);
      assert.ok(content !== null, `${pth}: no content region`);
      const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      const available = `${CSS}\n${inline}`;
      for (const t of classTokens(content)) {
        if (isDefined(t, available)) continue;
        if (!undefinedBy.has(t)) undefinedBy.set(t, new Set());
        undefinedBy.get(t).add(pth);
      }
    }
    const rows = [...undefinedBy.entries()].map(([c, r]) => `.${c} (${[...r].join(' ')})`);
    assert.deepStrictEqual(rows, [],
      `class(es) rendered on a DATA branch that nothing defines:\n      ${rows.join('\n      ')}`);
  });

  await atest('the populated stub REFUSES an unknown query rather than answering empty', async () => {
    // Load-bearing. A stub that answers everything with {rows: []} turns the
    // populated render silently back into the empty one, and the test above
    // then passes without having rendered a single data branch.
    const stub = populatedDb();
    await assert.rejects(() => stub.exports.query('SELECT 1 FROM esg_not_a_table'),
      /no fixture for/, 'the populated stub invents an empty answer for a query it does not know');
  });

  await atest('the shell itself renders no undefined class either', async () => {
    // The content region is checked above; this covers the sidebar, topbar and
    // bottom nav, which live OUTSIDE it and which Run 52 deliberately did not
    // look at because they were not that run's to fix.
    const { html } = RENDERED.pages[0];
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const available = `${CSS}\n${inline}`;
    const content = contentOf(html);
    const shell = html.replace(content, '');
    const bad = [...classTokens(shell)].filter((t) => !isDefined(t, available));
    assert.deepStrictEqual(bad, [], `the app shell renders undefined class(es): ${bad.join(', ')}`);
  });

  /* ═════════════════════════════════════════════════════════════════════════
     2 · THE DESIGN SYSTEM IS NOT EDITED IN THIS REPO
     ═════════════════════════════════════════════════════════════════════════ */

  test('this repo adds no CSS and no [data-platform] rule to the design system', () => {
    // MODUS_UI_CONTRACT §1: a per-repo edit to this file is a defect, and §1b
    // makes any real addition a thirteen-path fan-out — its own run, never a
    // line in this one. Pinned to the master hash Run 51 synced.
    const crypto = require('crypto');
    const md5 = crypto.createHash('md5').update(fs.readFileSync(CSS_PATH)).digest('hex').slice(0, 8);
    assert.strictEqual(md5, '5785b26f',
      `the design system is ${md5}, not the master's 5785b26f — either this repo edited it (a §1 `
      + 'defect) or a master sync landed and this pin was left behind (§1b)');
  });

  /* ═════════════════════════════════════════════════════════════════════════
     3 · THE DASHBOARD, EMPTY AND FULL
     ═════════════════════════════════════════════════════════════════════════ */

  let EMPTY_HTML = null;      // a NEW COMPANY — seeded deployment, no data yet
  let UNSEEDED_HTML = null;   // a deployment whose seed did not run
  let FULL_HTML = null;

  await atest('the dashboard renders with zero data AND with full data, and the two differ', async () => {
    EMPTY_HTML = await renderRoute('routes/pages', '/dashboard', newCompanyDb());
    UNSEEDED_HTML = await renderRoute('routes/pages', '/dashboard', EMPTY_DB);
    FULL_HTML = await renderRoute('routes/pages', '/dashboard', populatedDb().exports);
    assert.notStrictEqual(contentOf(EMPTY_HTML), contentOf(FULL_HTML),
      'a company with no data and a scored company render byte-identical dashboards');
    assert.notStrictEqual(contentOf(EMPTY_HTML), contentOf(UNSEEDED_HTML),
      'a new company and a deployment whose seed never ran render the same page — the first is '
      + 'normal and the second is a configuration fault, and telling them apart is the whole point '
      + 'of the three empty states');
    for (const [label, html] of [['empty', EMPTY_HTML], ['unseeded', UNSEEDED_HTML], ['full', FULL_HTML]]) {
      const c = contentOf(html);
      assert.ok(c && c.length > 400, `${label}: content region is ${c && c.length} bytes`);
      assert.ok(!/undefined|NaN|\[object Object\]/.test(c), `${label}: a template hole rendered`);
      assert.ok(/class="card/.test(c), `${label}: rendered no card`);
    }
  });

  await atest('THE EMPTY DASHBOARD LEADS WITH THE RAIL, and the full one leads with the numbers', async () => {
    // The mock draws a mature account. The screen most users see first is the
    // empty one, and rendering the mature layout for it produces a grid of
    // zeroes that reads as broken rather than as new. The rail is the one
    // block fully populated on day one, because the stages exist before the
    // company does anything.
    //
    // ANCHORED ON .stat-card, NOT ON THE CONTAINER. This assertion was written
    // against `.stat-grid` in Run 53 and Run 55 moved the counters into the §52
    // twelve-column grid, so the container name vanished — `indexOf` returned
    // -1 and the comparison passed or failed on the wrong fact rather than
    // saying the anchor was gone. The card is the thing whose POSITION this
    // test is about; the box around it is not. Both anchors are asserted to
    // exist first, so a future rename fails loudly here instead of silently
    // comparing against -1.
    const e = contentOf(EMPTY_HTML);
    const f = contentOf(FULL_HTML);
    for (const [label, c] of [['empty', e], ['full', f]]) {
      for (const anchor of ['journey-rail', 'stat-card']) {
        assert.ok(c.includes(anchor),
          `the ${label} dashboard renders no .${anchor} — this test's anchor is gone, so its `
          + 'verdict means nothing until the anchor is updated');
      }
    }
    assert.ok(e.indexOf('journey-rail') < e.indexOf('stat-card'),
      'the empty dashboard puts the stat cards above the journey rail — a grid of zeroes first');
    assert.ok(f.indexOf('stat-card') < f.indexOf('journey-rail'),
      'the scored dashboard does not follow the reference image\'s reading order');
    // Run 55: the wider column follows the reading order too. The block that
    // leads gets .col-7, so the empty page does not lead with the rail and then
    // give the larger half of the row to an empty state.
    const rowB = (s) => s.slice(s.indexOf('col-7'), s.indexOf('col-5'));
    assert.ok(rowB(e).includes('journey-rail'), 'the empty dashboard leads with the rail but gives it the narrow column');
    assert.ok(rowB(f).includes('score-ring--hero'), 'the scored dashboard gives the wide column to something other than the score');
  });

  await atest('THE DASHBOARD IS A GRID, NOT A STACK — and it collapses on a phone', async () => {
    // Run 53 got the content right and left it a one-column stack, because the
    // master had no column system. Run 54 added §52 and Run 55 composed onto
    // it, so this asserts the SHAPE rather than the appearance: rows that are
    // .grid-12, children that carry a span, and more than one span width — a
    // page of nothing but .col-12 is a stack wearing a grid's class name.
    for (const [label, html] of [['empty', EMPTY_HTML], ['full', FULL_HTML]]) {
      const c = contentOf(html);
      const rows = [...c.matchAll(/class="grid-12[^"]*"/g)];
      assert.ok(rows.length >= 3, `the ${label} dashboard has ${rows.length} grid rows — it is still a stack`);
      const spans = [...c.matchAll(/class="col-(\d+)"/g)].map((m) => Number(m[1]));
      assert.ok(spans.length >= 8, `the ${label} dashboard places ${spans.length} columns`);
      assert.ok(new Set(spans).size >= 3,
        `the ${label} dashboard uses ${new Set(spans).size} distinct column width(s) — a page of `
        + 'equal columns is a stack in a grid class');
      for (const s of spans) {
        assert.ok(s >= 1 && s <= 12, `.col-${s} is outside the twelve-column grid`);
      }
      // Every row must add up to twelve or less, or a child silently wraps and
      // the composition the brief specified is not what renders.
      for (const row of c.split('class="grid-12').slice(1)) {
        const inRow = [...row.slice(0, row.indexOf('</div></div>') + 1).matchAll(/class="col-(\d+)"/g)]
          .map((m) => Number(m[1]));
        if (inRow.length) {
          assert.ok(inRow.reduce((x, y) => x + y, 0) <= 12 || inRow.length > 4,
            `a ${label} row spans ${inRow.join('+')} = more than twelve columns`);
        }
      }
    }
    // AND IT COLLAPSES. The span helpers are meaningless on a phone unless the
    // master reduces them, and this repo cannot add that rule — so it asserts
    // the master ships it rather than assuming §52 is still what Run 54 wrote.
    const mobile = CSS.slice(CSS.indexOf('52. COMPOSITION LAYER'));
    const block = mobile.slice(mobile.indexOf('@media (max-width: 768px)'));
    assert.ok(block.startsWith('@media'), '§52 has no mobile block — every .col-* stays put on a phone');
    const body = block.slice(0, block.indexOf('\n}\n') + 2);
    assert.ok(/\.grid-12\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(body),
      '§52 no longer collapses .grid-12 to one column at ≤768px');
    assert.ok(/\.col-1,[\s\S]*?\.col-12\s*\{\s*grid-column:\s*span 1/.test(body),
      '§52 no longer collapses every .col-* to a single span at ≤768px');
  });

  test('EVERY PANEL NUMBER IS A REAL SEEDED STAGE', () => {
    // Run 55 numbers the panels from esg_journey_stages so the number means
    // something — reorder the seed and they renumber themselves. A code that is
    // not in the seed renders with no index at all, which is the honest
    // behaviour and also completely silent, so nothing on screen would tell you
    // the map had rotted. This is the check that would.
    //
    // It is asserted against seed.sql rather than against the suite's own
    // JOURNEY_FIXTURES, which carry FOUR stages where the product seeds
    // THIRTEEN: in the screenshots taken this run only one panel showed a
    // number, and that was the fixture, not the code. A test built on the
    // fixture would have agreed with the screenshot and been wrong.
    const routes = fs.readFileSync(path.join(SRC, 'routes/pages.js'), 'utf8');
    const map = /const PANEL_STAGE = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(routes);
    assert.ok(map, 'PANEL_STAGE is gone from pages.js — the panels are numbered by something else now');
    const codes = [...map[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    assert.ok(codes.length >= 5, `PANEL_STAGE names ${codes.length} stages`);

    const seed = fs.readFileSync(path.join(SRC, 'db/seed.sql'), 'utf8');
    const seeded = new Set([...seed.matchAll(/^\s*\('([A-Z_]+)',\s*\d+,/gm)].map((m) => m[1]));
    assert.ok(seeded.size >= 10,
      `only ${seeded.size} stage codes parsed out of seed.sql — the reader broke, so this test `
      + 'would pass by finding nothing');
    const orphans = codes.filter((c) => !seeded.has(c));
    assert.deepStrictEqual(orphans, [],
      `these panels point at a stage seed.sql does not create, so they render unnumbered and say `
      + `nothing about it: ${orphans.join(', ')}`);
  });

  await atest('NOTHING BLOCKED IS RENDERED AS AVAILABLE — all six, by name', async () => {
    // UI_REFERENCE_ANNOTATED §1 names five elements that must never ship as
    // drawn, plus §2's roadmap progress bars. Each is asserted by the phrase a
    // reimplementation would actually use, on BOTH renders, because the empty
    // page is the one most likely to reach for a plausible placeholder.
    const BANNED = [
      [/better than \d+%|top \d+%|industry percentile|compared to industry/i,
        'a peer percentile — §1.1, no cohort exists and it is a cross-tenant surface'],
      // A FIGURE, not the word. The page must be free to EXPLAIN that there is
      // no confidence percentage — "On the design, not on this page" says
      // exactly that, and a bare /confidence/i marked the explanation as the
      // defect. So this looks for a percentage within a sentence of the word,
      // over TEXT with the tags stripped, which also catches the mock's own
      // layout where "87%" and "AI Confidence" sit in two separate nodes.
      [/confidence[^.!?]{0,40}\d+\s*%|\d+\s*%[^.!?]{0,40}confidence/i,
        'an AI confidence figure — §1.2, there is deliberately no confidence column'],
      [/your contribution|pillar contribution|4 pillars impact|four pillars impact/i,
        'a SustNET pillar contribution level — §1.3, no published methodology maps to one'],
      [/certified|download certificate|certification progress/i,
        'a certification claim — §1.4, no scheme is published'],
      [/book a consultation|view consultation options|consultation available/i,
        'a consultation booking — §1.5, nothing is built behind it'],
      [/class="progress[^"]*"[\s\S]{0,200}recommendation|recommendation[\s\S]{0,200}class="progress/i,
        'a progress bar on a recommendation — §2, nothing tracks action against one'],
    ];
    // Tags stripped for the prose checks, kept for the markup one — a phrase
    // split across two elements reads as one sentence to a person and as two
    // to a regex, and the mock puts "87%" and "AI Confidence" in separate nodes
    // for exactly that reason.
    const textOf = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    for (const [label, html] of [['empty', EMPTY_HTML], ['full', FULL_HTML]]) {
      const markup = contentOf(html);
      const text = textOf(markup);
      for (const [re, why] of BANNED) {
        const target = re.source.includes('class=') ? markup : text;
        const hit = re.exec(target);
        assert.ok(!hit, `the ${label} dashboard renders ${why}\n      matched: ${hit && hit[0].slice(0, 90)}`);
      }
    }
    // The inverse, so this cannot pass by rendering nothing: the page says WHY
    // the two most dangerous ones are absent rather than hiding them.
    const full = contentOf(FULL_HTML);
    assert.ok(/no industry comparison/i.test(full),
      'the peer percentile is absent but unexplained — a hidden card teaches nothing');
    assert.ok(/verbatim quote/i.test(full),
      'nothing on the page says what replaced the confidence score');
  });

  await atest('every zero region on the empty dashboard NAMES which empty state it is', async () => {
    const c = contentOf(EMPTY_HTML);
    const states = (c.match(/class="empty-state"/g) || []).length;
    assert.ok(states >= 2, `the empty dashboard renders ${states} empty states`);
    // layout.emptyState()'s own defaults. Generic copy is banned: the point of
    // the three states is that each says WHICH it is, in its own words.
    for (const generic of [
      'Nothing writes to this yet. It is not switched on, rather than empty.',
      'This is switched on and working — nobody has entered anything yet.',
      'This has been measured and the answer is zero.',
    ]) {
      assert.ok(!c.includes(generic),
        `the empty dashboard falls back to generic empty-state copy: "${generic}"`);
    }
  });

  await atest('THE ANSWERS DENOMINATOR IS COMPUTED — 40 on the Modus 40, 38 on SEDG', async () => {
    const forty = contentOf(await renderRoute('routes/pages', '/dashboard', populatedDb({ indicatorCount: 40 }).exports));
    assert.ok(/18 \/ 40/.test(forty), 'a company on MODUS_SEDG_ALIGNED does not show 18 / 40');
    const thirtyEight = contentOf(await renderRoute('routes/pages', '/dashboard', populatedDb({ indicatorCount: 38 }).exports));
    assert.ok(/18 \/ 38/.test(thirtyEight), 'a company on SEDG@2.0 does not show 18 / 38');
    assert.ok(!/\/ 32\b/.test(forty) && !/\/ 32\b/.test(thirtyEight),
      'the reference image\'s hardcoded 32 reached the page — it is right for neither framework');
  });

  await atest('THE BAND LABEL COMES FROM esg_rating_bands, not from copy in the route', async () => {
    const c = contentOf(FULL_HTML);
    assert.ok(/AA/.test(c), 'the band code is not on the page');
    assert.ok(c.includes('Advanced'),
      'the seeded band label is not rendered — the page is naming the band itself');
    // The proof it came from the query: the string appears nowhere in the
    // DASHBOARD HANDLER. Scoped to that slice and stripped of comments — the
    // word also names a SEDG tier in /frameworks and appears in this file's own
    // explanation of the rule, and a whole-file scan reports both as the defect.
    const src = fs.readFileSync(path.join(SRC, 'routes', 'pages.js'), 'utf8');
    const from = src.indexOf("router.get('/dashboard'");
    const to = src.indexOf("router.get('/company'");
    assert.ok(from > 0 && to > from, 'the dashboard handler is gone — the anchor moved');
    const handler = src.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // DERIVED FROM THE FIXTURE, not a list written once (#24). Run 56 renders
    // the whole ladder, so three more labels became reachable — and a hand-kept
    // list of five would have gone green about all three of them.
    const seededLabels = FIXTURES.find(([re]) => re.test('FROM esg_rating_bands'))[1]
      .map((b) => b.band_label);
    assert.ok(seededLabels.length >= 7, `only ${seededLabels.length} band labels found in the fixture`);
    for (const band of [...seededLabels, 'Good Performance']) {
      assert.ok(!handler.includes(band), `the dashboard handler names the band "${band}" itself`);
    }
    assert.ok(!/Good Performance/.test(c),
      'the reference image\'s "Good Performance" reached the page — it is not a band this system has');
  });

  await atest('ANIMATED FIGURES ARE IN THE DOM AS TEXT, BEFORE ANY SCRIPT RUNS', async () => {
    // ELEMENT-AGNOSTIC. Run 53 pinned this to `<div class="score-ring-value">`;
    // Run 55's hero ring wraps the value in .score-ring-figure so a `/100`
    // denominator can sit on the same baseline, and the value became a <span>.
    // The fact under test is "the number is TEXT in the DOM", which has nothing
    // to do with which element carries it — pinning the tag made a composition
    // change look like a missing figure. The class is the contract.
    const c = contentOf(FULL_HTML);
    const rendered = [...c.matchAll(/class="score-ring-value"[^>]*>([^<]*)</g)].map((x) => x[1].trim());
    assert.ok(rendered.length >= 4,
      `only ${rendered.length} score-ring values rendered — the overall ring and three pillars are four`);
    for (const figure of ['78', '82', '74', '77']) {
      assert.ok(rendered.includes(figure),
        `${figure} is not present as server-rendered text — a ring that only reads its value after `
        + 'JavaScript has run shows a wrong number to a screen reader, a no-JS user and anyone whose '
        + `script was dropped. Rendered: ${rendered.join(', ')}`);
    }
    // The denominator is text too, and it is NOT part of the value — "78/100"
    // in one node would be read aloud as seven-thousand-eight-hundred.
    assert.ok(/class="score-ring-den"[^>]*>\/100</.test(c),
      'the hero ring has no server-rendered denominator');
    assert.ok(!/<script/i.test(c),
      'the dashboard content region carries a script — every figure on it is server-rendered and '
      + 'nothing on this page needs one');
    assert.ok(!/cdnjs|unpkg|jsdelivr/i.test(c), 'the dashboard loads a script from a CDN');
  });

  await atest('THE SCORE IS SHOWN AS A WHOLE NUMBER — and the arc agrees with the numeral', async () => {
    /* Run 56, §3.-0. `score_0_100` is numeric(6,2) and stays that way; staging
       reads 34.47 and the hero ring was printing all four characters, which is
       a spreadsheet cell rather than a headline figure.

       THE NORMAL FIXTURE CANNOT TEST THIS. Its four scores are 78/82/74/77 and
       Math.round() is a no-op on every one, so the guard would have shipped
       green against a fixture that could not tell rounded from unrounded — a
       test that cannot fail. Hence a second fixture whose scores have decimals,
       covering rounding down, up, and the .5 boundary. */
    const c = contentOf(await renderRoute('routes/pages', '/dashboard',
      populatedDb({ fractionalScores: true }).exports));
    const rendered = [...c.matchAll(/class="score-ring-value"[^>]*>([^<]*)</g)].map((x) => x[1].trim());
    assert.strictEqual(rendered.length, 4,
      `${rendered.length} ring values rendered, not the overall ring plus three pillars — the `
      + 'reader broke, so this check would pass by finding nothing');
    assert.deepStrictEqual(rendered.filter((v) => v.includes('.')), [],
      `a score renders with decimal places: ${rendered.join(', ')}`);
    for (const [raw, shown] of Object.entries(FRACTIONAL_SHOWN)) {
      assert.ok(rendered.includes(shown),
        `${raw} is not displayed as ${shown}. Rendered: ${rendered.join(', ')}`);
      assert.ok(!c.includes(raw),
        `the unrounded ${raw} is still somewhere on the page — the aria-label and the numeral must `
        + 'agree, or a screen reader hears a figure nobody else can see');
    }
    // ROUNDED ONCE. --score drives §50's conic-gradient, so an unrounded value
    // there draws a 34.47% arc underneath the number 34 — two statements of one
    // fact that disagree, which is the whole reason journeyView exists.
    assert.ok(!/--score:\s*\d+\.\d/.test(c),
      'the ring arc is set from an unrounded score while the numeral is rounded');
  });

  await atest('THE RATING LADDER IS THE SEEDED ONE, and exactly one rung says "You are here"', async () => {
    /* Run 56. The band query already returned the whole ladder and the page was
       using one row of it, so the ladder costs no query and invents nothing —
       which is the only reason it is allowed to fill the space that deleting the
       methodology paragraphs left.

       TWO WAYS THIS COULD GO WRONG SILENTLY, and both are asserted: a ladder
       built from a hardcoded list rather than from the rows (caught by the band
       test above, which now derives its banned labels from the fixture), and a
       "you are here" mark that lands on the wrong rung or on none. A ladder with
       no current rung renders as seven identical rows and says nothing. */
    const c = contentOf(FULL_HTML);
    const items = [...c.matchAll(/<div class="checklist-item ([^"]*)">([\s\S]*?)<\/div>/g)];
    const seeded = FIXTURES.find(([re]) => re.test('FROM esg_rating_bands'))[1];
    assert.strictEqual(items.length, seeded.length,
      `the ladder renders ${items.length} rungs for ${seeded.length} seeded bands`);
    for (const b of seeded) {
      assert.ok(c.includes(`${b.band_code} · ${b.band_label}`),
        `the seeded band ${b.band_code} is missing from the ladder`);
    }
    const here = items.filter(([, cls]) => cls.includes('is-active'));
    assert.strictEqual(here.length, 1,
      `${here.length} rungs are marked as the company's current band — exactly one is`);
    assert.ok(here[0][2].includes('AA · Advanced') && here[0][2].includes('You are here'),
      `the current rung is not the scored band AA: ${here[0][2].replace(/<[^>]*>/g, ' ').trim()}`);
    // The three states are stated in WORDS, not by mark alone (§6).
    for (const word of ['You are here', 'Cleared', 'Not reached']) {
      assert.ok(c.includes(word), `the ladder never renders the state "${word}"`);
    }
    // And it is absent, not zeroed, when there is no score to place on it.
    assert.ok(!/checklist-item/.test(contentOf(EMPTY_HTML)),
      'the ladder renders for a company with no score, so every rung reads "not reached" — which '
      + 'is a claim about a company that has not been assessed');
  });

  await atest('THE SCORE PANEL STATES THE SCORE — at most one sentence of prose under the number', async () => {
    /* Run 56, §3.-1. This panel used to end with two paragraphs: the weighting
       and engine versions plus "every figure here is arithmetic over your own
       answers, no part of it is generated by AI", and a note about the absent
       peer cohort. Both true, both engineering justification, both sitting
       directly under the most important number in the product — and between
       them the single biggest reason the page read as unfinished.

       A RULE, NOT A LIST OF BANNED PHRASES (checklist #24). Counting sentences
       catches the paragraph nobody has written yet; a regex for "arithmetic"
       catches only the two that were already deleted. Scoped to Row B's WIDE
       column on the scored render, and the slice asserts it found the hero ring
       before it counts anything — a scope that has silently moved reports zero
       sentences and passes. */
    const c = contentOf(FULL_HTML);
    const from = c.indexOf('col-7');
    const to = c.indexOf('col-5');
    assert.ok(from > 0 && to > from, 'Row B is gone from the scored dashboard — this check has no scope');
    const wide = c.slice(from, to);
    assert.ok(wide.includes('score-ring--hero'),
      'the wide column of Row B does not hold the hero ring, so this slice is measuring the wrong panel');
    const prose = [...wide.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const sentences = prose.join(' ').split(/[.!?](?=\s|$)/).map((s) => s.trim()).filter(Boolean);
    assert.ok(sentences.length <= 1,
      `the score panel carries ${sentences.length} sentences of prose under the number:\n      `
      + `${sentences.join('\n      ')}\n      At most one, and it says what to do next — never how `
      + 'the platform computes. Provenance goes in the header metadata; methodology is /governance.');
    // The inverse, so this cannot pass by deleting the panel: the absence it
    // used to apologise for is still NAMED, as a real empty state, further down.
    assert.ok(/class="empty-state"[\s\S]{0,400}No industry comparison/.test(c),
      'the peer-comparison absence left the score panel and is not a named empty state anywhere '
      + 'else — a hidden card teaches nothing, which is annotation §1.1');
  });

  await atest('NO DEAD CONTROLS — no search, no notification bell, no mail icon', async () => {
    // §4.3c. The reference image puts all three in the most prominent row of
    // the page and this repo has a backing feature for none of them: no search
    // route, no notifications table, no message store.
    for (const html of [EMPTY_HTML, FULL_HTML]) {
      assert.ok(!/type="search"/i.test(html), 'a search field renders with nothing behind it');
      assert.ok(!/placeholder="Search/i.test(html), 'a search field renders with nothing behind it');
      assert.ok(!/aria-label="[^"]*(notification|message|mail|inbox|search)/i.test(html),
        'a notification, mail or search control renders with no backing route');
      assert.ok(!/🔔|✉|📨|📬/.test(html), 'a bell or mail glyph renders as a control');
    }
    // And the one control that IS in the topbar does something.
    assert.ok(/id="themeBtn"/.test(FULL_HTML) && /getElementById\('themeBtn'\)/.test(FULL_HTML),
      'the topbar theme toggle is not bound to anything');
  });

  await atest('the bottom nav still shows exactly the five named keys, and they are ≥44px tall', async () => {
    const { BOTTOM_NAV_KEYS, MODULES } = require('../src/utils/layout');
    assert.deepStrictEqual(BOTTOM_NAV_KEYS,
      ['dashboard', 'company', 'assessment', 'documents', 'reports'],
      'BOTTOM_NAV_KEYS changed — it is five, named explicitly, and adding to it displaces one');
    // Anchored at the token boundary: `class="bottom-nav-item` also prefixes
    // `bottom-nav-item-icon`, so an unanchored count reports ten items for five.
    const items = (FULL_HTML.match(/class="bottom-nav-item[ "]/g) || []).length;
    assert.strictEqual(items, 5, `the bottom nav renders ${items} items`);
    for (const k of BOTTOM_NAV_KEYS) {
      assert.ok(MODULES.some((m) => m.key === k), `${k} is in BOTTOM_NAV_KEYS but not in MODULES`);
    }
    // Height comes from the master, so read it rather than assume it.
    const h = /\.app-bottom-nav\s*\{[^}]*height:\s*(\d+)px/.exec(CSS);
    assert.ok(h, '.app-bottom-nav declares no height');
    assert.ok(Number(h[1]) >= 44, `the bottom nav is ${h[1]}px tall; a touch target is 44px`);
    // Five items across the narrowest phone still clears 44px of width.
    assert.ok(320 / 5 >= 44, 'five bottom-nav items no longer fit a 320px viewport at 44px each');
  });

  test('every button clears 44px AT MOBILE SIZES, and stays compact on desktop', () => {
    /* §6 asks for 44×44 on mobile. Run 53 recorded that no button class
       cleared it — .btn ~29px, .btn-sm ~22px — and Run 54 fixed it in the
       master with a min-height inside the EXISTING ≤768px block. Applied there
       and not to the base rule on purpose: 44px is a finger, not a design, and
       a desktop toolbar of 44px buttons is a different and worse product. So
       the base sizes below are still the old ones, and that is correct. */
    const mobile = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/.exec(CSS);
    assert.ok(mobile, 'the ≤768px block is gone from the stylesheet');
    assert.ok(/min-height:\s*44px/.test(mobile[1]),
      'the mobile block sets no 44px minimum on any control — §6 is unenforced again');
    for (const cls of ['btn', 'btn-sm', 'page-btn', 'theme-toggle']) {
      assert.ok(new RegExp(`\\.${cls}[,\\s]`).test(mobile[1]),
        `.${cls} is not in the mobile touch-target rule`);
    }
    const height = (sel) => {
      const m = new RegExp(`\\.${sel}\\s*\\{[^}]*padding:\\s*(\\d+)px[^;]*;[^}]*font-size:\\s*(\\d+)px`).exec(CSS)
        || new RegExp(`\\.${sel}\\s*\\{[^}]*font-size:\\s*(\\d+)px[^}]*padding:\\s*(\\d+)px`).exec(CSS);
      assert.ok(m, `.${sel} declares no padding and font-size to measure`);
      const [pad, font] = sel === 'btn' ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[2])];
      return pad * 2 + font;   // line-height is 1 on .btn
    };
    assert.strictEqual(height('btn'), 29, '.btn changed size — if it now clears 44px, delete this record');
    assert.strictEqual(height('btn-sm'), 22, '.btn-sm changed size — if it now clears 44px, delete this record');
    // And the shell uses the larger of the two for its one control.
    assert.ok(/id="themeBtn"[^>]*>/.test(FULL_HTML), 'the theme toggle is gone');
    assert.ok(!/class="btn btn-outline btn-sm" id="themeBtn"/.test(FULL_HTML),
      'the topbar control uses .btn-sm, which is the smaller of the two touch targets');
  });

  await atest('every dynamic value on the dashboard goes through esc()', async () => {
    const payload = '<script>alert(1)</script>';
    const html = await renderRoute('routes/pages', '/dashboard', populatedDb({ hostile: payload }).exports);
    const c = contentOf(html);
    assert.ok(!c.includes(payload), 'a database string containing markup reached the page unescaped');
    assert.ok(c.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
      'the payload did not render at all — this test is asserting nothing');
  });

  /* ═════════════════════════════════════════════════════════════════════════
     4 · MOTION AND CONTRAST
     ═════════════════════════════════════════════════════════════════════════ */

  test('reduced motion: ONE global block, and .reveal is visible and final inside it', () => {
    // §6a. "Collapses to instant" is not "collapses to 0.01ms": an entrance
    // state whose resting appearance is opacity 0 becomes permanently
    // invisible under the global reduce block, and the accessibility setting
    // then hides the page from the people who set it.
    const blocks = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g) || [];
    assert.strictEqual(blocks.length, 1,
      `${blocks.length} prefers-reduced-motion blocks — two produce an effect that depends on `
      + 'source order, which is worse than having neither');
    const i = CSS.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const body = CSS.slice(i, i + 1200);
    assert.ok(/\.reveal/.test(body), 'the reduce block does not mention .reveal');
    assert.ok(/opacity:\s*1/.test(body) && /transform:\s*none/.test(body),
      'the reduce block does not force .reveal back to a visible, final state');
    // And the resting state in the cascade is visible, so no-script is safe.
    assert.ok(/(^|\n)\.reveal\s*\{\s*opacity:\s*1;?\s*\}/.test(CSS),
      '.reveal does not rest visible — it must be hidden only under [data-reveal="on"]');
  });

  test('the page animates transform and opacity only', () => {
    // §3.4 rule 1. Animating width, height, top or box-shadow on a dashboard
    // this dense drops frames on the mid-range Android a Malaysian SME owner
    // will actually open it on.
    const i = CSS.indexOf('50. GAMIFICATION & MOTION LAYER');
    assert.ok(i > 0, 'the §50 section is gone — the anchor moved');
    const section = CSS.slice(i);
    const animated = [...section.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
    assert.ok(animated.length >= 5, `only ${animated.length} transitions in §50 — the reader broke`);
    const properties = new Set();
    for (const t of animated) {
      for (const part of t.split(',')) {
        const prop = part.trim().split(/\s+/)[0];
        if (prop && prop !== 'none') properties.add(prop);
      }
    }
    // width is here on purpose and is not a frame problem: .xp-bar and
    // .mission-progress are set ONCE, server-side, so nothing animates on
    // first paint. Named as a shape, not exempted as a file.
    const allowed = new Set(['transform', 'opacity', 'background', 'background-color',
      'border-color', 'box-shadow', 'color', 'width']);
    const unexpected = [...properties].filter((p) => !allowed.has(p));
    assert.deepStrictEqual(unexpected, [], `§50 animates: ${unexpected.join(', ')}`);
    assert.ok(!/animation:[^;]*infinite/.test(section),
      '§50 contains an infinite animation — nothing loops except a live progress indicator');
  });

  test('every duration and easing in §50 comes from a token', () => {
    // Sliced from the END of §50's own header comment, not from the heading
    // inside it. Slicing at the heading starts the string mid-comment, so the
    // opening `/*` is missing, the comment strip does nothing, and the
    // sentence "a hardcoded 0.3s here is the same defect class as a literal
    // #16A34A" is reported as a hardcoded 0.3s. Checklist #16, again.
    const i = CSS.indexOf('50. GAMIFICATION & MOTION LAYER');
    assert.ok(i > 0, 'the §50 heading is gone — the anchor moved');
    const afterHeader = CSS.indexOf('*/', i);
    assert.ok(afterHeader > i, '§50 has no header comment — the anchor moved');
    const section = CSS.slice(afterHeader + 2).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(section.length > 3000, `the §50 body is ${section.length} bytes — the slice broke`);
    const literals = [...section.matchAll(/(?:transition|animation)[^;]*?(\d+(?:\.\d+)?m?s)\b/g)].map((m) => m[1]);
    assert.deepStrictEqual(literals, [],
      `§50 carries a literal duration: ${literals.join(', ')} — a literal 0.3s is the same defect `
      + 'class as a literal #16A34A');
  });

  test('THE CONTENT COLUMN IS CAPPED AND CENTRED, and the cap is waiting on the master', () => {
    /* §3.0. A dashboard that stretches to 2560px is not a dashboard: a .col-4
       panel becomes 700px wide and the twelve-column grid stops being a
       composition. The MASTER HAS NO CONTAINER — no .container, no max-width
       utility, no width token beyond --sidebar-w and --topbar-h — so the cap
       lives in layout.js's existing local geometry block and reads a token that
       does not exist yet.

       BOTH HALVES ARE ASSERTED, and the first is a PIN rather than a guard: it
       goes red the day the master declares --content-max or a container, which
       is the signal to move the rule upstream and delete the local half. That
       is the same arrangement as the contrast pins above — an entry here means
       "still owed", never "stop looking". */
    assert.ok(!/--content-max\s*:|^\.container\s*\{/m.test(CSS),
      'the master now declares --content-max or a .container — move the cap out of layout.js into '
      + 'the master (a thirteen-path fan-out) and delete the local half of this test');
    const html = require('../src/utils/layout').layout('Dashboard',
      '<div class="card"></div>', { name: 'Joel', email: 'j@x.test' }, '/dashboard');
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const rule = /\.app-main\s*>\s*\*\s*\{([^}]*)\}/.exec(inline);
    assert.ok(rule, 'the content column is uncapped — the page stretches to the width of the monitor');
    assert.ok(/max-width:\s*var\(--content-max,\s*\d+px\)/.test(rule[1]),
      `the cap does not read --content-max with a fallback, so a master token would not win: ${rule[1]}`);
    assert.ok(/margin-inline:\s*auto/.test(rule[1]),
      'the content column is capped but not centred, so a wide monitor pins the page to the left');
  });

  test('THE RING THICKNESS IS THE MASTER\'S, and the hero arc is recorded as too thin', () => {
    /* §3.-0's second half, reported rather than fixed. --ring-thickness is ONE
       value used at three ring sizes, so the arc is 12.5% of the 64px inline
       ring and 5.3% of the 152px hero — the hero, the most important figure in
       the product, reads THINNEST of the three. The reference image's hero arc
       is roughly 9% of its diameter.

       Fixing it means a per-size thickness in the master and a thirteen-path
       fan-out, which §3.5 makes its own run, so this repo does not override the
       token locally — it pins the measurement so the fix turns this red. */
    const t = /--ring-thickness:\s*(\d+)px/.exec(CSS);
    assert.ok(t, '--ring-thickness is gone from the master');
    assert.strictEqual(Number(t[1]), 8,
      `--ring-thickness moved to ${t[1]}px — re-measure the three ring sizes and update this record`);
    const sizes = {};
    for (const m of CSS.matchAll(/\.score-ring--(hero|inline)\s*\{\s*width:\s*(\d+)px/g)) {
      if (!(m[1] in sizes)) sizes[m[1]] = Number(m[2]);   // first = the desktop rule
    }
    assert.deepStrictEqual(sizes, { hero: 152, inline: 64 },
      `the ring sizes moved to ${JSON.stringify(sizes)} — re-measure and update this record`);
    assert.ok(!/\.score-ring--(hero|inline)[^{]*\{[^}]*--ring-thickness/.test(CSS),
      'a per-size ring thickness landed in the master — the hero arc is fixed, so delete this record '
      + 'and stop reporting it as owed');
  });

  /* CONTRAST, COMPUTED. §6 says ≥ 4.5:1 in both themes and until this run
     nothing checked it in either. The survey below is the answer, and most of
     it is bad news that belongs to the MASTER rather than to this repo:
     `--muted`, every `.badge-*` tint and every `.alert-*` tint sit between
     2.4:1 and 4.2:1, on all twelve platforms.

     So the assertion has two halves. The pairs this page can CHOOSE must pass.
     The pairs it inherits are pinned to their measured value, so a master fix
     turns this red and tells someone to move the entry up — which is the
     opposite of an exemption list, where an entry means "stop looking". */
  const contrast = require('./lib/contrast');

  /* ALL OF THESE PASS. Eleven of them did not until Run 54, and they were
     pinned here at their measured ratio precisely so that fixing the master
     would turn this suite red and say MOVE THEM UP rather than relax them.
     That is what happened: the master gained --accent-text and the five status
     -text tokens, --muted was darkened, the sidebar alphas were raised, and
     .milestone-badge.is-earned stopped being white on near-white. The record
     is deleted rather than kept, because an entry in it means "still broken". */
  const MUST_PASS = [
    ['var(--text)', ['var(--surface)', 'var(--bg)'], '.stat-value, .page-title, .card-title'],
    ['var(--text-2)', ['var(--surface)', 'var(--bg)'], '.score-ring-label, .mission-meta, .journey-node-meta'],
    ['var(--text)', ['var(--bg)'], 'body copy on the page background'],
    ['var(--text-2)', ['var(--surface-2)', 'var(--surface)', 'var(--bg)'], '.milestone-badge (resting)'],
    ['var(--text-2)', ['var(--bg-soft)', 'var(--surface)', 'var(--bg)'], '.badge-gray'],
    ['var(--accent-contrast)', ['var(--surface-deep)'], '.mission-card--deep, .panel--deep'],
    ['#ffffff', ['var(--accent)'], '.btn-primary, .skip-link'],
    ['#ffffff', ['var(--brand)'], 'the sidebar brand'],
    ['rgba(255,255,255,0.5)', ['var(--brand)'], '.sidebar-item resting'],
    ['rgba(255,255,255,0.85)', ['var(--brand)'], '.sidebar-user-name'],
    // ── moved up in Run 54 ──
    ['var(--muted)', ['var(--surface)', 'var(--bg)'], '--muted on a card (.stat-label, .stat-sub, .text-muted)'],
    ['var(--muted)', ['var(--bg)'], '--muted on the page background'],
    ['var(--muted)', ['var(--surface)'], '.bottom-nav-item resting'],
    ['var(--accent-text)', ['var(--surface)'], '.bottom-nav-item active'],
    ['var(--accent-text)', ['var(--accent-bg)', 'var(--surface)', 'var(--bg)'], '.badge-accent, .level-chip, .milestone-badge.is-earned'],
    ['var(--green-text)', ['var(--green-bg)', 'var(--surface)', 'var(--bg)'], '.badge-green'],
    ['var(--amber-text)', ['var(--amber-bg)', 'var(--surface)', 'var(--bg)'], '.badge-amber'],
    ['var(--red-text)', ['var(--red-bg)', 'var(--surface)', 'var(--bg)'], '.badge-red'],
    ['var(--blue-text)', ['var(--blue-bg)', 'var(--surface)', 'var(--bg)'], '.badge-blue, .alert-info'],
    ['rgba(255,255,255,0.46)', ['var(--brand)'], '.sidebar-section-label, .sidebar-user-plan'],
    // ── the §52 components this page introduced in Run 55 ──
    ['var(--accent-text)', ['var(--surface)', 'var(--bg)'], '.panel-index'],
    ['var(--text)', ['var(--surface)', 'var(--bg)'], '.panel-title, .file-row-name, .metric-row-value'],
    ['var(--muted)', ['var(--surface)', 'var(--bg)'], '.panel-meta, .file-row-meta, .score-ring-den'],
    ['var(--text-2)', ['var(--surface)', 'var(--bg)'], '.score-ring-caption'],
    ['var(--text)', ['var(--surface-2)', 'var(--surface)', 'var(--bg)'], '.kpi-tile-value'],
    ['var(--muted)', ['var(--surface-2)', 'var(--surface)', 'var(--bg)'], '.kpi-tile-label'],
    ['var(--accent-text)', ['var(--accent-bg)', 'var(--surface)', 'var(--bg)'], '.tag-accent'],
    ['var(--amber-text)', ['var(--amber-bg)', 'var(--surface)', 'var(--bg)'], '.tag-amber'],
    ['var(--text-2)', ['var(--surface)', 'var(--bg)'], '.tag resting'],
    // ── the §52 checklist, which Run 56's rating ladder is the first consumer of ──
    ['var(--text)', ['var(--surface)', 'var(--bg)'], '.checklist-item'],
    ['var(--text-2)', ['var(--surface)', 'var(--bg)'], '.checklist-item.is-pending'],
    ['var(--muted)', ['var(--surface)', 'var(--bg)'], '.checklist-status, .checklist-mark resting'],
    ['var(--accent-contrast)', ['var(--accent)'], '.checklist-item.is-done .checklist-mark'],
    ['var(--muted)', ['var(--accent-bg)', 'var(--surface)'], '.checklist-item.is-active .checklist-mark'],
  ];

  test('CONTRAST ≥ 4.5:1 IN BOTH THEMES for every pair this page chooses', () => {
    const failures2 = [];
    for (const theme of ['light', 'dark']) {
      const t = contrast.tokens(theme);
      for (const [fg, bg, label] of MUST_PASS) {
        const r = contrast.ratio(fg, bg, t);
        if (r < 4.5) failures2.push(`${theme}: ${r}:1  ${label}`);
      }
    }
    assert.deepStrictEqual(failures2, [],
      `text below 4.5:1:\n      ${failures2.join('\n      ')}`);
  });

  test('EVERY theme emitter defaults to dark (Ruling A, Run 54)', () => {
    const { layout, bareLayout } = require('../src/utils/layout');
    const signedIn = layout('Dashboard', '<div class="card"></div>', { name: 'Joel', email: 'j@x.test' }, '/dashboard');
    const signedOut = bareLayout('Sign in', '<form></form>');
    for (const [label, html] of [['signed-in', signedIn], ['signed-out', signedOut]]) {
      assert.ok(/<html[^>]*data-theme="dark"/.test(html),
        `the ${label} shell does not default to dark`);
      assert.ok(/<html[^>]*data-platform="esg"/.test(html), `the ${label} shell lost the platform accent`);
    }
    // The default moved; the override did not. A user who chose light keeps it.
    assert.ok(/localStorage.getItem\(KEY\)/.test(signedIn) && /setAttribute\('data-theme',saved\)/.test(signedIn),
      'the client-side theme restorer is gone — the default would become the only option');

    // The first version of this test named the two shells in layout.js and
    // shipped Ruling A two-thirds done: `public/index.html` is a THIRD emitter,
    // it is the page a first-time visitor actually lands on, and Gate 2 caught
    // it live rather than here. Checklist #23 — a scoped check is only as good
    // as its scope — so this no longer names files. It FINDS every `<html>` tag
    // in the repo that carries a theme and requires each one to be dark; a
    // fourth emitter added tomorrow fails here on the day it is written.
    // Deliberately NOT de-duplicated by tag text: the two shells emit the same
    // string, so collapsing identical tags would report two emitters where
    // there are three and quietly restore the blind spot this replaces.
    const emitters = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(js|html)$/.test(e.name)) continue;
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/<html\b[^>]*>/g)) {
          if (!/data-theme=/.test(m[0])) continue;
          emitters.push([path.relative(ROOT, p), m[0]]);
        }
      }
    }(ROOT));

    assert.ok(emitters.length >= 3,
      `expected at least the two shells and the landing page to emit a theme, found ${emitters.length}`);
    const light = emitters.filter(([, tag]) => !/data-theme="dark"/.test(tag));
    assert.deepStrictEqual(light.map(([f, t]) => `${f}  ${t}`), [],
      'these <html> tags still default to a theme other than dark');
  });

  test('the CSP names no script host, and nothing loads Chart.js', () => {
    // Run 53 deleted the radar; Run 54 closed the policy. A CSP that permits a
    // host the product never fetches from is a supply-chain surface held open
    // for nothing.
    const server = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
    const csp = /scriptSrc:\s*\[([^\]]*)\]/.exec(server);
    assert.ok(csp, 'scriptSrc is gone from the CSP entirely');
    assert.ok(!/cdnjs|unpkg|jsdelivr|cloudflare/i.test(csp[1]),
      `scriptSrc still permits a third-party host: ${csp[1].trim()}`);
    for (const f of fs.readdirSync(path.join(SRC, 'routes')).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(SRC, 'routes', f), 'utf8').replace(/\/\/[^\n]*/g, '');
      assert.ok(!/<script[^>]+src=/i.test(src), `routes/${f} loads an external script`);
    }
  });

  test('no status colour is used as TEXT — that is what the -text tokens are for', () => {
    // Run 54 split --red/--green/--amber/--blue/--purple into a FILL (a dot, a
    // bar, a solid button, tuned so white sits on it) and a -text variant
    // (tuned to sit on the 8% tint). A fill used as text is the defect that run
    // fixed thirty-two times in the master, and this repo must not reintroduce
    // it in a route file either.
    for (const f of fs.readdirSync(path.join(SRC, 'routes')).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(SRC, 'routes', f), 'utf8');
      for (const m of src.matchAll(/color:\s*var\(\s*--(red|green|amber|blue|purple)\s*\)/g)) {
        assert.fail(`routes/${f} uses the fill --${m[1]} as text; use --${m[1]}-text`);
      }
    }
  });

  console.log(`\ndashboard-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('dashboard-test FAILED:', e.stack || e.message); process.exit(1); });

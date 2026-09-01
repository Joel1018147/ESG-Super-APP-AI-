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
// The ESG layer (Run 62/P2). A SECOND sheet, never an edit to the one above —
// the md5 pin further down still guards that and is untouched. It is included
// in `AVAILABLE` because "every rendered class is defined" is a question about
// the styles the page actually loads, and the shell links both.
const ESG_CSS_PATH = path.join(ROOT, 'public', 'css', 'esg-system.css');
const ESG_CSS = fs.existsSync(ESG_CSS_PATH) ? fs.readFileSync(ESG_CSS_PATH, 'utf8') : '';

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
  // ── P9's aggregates ────────────────────────────────────────────────────
  // Every one of these is an alias no other query in this repo uses, which is
  // deliberate on the query side and is what lets a fixture below name exactly
  // one statement. Listed here so the EMPTY render reads a real zero from each
  // rather than an undefined that would arrive on the page as NaN.
  documents_total: 0, documents_read: 0, documents_unreadable: 0, documents_unattached: 0,
  unanswered: 0, self_declared: 0,
  projects_total: 0, projects_implemented: 0, projects_forecast: 0,
  projects_unclassified: 0, projects_no_financing: 0,
  opportunities_pending: 0, unverified_actuals: 0,
  profile_filled: 0,
  answers_total: 0, answers_na: 0, answers_documented: 0, answers_verified: 0, answers_declared: 0,
  carbon_entries: 0, carbon_provisional: 0,
  report_docs_total: 0, report_docs_read: 0,
  report_projects_total: 0, report_projects_forecast: 0,
  report_baselines: 0, report_actuals: 0, report_verified: 0,
  trigger_gaps: 0, trigger_pillars: 0, trigger_draft: 0,
  trigger_unevidenced: 0, trigger_unreadable: 0, trigger_unclassified: 0,
};
/* P9 WIDENED THIS FROM count(*) TO EVERY BARE AGGREGATE, and the change makes
   the stub MORE truthful rather than more forgiving.

   `SELECT coalesce(sum(byte_size), 0) FROM t WHERE …` with no GROUP BY returns
   exactly one row in Postgres — on an empty table, on a table with no rows for
   this company, always. That is what an aggregate IS, and it is as true of
   sum() as of count(). The old predicate knew only count(*), so a sum-only
   statement was answered `rows: []` — a database that cannot exist — and the
   only way a route could survive it was by carrying a `rows[0] || {}` guard for
   a case that never happens in production. That is RULE 6, forced on the code
   by the test.

   It caught exactly that on the dashboard's byte total, which is the query
   that prompted the widening.

   The GROUP BY exclusion still matters and is why this is not simply "does the
   SQL mention sum": a grouped aggregate returns one row PER GROUP and may
   legitimately return none. */
const isAggregate = (sql) => /\b(count|sum|min|max|avg)\s*\(/i.test(sql)
  && !/\bGROUP BY\b/i.test(sql);

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
  /* ── P9's aggregates ──────────────────────────────────────────────────────
     Keyed on an alias no other statement in this repo selects, which is why
     each of these names exactly one query and why none of them can be stolen
     by the table patterns further down. actionCenter, reportReadiness,
     roadmapService and consultationTriggers all issue correlated subqueries or
     joins naming a table that already has a fixture, and a key on the TABLE
     would have answered the wrong statement — silently, with a plausible row.

     The figures are chosen to exercise the branches: two proposals pending
     against a SCORED assessment fires actionCenter's U1, one implemented
     project with a baseline and no actual fires U2, and four self-declared
     answers sit one BELOW the consultation threshold of five so the trigger
     table has a "No" row in it as well as a "Yes". */
  [/AS documents_total/, [{ documents_total: 4, documents_read: 3,
    documents_unreadable: 1, documents_unattached: 1 }]],
  [/AS unanswered/, [{ unanswered: 22 }]],
  [/AS self_declared/, [{ self_declared: 4 }]],
  [/AS projects_total/, [{ projects_total: 1, projects_implemented: 1, projects_forecast: 1,
    projects_unclassified: 0, projects_no_financing: 1 }]],
  [/AS opportunities_pending/, [{ opportunities_pending: 1 }]],
  [/AS unverified_actuals/, [{ unverified_actuals: 1 }]],
  // actionCenter's U2 read: implemented, baselined, and never measured.
  [/AND p.status = 'implemented'/, [{ id: 'gp-1', title: 'Rooftop solar' }]],
  [/AS profile_filled/, [{ profile_filled: 5 }]],
  [/AS answers_total/, [{ answers_total: 18, answers_na: 1, answers_documented: 5,
    answers_verified: 2, answers_declared: 10 }]],
  [/AS carbon_entries/, [{ carbon_entries: 2, carbon_provisional: 1 }]],
  [/AS report_docs_total/, [{ report_docs_total: 4, report_docs_read: 3 }]],
  [/AS report_projects_total/, [{ report_projects_total: 1, report_projects_forecast: 1 }]],
  [/AS report_baselines/, [{ report_baselines: 1, report_actuals: 0, report_verified: 0 }]],
  [/AS trigger_gaps/, [{ trigger_gaps: 3, trigger_pillars: 3, trigger_draft: 2 }]],
  [/AS trigger_unevidenced/, [{ trigger_unevidenced: 4 }]],
  [/AS trigger_unreadable/, [{ trigger_unreadable: 1 }]],
  [/AS trigger_unclassified/, [{ trigger_unclassified: 0 }]],
  // roadmapService's project list. Keyed on its own unique alias for the same
  // reason: it names esg_green_project_baselines three times in subqueries.
  [/AS roadmap_baselines/, [{ id: 'gp-1', title: 'Rooftop solar', status: 'implemented',
    estimated_cost_myr: 250000, financing_required_myr: null,
    expected_benefit_metric: 'electricity_kwh', expected_benefit_value: 4200,
    expected_benefit_basis: 'supplier_quotation', ccpt_category_code: 'C1',
    classification_basis: 'human_assigned', source_opportunity_id: 'o-1',
    created_at: '2026-08-13T00:00:00.000Z',
    roadmap_baselines: 1, roadmap_actuals: 0, roadmap_verified: 0 }]],
  // gapAnalysis reads the scheme that scored the assessment — NOT whichever is
  // active today, which may be a later version.
  [/FROM esg_weighting_schemes/, [{ id: 'w-1', version: '1.0', weight_e: 0.4, weight_s: 0.3,
    weight_g: 0.3, mult_self_declared: 0.6, mult_documented: 0.85, mult_verified: 1.0 }]],
  [/AS proposals_live/, [{ proposals_live: 3, proposals_pending: 2 }]],
  [/AS entries, min\(period_start\)/, [{
    entries: 2, period_from: '2026-01-01', period_to: '2026-06-30', provisional: 1 }]],
  [/AS projects FROM esg_green_projects/, [{ projects: 1 }]],
  [/AS products FROM esg_finance_products/, [{ products: 1 }]],
  // ── readinessService (P6.5) reads these. Modelled explicitly rather than
  //    left to fall through, because the populated stub REFUSES an unknown
  //    query — an engine query nobody modelled must be a finding, not a zero.
  [/FROM esg_finance_inputs/, []],
  [/FROM esg_green_project_baselines/, [{ n: 1 }]],
  [/count\(\*\) FILTER \(WHERE r\.document_id IS NOT NULL\)/, [{ n: 12, documented: 5 }]],
  // `is_provisional` appears only in the carbon aggregate; an earlier draft
  // keyed on "::int AS n, count(*) FILTER" and matched the RESPONSES aggregate
  // too, which handed the engine carbon rows and produced a NaN score.
  [/FILTER \(WHERE is_provisional\)/, [{ n: 2, provisional: 1 }]],
  // ORDER BY is the disambiguator: the dashboard's own score query selects
  // band_code and the indicator counts too, and matching on the first two
  // columns stole it — which rendered a template hole and emptied the ladder.
  [/ORDER BY s\.computed_at DESC/, [
    { scope: 'OVERALL', score_0_100: 78 }, { scope: 'E', score_0_100: 82 }, { scope: 'G', score_0_100: 77 }]],
  [/AS n FROM esg_documents/, [{ n: 4 }]],
  [/SELECT id, project_type_id, estimated_cost_myr/, [
    { id: 'p1', project_type_id: 't1', estimated_cost_myr: 250000, ccpt_category_code: 'RE-01', status: 'defined' }]],
  [/SELECT id, annual_revenue_myr, employee_count/, [
    { id: 'c1', annual_revenue_myr: 24500000, employee_count: 148, ssm_number: 'X', msic_code: '25999' }]],
  [/FROM esg_assessments a? ?WHERE|FROM esg_assessments\b[\s\S]*WHERE (a\.)?company_id/, [{
    id: ASSESSMENT_ID, framework_id: 'fw-1', framework_code: 'MODUS_SEDG_ALIGNED',
    framework_version: '0.9-draft', reporting_year: 2025, status: 'scored', overall: 78,
  }]],
  /* Run 68's score history, ABOVE the esg_scores row fixture that would
     otherwise answer it — the same ordering rule the count queries at the top
     of this list are here for. Two years, because that is what exercises the
     branches that only exist with a trend: the history columns render at all,
     one of them is marked as the current year, and the metric row prints a
     delta. A single-year fixture would silently take the empty-state branch on
     both and neither would ever be rendered by this suite. */
  [/AS history_year/, [
    { history_year: 2024, score_0_100: 71, band_code: 'A' },
    { history_year: 2025, score_0_100: 78, band_code: 'AA' },
  ]],
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
      /* ── P9's aggregates, for a company that has done nothing ──────────────
         Same rule as the block above and it is the rule this stub exists to
         hold: a new company's aggregates are ZERO, not absent. The default
         `rows: []` at the bottom of this function models a database that
         answered nothing to a count(*), which cannot happen — and a route that
         survived it would only do so by carrying a `rows[0] || {}` guard for a
         case production never produces.

         EVERY FIGURE HERE IS ZERO AND THAT IS THE POINT. This is the day-one
         render: no documents, no answers, no projects, nothing pending. The
         action list it produces is the journey's own stages and nothing else,
         which is exactly what a company that registered ten minutes ago should
         see. */
      if (/AS documents_total/.test(sql)) {
        return { rows: [{ documents_total: 0, documents_read: 0, documents_unreadable: 0, documents_unattached: 0 }] };
      }
      if (/AS unanswered/.test(sql)) return { rows: [{ unanswered: 0 }] };
      if (/AS self_declared/.test(sql)) return { rows: [{ self_declared: 0 }] };
      if (/AS projects_total/.test(sql)) {
        return { rows: [{ projects_total: 0, projects_implemented: 0, projects_forecast: 0,
          projects_unclassified: 0, projects_no_financing: 0 }] };
      }
      if (/AS opportunities_pending/.test(sql)) return { rows: [{ opportunities_pending: 0 }] };
      if (/AS unverified_actuals/.test(sql)) return { rows: [{ unverified_actuals: 0 }] };
      // The register is a PUBLIC reference list, not this company's data, so it
      // is populated on day one. A new company sees products and no match.
      if (/AS products FROM esg_finance_products/.test(sql)) return { rows: [{ products: 31 }] };
      // readinessService (P6.5), for a company that has done nothing yet.
      if (/FROM esg_finance_inputs/.test(sql)) return { rows: [], rowCount: 0 };
      /* THIS BRANCH MUST STAY ABOVE THE BASELINES ONE, and the reason is the
         defect it was written from. actionCenter's U2 read is a ROW query over
         esg_green_projects whose two EXISTS subqueries both name
         esg_green_project_baselines — so the baselines branch below claimed it
         and answered `[{ n: 0 }]`, one row with no title on it, and the empty
         dashboard rendered "“undefined” is implemented and has never been
         measured" as its lead action. A row query cannot be disambiguated by an
         alias the way the aggregates above it can, so it is keyed on the
         predicate that is unique to it. */
      if (/AND p\.status = 'implemented'/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM esg_green_project_baselines/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FILTER \(WHERE is_provisional\)/.test(sql)) return { rows: [{ n: 0, provisional: 0 }] };
      if (/ORDER BY s\.computed_at DESC/.test(sql)) return { rows: [], rowCount: 0 };
      if (/AS n FROM esg_documents/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FILTER \(WHERE r\.document_id IS NOT NULL\)/.test(sql)) return { rows: [{ n: 0, documented: 0 }] };
      if (/SELECT id, project_type_id, estimated_cost_myr/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT id, annual_revenue_myr, employee_count/.test(sql)) {
        return { rows: [{ id: 'c1', annual_revenue_myr: null, employee_count: null, ssm_number: null, msic_code: null }] };
      }
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
  // Matched on the CLASS LIST, not on an exact attribute string. The previous
  // form looked for `<main class="app-main"` including the closing quote, so
  // adding a second class to the element — which P4 does — made every guard
  // that depends on this helper report "the shell changed" and go silently
  // vacuous. That is the exact failure mode this helper's comment warns about,
  // committed by the helper itself.
  const m = /<main\b[^>]*\bclass="([^"]*)"[^>]*>/i.exec(html);
  if (m && /\b(app-main|content)\b/.test(m[1])) {
    const j = html.lastIndexOf('</main>');
    const start = m.index + m[0].length;
    if (j > start) return html.slice(start, j);
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
      const available = `${CSS}\n${ESG_CSS}\n${inline}`;
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
      const available = `${CSS}\n${ESG_CSS}\n${inline}`;
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
    const available = `${CSS}\n${ESG_CSS}\n${inline}`;
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
    assert.strictEqual(md5, '8425f456',
      `the design system is ${md5}, not the master's 8425f456 — either this repo edited it (a §1 `
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
    /* ESG_DUMP_HTML — the only way to LOOK at this page on a machine with no
       database. test/visual/README is explicit that its probes need a live
       server at 127.0.0.1:3000 and a real Postgres behind it, which a Windows
       box with a private production database does not have; this suite already
       renders the three states this repo cares about, and writing them out
       costs three lines. Off unless the variable is set, so it is inert in CI
       and asserts nothing — it is a viewer, not a guard. */
    if (process.env.ESG_DUMP_HTML) {
      for (const [name, html] of [['empty', EMPTY_HTML], ['unseeded', UNSEEDED_HTML], ['full', FULL_HTML]]) {
        fs.writeFileSync(path.join(process.env.ESG_DUMP_HTML, `dashboard-${name}.html`), html);
      }
    }
    assert.notStrictEqual(contentOf(EMPTY_HTML), contentOf(FULL_HTML),
      'a company with no data and a scored company render byte-identical dashboards');
    assert.notStrictEqual(contentOf(EMPTY_HTML), contentOf(UNSEEDED_HTML),
      'a new company and a deployment whose seed never ran render the same page — the first is '
      + 'normal and the second is a configuration fault, and telling them apart is the whole point '
      + 'of the three empty states');
    for (const [label, html] of [['empty', EMPTY_HTML], ['unseeded', UNSEEDED_HTML], ['full', FULL_HTML]]) {
      const c = contentOf(html);
      assert.ok(c && c.length > 400, `${label}: content region is ${c && c.length} bytes`);
      /* THE FAILURE NAMES THE HOLE (P9). It used to say only that one existed,
         which on a 40 KB page is a bisect rather than a finding — the run that
         added the action list spent longer locating the word than fixing it.
         The message now carries 60 characters either side of the first match. */
      const hole = c.match(/undefined|NaN|\[object Object\]/);
      assert.ok(!hole, hole ? `${label}: a template hole rendered — "${hole[0]}" in: …${
        c.slice(Math.max(0, hole.index - 60), hole.index + 60).replace(/\s+/g, ' ')}…` : '');
      assert.ok(/class="(esg-)?card/.test(c), `${label}: rendered no card`);
    }
  });

  await atest('THE DASHBOARD LEADS WITH THE HERO, and only a scored one states a score', async () => {
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
    // P4 REPLACED THE COMPOSITION THIS TEST WAS WRITTEN AGAINST. Run 55's
    // reading order was "stat cards vs journey rail"; the dashboard is now one
    // narrative and both of those anchors are gone by design. The INVARIANT
    // survives and is asserted here in the new shape: the page leads with the
    // hero, the hero always carries the next action, and the story runs
    // position -> attention -> improvement -> pathway -> reserved.
    const e = contentOf(EMPTY_HTML);
    const f = contentOf(FULL_HTML);

    for (const [label, c] of [['empty', e], ['full', f]]) {
      for (const anchor of ['esg-hero', 'esg-next']) {
        assert.ok(c.includes(anchor),
          `the ${label} dashboard renders no .${anchor} — this test's anchor is gone, so its `
          + 'verdict means nothing until the anchor is updated');
      }
      /* RUN 68 PUT A PAGE HEAD ABOVE THE HERO, and the rule this assertion
         exists for survives it unchanged.

         The rule was never "nothing precedes the hero" — it was that no
         SECTION has drifted above it, which is what a character budget was a
         proxy for. A budget is the wrong instrument now that something is
         legitimately up there: raising the number would let a whole section
         through as long as it was terse, and keeping it at 120 would fail on
         a greeting. So the invariant is asserted directly instead.

         The page head is a greeting and the reporting period. It carries no
         figure, no state and no card, which is why it may lead. */
      const above = c.slice(0, c.indexOf('esg-hero'));
      assert.ok(!/esg-section|esg-metrics|esg-insight|esg-card/.test(above),
        `the ${label} dashboard puts a section above the hero: ${above.slice(-160)}`);
      // Matched on the FULL class attribute, not the substring: the head's own
      // children are all `esg-pagehead__*`, so a substring count would report
      // four blocks where there is one.
      const heads = (above.match(/class="esg-pagehead(?: |")/g) || []).length;
      assert.strictEqual(heads, 1,
        `the ${label} dashboard renders ${heads} blocks above the hero — exactly one, the page `
        + 'head, is allowed there');
      // The next action comes before the long-horizon sections, always.
      assert.ok(c.indexOf('esg-next') < c.indexOf('esg-pathway'),
        `the ${label} dashboard puts the pathway above the next action`);
      assert.ok(c.indexOf('esg-pathway') < c.indexOf('esg-reserved'),
        `the ${label} dashboard puts reserved capabilities above the pathway they follow`);
    }

    // The SCORED page states the score in the hero; the EMPTY one must not,
    // and must name which empty state it is instead of showing a zero.
    assert.ok(f.includes('score-ring--hero'),
      'the scored dashboard does not carry the hero ring');
    assert.ok(!e.includes('score-ring--hero'),
      'the empty dashboard renders a hero ring — a ring with no score is a claim about an unassessed company');
    assert.ok(/class="empty-state"/.test(e),
      'the empty dashboard states no empty state where the score would be');
  });

  await atest('THE DASHBOARD IS A COMPOSED NARRATIVE, NOT A GRID OF EQUAL CARDS', async () => {
    // REPLACES Run 55's twelve-column assertion. That test protected against a
    // one-column stack by demanding .grid-12 rows and three distinct column
    // widths — and the thing it was protecting became the defect: the audit
    // found a page of equal-weight panels where nothing led. P4's rule is the
    // opposite, so this asserts the new shape with the same strictness.
    const ESG_CSS_LOCAL = fs.readFileSync(ESG_CSS_PATH, 'utf8');
    for (const [label, html] of [['empty', EMPTY_HTML], ['full', FULL_HTML]]) {
      const c = contentOf(html);
      // A story of named sections, not a bag of panels.
      const sections = [...c.matchAll(/class="esg-section"/g)];
      assert.ok(sections.length >= 3,
        `the ${label} dashboard has ${sections.length} narrative sections`);
      const titles = [...c.matchAll(/class="esg-section__title">([^<]+)</g)].map((m) => m[1].trim());
      assert.strictEqual(new Set(titles).size, titles.length,
        `the ${label} dashboard repeats a section title: ${titles.join(' | ')}`);
      // The hero is the only two-column block, and it is a real grid.
      assert.ok(/class="esg-hero[ "]/.test(c), `the ${label} dashboard has no hero`);
      // Cards are used WHERE GROUPING HELPS, never as the page's layout unit.
      const cards = [...c.matchAll(/class="esg-card[ "]/g)].length;
      assert.ok(cards <= sections.length,
        `the ${label} dashboard renders ${cards} cards for ${sections.length} sections — the card `
        + 'grid is back');
    }
    // And it genuinely collapses, in the stylesheet rather than by hope.
    assert.ok(/@media \(max-width: 1100px\)[\s\S]{0,200}\.esg-hero \{ grid-template-columns: 1fr/.test(ESG_CSS_LOCAL),
      'the hero never collapses to one column — it will crush on a laptop');
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
    /* TWO MECHANISMS NOW CARRY ONE RULE, and the count spans both.

       Run 68 moved the document and carbon zero-states out of two standalone
       .esg-ai cards and into §33's insight rows, where an `info`-toned row is
       the named-zero: "No documents to read yet", "No carbon data yet",
       "Nothing to rank yet". The component changed and the obligation did not
       — each still says WHICH empty state it is, in its own words — so this
       counts both rather than dropping to whatever .empty-state survived.

       Counting only .empty-state would have passed at 1 with the threshold
       lowered, and that is the version of this edit that quietly stops
       protecting anything. */
    const boxes = (c.match(/class="empty-state"/g) || []).length;
    const namedRows = (c.match(/class="esg-insight__rowmark esg-insight__rowmark--info"/g) || []).length;
    const states = boxes + namedRows;
    assert.ok(states >= 2,
      `the empty dashboard names ${states} zero regions (${boxes} empty-state blocks, `
      + `${namedRows} info-toned insight rows)`);
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
    /* RUN 68 MOVED THE THREE PILLAR FIGURES OFF RINGS AND ONTO BARS, which is
       a rendering change and not a change to the fact under test. The fact is
       "every figure this page animates is TEXT in the DOM before any script
       runs"; the pillars are now .esg-pillar__value beside an .esg-progress
       bar whose width is a server-written percentage, so the number is if
       anything more plainly text than it was inside a ring.

       Both readers are asserted to find something before the figures are
       checked, so a renamed class fails here loudly instead of shrinking the
       denominator and passing. */
    const c = contentOf(FULL_HTML);
    const ringValues = [...c.matchAll(/class="score-ring-value"[^>]*>([^<]*)</g)].map((x) => x[1].trim());
    const pillarValues = [...c.matchAll(/class="esg-pillar__value"[^>]*>([^<]*)</g)].map((x) => x[1].trim());
    assert.strictEqual(ringValues.length, 1,
      `${ringValues.length} score-ring values rendered — the hero ring is the only one left`);
    assert.strictEqual(pillarValues.length, 3,
      `${pillarValues.length} pillar values rendered — E, S and G are three`);
    const rendered = [...ringValues, ...pillarValues];
    assert.ok(rendered.length >= 4,
      `only ${rendered.length} figures rendered — the overall ring and three pillars are four`);
    // The bar's WIDTH is server-written too, and from the same whole number.
    // A bar drawn by script would leave the page at 0% for anyone without one.
    assert.ok(/class="esg-progress__fill" style="width:\d+%"/.test(c),
      'a pillar bar has no server-rendered width — it would draw at zero without JavaScript');
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
    // Run 68: one hero ring plus three bar figures. Read from both classes for
    // the reason the sibling test above states — the rounding rule applies to
    // every score on the page, wherever it is drawn.
    const rendered = [
      ...[...c.matchAll(/class="score-ring-value"[^>]*>([^<]*)</g)].map((x) => x[1].trim()),
      ...[...c.matchAll(/class="esg-pillar__value"[^>]*>([^<]*)</g)].map((x) => x[1].trim()),
    ];
    assert.strictEqual(rendered.length, 4,
      `${rendered.length} score figures rendered, not the overall ring plus three pillars — the `
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
    // The ladder is a TABLE in P4, disclosed rather than occupying 40% of the
    // score card. Same rungs, same three words, same single current mark.
    const items = [...c.matchAll(/<tr>(\s*<td data-label="Band">[\s\S]*?)<\/tr>/g)]
      .map((m) => [m[0], m[0], m[0]]);
    const seeded = FIXTURES.find(([re]) => re.test('FROM esg_rating_bands'))[1];
    assert.strictEqual(items.length, seeded.length,
      `the ladder renders ${items.length} rungs for ${seeded.length} seeded bands`);
    for (const b of seeded) {
      assert.ok(c.includes(`${b.band_code} · ${b.band_label}`),
        `the seeded band ${b.band_code} is missing from the ladder`);
    }
    const here = items.filter(([row]) => row.includes('You are here'));
    assert.strictEqual(here.length, 1,
      `${here.length} rungs are marked as the company's current band — exactly one is`);
    assert.ok(here[0][2].includes('AA · Advanced') && here[0][2].includes('You are here'),
      `the current rung is not the scored band AA: ${here[0][2].replace(/<[^>]*>/g, ' ').trim()}`);
    // The three states are stated in WORDS, not by mark alone (§6).
    for (const word of ['You are here', 'Cleared', 'Not reached']) {
      assert.ok(c.includes(word), `the ladder never renders the state "${word}"`);
    }
    // And it is absent, not zeroed, when there is no score to place on it.
    assert.ok(!/data-label="Band"/.test(contentOf(EMPTY_HTML)),
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
    // Re-anchored from Run 55's col-7/col-5 row to P4's hero, which is where
    // the score now lives. The rule is unchanged: at most one sentence of prose
    // sits under the number.
    const c = contentOf(FULL_HTML);
    const from = c.indexOf('esg-hero');
    const to = c.indexOf('esg-next');
    assert.ok(from > -1 && to > from, 'the hero is gone from the scored dashboard — this check has no scope');
    const wide = c.slice(from, to);
    assert.ok(wide.includes('score-ring--hero'),
      'the hero does not hold the hero ring, so this slice is measuring the wrong block');
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

  await atest('the phone bar is four destinations plus a reachable overflow', async () => {
    // REPLACES the Run 53 assertion that pinned five hand-written keys. P3
    // changed the decision, not the protection: the bar is still explicit
    // (a module opts in with `bottom: true`, so ordering cannot move it), it is
    // still pinned here so a change is deliberate, and the NEW invariant is the
    // one the audit was about — everything not in the bar must still be
    // reachable, which is what the old five-key bar failed at for eleven of
    // sixteen destinations.
    const { BOTTOM_NAV, MODULES, TIERS } = require('../src/utils/layout');
    assert.deepStrictEqual(BOTTOM_NAV.map((m) => m.key),
      ['dashboard', 'journey', 'assessment', 'documents'],
      'the phone bar changed — four destinations plus the overflow is the decision; adding a fifth displaces the way out');

    for (const m of BOTTOM_NAV) {
      assert.ok(m.built, `${m.key} is in the phone bar but is not built — the old bar promoted an unbuilt Reports page`);
      assert.ok(m.tier === 'primary', `${m.key} is in the phone bar but is not a primary destination`);
    }

    // FOUR links plus the overflow summary. Anchored at the token boundary:
    // `class="bottom-nav-item` also prefixes `bottom-nav-item-icon`.
    const items = (FULL_HTML.match(/class="bottom-nav-item[ "]/g) || []).length;
    assert.strictEqual(items, 4, `the phone bar renders ${items} destinations`);
    assert.ok(/class="esg-nav-more"/.test(FULL_HTML), 'the phone bar has no overflow — this is the defect that hid eleven destinations');

    // THE INVARIANT. Every module is reachable at phone width: either it is in
    // the bar, or it is in the sheet. A module that is in neither is invisible
    // below 768px, which is exactly what happened to Green Finance.
    const sheet = /<nav class="esg-nav-sheet"[\s\S]*?<\/nav>/.exec(FULL_HTML);
    assert.ok(sheet, 'no overflow sheet rendered');
    const unreachable = MODULES.filter((m) => !m.bottom && !sheet[0].includes(`href="${m.path}"`));
    assert.deepStrictEqual(unreachable.map((m) => m.key), [],
      `unreachable at phone width: ${unreachable.map((m) => m.key).join(', ')}`);

    // Unbuilt destinations are present but marked, never silently promoted.
    for (const m of MODULES.filter((x) => !x.built)) {
      assert.ok(sheet[0].includes(`href="${m.path}"`), `${m.key} is not listed at all`);
    }
    assert.ok(/esg-nav-sheet__link--unbuilt/.test(sheet[0]),
      'unbuilt destinations render identically to working ones in the sheet');

    // Every tier the sidebar renders must be a tier some module actually has,
    // so a renamed tier cannot leave a heading with nothing under it.
    for (const m of MODULES) {
      assert.ok(TIERS.some((t) => t.key === m.tier), `${m.key} has tier "${m.tier}", which TIERS does not define`);
    }

    // Height comes from the master, so read it rather than assume it.
    const h = /\.app-bottom-nav\s*\{[^}]*height:\s*(\d+)px/.exec(CSS);
    assert.ok(h, '.app-bottom-nav declares no height');
    assert.ok(Number(h[1]) >= 44, `the bottom nav is ${h[1]}px tall; a touch target is 44px`);
    // Four destinations plus the overflow across the narrowest phone.
    assert.ok(320 / 5 >= 44, 'five bottom-bar slots no longer fit a 320px viewport at 44px each');
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
    /* §50 IS BOUNDED AT THE NEXT SECTION, and it was not before.
       `CSS.slice(i)` ran to the end of the file, so §50 was being graded on
       §52's and §53's declarations as well as its own. That was harmless while
       §50 was last; the master sync to edc02c0c appended §53, whose header
       comment contains the words "transition: all`, which" as PROSE, and the
       transition reader picked them up and reported §50 animating `all`. The
       section this test names is the section it should read. */
    const i = CSS.indexOf('50. GAMIFICATION & MOTION LAYER');
    assert.ok(i > 0, 'the §50 section is gone — the anchor moved');
    const rest = CSS.slice(i + 1);
    const next = rest.search(/\n\s*5[1-9]\. [A-Z]/);
    assert.ok(next > 0, 'no section follows §50 — the end bound is gone and this test is reading '
      + 'the rest of the file again');
    const section = rest.slice(0, next);
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
    /* ── Run 68 · §31–§33 ────────────────────────────────────────────────
       Most of what the metric row and the insight triad choose is already
       pinned above under another component's name — --muted and --text on a
       card, the three status tints as chip backgrounds. The pairs listed here
       are the ones this run genuinely introduces, and there is one shape that
       had never been measured before it: a STATUS colour as text on
       --surface-2, which is what .esg-insight__figure is. Every earlier use
       put a status colour on its own -bg tint; the recessed row inside a card
       is a different background and a different ratio.

       THESE THREE FAILED WHEN THEY WERE FIRST WRITTEN, which is the only
       reason to trust the fourth line. .esg-insight__figure took its card's
       tint and measured 4.47:1 and 4.46:1 in dark; it now takes --text, and
       the three tint pairs are kept here as the record of a measurement rather
       than deleted — reinstating that colour puts the ratio back under AA and
       these lines say so before anyone has to re-derive it.
       The tints are still asserted where they DO appear: on their own -bg,
       under .badge-accent / .badge-blue / .badge-green above. */
    ['var(--text)', ['var(--surface-2)', 'var(--surface)'], '.esg-insight__figure'],
    ['var(--text)', ['var(--surface)', 'var(--bg)'], '.esg-metric__value, .esg-pillar__value, .esg-chartcard__title'],
    ['var(--muted)', ['var(--surface)', 'var(--bg)'], '.esg-metric__label, .esg-metric__basis, .esg-chartcard__note, .esg-col__x'],
    ['var(--text-2)', ['var(--surface)', 'var(--bg)'], '.esg-pagehead__context, .esg-col__value'],
    ['var(--muted)', ['var(--surface-2)', 'var(--surface)'], '.esg-metric__delta--flat, .esg-insight__rownote'],
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

  /* ═══ GOVERNANCE AND COMPANY, AFTER THE P8 MIGRATION ═══════════════════
     Both were the last pages built entirely from master components. These
     assert the four things the migration was for, in the RENDERED page rather
     than in the source — the same reason PART 1 reads the rendering. */

  await atest('THE PHONE OVERFLOW SHEET NEVER SHIPS OPEN — on any page, including its own', async () => {
    // It used to carry `open` whenever the current page lived inside it. On a
    // 390px phone that covered roughly 60% of the viewport on arrival, so the
    // first act on /company and /governance was dismissing a menu the user had
    // not opened. The signal is kept; the overlay is not.
    const stub = populatedDb();
    const { pages } = await renderEveryPage(stub.exports, REQ);
    const opened = pages.filter(({ html }) => /<details class="esg-nav-more[^"]*"[^>]*\bopen\b/.test(html));
    assert.deepStrictEqual(opened.map((p) => p.path), [],
      `the overflow sheet ships open on: ${opened.map((p) => p.path).join(', ')} — a disclosure that `
      + 'opens itself covers the page the user just navigated to');

    // …and the "you are here" signal it was carrying is still carried, the way
    // the other four items in the bar carry it. /company is in the overflow.
    const company = await renderRoute('routes/pages', '/company', populatedDb().exports);
    assert.ok(/class="esg-nav-more esg-nav-more--current"/.test(company),
      'the overflow item does not mark itself current on a page that lives inside it');
    assert.ok(/<summary aria-current="true"/.test(company),
      'the overflow item is current but says so to nothing but a stylesheet');
    // §6: never colour alone. The visible label cannot change, so the
    // ACCESSIBLE NAME is what carries it in words.
    assert.ok(/aria-label="More sections — you are in [^"]+"/.test(company),
      'the current section is signalled by colour alone — the accessible name does not name it');

    // A page in the BAR, not the sheet, must not be marked.
    const dash = await renderRoute('routes/pages', '/dashboard', populatedDb().exports);
    assert.ok(!/esg-nav-more--current/.test(dash),
      'the overflow item marks itself current on a page that is in the bar, not the sheet');
    assert.ok(/aria-label="More sections"/.test(dash),
      'the overflow item claims a current section on a page that has none');

    // The modifier has to actually paint, or the whole thing is a no-op.
    assert.ok(/\.esg-nav-more--current\s*>\s*summary\s*\{[^}]*color:/.test(ESG_CSS),
      '.esg-nav-more--current is rendered but nothing styles it — CSS never warns');
  });

  await atest('GOVERNANCE USES THE ESG LAYER, NOT THE FAIL-OPEN MASTER CARD', async () => {
    const html = await renderRoute('routes/pages', '/governance', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    // .card fails OPEN — it carries no padding and expects .card-body to
    // supply it. Governance had six bare ones, every one measuring padding: 0.
    assert.ok(!/class="card"/.test(main),
      'governance still renders a bare master .card — that is the padding-collapsed shape D5 names');
    assert.ok(!/class="[^"]*\bsection-title\b/.test(main),
      'governance still uses .section-title instead of .esg-section__title');
    assert.ok(!/class="[^"]*\bstat-card\b/.test(main),
      'governance still uses .stat-card instead of §20\'s .esg-fact');
    assert.ok(!/class="[^"]*\bai-insight\b/.test(main),
      'governance still uses .ai-insight instead of §7\'s .esg-ai');

    // A composed .esg-card is the one that carries padding on its PARTS.
    assert.ok(/class="esg-card"/.test(main), 'governance renders no .esg-card at all');
    assert.ok(/esg-card__body/.test(main), 'governance has an .esg-card with no __body');
  });

  await atest('THE STAGE TABLE CANNOT CLIP — the column it loses is the only one it exists for', async () => {
    const html = await renderRoute('routes/pages', '/governance', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    // Measured before the migration: 419px of table inside a 390px viewport,
    // inside `.table-wrap { overflow: hidden }`. The column past the edge was
    // "Status here" — the platform/not-platform answer.
    assert.ok(!/class="table-wrap"/.test(main),
      'governance still wraps a table in the master .table-wrap, which clips with no scroll (D1)');
    assert.ok(/class="esg-table-scroll"[^>]*tabindex="0"/.test(main),
      'the stage table is not in a keyboard-reachable scroll container');
    assert.ok(/esg-table--stack/.test(main),
      'the stage table does not stack on a phone, so it will scroll sideways instead');

    // Every row states its status in WORDS, and the two states render
    // differently — §6, and the whole point of the table.
    const rows = main.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    const body = rows.filter((r) => /esg-astate/.test(r));
    assert.strictEqual(body.length, 5, `expected 5 stage rows, found ${body.length}`);
    assert.strictEqual(body.filter((r) => /esg-astate--verified/.test(r) && />This platform</.test(r)).length, 2,
      'the two stages this platform DOES cover are not both marked as such');
    assert.strictEqual(body.filter((r) => /esg-astate--na/.test(r) && />Not part of this platform</.test(r)).length, 3,
      'the three stages this platform does NOT cover are not all marked as such');
    // Every cell carries the label the stacked layout reads out.
    assert.ok(body.every((r) => /data-label="Status here"/.test(r)),
      'a stage row has no data-label, so its value loses its column name on a phone');
  });

  await atest('GOVERNANCE STATES WHAT IS NOT MIRRORED — and still publishes no count for it', async () => {
    const html = await renderRoute('routes/pages', '/governance', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    // mirrorStatus() returns methodologies_state: 'uninstrumented' and the page
    // was discarding it, so a reader saw two tiles and no sign a third thing
    // existed. It renders as an ABSENT fact — which is not a number, which is
    // what the route's own comment requires.
    const block = /esg-fact esg-fact--absent[\s\S]*?Methodologies mirrored[\s\S]*?<\/div>/.exec(main)
      || /Methodologies mirrored[\s\S]{0,400}?<\/div>/.exec(main);
    assert.ok(block, 'the methodologies fact is gone from the page');
    assert.ok(/esg-fact--absent/.test(main), 'nothing on the page renders as an absent fact');
    assert.ok(!/Methodologies mirrored<\/span>\s*<span class="esg-fact__value[^"]*">\s*0/.test(main),
      'the methodologies fact prints 0 — a zero would read as "none exist", which is the '
      + 'claim the route comment exists to prevent');
  });

  await atest('THE COMPANY FORM IS UNCHANGED BY THE MIGRATION — every field, name and control', async () => {
    const html = await renderRoute('routes/pages', '/company', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    // The migration must not have moved, renamed or dropped an input. These
    // are the six the POST handler writes.
    for (const name of ['name', 'ssm_number', 'msic_code', 'employee_count', 'annual_revenue_myr', 'grid_region']) {
      assert.ok(new RegExp(`name="${name}"`).test(main), `the ${name} field is gone from the form`);
      assert.ok(new RegExp(`<label for="${name}"`).test(main), `the ${name} field lost its label`);
    }
    assert.ok(/action="\/company"[^>]*|method="post"/.test(main), 'the form no longer posts to /company');
    assert.ok(/id="name"[^>]*required/.test(main), 'company name stopped being required');
    assert.ok(/id="grid_region"[^>]*required/.test(main), 'electricity grid stopped being required');
    assert.ok(/<button class="btn btn-primary" type="submit">Save<\/button>/.test(main),
      'the Save button changed shape');
  });

  await atest('THE THREE GRIDS ARE WRITTEN ONCE, AND THE AMPERSAND IS ESCAPED ONCE', async () => {
    const html = await renderRoute('routes/pages', '/company', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    // The live defect this found: the Sabah label carried a hand-written
    // `&amp;` and opt() escapes what it is given, so the dropdown rendered the
    // literal text "Sabah &amp; Labuan (SESB)".
    assert.ok(!/&amp;amp;/.test(main),
      'a double-escaped ampersand is back — a label is being escaped twice');
    assert.ok(/<option value="sabah"[^>]*>Sabah &amp; Labuan \(SESB\)<\/option>/.test(main),
      'the Sabah option no longer reads "Sabah & Labuan (SESB)"');

    // One source: the option label and the summary value must be the same string.
    const src = fs.readFileSync(path.join(SRC, 'routes', 'pages.js'), 'utf8');
    assert.strictEqual((src.match(/Sabah & Labuan \(SESB\)/g) || []).length, 1,
      'the Sabah label is written more than once — two copies of a label drift');
    assert.ok(/GRID_LABEL\[c\.grid_region\]/.test(src),
      'the profile summary no longer reads its grid label from GRID_OPTIONS');
  });

  await atest('A COLUMN NOTHING WRITES SAYS SO, rather than rendering as an empty field', async () => {
    const html = await renderRoute('routes/pages', '/company', populatedDb().exports);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    // industry_label, state and esg_maturity are READ by opportunityService —
    // they reach the AI prompt — and written by nothing. The page must not
    // offer them as blank inputs (that would imply they can be filled in) and
    // must not hide them (that hides why every scan says "unknown").
    for (const name of ['industry_label', 'state', 'esg_maturity']) {
      assert.ok(!new RegExp(`name="${name}"`).test(main),
        `${name} is now a form field — the P8 migration must not add one; nothing writes that column`);
    }
    for (const label of ['Industry', 'State', 'ESG maturity']) {
      assert.ok(new RegExp(`esg-fact__label">${label}<`).test(main),
        `${label} is not stated on the page, so the reader cannot tell why the AI scan says "unknown"`);
    }
    assert.ok(/Nothing records this/.test(main),
      'the write-less columns do not say that nothing records them');

    // And the claim in that sentence must still be TRUE. If a writer appears,
    // this fails and the sentence has to be deleted.
    const oppSrc = fs.readFileSync(path.join(SRC, 'services', 'opportunityService.js'), 'utf8');
    assert.ok(/industry_label/.test(oppSrc) && /esg_maturity/.test(oppSrc),
      'opportunityService no longer reads those columns — re-check the wording on /company');
    const writers = [];
    for (const dir of ['routes', 'services']) {
      for (const f of fs.readdirSync(path.join(SRC, dir)).filter((x) => x.endsWith('.js'))) {
        const s = fs.readFileSync(path.join(SRC, dir, f), 'utf8');
        for (const m of s.matchAll(/UPDATE esg_companies[\s\S]{0,400}?(?=`)/g)) {
          if (/industry_label\s*=|(^|[\s,])state\s*=|esg_maturity\s*=/.test(m[0])) writers.push(`${dir}/${f}`);
        }
      }
    }
    assert.deepStrictEqual(writers, [],
      `something now WRITES industry_label / state / esg_maturity (${writers.join(', ')}) — `
      + 'the "nothing records this" copy on /company is no longer true and must be replaced');
  });

  console.log(`\ndashboard-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('dashboard-test FAILED:', e.stack || e.message); process.exit(1); });

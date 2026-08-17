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

const EMPTY_DB = {
  query: async () => ({ rows: [], rowCount: 0 }),
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

const FIXTURES = [
  [/FROM esg_assessments a? ?WHERE|FROM esg_assessments\b[\s\S]*WHERE (a\.)?company_id/, [{
    id: ASSESSMENT_ID, framework_id: 'fw-1', framework_code: 'MODUS_SEDG_ALIGNED',
    framework_version: '0.9-draft', reporting_year: 2025, status: 'scored', overall: 78,
  }]],
  [/FROM esg_scores\b/, [
    { scope: 'OVERALL', score_0_100: 78, band_code: 'AA', points_earned: 40, points_available: 51,
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
  ]],
  [/FROM esg_recommendations\b/, [
    { id: 'rec-1', pillar: 'E', points_missed: 12, priority: 'high', narrative_en: 'Track electricity monthly.', source: 'ai_phrasing', code: 'E-01', question_en: 'Does the company track its monthly electricity consumption?' },
    { id: 'rec-2', pillar: 'S', points_missed: 6, priority: 'medium', narrative_en: 'Record training hours.', source: 'ai_phrasing', code: 'S-06', question_en: 'Average training hours per employee' },
    { id: 'rec-3', pillar: 'G', points_missed: 2, priority: 'low', narrative_en: 'Publish a supplier code.', source: 'fallback_template', code: 'G-10', question_en: 'Supplier code of conduct?' },
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
    projects: 4, methodologies: 2, last_fetch: '2026-08-01T00:00:00.000Z',
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

function populatedDb() {
  const seen = [];
  return {
    seen,
    exports: {
      query: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        seen.push(sql);
        if (/FROM esg_journey_stages\b/.test(sql)) return { rows: JOURNEY_FIXTURES.stages };
        if (/FROM esg_missions\b/.test(sql)) return { rows: JOURNEY_FIXTURES.missions };
        if (/FROM esg_xp_levels\b/.test(sql)) return { rows: JOURNEY_FIXTURES.levels };
        for (const [re, rows] of FIXTURES) {
          if (rows === null) continue;
          if (re.test(sql)) return { rows, rowCount: rows.length };
        }
        throw new Error(`populated stub has no fixture for: ${sql.slice(0, 130)}`);
      },
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    },
  };
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
    assert.strictEqual(md5, '8b92094c',
      `the design system is ${md5}, not the master's 8b92094c — either this repo edited it (a §1 `
      + 'defect) or a master sync landed and this pin was left behind (§1b)');
  });

  console.log(`\ndashboard-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('dashboard-test FAILED:', e.stack || e.message); process.exit(1); });

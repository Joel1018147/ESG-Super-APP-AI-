'use strict';
// JSON API. Built alongside the pages from day one, not retrofitted — no
// feature ships without its API equivalent, because the mobile client and any
// government-portal integration consume these and not the HTML.
//
// Every handler is wrapped: an unhandled rejection in an async Express 4 route
// hangs the request forever rather than 500-ing, which looks like a network
// problem to the caller and produces no log line worth reading.

const express = require('express');
const { query } = require('../db');
const { scoreAssessment, loadActiveScheme, computeScores } = require('../services/scoringEngine');
const { generateRecommendations } = require('../services/aiAdvisor');
const { electricityToCo2e, fuelToCo2e } = require('../services/carbonEngine');
const { mirrorStatus, syncProjects } = require('../services/verraService');
const ex = require('../services/extractionService');
const { enqueue, runOnce } = require('../services/jobRunner');
const { frameworkLabel } = require('../utils/layout');
const sedg = require('../data/sedgV2');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cid = (req) => req.user && req.user.company_id;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

router.get('/me', wrap(async (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name,
             role: req.user.role, company_id: req.user.company_id });
}));

router.get('/frameworks', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT code, version, name, publisher, framework_kind, is_active, source_url
       FROM esg_frameworks ORDER BY code, version`);
  // `name` and `publisher` are SELECTed and deliberately NOT returned. The
  // stored data stays factual — the working framework really was authored by
  // Modus AI Associates and seed.sql still says so — but a JSON body is
  // something a person can open, so the response carries the display name and
  // the identifiers only. See src/utils/layout.js FRAMEWORK_DISPLAY.
  res.json({
    frameworks: rows.map((f) => ({
      code: f.code,
      version: f.version,
      display_name: frameworkLabel(f.code, f.version),
      framework_kind: f.framework_kind,
      is_active: f.is_active,
      source_url: f.source_url,
    })),
  });
}));

// ── The official disclosure set ────────────────────────────────────────────
// Static reference data, not database rows. See src/data/sedgV2.js for why
// these 38 are deliberately NOT seeded into esg_indicators.
router.get('/frameworks/sedg-v2', wrap(async (req, res) => {
  res.json({
    provenance: sedg.PROVENANCE,
    counts: sedg.COUNTS,
    implemented: true,
    scored_on: 'completeness_of_disclosure',
    is_default_framework: false,
    has_cross_framework_mapping: false,
    has_translations: false,
    implementation_note:
      'All 38 are loaded as questions, answerable in the assessment, and scored on '
      + 'COMPLETENESS OF DISCLOSURE — not on performance. A reported figure has no good or '
      + 'bad value; what is scored is how much of SEDG the company can disclose, and a part '
      + 'marked not-applicable leaves the denominator. SEDG v2.0 is NOT the default '
      + 'framework, there is no cross-framework mapping to the 40 assessment '
      + 'questions this platform runs, and no BM or '
      + 'Chinese text exists (the official translations are v1). '
      + 'This platform is SEDG-aligned (draft), not SEDG-compliant.',
    disclosures: sedg.DISCLOSURES,
    other_frameworks: sedg.OTHER_FRAMEWORKS,
  });
}));

// ── Section status endpoints ───────────────────────────────────────────────
// Every page ships with its API equivalent (contract line 760). These report
// the SAME honest state the page renders — `uninstrumented` where a backing
// table exists but nothing writes to it, `not_built` where the capability does
// not exist at all. A client must be able to tell those apart without scraping
// HTML, which is the whole point of the three-empty-states rule.
const SECTION_STATUS = {
  analytics: { state: 'uninstrumented', built: false,
    summary: 'Scores are stored per assessment, but nothing writes the time series, peer benchmarks or trend aggregates this section needs.' },
  kpis: { state: 'uninstrumented', built: false,
    summary: 'No target has been set and nothing writes KPI values.' },
  assistant: { state: 'not_built', built: false,
    summary: 'A conversational assistant surface does not exist. AI recommendations DO run on assessment results and are logged to esg_ai_interactions.' },
  workflow: { state: 'not_built', built: false,
    summary: 'Assessments are completed and scored in one step. Nothing tracks an approval.' },
  users: { state: 'not_built', built: false,
    summary: 'Accounts exist and every route is authorised server-side. Role management is currently a database operation.' },
  integrations: { state: 'not_built', built: false,
    summary: 'No third-party connection is configured and none runs in the background.' },
};

for (const [section, status] of Object.entries(SECTION_STATUS)) {
  router.get(`/${section}`, wrap(async (req, res) => {
    res.json({ section, ...status });
  }));
}

router.get('/indicators', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT i.code, i.pillar, i.tier, i.question_en, i.response_type, i.unit,
            i.weight, i.allows_na, i.mapping_status, i.external_ref,
            f.code AS framework_code, f.version AS framework_version
       FROM esg_indicators i JOIN esg_frameworks f ON f.id = i.framework_id
      WHERE i.is_active
        AND ($1::text IS NULL OR f.code = $1)
        AND ($2::text IS NULL OR f.version = $2)
      ORDER BY i.pillar, i.sort_order`, [req.query.framework || null, req.query.version || null]);
  res.json({ indicators: rows });
}));

router.get('/company', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, ssm_number, msic_code, industry_label, employee_count,
            annual_revenue_myr, state, grid_region, esg_maturity, created_at, updated_at
       FROM esg_companies WHERE id = $1`, [cid(req)]);
  if (!rows[0]) return res.status(404).json({ error: 'Company not found' });
  res.json(rows[0]);
}));

router.put('/company', wrap(async (req, res) => {
  const b = req.body || {};
  const grid = ['peninsular', 'sabah', 'sarawak'].includes(b.grid_region) ? b.grid_region : null;
  const { rows } = await query(
    `UPDATE esg_companies SET
       name = COALESCE(NULLIF($2,''), name),
       ssm_number = NULLIF($3,''), msic_code = NULLIF($4,''),
       employee_count = COALESCE($5, employee_count),
       annual_revenue_myr = COALESCE($6, annual_revenue_myr),
       grid_region = COALESCE($7, grid_region)
     WHERE id = $1
     RETURNING id, name, ssm_number, msic_code, employee_count, annual_revenue_myr, grid_region`,
    [cid(req), String(b.name || ''), String(b.ssm_number || ''), String(b.msic_code || ''),
     num(b.employee_count), num(b.annual_revenue_myr), grid]);
  res.json(rows[0]);
}));

router.get('/assessments', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.reporting_year, a.status, a.framework_code, a.framework_version,
            a.weighting_version, a.submitted_at, a.scored_at
       FROM esg_assessments a WHERE a.company_id = $1 AND a.status <> 'archived'
      ORDER BY a.reporting_year DESC`, [cid(req)]);
  res.json({ assessments: rows });
}));

router.post('/assessments', wrap(async (req, res) => {
  const year = parseInt((req.body || {}).reporting_year, 10);
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'reporting_year is required' });
  // RULE 6. The framework is chosen, never inferred. Accepts either
  // framework_id, or framework + framework_version — the pair, because a code
  // alone stops being unique the moment a second version of one is seeded,
  // which is the same premise failure as trap C.
  //
  // A caller who names nothing, or names something unknown or inactive, gets a
  // 400. It must NOT quietly receive MODUS_SEDG_ALIGNED: a client that believed
  // it was creating a SEDG assessment and silently got the Modus 40 would carry
  // that error into every score it later read.
  const body = req.body || {};
  const fid = String(body.framework_id || '').trim();
  const fcode = String(body.framework || '').trim();
  const fver = String(body.framework_version || '').trim();
  if (!fid && !fcode) {
    return res.status(400).json({
      error: 'framework is required',
      detail: 'Pass framework_id, or framework with framework_version. There is deliberately no default.',
    });
  }
  const { rows: f } = fid
    ? await query(
      `SELECT id, code, version FROM esg_frameworks
        WHERE id = $1 AND framework_kind='entity_disclosure' AND is_active`, [fid])
    : await query(
      `SELECT id, code, version FROM esg_frameworks
        WHERE code = $1 AND ($2::text IS NULL OR version = $2)
          AND framework_kind='entity_disclosure' AND is_active`, [fcode, fver || null]);
  if (!f[0]) {
    return res.status(400).json({
      error: 'unknown or inactive framework',
      detail: 'Nothing was created. GET /api/frameworks lists the selectable ones.',
    });
  }
  if (f.length > 1) {
    return res.status(400).json({
      error: 'ambiguous framework',
      detail: `${fcode} has ${f.length} active versions; pass framework_version.`,
    });
  }
  const scheme = await loadActiveScheme();
  const { rows } = await query(
    `INSERT INTO esg_assessments
       (company_id, framework_id, framework_code, framework_version,
        weighting_scheme_id, weighting_version, reporting_year, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, framework_id, reporting_year) WHERE status <> 'archived'
     DO UPDATE SET updated_at = now()
     RETURNING id, reporting_year, status`,
    [cid(req), f[0].id, f[0].code, f[0].version, scheme.id, scheme.version, year, req.user.id]);
  res.status(201).json(rows[0]);
}));

/** Ownership check on every assessment-scoped route. Without it, any signed-in
 *  user could read any company's assessment by guessing a UUID. */
async function ownedAssessment(req) {
  const { rows } = await query(
    `SELECT id, framework_id, framework_code, framework_version, reporting_year, status
       FROM esg_assessments WHERE id = $1 AND company_id = $2`, [req.params.id, cid(req)]);
  return rows[0] || null;
}

router.get('/assessments/:id', wrap(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const [{ rows: responses }, { rows: scores }] = await Promise.all([
    query(`SELECT indicator_id, option_code, value_numeric, is_na, evidence_tier
             FROM esg_responses WHERE assessment_id = $1`, [a.id]),
    query(`SELECT scope, score_0_100, band_code, points_earned, points_available,
                  indicators_total, indicators_answered, indicators_na,
                  weighting_version, framework_version, engine_version, computed_at
             FROM esg_scores WHERE assessment_id = $1`, [a.id]),
  ]);
  res.json({ assessment: a, responses, scores });
}));

router.put('/assessments/:id/responses', wrap(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const items = Array.isArray((req.body || {}).responses) ? req.body.responses : null;
  if (!items) return res.status(400).json({ error: 'Body must be { responses: [...] }' });

  const { rows: inds } = await query(
    `SELECT id, code FROM esg_indicators WHERE framework_id = $1 AND is_active`, [a.framework_id]);
  const byCode = new Map(inds.map((i) => [i.code, i.id]));
  const valid  = new Set(inds.map((i) => i.id));

  let written = 0; const rejected = [];
  for (const item of items) {
    const indicatorId = item.indicator_id || byCode.get(item.code);
    if (!indicatorId || !valid.has(indicatorId)) { rejected.push(item.code || item.indicator_id); continue; }
    const tier = ['self_declared', 'documented', 'verified'].includes(item.evidence_tier)
      ? item.evidence_tier : 'self_declared';
    await query(
      `INSERT INTO esg_responses (assessment_id, indicator_id, option_code, value_numeric, is_na, evidence_tier, answered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (assessment_id, indicator_id) DO UPDATE SET
         option_code = EXCLUDED.option_code, value_numeric = EXCLUDED.value_numeric,
         is_na = EXCLUDED.is_na, evidence_tier = EXCLUDED.evidence_tier`,
      [a.id, indicatorId, item.option_code == null ? null : String(item.option_code),
       num(item.value_numeric), Boolean(item.is_na), tier, req.user.id]);
    written += 1;
  }
  // Rejections are REPORTED, not swallowed. A silently dropped response is a
  // score that is quietly wrong.
  res.json({ written, rejected });
}));

router.post('/assessments/:id/score', wrap(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const result = await scoreAssessment(a.id);
  let ai = { written: 0, mode: 'skipped' };
  if ((req.body || {}).with_recommendations !== false) {
    ai = await generateRecommendations(a.id, { companyId: cid(req), userId: req.user.id })
      .catch((e) => ({ written: 0, mode: 'error', error: e.message }));
  }
  res.json({ ...result, recommendations: ai });
}));

/** Score a hypothetical answer set without persisting anything. */
router.post('/score/preview', wrap(async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.indicators) || !Array.isArray(b.responses)) {
    return res.status(400).json({ error: 'Body must be { indicators: [...], responses: [...] }' });
  }
  const scheme = await loadActiveScheme();
  const { rows: bands } = await query(
    `SELECT band_code, min_score, max_score FROM esg_rating_bands WHERE scheme_id=$1 ORDER BY sort_order`,
    [scheme.id]);
  res.json(computeScores({ indicators: b.indicators, responses: b.responses, scheme, bands }));
}));

router.get('/carbon', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, period_start, period_end, scope, category, activity_amount, activity_unit,
            kg_co2e, factor_value_used, factor_version_used, factor_source_used,
            factor_verification_used, is_provisional
       FROM esg_carbon_entries WHERE company_id=$1 ORDER BY period_start DESC`, [cid(req)]);
  res.json({ entries: rows });
}));

router.post('/carbon', wrap(async (req, res) => {
  const b = req.body || {};
  const amount = num(b.amount);
  if (amount === null || amount < 0) return res.status(400).json({ error: 'amount must be a number >= 0' });
  if (!b.period_start || !b.period_end) return res.status(400).json({ error: 'period_start and period_end are required' });

  const { rows: co } = await query(`SELECT grid_region FROM esg_companies WHERE id=$1`, [cid(req)]);
  const calc = b.kind === 'electricity'
    ? await electricityToCo2e(amount, co[0] && co[0].grid_region)
    : await fuelToCo2e(amount, b.kind);

  const { rows } = await query(
    `INSERT INTO esg_carbon_entries
       (company_id, period_start, period_end, scope, category, activity_amount, activity_unit,
        factor_id, factor_value_used, factor_version_used, factor_source_used,
        factor_verification_used, is_provisional, kg_co2e, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id, kg_co2e, is_provisional, factor_version_used`,
    [cid(req), b.period_start, b.period_end, b.kind === 'electricity' ? 2 : 1,
     b.kind === 'electricity' ? 'grid_electricity' : 'mobile_combustion',
     calc.activity_amount, calc.activity_unit, calc.factor_id, calc.factor_value_used,
     calc.factor_version_used, calc.factor_source_used, calc.factor_verification_used,
     calc.is_provisional, calc.kg_co2e, req.user.id]);
  res.status(201).json(rows[0]);
}));

router.get('/emission-factors', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT code, scope, category, label, factor_value, unit_from, unit_to, region,
            source_name, source_url, source_year, version, valid_from, valid_to, verification_status
       FROM esg_emission_factors ORDER BY scope, code`);
  res.json({ factors: rows });
}));

router.get('/verra/status', wrap(async (req, res) => res.json(await mirrorStatus())));

router.get('/verra/projects', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await query(
    `SELECT verra_project_id, name, proponent, country, methodology_code, status,
            estimated_annual_reductions, registration_date
       FROM esg_verra_projects
      WHERE $1 = '' OR name ILIKE '%'||$1||'%' OR country ILIKE '%'||$1||'%'
         OR methodology_code ILIKE '%'||$1||'%'
      ORDER BY name LIMIT 200`, [q]);
  res.json({ projects: rows, query: q });
}));

router.post('/verra/sync', wrap(async (req, res) => {
  res.json(await syncProjects(req.body || {}));
}));

// ── Layer 2 ────────────────────────────────────────────────────────────────
router.get('/documents', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, filename, doc_type, mime_type, byte_size, text_status, page_count, created_at
       FROM esg_documents WHERE company_id=$1 ORDER BY created_at DESC`, [cid(req)]);
  res.json({ documents: rows });
}));

router.post('/documents/:id/analyse', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, assessment_id, mime_type FROM esg_documents WHERE id=$1 AND company_id=$2`,
    [req.params.id, cid(req)]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  if (!rows[0].assessment_id) return res.status(400).json({ error: 'Document is not linked to an assessment' });
  const jobId = await enqueue(ex.JOB_TYPE, {
    dedupe_key: rows[0].id, documentId: rows[0].id, assessmentId: rows[0].assessment_id,
    companyId: cid(req), userId: req.user.id,
  });
  // Nudge the worker, exactly as the HTML route at routes/documents.js does.
  // Without this the two paths for the same action behaved differently: the
  // page started extracting immediately and the API sat until the next 30s
  // poll. Same job, same durability — only how soon it starts differed, which
  // is the kind of drift that gets diagnosed as "the API is broken".
  if (jobId) setImmediate(() => runOnce().catch((e) => console.error('extraction:', e.message)));
  // null means a job for this document is already queued or running — reported
  // rather than swallowed, so a caller polling knows why nothing changed.
  res.status(jobId ? 202 : 200).json({ queued: Boolean(jobId), jobId });
}));

router.get('/assessments/:id/extractions', wrap(async (req, res) => {
  const a = await ownedAssessment(req);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const { rows } = await query(
    `SELECT e.id, i.code, i.pillar, e.proposed_option_code, e.evidence_quote, e.page_no,
            e.status, e.quote_verified, e.reject_reason, e.model, e.reviewed_at
       FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
      WHERE e.assessment_id=$1 ORDER BY e.status, i.pillar, i.code`, [a.id]);
  res.json({ extractions: rows, coverage: await ex.coverage(a.id) });
}));

/** Ownership is checked by joining through the document. Without it any
 *  signed-in user could accept another company's proposal by guessing a UUID —
 *  and accepting is the one action that changes a score. */
async function ownedExtraction(req) {
  const { rows } = await query(
    `SELECT e.id FROM esg_document_extractions e
       JOIN esg_documents d ON d.id = e.document_id
      WHERE e.id=$1 AND d.company_id=$2`, [req.params.id, cid(req)]);
  return rows[0] || null;
}

router.post('/extractions/:id/accept', wrap(async (req, res) => {
  if (!await ownedExtraction(req)) return res.status(404).json({ error: 'Not found' });
  res.json(await ex.acceptProposal(req.params.id, req.user.id));
}));

router.post('/extractions/:id/reject', wrap(async (req, res) => {
  if (!await ownedExtraction(req)) return res.status(404).json({ error: 'Not found' });
  res.json(await ex.rejectProposal(req.params.id, req.user.id, (req.body || {}).reason));
}));

// ═══════════════════════════════════════════════════════════════════════════
// GREEN FINANCE                                                     (Run 47)
//
// The JSON half of routes/greenFinance.js, and it lives HERE rather than in
// that router on purpose: checklist #17. `requireAuth` decides page-vs-fetch on
// the `/api/` prefix, and that test is only as good as its premise — a JSON
// endpoint served from a router mounted at `/` would get the 302 meant for a
// page navigation, and the caller would parse the login HTML and report the
// feature as unavailable.
//
// The register is REFERENCE DATA, not company data, so these reads are not
// scoped by company_id. Everything under /api already requires a session.
// ═══════════════════════════════════════════════════════════════════════════

const fin = require('../services/financeCopy');
const { requireRoles } = require('../middleware/auth');

// The register's column list is written out IN FULL at each of the four
// queries below rather than held in a constant and interpolated. It is a
// constant and it would be safe — but test/no-model-figures-test.js bans `${}`
// inside a SQL literal outright, and carving an exception for "this one is
// fine" is how the rule stops being a rule. server.js:87-92 makes the same
// trade for the same reason. Four repetitions cost nothing.

/** An enum value the schema's CHECK would reject is rejected HERE, by name, so
 *  the caller reads which field was wrong instead of a Postgres constraint
 *  string. Keys come from services/financeCopy.js — one vocabulary, asserted
 *  against schema.sql in the suite. */
function badEnum(field, value, labels) {
  if (Object.prototype.hasOwnProperty.call(labels, value)) return null;
  return { error: `invalid ${field}`, detail: `expected one of: ${Object.keys(labels).join(', ')}` };
}

/** last_verified is not optional on any write. A correction that leaves the old
 *  date in place is a lie with a date on it — the register's whole value is
 *  that every row carries the age of its own source. Enforced in the handler,
 *  not by convention. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function badVerifiedDate(value) {
  if (!value || !DATE_RE.test(String(value))) {
    return { error: 'last_verified is required', detail: 'Pass the date the source was read, as YYYY-MM-DD.' };
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { error: 'last_verified is not a real date' };
  // One day of tolerance, and exactly one: the server keeps UTC and this
  // platform's users are on UTC+8, so their "today" is legitimately tomorrow in
  // UTC for eight hours of every day. Anything beyond that is a typo or a
  // deliberate future-dating, and either way it must not be recorded.
  if (d.getTime() - Date.now() > 36 * 3600 * 1000) {
    return { error: 'last_verified is in the future', detail: 'A source cannot have been read tomorrow.' };
  }
  return null;
}

router.get('/finance-products', wrap(async (req, res) => {
  const q = req.query || {};
  for (const [field, value, labels] of [
    ['financing_type', q.type, fin.FINANCING_TYPE_LABELS],
    ['borrower_scope', q.scope, fin.BORROWER_SCOPE_LABELS],
    ['availability_status', q.status, fin.AVAILABILITY_LABELS],
  ]) {
    if (value) { const bad = badEnum(field, String(value), labels); if (bad) return res.status(400).json(bad); }
  }
  const { rows } = await query(
    `SELECT id, institution_name, institution_kind, product_name,
            financing_type, borrower_scope, max_financing_myr, min_financing_myr,
            amount_note, tenure_note, rate_note, documentation_note, eligibility_note,
            availability_status, status_note, source_url, source_publisher,
            last_verified, is_active, updated_by,
            (CURRENT_DATE - last_verified) AS days_since_verified
       FROM esg_finance_products
      WHERE ($1::text IS NULL OR financing_type      = $1)
        AND ($2::text IS NULL OR borrower_scope      = $2)
        AND ($3::text IS NULL OR availability_status = $3)
      ORDER BY institution_name, product_name`,
    [q.type || null, q.scope || null, q.status || null]);
  res.json({
    products: rows,
    stale_after_days: fin.STALE_AFTER_DAYS,
    disclaimer: fin.DISCLAIMER,
  });
}));

router.get('/finance-products/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, institution_name, institution_kind, product_name,
            financing_type, borrower_scope, max_financing_myr, min_financing_myr,
            amount_note, tenure_note, rate_note, documentation_note, eligibility_note,
            availability_status, status_note, source_url, source_publisher,
            last_verified, is_active, updated_by,
            (CURRENT_DATE - last_verified) AS days_since_verified
       FROM esg_finance_products WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ product: rows[0], stale_after_days: fin.STALE_AFTER_DAYS, disclaimer: fin.DISCLAIMER });
}));

router.get('/taxonomy/:schemeCode', wrap(async (req, res) => {
  const code = String(req.params.schemeCode || '').toUpperCase();
  const { rows: schemes } = await query(
    `SELECT id, code, version, publisher, source_url, effective_from, is_current
       FROM esg_taxonomy_schemes WHERE code = $1 ORDER BY is_current DESC, effective_from DESC`, [code]);
  if (!schemes[0]) return res.status(404).json({ error: 'Unknown taxonomy', detail: 'Known taxonomies: CCPT, ASEAN.' });
  const current = schemes[0];
  const { rows: categories } = await query(
    `SELECT code, label_en, definition_en, kind, sort_order
       FROM esg_taxonomy_categories WHERE scheme_id = $1 ORDER BY sort_order, code`, [current.id]);
  res.json({ scheme: current, revisions: schemes, categories });
}));

router.get('/project-types', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT code, label_en, label_bm, label_zh, sort_order, is_active,
            default_ccpt_category_id, default_asean_objective_id
       FROM esg_project_types ORDER BY sort_order, code`);
  res.json({
    project_types: rows.map((r) => ({
      ...r,
      // NOT a missing translation to be filled in by whoever notices. No source
      // publishes these terms in BM or Chinese, and a machine-translated
      // financial term is a wrong term in two more languages. Stated as a
      // state, so a client renders it rather than falling back silently.
      translation_status: (r.label_bm === null && r.label_zh === null) ? 'pending_no_official_source' : 'partial',
    })),
  });
}));

// ── The writers ────────────────────────────────────────────────────────────
// seed.sql is the legitimate writer for esg_taxonomy_schemes,
// esg_taxonomy_categories and esg_project_types — those are published reference
// data and change only when a publisher issues a revision. esg_finance_products
// needs a second one, because last_verified goes stale between deploys and a
// register nobody can correct stops being a register.
//
// super_admin only, and a denied caller gets a 403 — rendered in place for a
// page, JSON for a fetch, decided by the one wantsJson() in middleware/auth.js.
const superAdminOnly = requireRoles('super_admin');

router.post('/finance-products', superAdminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const required = ['institution_name', 'product_name', 'status_note', 'source_url'];
  for (const f of required) {
    if (!String(b[f] || '').trim()) return res.status(400).json({ error: `${f} is required` });
  }
  for (const [field, labels] of [
    ['institution_kind', fin.INSTITUTION_KIND_LABELS],
    ['financing_type', fin.FINANCING_TYPE_LABELS],
    ['borrower_scope', fin.BORROWER_SCOPE_LABELS],
    ['availability_status', fin.AVAILABILITY_LABELS],
    ['source_publisher', fin.SOURCE_PUBLISHER_LABELS],
  ]) {
    const bad = badEnum(field, String(b[field] || ''), labels);
    if (bad) return res.status(400).json(bad);
  }
  const badDate = badVerifiedDate(b.last_verified);
  if (badDate) return res.status(400).json(badDate);

  const { rows } = await query(
    `INSERT INTO esg_finance_products
       (institution_name, institution_kind, product_name, financing_type, borrower_scope,
        max_financing_myr, min_financing_myr, amount_note, tenure_note, rate_note,
        documentation_note, eligibility_note, availability_status, status_note,
        source_url, source_publisher, last_verified, is_active, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19)
     RETURNING id, institution_name, institution_kind, product_name,
               financing_type, borrower_scope, max_financing_myr, min_financing_myr,
               amount_note, tenure_note, rate_note, documentation_note, eligibility_note,
               availability_status, status_note, source_url, source_publisher,
               last_verified, is_active, updated_by,
               (CURRENT_DATE - last_verified) AS days_since_verified`,
    [String(b.institution_name).trim(), b.institution_kind, String(b.product_name).trim(),
     b.financing_type, b.borrower_scope,
     num(b.max_financing_myr), num(b.min_financing_myr),
     b.amount_note || null, b.tenure_note || null, b.rate_note || null,
     b.documentation_note || null, b.eligibility_note || null,
     b.availability_status, String(b.status_note).trim(),
     String(b.source_url).trim(), b.source_publisher, b.last_verified,
     b.is_active === false ? false : true, req.user.id]);
  res.status(201).json({ product: rows[0] });
}));

/* PATCH carries a jsonb PATCH DOCUMENT rather than a SET clause built in JS.
   Two reasons, and the second is the one that matters:

     1. no `${}` inside a SQL literal — test/no-model-figures-test.js bans that
        shape outright and carving an exception for "this one is safe" is how a
        rule stops being a rule;
     2. a key that is ABSENT and a key that is PRESENT AND EMPTY mean different
        things. Absent leaves the column alone; present-and-empty CLEARS it, and
        clearing is how an editor records that an institution has stopped
        publishing a term. COALESCE cannot express that difference, which is
        why the /company handler's shape is wrong for this table. */
router.patch('/finance-products/:id', superAdminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const badDate = badVerifiedDate(b.last_verified);
  if (badDate) return res.status(400).json(badDate);

  for (const [field, labels] of [
    ['institution_kind', fin.INSTITUTION_KIND_LABELS],
    ['financing_type', fin.FINANCING_TYPE_LABELS],
    ['borrower_scope', fin.BORROWER_SCOPE_LABELS],
    ['availability_status', fin.AVAILABILITY_LABELS],
    ['source_publisher', fin.SOURCE_PUBLISHER_LABELS],
  ]) {
    if (b[field] !== undefined) {
      const bad = badEnum(field, String(b[field]), labels);
      if (bad) return res.status(400).json(bad);
    }
  }
  // NOT NULL columns may be changed but never emptied.
  for (const f of ['status_note', 'source_url', 'institution_name', 'product_name']) {
    if (b[f] !== undefined && !String(b[f]).trim()) {
      return res.status(400).json({ error: `${f} cannot be emptied`, detail: 'It is required on every row.' });
    }
  }

  const patch = {};
  for (const f of ['institution_name', 'institution_kind', 'product_name', 'financing_type',
                   'borrower_scope', 'max_financing_myr', 'min_financing_myr', 'amount_note',
                   'tenure_note', 'rate_note', 'documentation_note', 'eligibility_note',
                   'availability_status', 'status_note', 'source_url', 'source_publisher', 'is_active']) {
    if (b[f] !== undefined) patch[f] = b[f] === null ? null : String(b[f]);
  }

  const { rows } = await query(
    `UPDATE esg_finance_products SET
       institution_name = CASE WHEN jsonb_exists($2::jsonb,'institution_name') THEN $2::jsonb->>'institution_name' ELSE institution_name END,
       institution_kind = CASE WHEN jsonb_exists($2::jsonb,'institution_kind') THEN $2::jsonb->>'institution_kind' ELSE institution_kind END,
       product_name = CASE WHEN jsonb_exists($2::jsonb,'product_name') THEN $2::jsonb->>'product_name' ELSE product_name END,
       financing_type = CASE WHEN jsonb_exists($2::jsonb,'financing_type') THEN $2::jsonb->>'financing_type' ELSE financing_type END,
       borrower_scope = CASE WHEN jsonb_exists($2::jsonb,'borrower_scope') THEN $2::jsonb->>'borrower_scope' ELSE borrower_scope END,
       max_financing_myr = CASE WHEN jsonb_exists($2::jsonb,'max_financing_myr') THEN NULLIF($2::jsonb->>'max_financing_myr','')::numeric(18,2) ELSE max_financing_myr END,
       min_financing_myr = CASE WHEN jsonb_exists($2::jsonb,'min_financing_myr') THEN NULLIF($2::jsonb->>'min_financing_myr','')::numeric(18,2) ELSE min_financing_myr END,
       amount_note = CASE WHEN jsonb_exists($2::jsonb,'amount_note') THEN NULLIF($2::jsonb->>'amount_note','') ELSE amount_note END,
       tenure_note = CASE WHEN jsonb_exists($2::jsonb,'tenure_note') THEN NULLIF($2::jsonb->>'tenure_note','') ELSE tenure_note END,
       rate_note = CASE WHEN jsonb_exists($2::jsonb,'rate_note') THEN NULLIF($2::jsonb->>'rate_note','') ELSE rate_note END,
       documentation_note = CASE WHEN jsonb_exists($2::jsonb,'documentation_note') THEN NULLIF($2::jsonb->>'documentation_note','') ELSE documentation_note END,
       eligibility_note = CASE WHEN jsonb_exists($2::jsonb,'eligibility_note') THEN NULLIF($2::jsonb->>'eligibility_note','') ELSE eligibility_note END,
       availability_status = CASE WHEN jsonb_exists($2::jsonb,'availability_status') THEN $2::jsonb->>'availability_status' ELSE availability_status END,
       status_note = CASE WHEN jsonb_exists($2::jsonb,'status_note') THEN $2::jsonb->>'status_note' ELSE status_note END,
       source_url = CASE WHEN jsonb_exists($2::jsonb,'source_url') THEN $2::jsonb->>'source_url' ELSE source_url END,
       source_publisher = CASE WHEN jsonb_exists($2::jsonb,'source_publisher') THEN $2::jsonb->>'source_publisher' ELSE source_publisher END,
       is_active = CASE WHEN jsonb_exists($2::jsonb,'is_active') THEN ($2::jsonb->>'is_active') IN ('true','on','1') ELSE is_active END,
       last_verified = $3::date,
       updated_by    = $4
     WHERE id = $1
     RETURNING id, institution_name, institution_kind, product_name,
               financing_type, borrower_scope, max_financing_myr, min_financing_myr,
               amount_note, tenure_note, rate_note, documentation_note, eligibility_note,
               availability_status, status_note, source_url, source_publisher,
               last_verified, is_active, updated_by,
               (CURRENT_DATE - last_verified) AS days_since_verified`,
    [req.params.id, JSON.stringify(patch), b.last_verified, req.user.id]);

  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ product: rows[0], last_verified: rows[0].last_verified });
}));

// ═══════════════════════════════════════════════════════════════════════════
// GREEN PROJECTS, BASELINES, EVIDENCE AND OPPORTUNITIES              (Run 48)
//
// requiring opportunityService HERE is what registers its job handler. The
// registration happens by side-effect at the bottom of that file, exactly as
// extractionService does it, and a handler registered in a module nobody
// imports fails at claim time with "No handler registered" — which reads as a
// queue bug rather than a missing import. server.js:23 requires verraService
// for the same reason and says so.
// ═══════════════════════════════════════════════════════════════════════════

const opp = require('../services/opportunityService');
const baselines = require('../services/baselineService');

/** Ownership on every project-scoped route. Copied from ownedAssessment()
 *  above rather than reinvented — two ownership predicates in one file is the
 *  duplication trap checklist #15 describes, where one of them drifts. */
async function ownedProject(req) {
  const { rows } = await query(
    `SELECT id, company_id, project_type_id, title, description, estimated_cost_myr,
            status, ccpt_category_code, ccpt_scheme_version, asean_ff_code,
            asean_ps_code, asean_scheme_version, classification_basis,
            classified_at, created_at
       FROM esg_green_projects WHERE id = $1 AND company_id = $2`,
    [req.params.id, cid(req)]);
  return rows[0] || null;
}

router.get('/green-projects', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.title, p.status, p.estimated_cost_myr, p.ccpt_category_code,
            p.ccpt_scheme_version, p.asean_ff_code, p.asean_scheme_version,
            p.classification_basis, p.created_at, t.code AS project_type_code,
            t.label_en AS project_type_label
       FROM esg_green_projects p
       LEFT JOIN esg_project_types t ON t.id = p.project_type_id
      WHERE p.company_id = $1
      ORDER BY p.created_at DESC`, [cid(req)]);
  res.json({ projects: rows });
}));

router.post('/green-projects', wrap(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });

  let typeRow = null;
  if (b.project_type_code) {
    const { rows } = await query(
      `SELECT id, code, label_en, default_ccpt_category_id, default_asean_objective_id
         FROM esg_project_types WHERE code = $1 AND is_active`, [String(b.project_type_code)]);
    if (!rows[0]) {
      return res.status(400).json({
        error: 'unknown project_type_code',
        detail: 'GET /api/project-types lists the selectable ones. A type is never inferred.',
      });
    }
    typeRow = rows[0];
  }

  // The classification is stamped at creation FROM the type's default, when it
  // has one. No type carries one today (Run 47 seeded them NULL rather than
  // invent a classification no source publishes), so a project created now is
  // unclassified and says so, rather than claiming a basis for a
  // classification that never happened.
  const stamp = typeRow
    ? await opp.resolveDefaultClassification(typeRow)
    : { ccpt_category_code: null, ccpt_scheme_version: null, asean_ff_code: null,
        asean_ps_code: null, asean_scheme_version: null, classification_basis: null };

  const { rows } = await query(
    `INSERT INTO esg_green_projects
       (company_id, project_type_id, title, description, estimated_cost_myr, status,
        ccpt_category_code, ccpt_scheme_version, asean_ff_code, asean_ps_code,
        asean_scheme_version, classification_basis, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, title, status, estimated_cost_myr, classification_basis, created_at`,
    [cid(req), typeRow ? typeRow.id : null, title, b.description || null,
     num(b.estimated_cost_myr), 'draft',
     stamp.ccpt_category_code, stamp.ccpt_scheme_version, stamp.asean_ff_code,
     stamp.asean_ps_code, stamp.asean_scheme_version, stamp.classification_basis,
     req.user.id]);
  res.status(201).json({ project: rows[0] });
}));

router.get('/green-projects/:id', wrap(async (req, res) => {
  const p = await ownedProject(req);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const [bl, ev] = await Promise.all([
    baselines.listBaselines(p.id),
    query(`SELECT e.document_id, d.filename, d.doc_type, d.byte_size, e.created_at
             FROM esg_green_project_evidence e
             JOIN esg_documents d ON d.id = e.document_id
            WHERE e.project_id = $1 ORDER BY e.created_at DESC`, [p.id]),
  ]);
  res.json({ project: p, baselines: bl, evidence: ev.rows });
}));

router.patch('/green-projects/:id', wrap(async (req, res) => {
  const p = await ownedProject(req);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const STATUSES = ['draft', 'defined', 'seeking_financing', 'implementing', 'implemented', 'abandoned'];
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: 'invalid status', detail: `expected one of: ${STATUSES.join(', ')}` });
  }
  // A human assigning a classification stamps human_assigned and the scheme
  // version it was read under — never a bare code with no provenance.
  const humanClassifying = b.ccpt_category_code !== undefined || b.asean_ff_code !== undefined;
  let ccptVersion = p.ccpt_scheme_version;
  let aseanVersion = p.asean_scheme_version;
  if (humanClassifying) {
    const { rows: cur } = await query(
      `SELECT code, version FROM esg_taxonomy_schemes WHERE is_current`);
    for (const s of cur) {
      if (s.code === 'CCPT') ccptVersion = s.version;
      if (s.code === 'ASEAN') aseanVersion = s.version;
    }
  }

  const { rows } = await query(
    `UPDATE esg_green_projects SET
       title = COALESCE(NULLIF($2,''), title),
       description = CASE WHEN $3::text IS NULL THEN description ELSE NULLIF($3,'') END,
       estimated_cost_myr = COALESCE($4, estimated_cost_myr),
       status = COALESCE($5, status),
       ccpt_category_code = COALESCE($6, ccpt_category_code),
       asean_ff_code = COALESCE($7, asean_ff_code),
       asean_ps_code = COALESCE($8, asean_ps_code),
       ccpt_scheme_version = $9,
       asean_scheme_version = $10,
       classification_basis = CASE WHEN $11 THEN 'human_assigned' ELSE classification_basis END,
       classified_by = CASE WHEN $11 THEN $12::uuid ELSE classified_by END,
       classified_at = CASE WHEN $11 THEN now() ELSE classified_at END
     WHERE id = $1 AND company_id = $13
     RETURNING id, title, description, status, estimated_cost_myr, ccpt_category_code,
               ccpt_scheme_version, asean_ff_code, asean_ps_code, asean_scheme_version,
               classification_basis, classified_at`,
    [p.id, b.title === undefined ? '' : String(b.title),
     b.description === undefined ? null : String(b.description),
     num(b.estimated_cost_myr), b.status || null,
     b.ccpt_category_code || null, b.asean_ff_code || null, b.asean_ps_code || null,
     ccptVersion, aseanVersion, humanClassifying, req.user.id, cid(req)]);
  res.json({ project: rows[0] });
}));

router.post('/green-projects/:id/baseline', wrap(async (req, res) => {
  const p = await ownedProject(req);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.period_start || !b.period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' });
  }
  const result = await baselines.computeBaseline(p.id, cid(req), b.period_start, b.period_end);
  if (!result) return res.status(404).json({ error: 'Not found' });
  const reasons = result.provisional
    ? await baselines.provisionalReasons(cid(req), b.period_start, b.period_end)
    : [];
  res.json({ ...result, provisional_reasons: reasons });
}));

router.post('/green-projects/:id/evidence', wrap(async (req, res) => {
  const p = await ownedProject(req);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const documentId = String((req.body || {}).document_id || '').trim();
  if (!documentId) return res.status(400).json({ error: 'document_id is required' });
  // The document must already belong to this company. Evidence reuses
  // esg_documents; there is no second upload path.
  const { rows: doc } = await query(
    `SELECT id FROM esg_documents WHERE id = $1 AND company_id = $2`, [documentId, cid(req)]);
  if (!doc[0]) return res.status(404).json({ error: 'Document not found for this company' });

  const { rows } = await query(
    `INSERT INTO esg_green_project_evidence (project_id, document_id, attached_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (project_id, document_id) DO NOTHING
     RETURNING id, project_id, document_id`, [p.id, documentId, req.user.id]);
  // Already attached is reported, not swallowed — a caller polling otherwise
  // cannot tell "attached" from "nothing happened".
  res.status(rows[0] ? 201 : 200).json({ attached: Boolean(rows[0]), evidence: rows[0] || null });
}));

router.delete('/green-projects/:id/evidence/:documentId', wrap(async (req, res) => {
  const p = await ownedProject(req);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { rows } = await query(
    `DELETE FROM esg_green_project_evidence WHERE project_id = $1 AND document_id = $2
     RETURNING id`, [p.id, req.params.documentId]);
  res.json({ detached: rows.length > 0 });
}));

router.get('/green-opportunities', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.proposed_project_type_code, o.rationale_en, o.status,
            o.derived_from_kind, o.reviewed_at, o.created_at, t.label_en AS project_type_label
       FROM esg_green_opportunities o
       LEFT JOIN esg_project_types t ON t.code = o.proposed_project_type_code
      WHERE o.company_id = $1
      ORDER BY o.created_at DESC`, [cid(req)]);
  const scan = await opp.lastScan(cid(req));
  // The scan's own state travels with the list, so a caller can tell an empty
  // list that means "nothing found" from one that means "the analysis failed".
  //
  // `state` is the derived answer and is what a client should branch on: the
  // raw `status` column reads 'pending' between retries, so a caller keying on
  // status === 'failed' misses the first failures exactly as the page did.
  const st = opp.scanState(scan);
  res.json({
    opportunities: rows,
    scan: scan ? {
      state: st.state,
      status: scan.status,
      attempts: st.attempts,
      max_attempts: st.maxAttempts,
      last_error: scan.last_error,
      ran_at: scan.updated_at,
    } : { state: 'none' },
  });
}));

router.post('/green-opportunities/scan', wrap(async (req, res) => {
  const jobId = await opp.queueScan(cid(req), req.user.id);
  if (jobId) setImmediate(() => runOnce().catch((e) => console.error('opportunity scan:', e.message)));
  // null means a scan for THIS company is already queued or running — reported
  // rather than swallowed, so a caller polling knows why nothing changed.
  res.status(jobId ? 202 : 200).json({ queued: Boolean(jobId), jobId });
}));

router.post('/green-opportunities/:id/accept', wrap(async (req, res) => {
  const created = await opp.acceptOpportunity(req.params.id, req.user.id, cid(req));
  if (!created) return res.status(404).json({ error: 'Not found' });
  res.status(201).json({ project: created });
}));

router.post('/green-opportunities/:id/reject', wrap(async (req, res) => {
  const row = await opp.rejectOpportunity(req.params.id, req.user.id, cid(req));
  if (!row) return res.status(404).json({ error: 'Not found or not pending' });
  res.json({ opportunity: row });
}));

// ═══════════════════════════════════════════════════════════════════════════
// THE JOURNEY, MISSIONS AND XP                                       (Run 52)
//
// CODES AND INTEGERS ONLY. Not one of these three responses carries an English
// display string — no stage label, no mission label, no level name.
// MODUS_UI_CONTRACT §4.3b: a server-supplied display string cannot be
// translated and is English forever, so identifiers and state cross the wire
// and the client looks up the words. test/journey-test.js asserts it by
// checking that no seeded label appears in any of the three bodies, which is a
// test that fails the moment someone adds one for convenience.
//
// `blocked_reason_code` is the STAGE CODE, because there is exactly one blocked
// reason per stage and the English sentence lives in
// esg_journey_stages.blocked_reason. A client wanting to render it in another
// language keys its own dictionary off this code; sending the sentence itself
// would be the §4.3b defect.
//
// These reads are company-scoped inside journeyEngine.gatherFacts(), which
// carries the tenant predicate on every statement it issues. Nothing is stored
// by any of them: they are all GET, and the engine writes nothing at all.
// ═══════════════════════════════════════════════════════════════════════════

const journeyEngine = require('../services/journeyEngine');

router.get('/journey', wrap(async (req, res) => {
  const { stages } = await journeyEngine.loadDefinitions();
  if (!stages.length) {
    // UNINSTRUMENTED, and it says so rather than answering with an empty array
    // that a client cannot tell apart from a company at stage zero.
    return res.json({ state: 'uninstrumented', stages: [], total_stages: 0,
      detail: 'No journey stage is defined on this deployment; seed.sql has not run.' });
  }
  const facts = await journeyEngine.gatherFacts(cid(req));
  const j = journeyEngine.computeJourney(facts, stages);
  res.json({
    state: 'ok',
    engine_version: journeyEngine.ENGINE_VERSION,
    active_stage_code: j.active_stage_code,
    counts: j.counts,
    total_stages: j.total_stages,
    stages: j.stages.map((s) => ({
      stage_code: s.stage_code,
      group_code: s.group_code,
      predicate_code: s.predicate_code,
      sort_order: s.sort_order,
      state: s.state,
      done: s.done,
      total: s.total,
      blocked: s.blocked,
      blocked_reason_code: s.blocked ? s.stage_code : null,
    })),
  });
}));

router.get('/missions', wrap(async (req, res) => {
  const { missions } = await journeyEngine.loadDefinitions();
  if (!missions.length) {
    return res.json({ state: 'uninstrumented', missions: [], total: 0, completed: 0,
      detail: 'No mission is defined on this deployment; seed.sql has not run.' });
  }
  const facts = await journeyEngine.gatherFacts(cid(req));
  const m = journeyEngine.computeMissions(facts, missions);
  res.json({
    state: 'ok',
    completed: m.completed,
    total: m.total,
    missions: m.missions.map((x) => ({
      mission_code: x.mission_code,
      stage_code: x.stage_code,
      predicate_code: x.predicate_code,
      state: x.state,
      done: x.done,
      total: x.total,
      xp_award: x.xp_award,
    })),
  });
}));

router.get('/xp', wrap(async (req, res) => {
  const { missions, levels } = await journeyEngine.loadDefinitions();
  if (!missions.length || !levels.length) {
    return res.json({ state: 'uninstrumented', total: 0, awards: [],
      detail: 'No mission or level ladder is defined on this deployment; seed.sql has not run.' });
  }
  const facts = await journeyEngine.gatherFacts(cid(req));
  const xp = journeyEngine.computeXp(facts, missions, levels);
  res.json({
    state: 'ok',
    total: xp.total,
    max_xp: xp.max_xp,
    level: xp.level,
    level_min_xp: xp.level_min_xp,
    next_level: xp.next_level,
    next_level_min_xp: xp.next_level_min_xp,
    // Every award names the row that earned it and is dated by THAT ROW'S own
    // timestamp, so a caller can compute "this week" itself and can go and look
    // at the row. An award that could not be traced would have thrown in the
    // engine rather than reaching here.
    awards: xp.awards.map((a) => ({
      mission_code: a.mission_code,
      xp: a.xp,
      earned_at: a.earned_at,
      source_table: a.source_table,
      source_id: a.source_id,
    })),
  });
}));

module.exports = router;

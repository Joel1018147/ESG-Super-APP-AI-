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
      WHERE i.is_active AND ($1::text IS NULL OR f.code = $1)
      ORDER BY i.pillar, i.sort_order`, [req.query.framework || null]);
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
  const { rows: f } = await query(
    `SELECT id, code, version FROM esg_frameworks
      WHERE framework_kind='entity_disclosure' AND is_active
      ORDER BY effective_from DESC NULLS LAST LIMIT 1`);
  if (!f[0]) return res.status(500).json({ error: 'No active entity-disclosure framework seeded' });
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

module.exports = router;

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN OPPORTUNITIES — the model picks a TYPE, it never sizes a project
   ───────────────────────────────────────────────────────────────────────────
   A separate service with its own containment, in the same shape as
   extractionService.js. aiAdvisor.js is NOT touched and does not gain a sixth
   guard — CLAUDE.md non-negotiable #1 says do not open one, and a guard added
   to a file already carrying five is a guard nobody re-reads.

   THE RULE THE WHOLE DESIGN RESTS ON: the model never produces a figure. It
   picks a project_type_code from a closed set and writes one sentence of
   rationale. Four guards, and none of them is a code comment asking nicely:

     1. THE PROMPT RECEIVES NO FREE-FORM NUMBERS TO ECHO. It is given the MSIC
        code, an employee BAND (not a headcount), the grid region, the closed
        list of project type codes, and which indicators are answered or
        unanswered — codes and states, never values. A model cannot echo a
        figure it was never shown. If a number is needed later, an executor
        computes it from the database.

     2. STRICT PARSE. A proposed code absent from esg_project_types is DROPPED,
        never "closest matched". A malformed line is SKIPPED, never repaired.
        Repairing a malformed line is how a model's typo becomes a company's
        project.

     3. NO NUMERIC COLUMN EXISTS to write to. See schema.sql §12 —
        esg_green_opportunities has no numeric column at all, deliberately, so
        a future author cannot add a write path for a figure without first
        adding the column and tripping the suite.

     4. A PROPOSAL IS A PROPOSAL UNTIL A HUMAN ACCEPTS IT. Only
        acceptOpportunity() creates an esg_green_projects row, and the project
        it creates has estimated_cost_myr = NULL. The human types the number or
        it stays null. The model never seeds it.

   AND FAILURE IS VISIBLY DISTINCT FROM SUCCESS-WITH-NOTHING-FOUND. This is
   RULE 6 and it is the exact defect carbonImportService.js shipped: a Groq
   failure returning {} was pixel-identical to a successful call that matched
   nothing. Here the scan THROWS; jobRunner records status='failed' with the
   message in esg_scheduled_jobs.last_error, where a successful empty scan
   leaves status='done' and last_error=NULL. The two are different rows, and
   the page renders them differently.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const { generateWithGroq, groqModel, logInteraction } = require('./groqService');
const { register, enqueue } = require('./jobRunner');

const JOB_TYPE = 'green_opportunity_scan';

/* ── Guard 1: what the model is allowed to see ─────────────────────────────
   Every field here is a CODE, a BAND or a STATE. Nothing is a measured value.
   An employee headcount is banded rather than passed through, because "we have
   47 staff" is exactly the kind of number a model will helpfully put back into
   a sentence about project size. */
function employeeBand(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'unknown';
  if (v < 5) return 'micro (under 5)';
  if (v < 30) return 'small (5-29)';
  if (v < 75) return 'medium (30-74)';
  return 'larger (75+)';
}

async function buildContext(companyId) {
  const { rows: co } = await query(
    `SELECT msic_code, industry_label, employee_count, state, grid_region, esg_maturity
       FROM esg_companies WHERE id = $1`, [companyId]);
  if (!co[0]) throw new Error('Company not found');

  const { rows: types } = await query(
    `SELECT code, label_en FROM esg_project_types WHERE is_active ORDER BY sort_order, code`);

  // Indicator CODES and whether they are answered. Never the answer itself:
  // a response value is a measured number and rule 1 forbids showing one.
  const { rows: indicators } = await query(
    `SELECT i.code,
            CASE WHEN r.id IS NULL THEN 'unanswered'
                 WHEN r.is_na THEN 'not_applicable'
                 ELSE 'answered' END AS state
       FROM esg_assessments a
       JOIN esg_indicators i ON i.framework_id = a.framework_id AND i.is_active
       LEFT JOIN esg_responses r ON r.assessment_id = a.id AND r.indicator_id = i.id
      WHERE a.company_id = $1 AND a.status <> 'archived'
      ORDER BY i.pillar, i.sort_order
      LIMIT 60`, [companyId]);

  // Which carbon CATEGORIES exist, never how much of anything.
  const { rows: carbon } = await query(
    `SELECT DISTINCT category, scope FROM esg_carbon_entries WHERE company_id = $1 ORDER BY scope, category`,
    [companyId]);

  return {
    msic_code: co[0].msic_code || 'unknown',
    industry: co[0].industry_label || 'unknown',
    employee_band: employeeBand(co[0].employee_count),
    state: co[0].state || 'unknown',
    grid_region: co[0].grid_region || 'unknown',
    esg_maturity: co[0].esg_maturity || 'unknown',
    project_types: types,
    indicators,
    carbon_categories: carbon,
  };
}

function buildPrompt(ctx) {
  const types = ctx.project_types.map((t) => `${t.code} — ${t.label_en}`).join('\n');
  const inds = ctx.indicators.map((i) => `${i.code}:${i.state}`).join(' ');
  const cats = ctx.carbon_categories.map((c) => `scope${c.scope}:${c.category}`).join(' ') || 'none recorded';
  return `You are helping a Malaysian SME identify which GREEN PROJECT TYPES are worth exploring.

Company facts (codes and bands only — no measured values are provided, and you must not invent any):
  MSIC industry code: ${ctx.msic_code}
  Industry: ${ctx.industry}
  Employee band: ${ctx.employee_band}
  State: ${ctx.state}
  Electricity grid region: ${ctx.grid_region}
  Self-reported ESG maturity: ${ctx.esg_maturity}
  Carbon data categories on file: ${cats}
  ESG indicator states: ${inds}

Choose from EXACTLY these project type codes. Do not invent a code, do not
alter one, and do not propose anything not on this list:
${types}

Output one line per proposal, at most five lines, in exactly this format:
CODE | one sentence explaining why this company in particular

Rules you must follow:
- Never state or estimate a cost, a saving, a payback period, a percentage, a
  tonnage or any other number. You have not been given any figures and you must
  not produce one.
- If nothing on the list fits this company, output the single word NONE.
- No preamble, no numbering, no markdown.`;
}

/* ── Guard 2: strict parse ─────────────────────────────────────────────────
   Drop, never repair. Returns {proposals, dropped} so the caller can report
   what was thrown away rather than silently shrinking the list. */
function parseProposals(text, validCodes) {
  const proposals = [];
  const dropped = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^none$/i.test(line)) continue;
    const bar = line.indexOf('|');
    if (bar === -1) { dropped.push({ line, why: 'no separator' }); continue; }
    const code = line.slice(0, bar).trim().toUpperCase();
    const rationale = line.slice(bar + 1).trim();
    if (!validCodes.has(code)) { dropped.push({ line, why: 'unknown project type code' }); continue; }
    if (!rationale) { dropped.push({ line, why: 'no rationale' }); continue; }
    if (seen.has(code)) { dropped.push({ line, why: 'duplicate code' }); continue; }
    seen.add(code);
    proposals.push({ code, rationale });
    if (proposals.length >= 5) break;
  }
  return { proposals, dropped };
}

/** Run a scan for one company. THROWS on a model failure — the caller must not
 *  be able to mistake "the analysis did not run" for "the analysis found
 *  nothing", which is the carbonImportService defect RULE 6 was written from. */
async function scanCompany(companyId, opts = {}) {
  const ctx = await buildContext(companyId);
  const validCodes = new Set(ctx.project_types.map((t) => t.code));
  const prompt = buildPrompt(ctx);
  const model = groqModel();
  const started = Date.now();

  let text;
  try {
    text = await generateWithGroq(prompt, { maxTokens: 600 });
  } catch (err) {
    await logOrReport({
      company_id: companyId, user_id: opts.userId || null, feature: JOB_TYPE, model,
      prompt_chars: prompt.length, response_chars: 0, latency_ms: Date.now() - started,
      ok: false, error_message: err.message,
    });
    // The message a human reads, and the one stored on the job row.
    throw new Error(`Green opportunity analysis did not run: ${err.message}`);
  }

  await logOrReport({
    company_id: companyId, user_id: opts.userId || null, feature: JOB_TYPE, model,
    prompt_chars: prompt.length, response_chars: (text || '').length,
    latency_ms: Date.now() - started, ok: true, error_message: null,
  });

  const { proposals, dropped } = parseProposals(text, validCodes);

  let written = 0;
  for (const p of proposals) {
    const { rowCount } = await query(
      `INSERT INTO esg_green_opportunities
         (company_id, proposed_project_type_code, rationale_en, derived_from_kind, derived_from_ref)
       VALUES ($1,$2,$3,'company_profile',$4)
       ON CONFLICT (company_id, proposed_project_type_code) WHERE status <> 'auto_rejected'
       DO NOTHING`,
      [companyId, p.code, p.rationale, ctx.msic_code]);
    written += rowCount;
  }
  return { proposed: proposals.length, written, dropped: dropped.length, droppedDetail: dropped };
}

/** A log write that fails must not take the scan down with it, and must not
 *  vanish either. Same shape as carbonImportService.logOrReport() (RULE 6). */
async function logOrReport(row) {
  try {
    await logInteraction(row);
  } catch (err) {
    console.error(`⚠️  ${JOB_TYPE}: interaction log write failed:`, err.message);
  }
}

/* ── Guard 4: only a human turns a proposal into a project ────────────────── */
async function acceptOpportunity(opportunityId, userId, companyId) {
  const { rows } = await query(
    `SELECT o.id, o.company_id, o.proposed_project_type_code, o.rationale_en, o.status
       FROM esg_green_opportunities o
      WHERE o.id = $1 AND o.company_id = $2`, [opportunityId, companyId]);
  const opp = rows[0];
  if (!opp) return null;
  if (opp.status !== 'pending') {
    throw new Error(`This proposal is already ${opp.status} and cannot be accepted again`);
  }

  const { rows: pt } = await query(
    `SELECT id, code, label_en, default_ccpt_category_id, default_asean_objective_id
       FROM esg_project_types WHERE code = $1`, [opp.proposed_project_type_code]);
  if (!pt[0]) throw new Error(`Project type ${opp.proposed_project_type_code} no longer exists`);

  const stamp = await resolveDefaultClassification(pt[0]);

  const { rows: created } = await query(
    `INSERT INTO esg_green_projects
       (company_id, project_type_id, title, description, estimated_cost_myr,
        status, ccpt_category_code, ccpt_scheme_version, asean_ff_code,
        asean_ps_code, asean_scheme_version, classification_basis, created_by)
     VALUES ($1,$2,$3,$4,NULL,'draft',$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, title, status, estimated_cost_myr, classification_basis`,
    [companyId, pt[0].id, pt[0].label_en, opp.rationale_en,
     stamp.ccpt_category_code, stamp.ccpt_scheme_version, stamp.asean_ff_code,
     stamp.asean_ps_code, stamp.asean_scheme_version, stamp.classification_basis, userId]);

  await query(
    `UPDATE esg_green_opportunities SET status='accepted', reviewed_by=$2, reviewed_at=now()
      WHERE id = $1`, [opportunityId, userId]);

  return created[0];
}

async function rejectOpportunity(opportunityId, userId, companyId) {
  const { rows } = await query(
    `UPDATE esg_green_opportunities SET status='rejected', reviewed_by=$3, reviewed_at=now()
      WHERE id = $1 AND company_id = $2 AND status = 'pending'
      RETURNING id, status`, [opportunityId, companyId, userId]);
  return rows[0] || null;
}

/** Resolve a project type's DEFAULT classification into stamped text codes.
 *
 *  Returns all-null with a null basis when the type carries no default, which
 *  is every type today — Run 47 seeded them NULL because no source publishes a
 *  per-type classification, and inventing one is the enrichment that file
 *  exists to prevent. A project with no classification says so; it does not
 *  claim 'project_type_default' for a classification that never happened. */
async function resolveDefaultClassification(projectType) {
  const empty = {
    ccpt_category_code: null, ccpt_scheme_version: null, asean_ff_code: null,
    asean_ps_code: null, asean_scheme_version: null, classification_basis: null,
  };
  const ids = [projectType.default_ccpt_category_id, projectType.default_asean_objective_id].filter(Boolean);
  if (!ids.length) return empty;

  const { rows } = await query(
    `SELECT c.id, c.code, c.kind, s.code AS scheme_code, s.version AS scheme_version
       FROM esg_taxonomy_categories c
       JOIN esg_taxonomy_schemes s ON s.id = c.scheme_id
      WHERE c.id = ANY($1::uuid[])`, [ids]);

  const out = { ...empty, classification_basis: 'project_type_default' };
  for (const r of rows) {
    if (r.scheme_code === 'CCPT') {
      out.ccpt_category_code = r.code;
      out.ccpt_scheme_version = r.scheme_version;
    } else if (r.scheme_code === 'ASEAN') {
      out.asean_ff_code = r.code;
      out.asean_scheme_version = r.scheme_version;
    }
  }
  return out;
}

/** Queue a scan for one company.
 *
 *  dedupe_key IS THE COMPANY ID, and that is load-bearing. The live index is
 *  uq_esg_jobs_dedupe (job_type, coalesce(payload->>'dedupe_key','')) WHERE
 *  status IN ('pending','running'). With no dedupe_key the coalesce collapses
 *  every company onto the empty string and the scan becomes a global singleton
 *  per job type — company B's request silently collides with company A's
 *  pending one. That is a cross-tenant denial of service, and it looks
 *  perfectly healthy in a single-tenant test. */
async function queueScan(companyId, userId) {
  return enqueue(JOB_TYPE, { dedupe_key: companyId, companyId, userId: userId || null });
}

/** The most recent scan job for a company, so a page can tell "did not run"
 *  from "ran and found nothing". Read, never inferred from an empty list. */
async function lastScan(companyId) {
  const { rows } = await query(
    `SELECT id, status, last_error, attempts, run_at, updated_at
       FROM esg_scheduled_jobs
      WHERE job_type = $1 AND payload->>'dedupe_key' = $2
      ORDER BY updated_at DESC LIMIT 1`, [JOB_TYPE, companyId]);
  return rows[0] || null;
}

// Registered by side-effect, exactly as extractionService.js does it. The
// service is require()d from routes/api.js so this actually runs — a handler
// registered in a file nobody imports is a job type that fails with "No
// handler registered" at claim time, which looks like a queue bug.
register(JOB_TYPE, async (payload) => {
  if (!payload || !payload.companyId) throw new Error('green_opportunity_scan: payload.companyId is required');
  await scanCompany(payload.companyId, { userId: payload.userId });
});

module.exports = {
  JOB_TYPE, scanCompany, queueScan, lastScan,
  acceptOpportunity, rejectOpportunity,
  parseProposals, buildPrompt, buildContext, employeeBand,
  resolveDefaultClassification,
};

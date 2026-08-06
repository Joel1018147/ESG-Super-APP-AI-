'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Verra reference mirror.
//
// WHAT THIS IS: a local, read-only copy of PUBLIC Verra registry records —
// project metadata, methodology names, issuance quantities — so the carbon
// module can look up a methodology or a Malaysian project without a round trip,
// and so SSEO can benchmark against real registry data.
//
// WHAT THIS IS NOT: an input to esg_scores. Verra certifies PROJECTS and issues
// VCUs; it publishes no company-level E/S/G indicators. scoringEngine.js
// refuses to score against a framework whose kind is 'project_crediting', and
// VERRA_VCS is registered as exactly that. docs/VERRA_BENCHMARK.md explains the
// distinction and what "benchmark against Verra" was resolved to mean.
//
// COPYRIGHT AND TERMS. Methodology documents are Verra's works. This mirror
// stores METADATA AND THE CANONICAL URL, never the document body. Verra's
// Registry Terms of Use also require that anything reached which is not part of
// a public report is not copied or reused — so ingest touches public endpoints
// only, and is OFF unless VERRA_API_BASE is set deliberately.
// ═══════════════════════════════════════════════════════════════════════════

const { query } = require('../db');
const { register } = require('./jobRunner');

const JOB_TYPE = 'verra_sync';

function ingestEnabled() {
  return String(process.env.VERRA_INGEST_ENABLED).toLowerCase() === 'true'
      && Boolean(process.env.VERRA_API_BASE);
}

/** Defensive field pick — the public feed's shape is not contractually stable. */
function pick(obj, ...names) {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return null;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function upsertProject(p) {
  const id = pick(p, 'resourceIdentifier', 'projectId', 'id');
  if (!id) return false;
  await query(
    `INSERT INTO esg_verra_projects
       (verra_project_id, name, proponent, country, region, sectoral_scope,
        methodology_code, status, project_type, estimated_annual_reductions,
        registration_date, crediting_start, crediting_end, raw, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (verra_project_id) DO UPDATE SET
       name = EXCLUDED.name, proponent = EXCLUDED.proponent, country = EXCLUDED.country,
       region = EXCLUDED.region, sectoral_scope = EXCLUDED.sectoral_scope,
       methodology_code = EXCLUDED.methodology_code, status = EXCLUDED.status,
       project_type = EXCLUDED.project_type,
       estimated_annual_reductions = EXCLUDED.estimated_annual_reductions,
       registration_date = EXCLUDED.registration_date,
       crediting_start = EXCLUDED.crediting_start, crediting_end = EXCLUDED.crediting_end,
       raw = EXCLUDED.raw, fetched_at = now()`,
    [String(id), pick(p, 'resourceName', 'name'), pick(p, 'proponent', 'developer'),
     pick(p, 'country', 'countryName'), pick(p, 'region'), pick(p, 'sectoralScope', 'protocolCategories'),
     pick(p, 'methodology', 'protocol'), pick(p, 'resourceStatus', 'status'), pick(p, 'projectType'),
     Number(pick(p, 'estimatedAnnualEmissionReductions')) || null,
     toDate(pick(p, 'projectRegistrationDate')), toDate(pick(p, 'creditingPeriodStart')),
     toDate(pick(p, 'creditingPeriodEnd')), p]);
  return true;
}

/**
 * Pull public project records.
 * Returns a report rather than throwing on an empty feed — "the endpoint
 * answered with nothing" and "the endpoint is unreachable" are different
 * findings and the admin page shows them differently.
 */
async function syncProjects({ country = null, maxPages = 20, pageSize = 100 } = {}) {
  if (!ingestEnabled()) {
    return { ok: false, reason: 'disabled', hint: 'Set VERRA_API_BASE and VERRA_INGEST_ENABLED=true' };
  }
  const base = process.env.VERRA_API_BASE.replace(/\/+$/, '');
  let upserted = 0, pages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${base}/resources`);
    url.searchParams.set('$skip', String((page - 1) * pageSize));
    url.searchParams.set('$top', String(pageSize));
    if (country) url.searchParams.set('country', country);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let batch;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) return { ok: false, reason: `http_${res.status}`, pages, upserted };
      const json = await res.json();
      batch = Array.isArray(json) ? json : (json.value || json.data || []);
    } catch (err) {
      return { ok: false, reason: 'unreachable', error: err.message, pages, upserted };
    } finally {
      clearTimeout(timer);
    }

    pages += 1;
    if (!batch.length) break;
    for (const p of batch) { if (await upsertProject(p)) upserted += 1; }
    if (batch.length < pageSize) break;
    // Courtesy pause. A public unauthenticated endpoint is a shared resource.
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: true, pages, upserted };
}

register(JOB_TYPE, async (payload) => {
  const result = await syncProjects(payload || {});
  if (!result.ok && result.reason !== 'disabled') {
    throw new Error(`Verra sync failed: ${result.reason}${result.error ? ` (${result.error})` : ''}`);
  }
});

/** What the mirror currently holds. Distinguishes the three empty states. */
async function mirrorStatus() {
  const { rows } = await query(
    `SELECT (SELECT count(*)::int FROM esg_verra_projects)       AS projects,
            (SELECT count(*)::int FROM esg_verra_methodologies)  AS methodologies,
            (SELECT max(fetched_at) FROM esg_verra_projects)     AS last_fetch`);
  const r = rows[0];
  const state = !ingestEnabled() ? 'uninstrumented'
              : r.projects === 0  ? 'instrumented_but_empty'
              : 'populated';
  return { ...r, state, ingest_enabled: ingestEnabled() };
}

module.exports = { JOB_TYPE, ingestEnabled, syncProjects, upsertProject, mirrorStatus };

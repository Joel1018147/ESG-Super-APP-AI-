'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN PROJECT BASELINES — arithmetic over carbon data, never a model
   ───────────────────────────────────────────────────────────────────────────
   This is the mechanic that turns an electricity bill into a financing case: a
   lender asks "what do you use today", and the answer is computed from
   esg_carbon_entries rows the company already entered, by an EXECUTOR. No
   language model is involved at any point, and there is no path by which one
   could be — the same separation scoringEngine.js has.

   PROVISIONAL IS INFECTIOUS, AND DELIBERATELY SO. If ANY contributing entry
   was computed from an unverified factor, the whole baseline is provisional.
   The placeholder DEFRA fuel factors are unverified (seed.sql says so in those
   words), so a baseline mixing diesel with grid electricity is provisional even
   though the electricity half rests on a verified Suruhanjaya Tenaga figure.

   Averaging a provisional and a verified factor into one number that reads as
   verified is the failure this file is built to make impossible. A lender
   acting on it would be acting on a figure nobody has stood behind.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

// Which carbon category becomes which baseline metric. A category with no entry
// here contributes to kg_co2e only — it is NOT guessed into the nearest metric,
// because a litre of something unrecognised is not a litre of fuel.
const METRIC_FOR_UNIT = {
  kWh: { metric: 'electricity_kwh', unit: 'kWh' },
  litre: { metric: 'fuel_litres', unit: 'litre' },
  m3: { metric: 'water_m3', unit: 'm3' },
  kg: { metric: 'waste_kg', unit: 'kg' },
};

/** Recompute every baseline for a project over a period.
 *
 *  Recompute REPLACES: the previous rows for this project are deleted and
 *  rewritten in one transaction-shaped sequence, so a project never carries two
 *  baselines for overlapping periods that a reader would have to choose
 *  between. "Written once" means one live answer, not append-only history. */
/** Derive a measurement for a period from the company's carbon entries.
 *
 *  A BASELINE and an ACTUAL are the same computation over different periods —
 *  same entries, same units, same provisional rule — so they share this
 *  function rather than a copy that could drift. `kind` decides only which rows
 *  are replaced and what the new rows are called.
 *
 *  NOTHING IS EVER COPIED FROM THE PROJECT'S FORECAST. The forecast lives on
 *  esg_green_projects and is not read here at all. */
async function computeMeasurement(projectId, companyId, periodStart, periodEnd, kind = 'baseline') {
  const { rows: proj } = await query(
    `SELECT id FROM esg_green_projects WHERE id = $1 AND company_id = $2`, [projectId, companyId]);
  if (!proj[0]) return null;

  const { rows: entries } = await query(
    `SELECT activity_amount, activity_unit, kg_co2e, is_provisional, category
       FROM esg_carbon_entries
      WHERE company_id = $1 AND period_start >= $2 AND period_end <= $3`,
    [companyId, periodStart, periodEnd]);

  // SCOPED BY KIND (P7). This used to delete every row for the project, and
  // once actuals began living in the same table a baseline recomputation would
  // have silently destroyed the company's measured impact.
  //
  // A baseline replaces the whole baseline; an ACTUAL replaces only the reading
  // for the SAME PERIOD, because a company measures many periods and last
  // year's reading is not superseded by this year's.
  if (kind === 'baseline') {
    await query(
      `DELETE FROM esg_green_project_baselines WHERE project_id = $1 AND kind = 'baseline'`,
      [projectId]);
  } else {
    await query(
      `DELETE FROM esg_green_project_baselines
        WHERE project_id = $1 AND kind = $2 AND period_start = $3 AND period_end = $4`,
      [projectId, kind, periodStart, periodEnd]);
  }

  if (!entries.length) {
    return { metrics: [], entryCount: 0, provisional: false, empty: true };
  }

  // Group by unit, and total CO2e across everything.
  const byMetric = new Map();
  let co2eTotal = 0;
  let co2eProvisional = false;
  for (const e of entries) {
    co2eTotal += Number(e.kg_co2e) || 0;
    if (e.is_provisional) co2eProvisional = true;
    const m = METRIC_FOR_UNIT[e.activity_unit];
    if (!m) continue;
    const cur = byMetric.get(m.metric) || { metric: m.metric, unit: m.unit, value: 0, count: 0, provisional: false };
    cur.value += Number(e.activity_amount) || 0;
    cur.count += 1;
    // ANY provisional contributor makes the whole metric provisional.
    if (e.is_provisional) cur.provisional = true;
    byMetric.set(m.metric, cur);
  }

  const written = [];
  for (const m of byMetric.values()) {
    const { rows } = await query(
      `INSERT INTO esg_green_project_baselines
         (project_id, period_start, period_end, metric, value, unit,
          derived_from, source_entry_count, is_provisional, kind)
       VALUES ($1,$2,$3,$4,$5,$6,'carbon_entries',$7,$8,$9)
       RETURNING id, metric, value, unit, source_entry_count, is_provisional`,
      [projectId, periodStart, periodEnd, m.metric, m.value.toFixed(4), m.unit, m.count, m.provisional, kind]);
    written.push(rows[0]);
  }

  const { rows: co2 } = await query(
    `INSERT INTO esg_green_project_baselines
       (project_id, period_start, period_end, metric, value, unit,
        derived_from, source_entry_count, is_provisional, kind)
     VALUES ($1,$2,$3,'kg_co2e',$4,'kgCO2e','carbon_entries',$5,$6,$7)
     RETURNING id, metric, value, unit, source_entry_count, is_provisional`,
    [projectId, periodStart, periodEnd, co2eTotal.toFixed(4), entries.length, co2eProvisional, kind]);
  written.push(co2[0]);

  return {
    metrics: written,
    entryCount: entries.length,
    provisional: written.some((w) => w.is_provisional),
    empty: false,
  };
}

/** Which factors made a baseline provisional, so the page can name them rather
 *  than just flagging the row. "Provisional" with no reason is a badge nobody
 *  can act on. */
async function provisionalReasons(companyId, periodStart, periodEnd) {
  const { rows } = await query(
    `SELECT DISTINCT factor_version_used, factor_source_used, factor_verification_used
       FROM esg_carbon_entries
      WHERE company_id = $1 AND period_start >= $2 AND period_end <= $3
        AND is_provisional
      ORDER BY factor_source_used`, [companyId, periodStart, periodEnd]);
  return rows;
}

async function listBaselines(projectId) {
  const { rows } = await query(
    `SELECT id, period_start, period_end, metric, value, unit, derived_from,
            source_entry_count, is_provisional, computed_at
       FROM esg_green_project_baselines
      WHERE project_id = $1 AND kind = 'baseline' ORDER BY metric`, [projectId]);
  return rows;
}

/** Kept for callers that mean a baseline specifically. */
const computeBaseline = (projectId, companyId, s, e) => computeMeasurement(projectId, companyId, s, e, 'baseline');

module.exports = { computeBaseline, computeMeasurement, provisionalReasons, listBaselines, METRIC_FOR_UNIT };

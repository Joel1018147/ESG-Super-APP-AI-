'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Carbon bulk import — an uploaded spreadsheet of utility bills / fuel
// purchases becomes esg_carbon_entries rows, without a model ever stating a
// number. See the section comment above esg_carbon_import_batches in
// schema.sql for the four-guard summary; this file is the implementation of
// all four.
//
// Guard 1 lives here: proposeMapping() sends ONLY column headers to Groq.
// Row data (dates, amounts) is never included in a prompt.
// Guard 4 lives at the boundary between approveMapping() and commitBatch() —
// commitBatch() is deterministic code, not a model call, and nothing writes
// to esg_carbon_entries before a human calls it.
// ═══════════════════════════════════════════════════════════════════════════

const XLSX = require('xlsx');
const { query, withTransaction } = require('../db');
const { generateWithGroq, groqModel, logInteraction } = require('./groqService');
const { electricityToCo2e, fuelToCo2e } = require('./carbonEngine');

const TARGET_FIELDS = Object.freeze([
  'period_start', // date
  'period_end',   // date
  'kind',         // 'electricity' | 'FUEL_DIESEL' | 'FUEL_PETROL'
  'amount',       // numeric — kWh for electricity, litres for fuel
]);

const MAX_ROWS = 2000;

// ── Parse the uploaded file ─────────────────────────────────────────────────
function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no sheets');
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  if (!grid.length) throw new Error('Sheet is empty');
  const headers = (grid[0] || []).map((h) => String(h == null ? '' : h).trim()).filter(Boolean);
  if (!headers.length) throw new Error('No column headers found in row 1');
  const dataRows = grid.slice(1).filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`Sheet has ${dataRows.length} data rows; the limit is ${MAX_ROWS} per upload`);
  }
  const rows = dataRows.map((r) => {
    const cells = {};
    headers.forEach((h, i) => { cells[h] = r[i] == null ? null : String(r[i]).trim(); });
    return cells;
  });
  return { headers, rows };
}

// ── Guard 1: propose a mapping from headers alone ───────────────────────────
const SYSTEM = [
  'You map spreadsheet column headers to carbon-accounting fields.',
  'Fields: period_start (a date column, start of the billing/usage period),',
  'period_end (a date column, end of the period),',
  'kind (the type of activity: electricity or fuel),',
  'amount (the numeric quantity: kWh for electricity, litres for fuel).',
  'For each header you can confidently map, output exactly one line: header|field',
  'Skip a header you are not confident about. Never invent a header. Never invent a field name.',
  'Never output a data value, a number, or a date — only header names and field names.',
  'Output nothing else — no preamble, no explanation, no markdown.',
].join(' ');

function buildPrompt(headers) {
  return `COLUMN HEADERS:\n${headers.map((h) => `"${h}"`).join('\n')}\n\nFIELDS:\n${TARGET_FIELDS.join(', ')}\n\nLines only.`;
}

async function proposeMapping(headers, { companyId, userId } = {}) {
  const started = Date.now();
  let reply = '';
  try {
    reply = await generateWithGroq(buildPrompt(headers), { system: SYSTEM, temperature: 0, maxTokens: 300 });
    await logInteraction({ companyId, userId, feature: 'carbon_import_mapping', model: groqModel(),
                           promptChars: headers.join(',').length, responseChars: reply.length,
                           latencyMs: Date.now() - started, ok: true }).catch(() => {});
  } catch (err) {
    await logInteraction({ companyId, userId, feature: 'carbon_import_mapping', model: groqModel(),
                           latencyMs: Date.now() - started, ok: false, error: err.message }).catch(() => {});
    return {}; // AI is best-effort; an empty mapping just means the human maps every column by hand
  }
  return parseMapping(reply, headers);
}

// Guard 3: strict parse. A header the sheet doesn't have, a field that isn't
// in TARGET_FIELDS, or a second claim on a field already mapped is dropped,
// never coerced into something plausible.
function parseMapping(reply, headers) {
  const headerSet = new Set(headers);
  const fieldSet = new Set(TARGET_FIELDS);
  const mapping = {};
  const usedFields = new Set();
  for (const raw of String(reply || '').split('\n')) {
    const m = raw.match(/^\s*"?([^"|]+?)"?\s*\|\s*([a-z_]+)\s*$/i);
    if (!m) continue;
    const header = m[1].trim();
    const field = m[2].trim().toLowerCase();
    if (!headerSet.has(header)) continue;
    if (!fieldSet.has(field)) continue;
    if (usedFields.has(field)) continue; // first claim on a field wins
    mapping[header] = field;
    usedFields.add(field);
  }
  return mapping;
}

// ── Batch lifecycle ──────────────────────────────────────────────────────────
async function createBatch({ companyId, filename, uploadedBy, headers, rows }) {
  const proposed = await proposeMapping(headers, { companyId, userId: uploadedBy });
  return withTransaction(async (client) => {
    const { rows: b } = await client.query(
      `INSERT INTO esg_carbon_import_batches
         (company_id, filename, uploaded_by, status, column_headers, proposed_mapping, row_count)
       VALUES ($1,$2,$3,'mapping_pending',$4,$5,$6) RETURNING *`,
      [companyId, filename, uploadedBy, JSON.stringify(headers), JSON.stringify(proposed), rows.length]);
    const batch = b[0];
    for (let i = 0; i < rows.length; i += 1) {
      await client.query(
        `INSERT INTO esg_carbon_import_rows (batch_id, row_number, raw_cells) VALUES ($1,$2,$3)`,
        [batch.id, i + 1, JSON.stringify(rows[i])]);
    }
    return batch;
  });
}

async function getBatch(batchId, companyId) {
  const { rows } = await query(
    `SELECT id, company_id, filename, uploaded_by, status, column_headers, proposed_mapping,
            approved_mapping, row_count, committed_count, error_count, error_message, created_at, updated_at
       FROM esg_carbon_import_batches WHERE id=$1 AND company_id=$2`, [batchId, companyId]);
  return rows[0] || null;
}

async function getBatchRows(batchId, limit = 50) {
  const { rows } = await query(
    `SELECT id, batch_id, row_number, raw_cells, status, carbon_entry_id, error_message, created_at, updated_at
       FROM esg_carbon_import_rows WHERE batch_id=$1 ORDER BY row_number LIMIT $2`, [batchId, limit]);
  return rows;
}

// Human approves (and may edit) the mapping before anything is written.
async function approveMapping(batchId, companyId, approvedMapping) {
  const batch = await getBatch(batchId, companyId);
  if (!batch) throw new Error('Batch not found');
  const headerSet = new Set(batch.column_headers);
  const fieldSet = new Set(TARGET_FIELDS);
  const clean = {};
  for (const [header, field] of Object.entries(approvedMapping || {})) {
    if (!headerSet.has(header) || !fieldSet.has(field)) continue;
    clean[header] = field;
  }
  const { rows } = await query(
    `UPDATE esg_carbon_import_batches SET approved_mapping=$2, updated_at=now()
       WHERE id=$1 RETURNING *`, [batchId, JSON.stringify(clean)]);
  return rows[0];
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/**
 * Guard 4's other half. Fully deterministic: reads whatever the approved
 * mapping points at, out of the raw cell text, and runs it through the SAME
 * carbonEngine functions and the SAME esg_carbon_entries insert shape as the
 * manual /carbon form (routes/pages.js POST /carbon). No parallel calculation
 * path, no model call anywhere in this function.
 */
async function commitBatch(batchId, companyId, userId) {
  const batch = await getBatch(batchId, companyId);
  if (!batch) throw new Error('Batch not found');
  if (!batch.approved_mapping || !Object.keys(batch.approved_mapping).length) {
    throw new Error('No approved mapping — approve a mapping before committing');
  }
  const mapping = batch.approved_mapping; // header -> field
  const fieldHeader = {}; // field -> header
  for (const [h, f] of Object.entries(mapping)) fieldHeader[f] = h;

  const { rows: co } = await query(`SELECT grid_region FROM esg_companies WHERE id=$1`, [companyId]);
  const gridRegion = co[0] && co[0].grid_region;

  await query(`UPDATE esg_carbon_import_batches SET status='committing', updated_at=now() WHERE id=$1`, [batchId]);

  const { rows: pendingRows } = await query(
    `SELECT id, batch_id, row_number, raw_cells, status, carbon_entry_id, error_message, created_at, updated_at
       FROM esg_carbon_import_rows WHERE batch_id=$1 AND status='pending' ORDER BY row_number`,
    [batchId]);

  let committed = 0, errored = 0;
  for (const row of pendingRows) {
    try {
      const cells = row.raw_cells;
      const periodStart = fieldHeader.period_start ? cells[fieldHeader.period_start] : null;
      const periodEnd = fieldHeader.period_end ? cells[fieldHeader.period_end] : null;
      const kindRaw = fieldHeader.kind ? cells[fieldHeader.kind] : null;
      const amount = fieldHeader.amount ? num(cells[fieldHeader.amount]) : null;

      if (!periodStart || !periodEnd) throw new Error('period_start and period_end are required');
      if (new Date(periodStart) > new Date(periodEnd)) throw new Error('period_start is after period_end');
      if (amount === null || amount < 0) throw new Error('amount must be a number >= 0');
      const kind = String(kindRaw || '').trim();
      if (!kind) throw new Error('kind is required (electricity, FUEL_DIESEL, FUEL_PETROL, ...)');

      const isElectricity = kind.toLowerCase() === 'electricity';
      const calc = isElectricity
        ? await electricityToCo2e(amount, gridRegion)
        : await fuelToCo2e(amount, kind);

      const { rows: inserted } = await query(
        `INSERT INTO esg_carbon_entries
           (company_id, period_start, period_end, scope, category, activity_amount, activity_unit,
            factor_id, factor_value_used, factor_version_used, factor_source_used,
            factor_verification_used, is_provisional, kg_co2e, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [companyId, periodStart, periodEnd, isElectricity ? 2 : 1,
         isElectricity ? 'grid_electricity' : 'mobile_combustion',
         calc.activity_amount, calc.activity_unit, calc.factor_id, calc.factor_value_used,
         calc.factor_version_used, calc.factor_source_used, calc.factor_verification_used,
         calc.is_provisional, calc.kg_co2e, userId]);

      await query(
        `UPDATE esg_carbon_import_rows SET status='committed', carbon_entry_id=$2, error_message=NULL, updated_at=now()
           WHERE id=$1`, [row.id, inserted[0].id]);
      committed += 1;
    } catch (err) {
      await query(
        `UPDATE esg_carbon_import_rows SET status='error', error_message=$2, updated_at=now() WHERE id=$1`,
        [row.id, err.message.slice(0, 1000)]);
      errored += 1;
    }
  }

  const { rows: done } = await query(
    `UPDATE esg_carbon_import_batches
        SET status='committed', committed_count=committed_count+$2, error_count=error_count+$3, updated_at=now()
      WHERE id=$1 RETURNING *`, [batchId, committed, errored]);
  return { batch: done[0], committed, errored };
}

module.exports = {
  TARGET_FIELDS, MAX_ROWS,
  parseWorkbook, proposeMapping, parseMapping, buildPrompt,
  createBatch, getBatch, getBatchRows, approveMapping, commitBatch,
};

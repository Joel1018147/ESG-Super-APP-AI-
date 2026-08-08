'use strict';
// Carbon bulk import — upload an Excel/CSV sheet of utility bills or fuel
// purchases, review the AI's column mapping, approve it, commit. See
// carbonImportService.js for the guard implementation.

const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { layout, esc, emptyState } = require('../utils/layout');
const svc = require('../services/carbonImportService');

const router = express.Router();
const cid = (req) => req.user && req.user.company_id;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error(`${file.mimetype} is not an accepted spreadsheet type`));
    cb(null, true);
  },
});

const FIELD_LABEL = {
  period_start: 'Period start (date)',
  period_end: 'Period end (date)',
  kind: 'Type (electricity / FUEL_DIESEL / FUEL_PETROL)',
  amount: 'Amount (kWh for electricity, litres for fuel)',
};

// ── Upload form ──────────────────────────────────────────────────────────────
router.get('/carbon/import', (req, res) => {
  res.send(layout('Bulk carbon import', `
    <div class="card">
      <h3>Bulk import carbon activity data</h3>
      <p class="muted">Upload a spreadsheet of utility bills or fuel purchases. The AI proposes which
      column is which — it never sees or states an activity figure — and you approve the mapping
      before anything is calculated or saved. Every row still goes through the same emission-factor
      calculation as adding one entry by hand.</p>
      <form method="post" action="/carbon/import/upload" enctype="multipart/form-data">
        <div class="form-group">
          <label for="file">Spreadsheet (.xlsx, .xls, .csv)</label>
          <input class="input" id="file" name="file" type="file" accept=".xlsx,.xls,.csv" required>
        </div>
        <button class="btn btn-primary" type="submit">Upload &amp; propose mapping</button>
      </form>
    </div>`, req.user, '/carbon'));
});

router.post('/carbon/import/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    const { headers, rows } = svc.parseWorkbook(req.file.buffer);
    const batch = await svc.createBatch({
      companyId: cid(req), filename: req.file.originalname, uploadedBy: req.user.id, headers, rows,
    });
    res.redirect(`/carbon/import/${batch.id}`);
  } catch (err) { next(err); }
});

// ── Mapping review ───────────────────────────────────────────────────────────
router.get('/carbon/import/:batchId', async (req, res, next) => {
  try {
    const batch = await svc.getBatch(req.params.batchId, cid(req));
    if (!batch) return res.status(404).send('Batch not found');
    const rows = await svc.getBatchRows(batch.id, 10);

    if (batch.status === 'committed') {
      const rowTable = rows.length ? `<table class="table"><thead><tr>
        <th>Row</th><th>Status</th><th>Detail</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.row_number)}</td>
          <td><span class="badge ${r.status === 'committed' ? 'badge-green' : 'badge-red'}">${esc(r.status)}</span></td>
          <td>${r.error_message ? esc(r.error_message) : (r.carbon_entry_id ? 'Saved to Carbon' : '')}</td></tr>`).join('')}
        </tbody></table>` : '';
      return res.send(layout('Import committed', `
        <div class="card">
          <h3>Import complete</h3>
          <p><strong>${esc(batch.committed_count)}</strong> row(s) saved to Carbon,
             <strong>${esc(batch.error_count)}</strong> row(s) failed.</p>
          <a class="btn btn-outline" href="/carbon">Back to Carbon →</a>
        </div>
        <div class="table-wrap" style="margin-top:16px">${rowTable}</div>`, req.user, '/carbon'));
    }

    const headers = batch.column_headers;
    const proposed = batch.proposed_mapping || {};
    const mappingRows = headers.map((h) => {
      const suggested = proposed[h] || '';
      const options = ['', ...Object.keys(FIELD_LABEL)].map((f) =>
        `<option value="${esc(f)}"${f === suggested ? ' selected' : ''}>${f ? esc(FIELD_LABEL[f]) : '— ignore this column —'}</option>`).join('');
      return `<tr><td><code>${esc(h)}</code></td>
        <td><select class="input" name="map___${encodeURIComponent(h)}">${options}</select></td></tr>`;
    }).join('');

    const previewRows = rows.slice(0, 5).map((r) =>
      `<tr>${headers.map((h) => `<td>${esc(r.raw_cells[h] || '')}</td>`).join('')}</tr>`).join('');

    res.send(layout('Review import mapping', `
      <div class="card">
        <h3>${esc(batch.filename)}</h3>
        <p class="muted">${esc(batch.row_count)} row(s) detected. Review the AI's suggested mapping below —
        change or clear any column — then approve to calculate and save.</p>
        <form method="post" action="/carbon/import/${esc(batch.id)}/approve">
          <table class="table"><thead><tr><th>Column in your file</th><th>Maps to</th></tr></thead>
            <tbody>${mappingRows}</tbody></table>
          <button class="btn btn-primary" type="submit" style="margin-top:16px">Approve &amp; commit</button>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        <h4>Preview (first 5 rows)</h4>
        <div class="table-wrap"><table class="table"><thead><tr>
          ${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${previewRows}</tbody></table></div>
      </div>`, req.user, '/carbon'));
  } catch (err) { next(err); }
});

router.post('/carbon/import/:batchId/approve', async (req, res, next) => {
  try {
    const mapping = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!key.startsWith('map___') || !value) continue;
      mapping[decodeURIComponent(key.slice('map___'.length))] = value;
    }
    await svc.approveMapping(req.params.batchId, cid(req), mapping);
    await svc.commitBatch(req.params.batchId, cid(req), req.user.id);
    res.redirect(`/carbon/import/${req.params.batchId}`);
  } catch (err) { next(err); }
});

module.exports = router;

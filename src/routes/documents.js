'use strict';
// Evidence upload and the Layer 2 review queue.
//
// Files live in Postgres, not on disk: Railway containers have an ephemeral
// filesystem and a restart would silently take the evidence with it.

const express = require('express');
const crypto  = require('crypto');
const multer  = require('multer');
const { query } = require('../db');
const { layout, esc, emptyState } = require('../utils/layout');
const { enqueue, runOnce } = require('../services/jobRunner');
const ex = require('../services/extractionService');

const router = express.Router();
const cid = (req) => req.user && req.user.company_id;

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf', 'image/png', 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Memory storage, because the destination is a bytea column. The size cap is
// enforced by multer BEFORE the buffer is held, so an oversized upload cannot
// be used to exhaust the container's memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error(`${file.mimetype} is not an accepted evidence type`));
    }
    cb(null, true);
  },
});

const STATUS_LABEL = {
  pending:       ['Not analysed', 'badge'],
  extracting:    ['Reading…', 'badge badge-warning'],
  extracted:     ['Text extracted', 'badge badge-success'],
  no_text_layer: ['No text layer (scan)', 'badge badge-warning'],
  failed:        ['Could not read', 'badge badge-danger'],
};

// ── List and upload ─────────────────────────────────────────────────────────
router.get('/documents', async (req, res, next) => {
  try {
    // content is deliberately not selected — it is the file itself.
    const { rows } = await query(
      `SELECT d.id, d.filename, d.doc_type, d.mime_type, d.byte_size, d.created_at,
              d.text_status, d.page_count,
              (SELECT count(*)::int FROM esg_document_extractions e
                WHERE e.document_id = d.id AND e.status='pending') AS pending
         FROM esg_documents d WHERE d.company_id = $1
        ORDER BY d.created_at DESC`, [cid(req)]);

    const table = rows.length ? `<table class="table"><thead><tr>
        <th>File</th><th>Type</th><th>Size</th><th>Status</th><th>To review</th><th></th></tr></thead><tbody>
        ${rows.map((d) => {
          const [label, cls] = STATUS_LABEL[d.text_status] || ['Unknown', 'badge'];
          return `<tr><td>${esc(d.filename)}</td><td>${esc(d.doc_type)}</td>
            <td>${Math.round(d.byte_size / 1024)} KB</td>
            <td><span class="${cls}">${esc(label)}</span>${d.page_count ? ` <small class="muted">${esc(d.page_count)}p</small>` : ''}</td>
            <td>${d.pending > 0 ? `<span class="badge badge-primary">${esc(d.pending)}</span>` : '—'}</td>
            <td><a class="btn btn-ghost" href="/documents/${esc(d.id)}">Open</a></td></tr>`;
        }).join('')}</tbody></table>`
      : emptyState('instrumented_but_empty', {
          title: 'No evidence uploaded yet',
          body: 'Upload a utility bill, a policy, an ISO certificate or a full ESG report.' });

    res.send(layout('Evidence', `
      <div class="card"><h3>Upload evidence</h3>
        <form method="post" action="/documents" enctype="multipart/form-data"
              style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
          <div class="form-group" style="margin:0"><label for="file">File (max 15 MB)</label>
            <input class="input" id="file" name="file" type="file" required
                   accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"></div>
          <div class="form-group" style="margin:0"><label for="doc_type">What is it?</label>
            <select class="input" id="doc_type" name="doc_type">
              <option value="esg_report">ESG / sustainability report</option>
              <option value="utility_bill">Utility bill</option>
              <option value="policy">Policy document</option>
              <option value="iso_cert">ISO certificate</option>
              <option value="training_record">Training record</option>
              <option value="other">Other</option>
            </select></div>
          <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" type="submit">Upload</button></div>
        </form>
        ${req.query.error ? `<div class="badge badge-danger" style="display:block;margin-top:12px">${esc(req.query.error)}</div>` : ''}
      </div>
      <div class="table-wrap" style="margin-top:16px">${table}</div>`, req.user, '/documents'));
  } catch (err) { next(err); }
});

router.post('/documents', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    // multer's own errors are user errors, not 500s — an oversized file should
    // say so on the page rather than land in the error handler.
    if (err) return res.redirect(`/documents?error=${encodeURIComponent(err.message)}`);
    if (!req.file) return res.redirect('/documents?error=No+file+received');
    try {
      const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const { rows: dup } = await query(
        `SELECT id FROM esg_documents WHERE company_id=$1 AND sha256=$2`, [cid(req), sha]);
      if (dup[0]) return res.redirect(`/documents/${dup[0].id}`);

      const { rows: a } = await query(
        `SELECT id FROM esg_assessments WHERE company_id=$1 AND status <> 'archived'
          ORDER BY reporting_year DESC LIMIT 1`, [cid(req)]);

      const { rows } = await query(
        `INSERT INTO esg_documents
           (company_id, assessment_id, doc_type, filename, mime_type, byte_size, content, sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [cid(req), a[0] ? a[0].id : null, String(req.body.doc_type || 'other'),
         req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, sha, req.user.id]);
      res.redirect(`/documents/${rows[0].id}`);
    } catch (e) { next(e); }
  });
});

// ── Detail and review queue ─────────────────────────────────────────────────
router.get('/documents/:id', async (req, res, next) => {
  try {
    const { rows: docs } = await query(
      `SELECT id, filename, doc_type, mime_type, byte_size, text_status, page_count,
              extraction_error, assessment_id, created_at
         FROM esg_documents WHERE id=$1 AND company_id=$2`, [req.params.id, cid(req)]);
    const d = docs[0];
    if (!d) return res.status(404).send(layout('Not found',
      emptyState('zero', { title: 'Document not found' }), req.user, '/documents'));

    const { rows: props } = await query(
      `SELECT e.id, e.proposed_option_code, e.evidence_quote, e.page_no, e.status,
              e.reject_reason, i.code, i.pillar, i.question_en
         FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1 ORDER BY e.status, i.pillar, i.code`, [req.params.id]);

    const pending  = props.filter((p) => p.status === 'pending');
    const decided  = props.filter((p) => p.status === 'accepted' || p.status === 'rejected');
    const rejected = props.filter((p) => p.status === 'auto_rejected');
    const [label, cls] = STATUS_LABEL[d.text_status] || ['Unknown', 'badge'];

    const card = (p, actions) => `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
          <span class="badge">${esc(p.code)}</span>
          <strong>${esc(p.question_en)}</strong>
          <span class="badge badge-primary">${esc(p.proposed_option_code)}</span>
          ${p.page_no ? `<small class="muted">page ${esc(p.page_no)}</small>` : ''}
        </div>
        <blockquote style="margin:10px 0;padding-left:12px;border-left:3px solid var(--border);color:var(--text-2)">
          ${esc(p.evidence_quote)}</blockquote>
        ${p.reject_reason ? `<small class="muted">${esc(p.reject_reason)}</small>` : ''}
        ${actions || ''}
      </div>`;

    const analysable = d.mime_type === 'application/pdf' && d.assessment_id;

    res.send(layout(d.filename, `
      <div class="card">
        <p><span class="${cls}">${esc(label)}</span>
           ${d.page_count ? `<small class="muted"> · ${esc(d.page_count)} pages</small>` : ''}
           <small class="muted"> · ${Math.round(d.byte_size / 1024)} KB · ${esc(d.doc_type)}</small></p>
        ${d.extraction_error ? `<p class="muted">${esc(d.extraction_error)}</p>` : ''}
        ${d.text_status === 'no_text_layer' ? `<div class="ai-insight">
            <strong>This PDF has no text layer.</strong> It is almost certainly a scan or an export
            of images. Nothing could be read from it — which is not the same as it disclosing
            nothing. Re-export it from the original document, or run OCR, and upload again.
          </div>` : ''}
        ${!d.assessment_id ? `<p class="muted">Not linked to an assessment, so it cannot be analysed.
            <a href="/assessment">Create one first</a>.</p>` : ''}
        <div style="display:flex;gap:10px;margin-top:12px">
          <a class="btn btn-ghost" href="/documents/${esc(d.id)}/download">Download</a>
          ${analysable ? `<form method="post" action="/documents/${esc(d.id)}/analyse">
            <button class="btn btn-primary" type="submit">🤖 Analyse this report</button></form>` : ''}
        </div>
      </div>

      ${pending.length ? `<h3 style="margin:24px 0 12px">Proposed disclosures — ${pending.length} to review</h3>
        <div class="ai-insight" style="margin-bottom:12px">
          Nothing below has changed your score. Each is a claim the AI made about this document,
          with the sentence it came from. Accepting one records it as a <em>documented</em> answer;
          the score is then recalculated by the scoring engine, not by the AI.
        </div>
        ${pending.map((p) => card(p, `
          <div style="display:flex;gap:8px;margin-top:10px">
            <form method="post" action="/extractions/${esc(p.id)}/accept">
              <button class="btn btn-primary" type="submit">Accept</button></form>
            <form method="post" action="/extractions/${esc(p.id)}/reject">
              <button class="btn btn-ghost" type="submit">Reject</button></form>
          </div>`)).join('')}` : ''}

      ${decided.length ? `<h3 style="margin:24px 0 12px">Reviewed</h3>
        ${decided.map((p) => card(p, `<small class="muted">${esc(p.status)}</small>`)).join('')}` : ''}

      ${rejected.length ? `<h3 style="margin:24px 0 12px">Discarded automatically — ${rejected.length}</h3>
        <div class="ai-insight" style="margin-bottom:12px">
          These were claims the AI could not back with a sentence actually present in the document.
          They were discarded before reaching the review queue. They are shown because a rising
          count here is the signal that extraction is going badly on this document.
        </div>
        ${rejected.map((p) => card(p, '')).join('')}` : ''}

      ${d.text_status === 'extracted' && !props.length
        ? emptyState('instrumented_but_empty', {
            title: 'Analysed, nothing proposed',
            body: 'The text was read and no disclosure could be evidenced from it.' })
        : ''}`, req.user, '/documents'));
  } catch (err) { next(err); }
});

router.get('/documents/:id/download', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT filename, mime_type, content FROM esg_documents WHERE id=$1 AND company_id=$2`,
      [req.params.id, cid(req)]);
    if (!rows[0]) return res.status(404).send('Not found');
    res.setHeader('Content-Type', rows[0].mime_type || 'application/octet-stream');
    // Quoted and sanitised: a filename with a newline or a quote in it is a
    // header-injection vector.
    const safe = String(rows[0].filename).replace(/[^\w.\- ]+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.send(rows[0].content);
  } catch (err) { next(err); }
});

router.post('/documents/:id/analyse', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, assessment_id FROM esg_documents WHERE id=$1 AND company_id=$2`,
      [req.params.id, cid(req)]);
    if (!rows[0] || !rows[0].assessment_id) return res.redirect('/documents');
    // dedupe_key, not a per-document job_type: the handler is registered
    // against JOB_TYPE, so encoding the id into the type would queue a job
    // nothing could run.
    await enqueue(ex.JOB_TYPE, {
      dedupe_key: rows[0].id,
      documentId: rows[0].id, assessmentId: rows[0].assessment_id,
      companyId: cid(req), userId: req.user.id,
    });
    // Nudge the worker rather than waiting up to a poll interval. setImmediate,
    // not setTimeout: the job is already durable in Postgres, so this only
    // affects how soon it starts, never whether it runs.
    setImmediate(() => runOnce().catch((e) => console.error('extraction:', e.message)));
    res.redirect(`/documents/${rows[0].id}?queued=1`);
  } catch (err) { next(err); }
});

router.post('/extractions/:id/accept', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.document_id FROM esg_document_extractions e
         JOIN esg_documents d ON d.id = e.document_id
        WHERE e.id=$1 AND d.company_id=$2`, [req.params.id, cid(req)]);
    if (!rows[0]) return res.status(404).send('Not found');
    await ex.acceptProposal(rows[0].id, req.user.id);
    res.redirect(`/documents/${rows[0].document_id}`);
  } catch (err) { next(err); }
});

router.post('/extractions/:id/reject', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.document_id FROM esg_document_extractions e
         JOIN esg_documents d ON d.id = e.document_id
        WHERE e.id=$1 AND d.company_id=$2`, [req.params.id, cid(req)]);
    if (!rows[0]) return res.status(404).send('Not found');
    await ex.rejectProposal(rows[0].id, req.user.id, req.body && req.body.reason);
    res.redirect(`/documents/${rows[0].document_id}`);
  } catch (err) { next(err); }
});

module.exports = router;

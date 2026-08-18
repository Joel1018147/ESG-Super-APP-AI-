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

// The class names live in a MAP rather than in a class attribute, which is why
// a source census of `class="…"` never saw them and why the empty-database
// render never saw them either — the list is empty until a document exists.
// badge-warning / badge-success / badge-danger do not exist in the design
// system; badge-amber / badge-green / badge-red do.
const STATUS_LABEL = {
  pending:       ['Not analysed', 'badge'],
  extracting:    ['Reading…', 'badge badge-amber'],
  extracted:     ['Text extracted', 'badge badge-green'],
  no_text_layer: ['No text layer (scan)', 'badge badge-amber'],
  failed:        ['Could not read', 'badge badge-red'],
};

/* P8 maps the same five statuses onto §16.3's .esg-astate modifiers, so a
   reading state reads identically to an answer state everywhere else in the
   product. Two maps rather than one because the badge classes above are still
   what the API-shaped callers expect; this one is the PAGE's vocabulary. */
const READING_STATE = {
  pending:       'declared',
  extracting:    'declared',
  extracted:     'verified',
  no_text_layer: 'missing',
  failed:        'review',
};

/* ── THE ANALYSIS TRACK ─────────────────────────────────────────────────────
   §19's component, driven ONLY by rows this database actually holds:
   esg_documents.text_status, the esg_scheduled_jobs row for this document, and
   the esg_document_extractions rows. There is no percentage anywhere in it,
   because the system has no continuous progress to report — it has five
   discrete facts, and the track shows which of them are true.

   The FIFTH state, `reserved`, is used for a step that cannot be reached at
   all: a document with no assessment can never be analysed, and saying so is
   the same discipline as a blocked journey stage naming its precondition. */
function analysisTrack(d, props, job) {
  const pending = props.filter((p) => p.status === 'pending').length;
  const discarded = props.filter((p) => p.status === 'auto_rejected').length;
  const read = d.text_status === 'extracted';
  const unreadable = d.text_status === 'no_text_layer' || d.text_status === 'failed';
  const queued = !!job && (job.status === 'pending' || job.status === 'running');
  const reading = d.text_status === 'extracting' || (queued && !read && !unreadable);

  // A step with no assessment behind it is RESERVED, not pending: nothing the
  // user does on this page will start it.
  const blocked = !d.assessment_id;

  // A step that has not happened says WHY it has not, never an em-dash. The
  // three cases are genuinely different and the audit's own §8 rule applies at
  // the scale of one line: nothing to do, not started, or cannot start.
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const notYet = (reason) => ({ state: blocked ? 'reserved' : 'future', words: reason });

  const steps = [
    { name: 'Received', state: 'done', words: `${Math.round(d.byte_size / 1024)} KB on file` },
    read
      ? { name: 'Read', state: 'done', words: d.page_count ? `${plural(d.page_count, 'page', 'pages')} of text` : 'Text extracted' }
      : unreadable
        ? { name: 'Read', state: 'failed', words: d.text_status === 'no_text_layer' ? 'No text layer' : 'Could not read' }
        : reading
          ? { name: 'Read', state: 'current', words: job && job.status === 'pending' ? 'Queued' : 'Reading now' }
          : Object.assign({ name: 'Read' }, notYet(blocked ? 'Needs an assessment' : 'Not started')),
    props.length
      ? { name: 'Disclosures proposed', state: 'done', words: plural(props.length, 'proposed', 'proposed') }
      : read
        ? { name: 'Disclosures proposed', state: 'done', words: 'Nothing could be evidenced' }
        : reading
          ? { name: 'Disclosures proposed', state: 'current', words: 'In progress' }
          : Object.assign({ name: 'Disclosures proposed' }, notYet(blocked ? 'Needs an assessment' : 'Not started')),
    props.length
      ? { name: 'Checked against the text', state: 'done',
        words: discarded ? `${plural(discarded, 'discarded', 'discarded')} as unquotable` : 'Every quote found verbatim' }
      // Read, and nothing proposed: there was nothing to check, and there
      // never will be for this reading. Saying "not started" would be wrong.
      : read
        ? { name: 'Checked against the text', state: 'done', words: 'Nothing to check' }
        : Object.assign({ name: 'Checked against the text' }, notYet(blocked ? 'Needs an assessment' : 'Not started')),
    pending > 0
      ? { name: 'Ready for review', state: 'current', words: `${plural(pending, 'proposal', 'proposals')} waiting on you` }
      : props.length
        ? { name: 'Ready for review', state: 'done', words: 'All reviewed' }
        : read
          ? { name: 'Ready for review', state: 'done', words: 'Nothing to review' }
          : Object.assign({ name: 'Ready for review' }, notYet(blocked ? 'Needs an assessment' : 'Not started')),
  ];

  // data-live is the SERVER's view of whether work is running. Without it the
  // pulse in §19 cannot start, so a finished track cannot go on saying
  // "working" — which is the failure that guard exists to prevent.
  return `<ol class="esg-track"${reading ? ' data-live="true"' : ''} aria-label="Analysis progress">
    ${steps.map((s, i) => `<li class="esg-track__step esg-track__step--${s.state}" style="--esg-i:${i}">
      <span class="esg-track__name">${esc(s.name)}</span>
      <span class="esg-track__state">${esc(s.words)}</span>
    </li>`).join('')}
  </ol>`;
}

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

    /* P8 · ONTO THE DESIGN LAYER.
       This page was the last one still built from `.card`, a raw `<table>` in
       the master's clipping `.table-wrap`, six inline `style=` attributes and
       an emoji on its primary button. It is also where a user first meets the
       AI, so "does this look like the same product as the dashboard" is not a
       cosmetic question here. Nothing about what it DOES has changed. */
    const table = rows.length ? `
      <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Uploaded evidence">
        <table class="esg-table esg-table--stack">
          <thead><tr>
            <th>File</th><th>Type</th><th>Size</th><th>Reading</th><th>To review</th><th></th>
          </tr></thead>
          <tbody>${rows.map((d) => `<tr>
            <td data-label="File">${esc(d.filename)}</td>
            <td data-label="Type">${esc(d.doc_type)}</td>
            <td data-label="Size" class="esg-td-num">${Math.round(d.byte_size / 1024)} KB</td>
            <td data-label="Reading"><span class="esg-astate esg-astate--${
  esc(READING_STATE[d.text_status] || 'declared')}">${esc((STATUS_LABEL[d.text_status] || ['Unknown'])[0])}</span>${
  d.page_count ? ` <span class="esg-meta">${esc(d.page_count)}p</span>` : ''}</td>
            <td data-label="To review" class="esg-td-num">${d.pending > 0
    ? `<span class="esg-astate esg-astate--review">${esc(d.pending)} waiting</span>`
    : '<span class="esg-meta">None</span>'}</td>
            <td data-label=""><a class="btn btn-outline" href="/documents/${esc(d.id)}">Open</a></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
      : emptyState('instrumented_but_empty', {
        title: 'No evidence uploaded yet',
        body: 'Upload a utility bill, a policy, an ISO certificate or a full ESG report.' });

    res.send(layout('Evidence', `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">Evidence</h2>
            <p class="esg-page-header__intro">A document is read, and every disclosure it can
              support is proposed with the sentence it came from. Nothing it proposes changes your
              score until you accept it.</p>
          </div>
        </header>

        ${req.query.error ? `<div class="alert alert-danger" role="alert">
          <div class="alert-body">${esc(req.query.error)}</div></div>` : ''}

        <section class="esg-card esg-enter" style="--esg-i:1">
          <div class="esg-card__header">
            <h3 class="esg-card__title">Upload evidence</h3>
            <span class="esg-card__meta">PDF, image, Word or Excel · 15 MB maximum</span>
          </div>
          <div class="esg-card__body">
            <form method="post" action="/documents" enctype="multipart/form-data" class="esg-row esg-row-controls">
              <div class="form-group"><label for="file">File</label>
                <input id="file" name="file" type="file" required
                       accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"></div>
              <div class="form-group"><label for="doc_type">What is it?</label>
                <select id="doc_type" name="doc_type">
                  <option value="esg_report">ESG / sustainability report</option>
                  <option value="utility_bill">Utility bill</option>
                  <option value="policy">Policy document</option>
                  <option value="iso_cert">ISO certificate</option>
                  <option value="training_record">Training record</option>
                  <option value="other">Other</option>
                </select></div>
              <button class="btn btn-primary" type="submit">Upload</button>
            </form>
          </div>
        </section>

        <section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">What has been uploaded</h3>
            <span class="esg-section__note">${rows.length
    ? `${esc(rows.length)} document${rows.length === 1 ? '' : 's'}` : 'Nothing yet'}</span>
          </div>
          ${table}
        </section>
      </div>`, req.user, '/documents'));
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

    // The live half of the track. One row, this document's own job, and it is
    // the only thing that may switch the pulse on.
    const { rows: jobs } = await query(
      `SELECT status FROM esg_scheduled_jobs
        WHERE job_type = $1 AND payload->>'documentId' = $2
        ORDER BY created_at DESC LIMIT 1`, [ex.JOB_TYPE, req.params.id]);

    /* ── THE PROPOSAL, AS A DISCOVERY ────────────────────────────────────────
       P8's rule for this surface: an AI proposal is not a chat reply, and the
       order in which it becomes believable is EVIDENCE FIRST, conclusion
       second. So the quote is above the proposed answer and arrives before it
       — .esg-found then .esg-follows, 140ms apart, both collapsing to their
       final state under prefers-reduced-motion.

       The three states this renders — proposed, reviewed, discarded — are the
       same three .esg-astate modifiers the assessment page uses, so a proposal
       looks the same wherever a person meets it. */
    const proposal = (p, i, actions, state) => `
      <article class="esg-q${state === 'review' ? ' esg-q--review' : ''} esg-enter" style="--esg-i:${i}">
        <div class="esg-q__head">
          <span class="esg-q__code">${esc(p.code)}</span>
          <span class="esg-q__text">${esc(p.question_en)}</span>
          <span class="esg-astate esg-astate--${esc(state)}${state === 'verified' ? ' esg-settled' : ''}">${
  esc(state === 'review' ? 'Proposed' : state === 'verified' ? 'Reviewed' : 'Discarded')}</span>
        </div>
        <div class="esg-proposal esg-found">
          <blockquote class="esg-quote esg-found">${esc(p.evidence_quote)}
            <cite class="esg-quote__cite">${esc(d.filename)}${p.page_no ? ` · page ${esc(p.page_no)}` : ''}</cite>
          </blockquote>
          <div class="esg-proposal__head esg-follows">
            <span class="esg-proposal__label">Proposed answer</span>
            <span class="esg-proposal__answer">${esc(p.proposed_option_code)}</span>
          </div>
          ${p.reject_reason ? `<p class="esg-small esg-follows">${esc(p.reject_reason)}</p>` : ''}
          ${actions || ''}
        </div>
      </article>`;

    const analysable = d.mime_type === 'application/pdf' && d.assessment_id;

    res.send(layout(d.filename, `
      <div class="esg-page">
        <header class="esg-page-header esg-enter">
          <div class="esg-page-header__text">
            <h2 class="esg-h1">${esc(d.filename)}</h2>
            <p class="esg-page-header__intro">${esc(d.doc_type)} · ${
  Math.round(d.byte_size / 1024)} KB${d.page_count ? ` · ${esc(d.page_count)} pages` : ''}</p>
          </div>
          <div class="esg-page-header__action">
            <a class="btn btn-outline" href="/documents/${esc(d.id)}/download">Download</a>
            ${analysable ? `<form method="post" action="/documents/${esc(d.id)}/analyse">
              <button class="btn btn-primary" type="submit">Analyse this document</button></form>` : ''}
          </div>
        </header>

        <section class="esg-section esg-enter" style="--esg-i:1">
          <div class="esg-section__head">
            <h3 class="esg-section__title">What has happened to this document</h3>
            <span class="esg-section__note">Five facts, no percentage</span>
          </div>
          ${analysisTrack(d, props, jobs[0])}
        </section>

        ${d.extraction_error ? `<div class="esg-ai esg-ai--failed">
          <span class="esg-ai__dot" style="color:var(--esg-problem)" aria-hidden="true"></span>
          <div class="esg-ai__body">
            <p class="esg-ai__title">The reader stopped</p>
            <p class="esg-ai__detail">${esc(d.extraction_error)}</p>
          </div></div>` : ''}

        ${d.text_status === 'no_text_layer' ? `<div class="esg-ai esg-ai--empty">
          <span class="esg-ai__dot" style="color:var(--esg-caution)" aria-hidden="true"></span>
          <div class="esg-ai__body">
            <p class="esg-ai__title">This PDF has no text layer</p>
            <p class="esg-ai__detail">It is almost certainly a scan or an export of images. Nothing
              could be read from it — which is not the same as it disclosing nothing. Re-export it
              from the original document, or run OCR, and upload it again.</p>
          </div></div>` : ''}

        ${!d.assessment_id ? `<div class="esg-ai esg-ai--idle">
          <span class="esg-ai__dot" style="color:var(--esg-blocked)" aria-hidden="true"></span>
          <div class="esg-ai__body">
            <p class="esg-ai__title">Not linked to an assessment</p>
            <p class="esg-ai__detail">A proposal answers a disclosure, and there is no assessment
              here for it to answer. <a href="/assessment">Create one first</a>.</p>
          </div></div>` : ''}

        ${pending.length ? `<section class="esg-section esg-enter" style="--esg-i:2">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Proposed disclosures — ${esc(pending.length)} to review</h3>
            <span class="esg-section__note">AI proposes · a person verifies</span>
          </div>
          <p class="esg-body-2 esg-prose">Nothing below has changed your score. Each one is a claim
            about this document with the sentence it came from. Accepting a proposal records it as a
            <em>documented</em> answer, and the score is then recalculated by the scoring engine —
            never by the model.</p>
          ${pending.map((p, i) => proposal(p, i, `
            <div class="esg-proposal__actions esg-follows">
              <form method="post" action="/extractions/${esc(p.id)}/accept">
                <button class="btn btn-primary" type="submit">Accept</button></form>
              <form method="post" action="/extractions/${esc(p.id)}/reject">
                <button class="btn btn-outline" type="submit">Reject</button></form>
            </div>`, 'review')).join('')}
        </section>` : ''}

        ${decided.length ? `<section class="esg-section esg-enter" style="--esg-i:3">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Reviewed</h3>
            <span class="esg-section__note">${esc(decided.length)} decided by a person</span>
          </div>
          ${decided.map((p, i) => proposal(p, i,
    `<p class="esg-small esg-follows">${esc(p.status === 'accepted' ? 'Accepted' : 'Rejected')} by a reviewer.</p>`,
    'verified')).join('')}
        </section>` : ''}

        ${rejected.length ? `<section class="esg-section esg-enter" style="--esg-i:4">
          <div class="esg-section__head">
            <h3 class="esg-section__title">Discarded automatically — ${esc(rejected.length)}</h3>
            <span class="esg-section__note">Never reached the review queue</span>
          </div>
          <p class="esg-body-2 esg-prose">These were claims that could not be backed by a sentence
            actually present in the document, so they were discarded before you saw them. They are
            shown because a rising count here is the signal that reading is going badly on this
            document.</p>
          ${rejected.map((p, i) => proposal(p, i, '', 'dismissed')).join('')}
        </section>` : ''}

        ${d.text_status === 'extracted' && !props.length
    ? `<div class="esg-card esg-enter" style="--esg-i:2"><div class="esg-card__body">${
  emptyState('instrumented_but_empty', {
    title: 'Analysed, nothing proposed',
    body: 'The text was read and no disclosure could be evidenced from it. Nothing was guessed '
        + 'in its place.' })}</div></div>`
    : ''}
      </div>`, req.user, '/documents'));
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

/** Where to send the reviewer back to.
 *
 *  A proposal is now reviewable from TWO places — the document it came from and
 *  the assessment question it answers — and landing back on the document after
 *  accepting from inside the assessment loses the reviewer's place in a form of
 *  forty questions.
 *
 *  OPEN-REDIRECT GUARD: only a same-site absolute path is honoured. `//host`
 *  and `/\host` are browser-legal ways of writing an absolute URL, so a leading
 *  slash alone is not enough of a test. Anything else falls back to the
 *  document, which is always a valid destination. */
function backTo(req, fallback) {
  const next = req.body && req.body.next;
  if (typeof next === 'string' && /^\/[^/\\]/.test(next)) return next;
  return fallback;
}

router.post('/extractions/:id/accept', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.document_id FROM esg_document_extractions e
         JOIN esg_documents d ON d.id = e.document_id
        WHERE e.id=$1 AND d.company_id=$2`, [req.params.id, cid(req)]);
    if (!rows[0]) return res.status(404).send('Not found');
    await ex.acceptProposal(rows[0].id, req.user.id);
    res.redirect(303, backTo(req, `/documents/${rows[0].document_id}`));
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
    res.redirect(303, backTo(req, `/documents/${rows[0].document_id}`));
  } catch (err) { next(err); }
});

module.exports = router;

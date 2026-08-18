'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN FINANCE — the reference layer                            (Run 47)
   ───────────────────────────────────────────────────────────────────────────
   Pages only. Every JSON endpoint for this module lives in routes/api.js under
   the existing `/api` mount — recurring-bugs-checklist.md #17: the guard's
   `/api/` prefix test is only as good as its premise, and a JSON route served
   from outside `/api/` gets the 302 meant for a page navigation. The caller
   then parses the login page as JSON and reports "could not load".

   THIS MODULE DECIDES NOTHING. It records which financing programmes exist,
   what each institution publishes about them, and when that was last read. No
   scoring, no matching, no recommendation — those are later runs, and the
   phrases that would imply one are banned and asserted against rendered HTML
   in test/green-finance-register-test.js.

   THE THREE EMPTY STATES ARE THE PRODUCT HERE, not a nicety:
     uninstrumented          the register itself holds nothing
     zero                    a filter matched nothing
     instrumented_but_empty  the product is real and THE INSTITUTION PUBLISHES
                             NO TERMS — which is not the same as the product
                             having none, and is the single most common state in
                             this register. HSBC, AmBank and Public Bank publish
                             no amounts, tenures or rates at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { query } = require('../db');
/* dayOf IS IMPORTED, AND THAT IS THE WHOLE OF THE P10 DATE FIX.
   node-postgres materialises a DATE column as a JS Date at LOCAL midnight, so
   String(v) is "Sat Aug 15 2026 00:00:00 GMT+0800 (Malaysia Time)" and
   .slice(0, 10) yields "Sat Aug 15" — a date with no year. Three places in
   this file did that, and one of them fed an <input type="date">, which
   REJECTS a value in that shape and renders the field EMPTY.

   layout.dayOf() already existed and already handled this correctly. Nothing
   new was written; the defective sites now call the helper this repo already
   owns. (impactService keeps its own isoDate: same rule, different null
   contract — it returns null where dayOf returns '' — and its tests pin that.) */
const { layout, esc, dayOf, emptyState } = require('../utils/layout');
const { requireRoles } = require('../middleware/auth');
const copy = require('../services/financeCopy');

const router = express.Router();

// Express 4 hangs a request forever on an unhandled rejection instead of
// 500-ing, which reads as a network fault and logs nothing worth reading.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const NAV = '/green-finance';

// Run 47's pages are reference data and need no tenant scope. Run 48's do:
// every project, baseline and opportunity below is company-scoped, and this is
// the one place that decides what "this company" means in this router.
const companyIdOf = (req) => req.user && req.user.company_id;

/** The outcome of the action the user just took, rendered where they took it.
 *
 *  Every branch is a DISTINCT fact with its own wording. "Started" and "already
 *  running" render differently on purpose — the same complaint the scan-state
 *  notice below already answers, applied to the action instead of the job. An
 *  unrecognised value renders nothing rather than a generic success. */
function outcomeBanner(done) {
  const OUTCOMES = {
    'scan-queued': ['success', 'The suggestion scan has started.',
      'It runs in the background. Reload this page in a minute to see what it proposed.'],
    'scan-already': ['info', 'A scan is already running for your company.',
      'Nothing new was started. Reload shortly to see the result of the run already in progress.'],
    accepted: ['success', 'Suggestion accepted.',
      'A draft project was created from it, with no cost filled in. You set the figures yourself.'],
    rejected: ['info', 'Suggestion dismissed.', 'It will not be proposed again.'],
    'not-found': ['warning', 'That suggestion is no longer available.',
      'It may have already been accepted or dismissed. Nothing was changed.'],
  };
  const o = OUTCOMES[done];
  if (!o) return '';
  return `<div class="alert alert-${o[0]}" role="status" aria-live="polite">
    <div class="alert-body"><strong>${esc(o[1])}</strong> ${esc(o[2])}</div>
  </div>`;
}

/** The one place the legal position is written. Rendered on every surface in
 *  this module, and imported by the runs that come after. */
function disclaimerBlock() {
  return `<div class="alert alert-info" role="alert" aria-live="polite">
    <div class="alert-body"><strong>Reference only.</strong> ${esc(copy.DISCLAIMER)}</div>
  </div>`;
}

/** Verification age, rendered the same way everywhere it appears. A row whose
 *  source has not been re-read inside STALE_AFTER_DAYS says so visibly — the
 *  whole value of the register is that it carries its own age. */
function ageBadge(daysSinceVerified) {
  const age = copy.verificationAge(daysSinceVerified);
  const cls = age.stale ? 'badge badge-amber' : 'badge badge-gray';
  const suffix = age.stale ? ` · not re-read for over ${copy.STALE_AFTER_DAYS} days` : '';
  return `<span class="${cls}">${esc(age.text)}${esc(suffix)}</span>`;
}

/* ── Filters ───────────────────────────────────────────────────────────────
   A filter value the register does not know about is REPORTED, never silently
   dropped. Quietly ignoring it shows the unfiltered list under a filtered
   heading, which is a wrong answer wearing a right answer's clothes. */
const FILTERS = [
  { key: 'type',   column: 'financing_type',       labels: copy.FINANCING_TYPE_LABELS, legend: 'Financing type' },
  { key: 'scope',  column: 'borrower_scope',       labels: copy.BORROWER_SCOPE_LABELS, legend: 'Borrower' },
  { key: 'status', column: 'availability_status',  labels: copy.AVAILABILITY_LABELS,   legend: 'Availability' },
];

function readFilters(reqQuery) {
  const applied = {};
  const unknown = [];
  for (const f of FILTERS) {
    const raw = String((reqQuery || {})[f.key] || '').trim();
    if (!raw) continue;
    if (Object.prototype.hasOwnProperty.call(f.labels, raw)) applied[f.key] = raw;
    else unknown.push(`${f.key}=${raw}`);
  }
  return { applied, unknown, any: Object.keys(applied).length > 0 };
}

function filterControls(applied) {
  const selects = FILTERS.map((f) => {
    const options = ['<option value="">Any</option>'].concat(
      Object.keys(f.labels).map((k) => `<option value="${esc(k)}"${applied[f.key] === k ? ' selected' : ''}>${esc(f.labels[k])}</option>`),
    ).join('');
    return `<div class="form-group">
      <label for="f-${esc(f.key)}">${esc(f.legend)}</label>
      <select id="f-${esc(f.key)}" name="${esc(f.key)}">${options}</select>
    </div>`;
  }).join('');
  return `<form class="card" method="get" action="${NAV}/register">
    <h3 class="section-title">Filter the register</h3>
    ${selects}
    <button class="btn btn-primary" type="submit">Apply</button>
    <a class="btn btn-outline" href="${NAV}/register">Clear</a>
    <p class="text-muted text-sm">There is deliberately no filter by project type. That mapping is
       a judgement about what each facility covers, and it does not exist yet.</p>
  </form>`;
}

/** Outcomes of the two project writers, worded distinctly so "saved" and
 *  "that code is not in the current scheme" cannot render the same way. */
const CLASSIFY_OUTCOME = Object.freeze({
  saved: '<div class="alert alert-success" role="status" aria-live="polite"><div class="alert-body">'
    + '<strong>Classification saved.</strong> The scheme version is stamped on this project, so a '
    + 'later revision of the taxonomy will not silently reinterpret it.</div></div>',
  none: '<div class="alert alert-warning" role="alert"><div class="alert-body">'
    + '<strong>No category chosen.</strong> Nothing was changed.</div></div>',
  unknown: '<div class="alert alert-warning" role="alert"><div class="alert-body">'
    + '<strong>That category is not in the current CCPT scheme.</strong> Nothing was changed — the '
    + 'platform will not stamp a code the published scheme does not contain.</div></div>',
});
const FINANCING_OUTCOME = Object.freeze({
  saved: '<div class="alert alert-success" role="status" aria-live="polite"><div class="alert-body">'
    + '<strong>Saved.</strong> Green Finance Readiness has been recomputed from it.</div></div>',
});

/* ── The module landing page ──────────────────────────────────────────────── */
router.get('/green-finance', wrap(async (req, res) => {
  res.send(layout('Green Finance', `
    <h2 class="page-title">Green and sustainability financing in Malaysia</h2>
    ${disclaimerBlock()}

    <div class="card">
      <h3 class="section-title">Two different things, and banks price them differently</h3>
      <p><strong>Use-of-proceeds green financing</strong> lends against a specific green
         project — a rooftop solar array, a chiller replacement, a waste-recovery line.
         What makes it green is where the money goes, so the institution asks for
         quotations, technical documents and a certificate covering that project.</p>
      <p><strong>Sustainability-linked financing</strong> lends for general purposes and
         ties the price to whether the borrower hits agreed targets. What makes it
         sustainability-linked is what the borrower promises to achieve, so the
         institution asks for a baseline, targets and an assured report — and reprices
         when the targets are met or missed.</p>
      <p class="text-muted">Alongside those sit <strong>guarantees</strong>, which do not lend
         at all — a guarantee corporation covers part of a lender's loss so the lender
         will take the risk — and <strong>grants or subsidies</strong>, which do not have
         to be repaid.</p>
    </div>

    <div class="card">
      <h3 class="section-title">What this section is, and what it is not</h3>
      <p>It is a register of the programmes that exist, transcribed from each
         institution's own published material, with the date each source was last read
         printed against every row. Where an institution publishes nothing, the register
         says so rather than leaving a blank that reads like a zero.</p>
      <p>It does <strong>not</strong> tell you which programme fits your company, and it
         does not tell you what any institution would decide. Nothing here has been
         checked against your accounts.</p>
      <p><a class="btn btn-primary" href="${NAV}/register">Open the register</a></p>
    </div>`, req.user, NAV));
}));

/* ── The register ─────────────────────────────────────────────────────────── */
router.get('/green-finance/register', wrap(async (req, res) => {
  const { applied, unknown, any } = readFilters(req.query);

  const { rows } = await query(
    `SELECT id, institution_name, institution_kind, product_name, financing_type,
            borrower_scope, availability_status, is_active, source_publisher,
            last_verified, (CURRENT_DATE - last_verified) AS days_since_verified
       FROM esg_finance_products
      WHERE ($1::text IS NULL OR financing_type      = $1)
        AND ($2::text IS NULL OR borrower_scope      = $2)
        AND ($3::text IS NULL OR availability_status = $3)
      ORDER BY institution_name, product_name`,
    [applied.type || null, applied.scope || null, applied.status || null]);

  const warning = unknown.length
    ? `<div class="alert alert-warning" role="alert" aria-live="polite"><div class="alert-body">
         <strong>Filter not applied.</strong> The register does not have
         ${esc(unknown.join(', '))}. The list below is <em>not</em> filtered by it.
       </div></div>`
    : '';

  let body;
  if (rows.length) {
    const trs = rows.map((r) => `<tr>
        <td data-label="Institution">${esc(r.institution_name)}<br>
            <span class="esg-small">${esc(copy.labelFor(copy.INSTITUTION_KIND_LABELS, r.institution_kind))}</span></td>
        <td data-label="Programme"><a class="esg-cell-link" href="${NAV}/register/${esc(r.id)}">${esc(r.product_name)}</a>${
  r.is_active ? '' : ' <span class="esg-astate esg-astate--na">not current</span>'}</td>
        <td data-label="Financing type">${esc(copy.labelFor(copy.FINANCING_TYPE_LABELS, r.financing_type))}</td>
        <td data-label="Borrower">${esc(copy.labelFor(copy.BORROWER_SCOPE_LABELS, r.borrower_scope))}</td>
        <td data-label="Availability"><span class="esg-astate esg-astate--${
  r.availability_status === 'open' ? 'verified' : 'missing'}">${
  esc(copy.labelFor(copy.AVAILABILITY_LABELS, r.availability_status))}</span></td>
        <td data-label="Source last read">${ageBadge(r.days_since_verified)}</td>
      </tr>`).join('');
    /* P10 · OFF .table-wrap AND ONTO §5's SCROLL CONTAINER.
       MEASURED at 390px before this change: the table was 749px wide inside
       .table-wrap, whose overflow-x is hidden, with no scroll container above
       it — so the last cell's right edge landed at 761px in a 390px viewport
       and 371px of every one of 31 rows was unreachable. No scrollbar, no
       gesture, no way back. That is D1's data-loss shape, and it is the same
       defect fc29163 fixed on /frameworks and /assessment.

       It survived that run because this page was not in test/visual/audit.js's
       hand-kept list — exactly the drift that commit's own comment predicted.
       The list is derived from layout.MODULES in this run so it cannot drift
       again. Same treatment the green projects table already had: a scroll
       container that is keyboard reachable, and .esg-table--stack so a phone
       gets one row per block instead of a sideways scroll it has to discover. */
    body = `<div class="esg-table-scroll" tabindex="0" role="region" aria-label="Financing register">
      <table class="esg-table esg-table--stack">
      <thead><tr><th>Institution</th><th>Programme</th><th>Financing type</th>
                 <th>Borrower</th><th>Availability</th><th>Source last read</th></tr></thead>
      <tbody>${trs}</tbody></table></div>
      <p class="esg-small esg-prose">${esc(rows.length)} programme${rows.length === 1 ? '' : 's'} shown.
         A row marked over ${esc(copy.STALE_AFTER_DAYS)} days old has not been re-read since it was
         recorded; treat its figures as needing confirmation with the institution.</p>`;
  } else if (any) {
    // No rows AND a filter was applied. It could still be that the register
    // itself is empty, and those two states must not be collapsed — so ask.
    const { rows: tot } = await query('SELECT count(*)::int AS n FROM esg_finance_products');
    if (!tot.length) throw new Error('register count returned no row — the data path is broken');
    body = Number(tot[0].n) === 0
      ? emptyState('uninstrumented', {
        title: 'The register holds nothing yet',
        body: 'No financing programme has been recorded. This is not switched on, rather than empty.' })
      : emptyState('zero', {
        title: 'No programme matches this filter',
        body: 'The register has programmes in it — none of them matches every filter you selected. Clear a filter to widen the list.' });
  } else {
    body = emptyState('uninstrumented', {
      title: 'The register holds nothing yet',
      body: 'No financing programme has been recorded. This is not switched on, rather than empty.' });
  }

  res.send(layout('Financing register', `
    <h2 class="page-title">Financing register</h2>
    ${disclaimerBlock()}
    ${warning}
    ${filterControls(applied)}
    ${body}`, req.user, NAV));
}));

/* ── One programme ────────────────────────────────────────────────────────── */
const TERM_FIELDS = [
  ['tenure_note',        'Tenure'],
  ['rate_note',          'Rate and pricing'],
  ['documentation_note', 'What the institution asks for'],
  ['eligibility_note',   'Published eligibility'],
];

const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function moneyRow(label, value) {
  if (!present(value)) return '';
  return `<tr><th scope="row">${esc(label)}</th><td>RM ${esc(Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2 }))}</td></tr>`;
}

/** The amount block, which is where NULL-is-not-zero actually bites.
 *
 *  Three genuinely different situations and they must not collapse:
 *    a published cap            -> the figure
 *    a cap that varies by tier  -> amount_note verbatim, max deliberately NULL
 *    nothing published at all   -> INSTRUMENTED-BUT-EMPTY, naming the
 *                                  institution as the one that is silent
 *
 *  Rendering the third as a blank cell is the failure this whole module is
 *  built to avoid: a reader takes an empty amount for "no limit" or for zero. */
function amountBlock(p) {
  const money = moneyRow('Maximum financing', p.max_financing_myr)
              + moneyRow('Minimum financing', p.min_financing_myr);
  const note = present(p.amount_note)
    ? `<tr><th scope="row">Amount</th><td>${esc(p.amount_note)}</td></tr>` : '';
  if (money || note) return { rows: money + note, empty: '' };
  return {
    rows: '',
    empty: emptyState('instrumented_but_empty', {
      title: 'No amount published',
      body: `${p.institution_name} publishes no financing amount for this programme. `
          + 'That is the institution not disclosing a figure — it is not an amount of zero, '
          + 'and it is not a limit of nothing.' }),
  };
}

router.get('/green-finance/register/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, institution_name, institution_kind, product_name, financing_type,
            borrower_scope, max_financing_myr, min_financing_myr, amount_note,
            tenure_note, rate_note, documentation_note, eligibility_note,
            availability_status, status_note, source_url, source_publisher,
            last_verified, is_active,
            (CURRENT_DATE - last_verified) AS days_since_verified
       FROM esg_finance_products WHERE id = $1`, [req.params.id]);

  if (!rows[0]) {
    return res.status(404).send(layout('Not found', `
      ${emptyState('zero', { title: 'No such programme',
        body: 'Nothing in the register has that identifier.' })}
      <p><a class="btn btn-outline" href="${NAV}/register">Back to the register</a></p>`,
    req.user, NAV));
  }

  const p = rows[0];
  const termRows = TERM_FIELDS
    .filter(([f]) => present(p[f]))
    .map(([f, label]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(p[f])}</td></tr>`)
    .join('');
  const amount = amountBlock(p);

  // INSTRUMENTED-BUT-EMPTY, and the copy has to say WHOSE silence it is. "This
  // product has no published terms" would be a claim about the product; the
  // true statement is that the institution does not publish them.
  const terms = (termRows + amount.rows)
    ? `<div class="table-wrap"><table><tbody>${amount.rows}${termRows}</tbody></table></div>${amount.empty}`
    : emptyState('instrumented_but_empty', {
      title: 'No terms published',
      body: `${p.institution_name} publishes no amount, tenure, rate, documentation list or `
          + 'eligibility criteria for this programme. The programme is real and this record is '
          + 'complete — the institution does not disclose the terms.' });

  /* P10 · THE DETAIL PAGE, MIGRATED WITH ITS LIST.
     The derived page list found this the moment it started deriving: the same
     module, the same pre-P8 markup, and a source URL 492px wide rendered
     off-screen at 360 and 390 with nothing to scroll it. A BNM document URL is
     one unbreakable token, so it needs a wrapping rule rather than a container
     — .esg-prose-wide plus overflow-wrap is what /frameworks already uses for
     the same kind of link. The 11px master badges go with it, for the reason
     §3 gives: 11px is reserved for legal and provenance, never for a status. */
  res.send(layout(p.product_name, `
    <div class="esg-page">
      <header class="esg-page-header esg-enter">
        <div class="esg-page-header__text">
          <h2 class="esg-h1">${esc(p.product_name)}</h2>
          <p class="esg-page-header__intro">${esc(p.institution_name)} ·
             ${esc(copy.labelFor(copy.INSTITUTION_KIND_LABELS, p.institution_kind))}</p>
        </div>
      </header>
      ${disclaimerBlock()}

      <section class="esg-section esg-enter" style="--esg-i:1">
        <div class="esg-section__head">
          <h3 class="esg-section__title">Status</h3>
          <span class="esg-section__note">As the institution publishes it</span>
        </div>
        <div class="esg-card"><div class="esg-card__body esg-stack">
          <div class="esg-row">
            <span class="esg-astate esg-astate--${
  p.availability_status === 'open' ? 'verified' : 'missing'}">${
  esc(copy.labelFor(copy.AVAILABILITY_LABELS, p.availability_status))}</span>
            ${p.is_active ? '' : '<span class="esg-astate esg-astate--na">not current</span>'}
            ${ageBadge(p.days_since_verified)}
          </div>
          <p class="esg-body esg-prose">${esc(p.status_note)}</p>
        </div></div>
      </section>

      <section class="esg-section esg-enter" style="--esg-i:2">
        <div class="esg-section__head">
          <h3 class="esg-section__title">What the institution publishes</h3>
          <span class="esg-section__note">Recorded from the source, never inferred</span>
        </div>
        <div class="esg-card"><div class="esg-card__body esg-stack">
          <div class="esg-table-scroll" tabindex="0" role="region" aria-label="Published terms">
            <table class="esg-table esg-table--stack"><tbody>
              <tr><th scope="row">Financing type</th>
                  <td data-label="Financing type">${esc(copy.labelFor(copy.FINANCING_TYPE_LABELS, p.financing_type))}</td></tr>
              <tr><th scope="row">Borrower</th>
                  <td data-label="Borrower">${esc(copy.labelFor(copy.BORROWER_SCOPE_LABELS, p.borrower_scope))}</td></tr>
            </tbody></table>
          </div>
          ${terms}
        </div></div>
      </section>

      <section class="esg-section esg-enter" style="--esg-i:3">
        <div class="esg-section__head">
          <h3 class="esg-section__title">Where this came from</h3>
          <span class="esg-section__note">Provenance, and when it was last read</span>
        </div>
        <div class="esg-card"><div class="esg-card__body esg-stack">
          <p class="esg-body">${esc(copy.labelFor(copy.SOURCE_PUBLISHER_LABELS, p.source_publisher))} ·
             read ${esc(dayOf(p.last_verified))}</p>
          <p class="esg-prose-wide"><a class="esg-cell-link" href="${esc(p.source_url)}"
             rel="noreferrer noopener" target="_blank">${esc(p.source_url)}</a></p>
        </div></div>
      </section>

      <div class="esg-row">
        <a class="btn btn-outline" href="${NAV}/register">Back to the register</a>
      </div>
    </div>`,
  req.user, NAV));
}));

/* ── Maintenance, super_admin only ────────────────────────────────────────
   These screens are what makes "the register can be corrected without a
   deploy" true rather than API-only. requireRoles answers a denied PAGE
   navigation with a 403 RENDERED IN PLACE — never a redirect. 401 means we do
   not know who you are; 403 means we know exactly who you are and the answer is
   no, and bouncing a signed-in user to /dashboard for it is the loop
   MODUS_UI_CONTRACT §4.3e describes. */
const adminOnly = requireRoles('super_admin');

router.get('/green-finance/admin/products', adminOnly, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, institution_name, product_name, availability_status, is_active,
            last_verified, (CURRENT_DATE - last_verified) AS days_since_verified
       FROM esg_finance_products ORDER BY (CURRENT_DATE - last_verified) DESC, institution_name`);

  const body = rows.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Institution</th><th>Programme</th><th>Availability</th>
                   <th>Source last read</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.institution_name)}</td>
          <td>${esc(r.product_name)}${r.is_active ? '' : ' <span class="badge badge-gray">not current</span>'}</td>
          <td>${esc(copy.labelFor(copy.AVAILABILITY_LABELS, r.availability_status))}</td>
          <td>${ageBadge(r.days_since_verified)}</td>
          <td><a class="btn btn-sm btn-outline" href="${NAV}/admin/products/${esc(r.id)}/edit">Correct</a></td>
        </tr>`).join('')}</tbody></table></div>`
    : emptyState('uninstrumented', {
      title: 'Nothing to maintain yet',
      body: 'The register holds no programme, so there is nothing to correct.' });

  res.send(layout('Register maintenance', `
    <h2 class="page-title">Register maintenance</h2>
    <div class="alert alert-info" role="alert" aria-live="polite"><div class="alert-body">
      Sorted oldest-verification first. Correcting a row <strong>always</strong> stamps a new
      verification date — a correction that leaves the old date in place is a lie with a date on it.
    </div></div>
    ${body}`, req.user, NAV));
}));

router.get('/green-finance/admin/products/:id/edit', adminOnly, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, institution_name, product_name, availability_status, status_note,
            amount_note, tenure_note, rate_note, documentation_note, eligibility_note,
            source_url, last_verified, is_active
       FROM esg_finance_products WHERE id = $1`, [req.params.id]);

  if (!rows[0]) {
    return res.status(404).send(layout('Not found', `
      ${emptyState('zero', { title: 'No such programme',
        body: 'Nothing in the register has that identifier.' })}`, req.user, NAV));
  }
  const p = rows[0];
  /* LOCAL components, not UTC. toISOString() was the fourth site of the same
     off-by-one: in GMT+0800 an admin recording a verification before 08:00
     local would get yesterday's date here, and could not select today. */
  const today = dayOf(new Date());
  const area = (name, label, value) => `<div class="form-group">
      <label for="fld-${esc(name)}">${esc(label)}</label>
      <textarea id="fld-${esc(name)}" name="${esc(name)}" rows="3">${esc(value === null || value === undefined ? '' : value)}</textarea>
    </div>`;

  res.send(layout('Correct a register entry', `
    <h2 class="page-title">${esc(p.product_name)}</h2>
    <p class="text-muted">${esc(p.institution_name)}</p>
    <div class="alert alert-warning" role="alert" aria-live="polite"><div class="alert-body">
      Leave a field empty to record that <strong>the institution publishes nothing</strong> for it.
      An empty field is not zero, and the register renders the two differently.
    </div></div>
    <form class="card" id="editForm" data-id="${esc(p.id)}">
      <div class="form-group">
        <label for="fld-availability_status">Availability</label>
        <select id="fld-availability_status" name="availability_status">
          ${Object.keys(copy.AVAILABILITY_LABELS).map((k) => `<option value="${esc(k)}"${
            p.availability_status === k ? ' selected' : ''}>${esc(copy.AVAILABILITY_LABELS[k])}</option>`).join('')}
        </select>
      </div>
      ${area('status_note', 'Status note (required)', p.status_note)}
      ${area('amount_note', 'Amount note', p.amount_note)}
      ${area('tenure_note', 'Tenure note', p.tenure_note)}
      ${area('rate_note', 'Rate note', p.rate_note)}
      ${area('documentation_note', 'What the institution asks for', p.documentation_note)}
      ${area('eligibility_note', 'Published eligibility', p.eligibility_note)}
      <div class="form-group">
        <label for="fld-source_url">Source URL</label>
        <input id="fld-source_url" name="source_url" type="url" value="${esc(p.source_url)}">
      </div>
      <div class="form-group">
        <label for="fld-last_verified">Date this source was read (required)</label>
        <input id="fld-last_verified" name="last_verified" type="date" value="${esc(today)}" required>
      </div>
      <button class="btn btn-primary" type="submit">Save correction</button>
      <a class="btn btn-outline" href="${NAV}/admin/products">Cancel</a>
    </form>
    <div id="saveAlert" class="alert alert-inline" role="alert" aria-live="polite" hidden><div class="alert-body" id="saveMsg"></div></div>
    <script>
    (function () {
      var form = document.getElementById('editForm');
      var box  = document.getElementById('saveAlert');
      var msg  = document.getElementById('saveMsg');
      function say(kind, text) {
        box.hidden = false;
        box.className = 'alert alert-inline alert-' + kind;
        msg.textContent = text;
      }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var body = {};
        new FormData(form).forEach(function (v, k) { body[k] = v; });
        // The id travels as an ATTRIBUTE, not spliced into this script. esc()
        // escapes the quote characters that bound an attribute; it does not
        // escape the single quote that would bound a JS string literal. The
        // value is a uuid today and that is not a property of the renderer.
        fetch('/api/finance-products/' + encodeURIComponent(form.getAttribute('data-id')), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        }).then(function (res) {
          return res.json().then(function (data) { return { res: res, data: data }; });
        }).then(function (out) {
          if (out.res.ok) { say('success', 'Saved. Verification date set to ' + out.data.last_verified + '.'); return; }
          say('error', out.data && out.data.error ? out.data.error : 'Not saved: HTTP ' + out.res.status);
        }).catch(function (err) {
          say('error', 'Not saved — the request did not complete: ' + err.message);
        });
      });
    })();
    </script>`, req.user, NAV));
}));

/* ═══════════════════════════════════════════════════════════════════════════
   GREEN PROJECTS                                                    (Run 48)
   ───────────────────────────────────────────────────────────────────────────
   The comparison between use-of-proceeds green financing and
   sustainability-linked financing is NOT repeated here. It has exactly one
   definition, on the module landing page above, and these pages link to it.
   Two explanations of the same distinction in two places is how they end up
   saying different things — the same argument as the disclaimer constant.
   ═══════════════════════════════════════════════════════════════════════════ */

const opp = require('../services/opportunityService');
const { runOnce } = require('../services/jobRunner');
const readiness = require('../services/readinessService');
const financeMatch = require('../services/financeMatchService');
const { pad2 } = require('../utils/journeyView');
const impact = require('../services/impactService');
const frameworks = require('../services/missionFrameworks');
const { icon } = require('../utils/layout');
const model = require('../services/readinessModel');
const baselines = require('../services/baselineService');

const PROJECT_STATUSES = ['draft', 'defined', 'seeking_financing', 'implementing', 'implemented', 'abandoned'];

/** How a project's classification is shown. Never a bare code: a code with no
 *  scheme version cannot be checked against anything, and a code a human never
 *  confirmed must not look like one they did. */
function classificationBlock(p) {
  if (!p.classification_basis || (!p.ccpt_category_code && !p.asean_ff_code)) {
    return emptyState('uninstrumented', {
      title: 'Not classified yet',
      body: 'No taxonomy classification has been recorded for this project. No project type '
          + 'carries a default classification — none of the published sources states one — so a '
          + 'person assigns it, against the taxonomy a lender will ask under.' });
  }
  const provenance = p.classification_basis === 'human_assigned'
    ? '<span class="badge badge-green">confirmed by a person</span>'
    : '<span class="badge badge-amber">from the project-type default — not yet confirmed</span>';
  const rows = [
    ['BNM CCPT', p.ccpt_category_code, p.ccpt_scheme_version],
    ['ASEAN Foundation Framework', p.asean_ff_code, p.asean_scheme_version],
    ['ASEAN Plus Standard', p.asean_ps_code, p.asean_scheme_version],
  ].filter(([, code]) => present(code))
    .map(([label, code, version]) => `<tr><th scope="row">${esc(label)}</th>
       <td>${esc(code)} <span class="text-muted text-sm">under ${esc(version || 'an unrecorded revision')}</span></td></tr>`)
    .join('');
  return `<p>${provenance}</p>
    <div class="table-wrap"><table><tbody>${rows}</tbody></table></div>
    <p class="text-muted text-sm">The scheme version is stamped on this project, not looked up.
       ASEAN V3 was superseded by V4 in November 2025; a project classified under V3 keeps saying V3.</p>`;
}

function baselineBlock(rows, reasons, hasAnyEntries) {
  if (!rows.length) {
    // THE THREE EMPTY STATES, KEPT APART. Which one it is depends on whether
    // the company has carbon data at all, not on whether this query returned
    // rows — those are different facts and collapsing them tells an owner a
    // capability does not exist when it does.
    return hasAnyEntries
      ? emptyState('instrumented_but_empty', {
        title: 'No carbon data in this period',
        body: 'This company has carbon entries, but none falls inside the period you chose. '
            + 'Widen the period, or add entries for it.' })
      : emptyState('uninstrumented', {
        title: 'Nothing writes an energy baseline for you yet',
        body: 'A baseline is computed from your carbon entries. Add carbon data and it will be '
            + 'calculated — it is not estimated, and no part of it is generated by AI.' });
  }
  const allZero = rows.every((r) => Number(r.value) === 0);
  if (allZero) {
    return emptyState('zero', {
      title: 'Measured, and the answer is zero',
      body: `${rows[0].source_entry_count} entries were found in this period and they sum to zero.` });
  }
  const trs = rows.map((r) => `<tr>
      <td>${esc(r.metric)}</td>
      <td>${esc(r.value)} ${esc(r.unit)}</td>
      <td>${esc(r.source_entry_count)}</td>
      <td>${r.is_provisional
    ? '<span class="badge badge-amber">provisional</span>'
    : '<span class="badge badge-green">verified factors</span>'}</td>
    </tr>`).join('');
  const why = reasons.length
    ? `<p class="text-muted text-sm">Provisional because these factors are not verified:
         ${esc(reasons.map((r) => `${r.factor_source_used} (v${r.factor_version_used})`).join('; '))}.
         A figure computed from an unverified factor is useful internally and must not leave the
         system looking verified.</p>`
    : '';
  return `<div class="table-wrap"><table>
      <thead><tr><th>Metric</th><th>Value</th><th>Entries</th><th>Basis</th></tr></thead>
      <tbody>${trs}</tbody></table></div>${why}`;
}

router.get('/green-finance/projects', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.title, p.status, p.estimated_cost_myr, p.ccpt_category_code,
            p.classification_basis, p.created_at, t.label_en AS project_type_label
       FROM esg_green_projects p
       LEFT JOIN esg_project_types t ON t.id = p.project_type_id
      WHERE p.company_id = $1 ORDER BY p.created_at DESC`, [companyIdOf(req)]);

  /* P8 · off .table-wrap and onto §5's scroll container, and the project link
     is a full-height cell rather than a 16px line of text — it measured 16px
     tall at every viewport, which is the smallest target in the product. */
  const body = rows.length
    ? `<div class="esg-table-scroll" tabindex="0" role="region" aria-label="Green projects">
        <table class="esg-table esg-table--stack">
          <thead><tr><th>Project</th><th>Type</th><th>Status</th><th>Classification</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td data-label="Project"><a class="esg-cell-link" href="${NAV}/projects/${esc(r.id)}">${esc(r.title)}</a></td>
            <td data-label="Type">${esc(r.project_type_label || 'Not set')}</td>
            <td data-label="Status">${esc(r.status)}</td>
            <td data-label="Classification">${r.ccpt_category_code
    ? esc(r.ccpt_category_code) + (r.classification_basis === 'human_assigned' ? ''
      : ' <span class="esg-astate esg-astate--missing">Unconfirmed</span>')
    : '<span class="esg-astate esg-astate--na">Not classified</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`
    : emptyState('instrumented_but_empty', {
      title: 'No green projects yet',
      body: 'This is switched on and working — nobody has defined a project yet. '
          + 'A project is what a lender is actually told about.' });

  res.send(layout('Green projects', `
    <div class="esg-page">
      <header class="esg-page-header esg-enter">
        <div class="esg-page-header__text">
          <h2 class="esg-h1">Green projects</h2>
          <p class="esg-page-header__intro">A project is the thing a lender is actually told about.
            A score is not.</p>
        </div>
        <div class="esg-page-header__action">
          <a class="btn btn-primary" href="${NAV}/projects/new">Define a project</a>
          <a class="btn btn-outline" href="${NAV}/opportunities">AI suggestions</a>
        </div>
      </header>
      ${disclaimerBlock()}
      <section class="esg-section esg-enter" style="--esg-i:1">
        <div class="esg-section__head">
          <h3 class="esg-section__title">Your projects</h3>
          <span class="esg-section__note">${rows.length
    ? `${esc(rows.length)} defined` : 'None defined yet'}</span>
        </div>
        ${body}
      </section>
      <p><a class="btn btn-outline" href="${NAV}">What the two financing types mean</a></p>
    </div>`, req.user, NAV));
}));

router.get('/green-finance/projects/new', wrap(async (req, res) => {
  const { rows: types } = await query(
    `SELECT code, label_en FROM esg_project_types WHERE is_active ORDER BY sort_order, code`);
  res.send(layout('Define a green project', `
    <h2 class="page-title">Define a green project</h2>
    ${disclaimerBlock()}
    <form class="card" method="post" action="${NAV}/projects/new">
      <div class="form-group">
        <label for="p-title">Project title</label>
        <input id="p-title" name="title" required maxlength="200">
      </div>
      <div class="form-group">
        <label for="p-type">Project type</label>
        <select id="p-type" name="project_type_code">
          <option value="">Not sure yet</option>
          ${types.map((t) => `<option value="${esc(t.code)}">${esc(t.label_en)}</option>`).join('')}
        </select>
        <p class="text-muted text-sm">Types are shown in English only. No source publishes these
           terms in Bahasa Malaysia or Chinese, and a machine-translated financial term is a wrong
           term in two more languages.</p>
      </div>
      <div class="form-group">
        <label for="p-desc">What the project is</label>
        <textarea id="p-desc" name="description" rows="4"></textarea>
      </div>
      <div class="form-group">
        <label for="p-cost">Estimated cost (MYR, optional)</label>
        <input id="p-cost" name="estimated_cost_myr" type="number" step="0.01" min="0">
        <p class="text-muted text-sm">Leave blank if you do not know. It stays empty — nothing
           estimates it for you.</p>
      </div>
      <button class="btn btn-primary" type="submit">Create project</button>
      <a class="btn btn-outline" href="${NAV}/projects">Cancel</a>
    </form>`, req.user, NAV));
}));

router.post('/green-finance/projects/new', wrap(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.redirect(`${NAV}/projects/new`);
  let typeRow = null;
  if (b.project_type_code) {
    const { rows } = await query(
      `SELECT id, code, label_en, default_ccpt_category_id, default_asean_objective_id
         FROM esg_project_types WHERE code = $1 AND is_active`, [String(b.project_type_code)]);
    typeRow = rows[0] || null;
  }
  const stamp = typeRow
    ? await opp.resolveDefaultClassification(typeRow)
    : { ccpt_category_code: null, ccpt_scheme_version: null, asean_ff_code: null,
        asean_ps_code: null, asean_scheme_version: null, classification_basis: null };
  const cost = parseFloat(b.estimated_cost_myr);
  const { rows } = await query(
    `INSERT INTO esg_green_projects
       (company_id, project_type_id, title, description, estimated_cost_myr, status,
        ccpt_category_code, ccpt_scheme_version, asean_ff_code, asean_ps_code,
        asean_scheme_version, classification_basis, created_by)
     VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [companyIdOf(req), typeRow ? typeRow.id : null, title, b.description || null,
     Number.isFinite(cost) ? cost : null,
     stamp.ccpt_category_code, stamp.ccpt_scheme_version, stamp.asean_ff_code,
     stamp.asean_ps_code, stamp.asean_scheme_version, stamp.classification_basis, req.user.id]);
  res.redirect(`${NAV}/projects/${rows[0].id}`);
}));

router.get('/green-finance/projects/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.title, p.description, p.status, p.estimated_cost_myr, p.project_type_id,
            p.ccpt_category_code, p.ccpt_scheme_version, p.asean_ff_code,
            p.asean_ps_code, p.asean_scheme_version, p.classification_basis,
            p.classified_at, t.label_en AS project_type_label,
            p.financing_required_myr, p.own_contribution_myr, p.financing_purpose,
            p.expected_benefit_metric, p.expected_benefit_value, p.expected_benefit_basis
       FROM esg_green_projects p
       LEFT JOIN esg_project_types t ON t.id = p.project_type_id
      WHERE p.id = $1 AND p.company_id = $2`, [req.params.id, companyIdOf(req)]);
  if (!rows[0]) {
    return res.status(404).send(layout('Not found',
      emptyState('zero', { title: 'No such project', body: 'Nothing you own has that identifier.' }),
      req.user, NAV));
  }
  const p = rows[0];
  const [bl, anyEntries, ev, cats] = await Promise.all([
    baselines.listBaselines(p.id),
    query(`SELECT count(*)::int n FROM esg_carbon_entries WHERE company_id = $1`, [companyIdOf(req)]),
    query(`SELECT e.document_id, d.filename FROM esg_green_project_evidence e
             JOIN esg_documents d ON d.id = e.document_id
            WHERE e.project_id = $1 ORDER BY e.created_at DESC`, [p.id]),
    // The CURRENT CCPT scheme's categories. A superseded scheme's codes are not
    // offered for a new classification, but a project already stamped with one
    // keeps saying so — that is what the stamp is for.
    query(`SELECT c.code, c.label_en, c.definition_en, s.version
             FROM esg_taxonomy_categories c
             JOIN esg_taxonomy_schemes s ON s.id = c.scheme_id
            WHERE s.code = 'CCPT' AND s.is_current
            ORDER BY c.sort_order, c.code`),
  ]);
  const reasons = bl.some((r) => r.is_provisional) && bl.length
    ? await baselines.provisionalReasons(companyIdOf(req), bl[0].period_start, bl[0].period_end)
    : [];

  res.send(layout(p.title, `
    <header class="esg-page-header esg-enter">
      <div class="esg-page-header__text">
        <h2 class="esg-h1">${esc(p.title)}</h2>
        <p class="esg-page-header__intro">${esc(p.project_type_label || 'No project type set')} · ${esc(p.status)}</p>
      </div>
    </header>
    ${disclaimerBlock()}

    <!-- P8 MOVED THE PROGRESSION TO THE TOP. It used to sit between "potential
         financing routes" and "evidence", four screens down, so the one thing
         that answers "where am I and what is next" was the last thing read. -->
    ${projectMission(p, bl.length, 0)}

    <div class="card">
      <h3 class="section-title">What it is</h3>
      <p>${esc(p.description || 'No description recorded.')}</p>
      <p class="text-muted">Estimated cost: ${p.estimated_cost_myr === null
    ? '<span class="text-muted">not stated</span>'
    : 'RM ' + esc(Number(p.estimated_cost_myr).toLocaleString('en-MY', { minimumFractionDigits: 2 }))}</p>
    </div>

    <div class="card">
      <h3 class="section-title">Taxonomy classification</h3>
      ${classificationBlock(p)}
      ${CLASSIFY_OUTCOME[req.query.classify] || ''}
      <form method="post" action="${NAV}/projects/${esc(p.id)}/classify" style="margin-top:12px">
        <div class="form-group">
          <label for="cc">${esc(p.ccpt_category_code ? 'Reclassify under BNM CCPT' : 'Classify under BNM CCPT')}</label>
          <select id="cc" name="ccpt_category_code" required>
            <option value="">Choose a category</option>
            ${cats.rows.map((c) => `<option value="${esc(c.code)}"${
  p.ccpt_category_code === c.code ? ' selected' : ''}>${esc(c.code)} — ${esc(c.label_en)}</option>`).join('')}
          </select>
          <small class="text-muted">A person assigns this, and it is recorded against your name with
            the scheme version stamped on the project. No project type carries a default — none of
            the published sources states one.</small>
        </div>
        <button class="btn btn-outline" type="submit">Save classification</button>
      </form>
    </div>

    <div class="card">
      <h3 class="section-title">Energy baseline</h3>
      ${baselineBlock(bl, reasons, (anyEntries.rows[0] ? Number(anyEntries.rows[0].n) : 0) > 0)}
      <form method="post" action="${NAV}/projects/${esc(p.id)}/baseline">
        <div class="form-group">
          <label for="b-start">Period start</label>
          <input id="b-start" name="period_start" type="date" required>
        </div>
        <div class="form-group">
          <label for="b-end">Period end</label>
          <input id="b-end" name="period_end" type="date" required>
        </div>
        <button class="btn btn-outline" type="submit">Recompute baseline</button>
      </form>
      <p class="text-muted text-sm">Computed from your carbon entries by arithmetic. No part of it
         is generated by AI.</p>
    </div>

    <div class="card">
      <h3 class="section-title">Financing requirement</h3>
      ${FINANCING_OUTCOME[req.query.financing] || ''}
      <form method="post" action="${NAV}/projects/${esc(p.id)}/financing">
        <div class="form-group">
          <label for="fr">Financing required (MYR)</label>
          <input id="fr" name="financing_required_myr" type="number" step="0.01" min="0"
                 value="${esc(p.financing_required_myr ?? '')}">
          <small class="text-muted">How much of the cost you would finance. Blank clears it — an
            unanswered question is not a request for nothing.</small>
        </div>
        <div class="form-group">
          <label for="oc">Your own contribution (MYR)</label>
          <input id="oc" name="own_contribution_myr" type="number" step="0.01" min="0"
                 value="${esc(p.own_contribution_myr ?? '')}">
        </div>
        <div class="form-group">
          <label for="fp">Financing purpose</label>
          <select id="fp" name="financing_purpose">
            <option value="">Not stated</option>
            ${[['capex', 'Capital expenditure'], ['working_capital', 'Working capital'],
    ['refinancing', 'Refinancing'], ['mixed', 'Mixed']].map(([v, l]) =>
    `<option value="${esc(v)}"${p.financing_purpose === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>

        <h3 class="section-title">Expected benefit</h3>
        <p class="text-muted text-sm"><strong>Expected, not measured.</strong> This is what you
           believe the project will save before it exists. What it actually saved is measured from
           your carbon entries against the baseline below, and is never written from this form.</p>
        <div class="form-group">
          <label for="em">Metric</label>
          <select id="em" name="expected_benefit_metric">
            <option value="">Not stated</option>
            ${[['electricity_kwh', 'Electricity (kWh)'], ['fuel_litres', 'Fuel (litres)'],
    ['water_m3', 'Water (m³)'], ['waste_kg', 'Waste (kg)'], ['kg_co2e', 'Emissions (kg CO2e)']].map(([v, l]) =>
    `<option value="${esc(v)}"${p.expected_benefit_metric === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="ev-val">Expected saving per year</label>
          <input id="ev-val" name="expected_benefit_value" type="number" step="any" min="0"
                 value="${esc(p.expected_benefit_value ?? '')}">
        </div>
        <div class="form-group">
          <label for="eb">Where the figure comes from</label>
          <select id="eb" name="expected_benefit_basis">
            <option value="">Not stated</option>
            ${[['user_estimate', 'Our own estimate'], ['supplier_quotation', 'A supplier quotation'],
    ['engineering_study', 'An engineering study']].map(([v, l]) =>
    `<option value="${esc(v)}"${p.expected_benefit_basis === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
          <small class="text-muted">A quotation and a guess are not the same claim, so the platform
            records which one this is.</small>
        </div>
        <button class="btn btn-primary" type="submit">Save financing and expected benefit</button>
      </form>
    </div>

    <div class="card">
      <h3 class="section-title">Potential financing routes</h3>
      <p class="text-muted text-sm">Programmes whose published terms do not rule this project out.
         That is the whole claim — nothing here is an eligibility decision.</p>
      <p><a class="btn btn-outline" href="${NAV}/projects/${esc(p.id)}/routes">See potential routes</a></p>
    </div>

    <div class="card">
      <h3 class="section-title">Evidence</h3>
      ${ev.rows.length
    ? `<ul>${ev.rows.map((d) => `<li>${esc(d.filename)}</li>`).join('')}</ul>`
    : emptyState('instrumented_but_empty', {
      title: 'No evidence attached',
      body: 'You can attach documents you have already uploaded under Evidence. '
          + 'There is deliberately no second upload path here.' })}
      <p><a class="btn btn-outline" href="/documents">Go to Evidence</a></p>
    </div>
    <p><a class="btn btn-outline" href="${NAV}/projects">Back to projects</a></p>`,
  req.user, NAV));
}));

router.post('/green-finance/projects/:id/baseline', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.period_start && b.period_end) {
    await baselines.computeBaseline(req.params.id, companyIdOf(req), b.period_start, b.period_end);
  }
  res.redirect(`${NAV}/projects/${req.params.id}`);
}));

router.get('/green-finance/opportunities', wrap(async (req, res) => {
  const cid = companyIdOf(req);
  const { rows } = await query(
    `SELECT o.id, o.proposed_project_type_code, o.rationale_en, o.status, o.created_at,
            t.label_en AS project_type_label
       FROM esg_green_opportunities o
       LEFT JOIN esg_project_types t ON t.code = o.proposed_project_type_code
      WHERE o.company_id = $1 ORDER BY o.created_at DESC`, [cid]);
  const scan = await opp.lastScan(cid);

  // RULE 6, the user-facing half. A scan that FAILED must never be presented as
  // a scan that found nothing — that is pixel-identical output for two
  // completely different facts, and it is the carbonImportService defect.
  //
  // 'retrying' is reported as well as 'failed'. jobRunner leaves a job pending
  // between attempts, so keying on 'failed' alone said nothing about the first
  // two failures of three — the user saw an ordinary page while the analysis
  // had already failed twice. The two are worded differently because they are
  // different facts: one resolves itself, the other does not.
  const st = opp.scanState(scan);
  const failed = st.state === 'failed';
  const retrying = st.state === 'retrying';
  const notice = (failed || retrying)
    ? `<div class="alert alert-warning" role="alert"><div class="alert-body">
         <strong>${failed
    ? 'The AI suggestion run did not complete.'
    : `The last AI suggestion run failed and is being retried (attempt ${esc(st.attempts)} of ${esc(st.maxAttempts)}).`}</strong>
         Nothing below is missing because your company has no options — the analysis itself did not
         run, so there is nothing to show from it. Your projects and data are unaffected.${failed
    ? ''
    : ' Reload in a few minutes; if it keeps failing it will stop retrying and say so.'}
         <br><small class="text-muted">${esc(st.message || 'no message recorded')}</small>
       </div></div>`
    : '';

  const body = rows.length
    ? rows.map((o) => `<div class="mission-card" style="margin-bottom:12px">
        <div class="mission-title">${esc(o.project_type_label || o.proposed_project_type_code)}</div>
        <p>${esc(o.rationale_en || '')}</p>
        <p class="mission-meta">${esc(o.status)}</p>
        ${o.status === 'pending' ? `
        <div class="flex gap-2 flex-wrap">
          <form method="post" action="/green-finance/opportunities/${esc(o.id)}/accept">
            <button class="btn btn-primary" type="submit">Accept — create a project</button>
          </form>
          <form method="post" action="/green-finance/opportunities/${esc(o.id)}/reject">
            <button class="btn btn-outline" type="submit">Dismiss</button>
          </form>
        </div>` : ''}
      </div>`).join('')
    : ((failed || retrying) ? '' : emptyState('instrumented_but_empty', {
      title: 'No suggestions yet',
      body: 'The suggestion run is switched on and working — it has not proposed anything for this '
          + 'company. Run it below, or define a project yourself.' }));

  res.send(layout('AI suggestions', `
    <h2 class="page-title">AI suggestions</h2>
    ${disclaimerBlock()}
    ${notice}
    ${outcomeBanner(req.query.done)}
    <div class="card">
      <div class="card-body">
        <p>The model picks a <strong>project type</strong> from a fixed list and says why it might
           suit this company. <strong>It never estimates a cost, a saving or a payback period</strong>
           — it is not shown any of your figures, and there is nowhere in the database for a number it
           produced to be stored.</p>
        <p>A suggestion is a suggestion until you accept it. Accepting creates a draft project with no
           cost filled in.</p>
        <form method="post" action="/green-finance/opportunities/scan">
          <button class="btn btn-primary" type="submit">Run the suggestion scan</button>
        </form>
      </div>
    </div>
    ${body}`, req.user, NAV));
}));

// ── The three AI actions, as PAGE routes ───────────────────────────────────
// These deliberately duplicate no logic: each calls the same service function
// the /api handler calls. They exist because the buttons above are ordinary
// HTML form submits, and a form pointed at a JSON endpoint navigates the
// browser to the JSON. The user landed on a white page reading
// {"queued":true,"jobId":"..."} with no route back — the AI feature exited the
// application at the moment it was used.
//
// Answering a page POST with 303 + Location is the no-JavaScript version of an
// in-app interaction state: the browser returns here, the outcome is rendered
// as a banner, and a reload cannot re-fire the action. The module contract
// still holds — JSON lives in routes/api.js, and these return no JSON at all.
const backToOpportunities = (res, done) =>
  res.redirect(303, `/green-finance/opportunities?done=${done}`);

router.post('/green-finance/opportunities/scan', wrap(async (req, res) => {
  const jobId = await opp.queueScan(companyIdOf(req), req.user.id);
  if (jobId) setImmediate(() => runOnce().catch((e) => console.error('opportunity scan:', e.message)));
  // null means a scan for THIS company is already queued or running. Reported
  // as its own outcome rather than as success: "already running" and "started"
  // are different facts and must not render identically.
  backToOpportunities(res, jobId ? 'scan-queued' : 'scan-already');
}));

router.post('/green-finance/opportunities/:id/accept', wrap(async (req, res) => {
  const created = await opp.acceptOpportunity(req.params.id, req.user.id, companyIdOf(req));
  backToOpportunities(res, created ? 'accepted' : 'not-found');
}));

router.post('/green-finance/opportunities/:id/reject', wrap(async (req, res) => {
  const row = await opp.rejectOpportunity(req.params.id, req.user.id, companyIdOf(req));
  backToOpportunities(res, row ? 'rejected' : 'not-found');
}));


/* ═══════════════════════════════════════════════════════════════════════════
   GREEN FINANCE READINESS                                       (Run 62/P6.5)
   ───────────────────────────────────────────────────────────────────────────
   The engine's own surface: what was assessed, what could not be, and the one
   place a company supplies the financial facts nothing else in this platform
   holds.

   IT SHOWS ITS WORKING. Every criterion states its earned and assessable
   points and every unassessable input says why, because a readiness figure a
   company cannot interrogate is one it cannot use in a financing conversation.

   IT IS NOT A CREDIT ASSESSMENT. disclaimerBlock() renders on this page as on
   every other financing surface.
   ═══════════════════════════════════════════════════════════════════════════ */

const READINESS_STATE_WORD = Object.freeze({
  not_configured:     'Not configured',
  insufficient_data:  'Data required',
  partially_assessed: 'Partly assessed',
  calculated:         'Calculated',
});

const CRITERION_STATE_WORD = Object.freeze({
  data_required:      'Data required',
  partially_assessed: 'Partly assessed',
  assessed:           'Assessed',
});

/** The inputs a person supplies. Rendered from the MODEL, so an input added
 *  there appears here with no edit — and one removed stops being asked for. */
function inputRow(def, criterion, row) {
  const id = `fi_${def.code}`;
  const state = row ? row.state : null;
  const checked = (v) => (state === v ? ' checked' : '');
  // A date and a number are not yes/no questions; everything else here is.
  const control = def.code === 'incorporation_date'
    ? `<input id="${esc(id)}" name="${esc(id)}" type="date" value="${esc(row && row.value_date ? dayOf(row.value_date) : '')}">`
    : (def.code === 'trading_years'
      ? `<input id="${esc(id)}" name="${esc(id)}" type="number" min="0" step="1" value="${esc(row && row.value_numeric !== null && row.value_numeric !== undefined ? row.value_numeric : '')}">`
      : (def.code === 'revenue_trend'
        ? `<select id="${esc(id)}" name="${esc(id)}">
             <option value="">Not stated</option>
             <option value="up"${row && row.value_text === 'up' ? ' selected' : ''}>Growing</option>
             <option value="flat"${row && row.value_text === 'flat' ? ' selected' : ''}>Flat</option>
             <option value="down"${row && row.value_text === 'down' ? ' selected' : ''}>Falling</option>
           </select>`
        : `<select id="${esc(id)}" name="${esc(id)}">
             <option value="">Not stated</option>
             <option value="yes"${row && row.value_bool === true ? ' selected' : ''}>Yes</option>
             <option value="no"${row && row.value_bool === false ? ' selected' : ''}>No</option>
           </select>`));

  return `<div class="esg-q">
    <div class="esg-q__head">
      <span class="esg-q__text">${esc(def.label)}</span>
      <span class="esg-astate esg-astate--${state === 'verified' ? 'verified' : (state ? 'declared' : 'missing')}">${
  esc(state ? { verified: 'Verified', provided: 'Provided', declined: 'Declined', not_applicable: 'Not applicable' }[state] : 'Not supplied')}</span>
      <span class="esg-q__map">${esc(def.points)} pts · ${esc(criterion.name)}</span>
    </div>
    <div class="esg-q__controls">
      <div class="esg-q__control"><label for="${esc(id)}">Your answer</label>${control}</div>
      <div class="esg-q__control">
        <label for="st_${esc(def.code)}">State</label>
        <select id="st_${esc(def.code)}" name="st_${esc(def.code)}">
          <option value="provided"${checked('provided') || (!state ? ' selected' : '')}>Provided</option>
          <option value="not_applicable"${checked('not_applicable')}>Not applicable</option>
          <option value="declined"${checked('declined')}>Prefer not to say</option>
        </select>
      </div>
      <span></span>
    </div>
  </div>`;
}

router.get('/green-finance/readiness', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const result = await readiness.calculate(companyId);

  if (!result) {
    return res.send(layout('Green Finance Readiness',
      `<div class="esg-page">${disclaimerBlock()}${emptyState('uninstrumented', {
        title: 'No company to assess',
        body: 'Readiness is computed for a company, and this account is not attached to one.' })}</div>`,
      req.user, NAV));
  }

  const stored = Object.fromEntries((await query(
    `SELECT input_code, value_numeric, value_text, value_bool, value_date, state
       FROM esg_finance_inputs WHERE company_id = $1`, [companyId])).rows.map((r) => [r.input_code, r]));

  const calculated = result.score !== null;
  const gap = result.maximum - result.assessable;

  // THE HEADLINE. A number ONLY when the engine says every criterion could be
  // assessed; otherwise the two real figures and the size of what is missing.
  const headline = calculated
    ? `<div class="esg-hero__score">
         ${`<div class="score-ring score-ring--hero" style="--score:${Math.round(result.score)}" role="img" aria-label="Readiness ${Math.round(result.score)} out of 100"><div class="score-ring-figure"><span class="score-ring-value">${Math.round(result.score)}</span><span class="score-ring-den">/100</span></div></div>`}
         <div class="esg-score__band">
           <span class="esg-chip esg-chip--done">${esc(READINESS_STATE_WORD[result.status])}</span>
           <span class="esg-score__basis">Every criterion in the model could be assessed. This is a
             readiness assessment, never a financing approval.</span>
         </div>
       </div>`
    : `<div>
         <span class="esg-chip esg-chip--caution">${esc(READINESS_STATE_WORD[result.status] || 'Not configured')}</span>
         <h2 class="esg-hero__headline" style="margin-top:12px">${esc(result.earned)} of ${esc(result.assessable)} assessable points</h2>
         <p class="esg-hero__sub">${esc(gap)} of the model&rsquo;s ${esc(result.maximum)} points cannot be
           assessed yet. Those points are not lost and they are not scored against you — the platform
           simply has nothing to look at. No overall figure is published until it does.</p>
       </div>`;

  const criteriaBlocks = result.criteria.map((c) => `
    <div class="esg-card"><div class="esg-card__body">
      <div class="esg-q__head" style="margin-bottom:8px">
        <span class="esg-q__text">${esc(c.name)}</span>
        <span class="esg-astate esg-astate--${c.status === 'assessed' ? 'verified' : (c.status === 'data_required' ? 'missing' : 'declared')}">${
  esc(CRITERION_STATE_WORD[c.status])}</span>
        <span class="esg-q__map">${c.status === 'data_required'
    ? `0 of ${esc(c.weight)} assessable`
    : `${esc(c.earned)} of ${esc(c.assessable)} assessable · ceiling ${esc(c.weight)}`}</span>
      </div>
      <p class="esg-q__guide">${esc(c.explanation)}</p>
      ${c.assessable ? `<span class="esg-progress" role="img"
        aria-label="${esc(c.earned)} of a possible ${esc(c.weight)} points, of which ${esc(c.assessable)} could be assessed"
        ><span class="esg-progress__fill" style="width:${esc(Math.round((c.earned / c.weight) * 100))}%"></span></span>
        <span class="esg-meta">Filled against the ${esc(c.weight)}-point ceiling, not against what was
        assessable — a bar drawn to earned-over-assessable showed Financial bankability FULL while
        32 of its 40 points could not be looked at.</span>` : ''}
      <details class="esg-evidence">
        <summary>What was read for this</summary>
        <div class="esg-evidence__body">
          ${c.inputs.map((i) => `<span class="esg-evidence__k">${esc(i.label)}</span>
            <span class="esg-evidence__v">${i.assessable
    ? `${esc(i.earned)} of ${esc(i.points)} — ${esc(i.detail || 'assessed')}`
    : `<em>not assessable</em> — ${esc(i.detail || 'nothing recorded')}`}</span>`).join('')}
        </div>
      </details>
    </div></div>`).join('');

  const userInputs = model.CRITERIA.flatMap((c) =>
    c.inputs.filter((i) => i.from === 'esg_finance_inputs').map((i) => inputRow(i, c, stored[i.code])));

  res.send(layout('Green Finance Readiness', `
    <div class="esg-page">
      ${disclaimerBlock()}
      ${req.query.saved ? `<div class="alert alert-success" role="status" aria-live="polite">
        <div class="alert-body"><strong>Saved.</strong> Readiness has been recomputed from what you supplied.</div></div>` : ''}

      <section class="esg-hero esg-enter">
        ${headline}
        <div class="esg-next">
          <span class="esg-next__label">Model</span>
          <h3 class="esg-next__title">The platform&rsquo;s readiness framework, version ${esc(result.modelVersion)}</h3>
          <p class="esg-next__why">Six criteria totalling ${esc(result.maximum)} points. These weights are
            this platform&rsquo;s own view of what a financing conversation needs — they are not any
            institution&rsquo;s scoring formula, and no institution has seen them.</p>
        </div>
      </section>

      <section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">How it was assessed</h2>
          <span class="esg-section__note">Every point traced to what produced it</span>
        </div>
        <div class="esg-stack">${criteriaBlocks}</div>
      </section>

      ${result.missingData.length ? `<section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">What would raise it</h2>
          <span class="esg-section__note">Ordered by the points each would unlock</span>
        </div>
        <div class="esg-card"><div class="esg-card__body">
          ${result.recommendations.map((r) => `<div class="esg-rec">
            <span class="esg-rec__points esg-num">+${esc(r.points)}</span>
            <span class="esg-rec__head">${esc(r.action)}</span>
            <span class="esg-chip esg-chip--blocked">${esc(r.criterion)}</span>
            <p class="esg-rec__text">${esc(r.why)}</p>
          </div>`).join('')}
        </div></div>
      </section>` : ''}

      <section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">Financial information</h2>
          <span class="esg-section__note">Supplied by you · nothing here is shared with any institution</span>
        </div>
        <form method="post" action="/green-finance/readiness">
          <div class="esg-stack-tight">${userInputs.join('')}</div>
          <div class="esg-row" style="margin-top:16px">
            <button class="btn btn-primary" type="submit">Save and recompute</button>
          </div>
        </form>
      </section>
    </div>`, req.user, NAV));
}));

router.post('/green-finance/readiness', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const b = req.body || {};

  // ONLY codes the MODEL declares as user-supplied are accepted. A field name
  // that is not in the model is ignored rather than written — the table must
  // never hold an input the engine has no evaluator for.
  for (const code of model.USER_SUPPLIED_CODES) {
    const raw = b[`fi_${code}`];
    const state = ['provided', 'not_applicable', 'declined'].includes(b[`st_${code}`])
      ? b[`st_${code}`] : 'provided';

    const blank = raw === undefined || raw === null || String(raw).trim() === '';
    // A blank answer at state 'provided' is NOT a recorded value — it is the
    // absence of one, so the row is removed rather than stored as a false zero.
    if (blank && state === 'provided') {
      await query(`DELETE FROM esg_finance_inputs WHERE company_id = $1 AND input_code = $2`,
        [companyId, code]);
      continue;
    }

    let num = null; let txt = null; let bool = null; let date = null;
    if (code === 'incorporation_date') date = blank ? null : String(raw);
    else if (code === 'trading_years') num = blank ? null : Number(raw);
    else if (code === 'revenue_trend') txt = blank ? null : String(raw);
    else bool = blank ? null : String(raw) === 'yes';

    await query(
      `INSERT INTO esg_finance_inputs
         (company_id, input_code, value_numeric, value_text, value_bool, value_date,
          state, source, provided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'user_input',$8)
       ON CONFLICT (company_id, input_code) DO UPDATE SET
         value_numeric = EXCLUDED.value_numeric,
         value_text    = EXCLUDED.value_text,
         value_bool    = EXCLUDED.value_bool,
         value_date    = EXCLUDED.value_date,
         state         = EXCLUDED.state,
         source        = EXCLUDED.source,
         provided_by   = EXCLUDED.provided_by`,
      [companyId, code, num, txt, bool, date, state, req.user.id]);
  }
  res.redirect(303, '/green-finance/readiness?saved=1');
}));


/* ═══════════════════════════════════════════════════════════════════════════
   THE GREEN PROJECT WORKFLOW                                    (Run 62/P6.6)
   ───────────────────────────────────────────────────────────────────────────
   Green Project Eligibility was the binding constraint in the readiness model,
   and the reason was not the model: NOTHING IN THIS CODEBASE COULD WRITE A
   CLASSIFICATION. esg_green_projects carried ccpt_category_code and
   classification_basis, classificationBlock() rendered them, the taxonomy
   reference tables were seeded — and no route ever set them, so no project
   could become classified and the readiness criterion could never be earned.

   The three writers below close that. They do not change the scoring model.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The mission strip: where this project is in its own six steps.
 *
 *  Each step is a FACT about the project row, not a stored counter — the same
 *  rule the journey engine follows. */
function projectMission(p, baselineCount, routeCount) {
  const steps = [
    { n: 1, label: 'Project identified', done: true, why: 'It exists and has a title' },
    { n: 2, label: 'Type chosen', done: Boolean(p.project_type_id), why: 'A lender asks what kind of project this is' },
    { n: 3, label: 'Classified', done: Boolean(p.ccpt_category_code), why: 'Against the taxonomy a lender will ask under' },
    { n: 4, label: 'Cost estimated', done: p.estimated_cost_myr !== null && p.estimated_cost_myr !== undefined, why: 'What the project costs to build' },
    { n: 5, label: 'Financing need stated', done: p.financing_required_myr !== null && p.financing_required_myr !== undefined, why: 'How much of that cost you would finance' },
    { n: 6, label: 'Baseline computed', done: baselineCount > 0, why: 'What the project is measured against afterwards' },
  ];
  const done = steps.filter((s) => s.done).length;

  /* P8 · §19's TRACK, and the same component the document analysis uses.
     A green project's definition is a named sequence of states exactly as an
     analysis is, so it is the same object and it now looks like one. The
     CURRENT step is the first one not done — which is what makes the next
     action visible without a second sentence telling the reader where to look.

     The progress bar was removed rather than restyled. Six discrete facts have
     no continuous quantity between them, and a 50% bar over "cost estimated"
     and "financing need stated" invites the reading that the project is half
     financed. The ratio is still stated, in words, in the section note. */
  const nextIndex = steps.findIndex((s) => !s.done);
  const stateOf = (s, i) => (s.done ? 'done' : i === nextIndex ? 'current' : 'future');

  return `<section class="esg-section esg-enter">
    <div class="esg-section__head">
      <h2 class="esg-section__title">Where this project stands</h2>
      <span class="esg-section__note">${esc(done)} of ${esc(steps.length)} steps · a definition, never an application</span>
    </div>
    <div class="esg-card"><div class="esg-card__body">
      <ol class="esg-track" aria-label="Project definition progress">
        ${steps.map((s, i) => `<li class="esg-track__step esg-track__step--${stateOf(s, i)}" style="--esg-i:${i}">
          <span class="esg-track__name">${esc(s.label)}</span>
          <span class="esg-track__state">${esc(s.done ? 'Done' : i === nextIndex ? 'Next' : 'Not yet')} · ${esc(s.why)}</span>
        </li>`).join('')}
      </ol>
    </div></div>
  </section>`;
}

/** Classify the project against the taxonomy a lender asks under.
 *
 *  HUMAN ASSIGNED, ALWAYS. classification_basis admits 'project_type_default'
 *  too, but no project type carries a default — none of the published sources
 *  states one — so writing that value here would record a determination nobody
 *  made. The version is STAMPED from the scheme row at the moment of
 *  classification, never joined at read time, so a later revision of the
 *  taxonomy cannot silently reinterpret a project already classified. */
router.post('/green-finance/projects/:id/classify', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const { rows: owned } = await query(
    `SELECT id FROM esg_green_projects WHERE id = $1 AND company_id = $2`, [req.params.id, companyId]);
  if (!owned[0]) return res.status(404).send(layout('Not found',
    emptyState('zero', { title: 'Project not found', body: 'It may belong to another company.' }),
    req.user, NAV));

  const code = String((req.body && req.body.ccpt_category_code) || '').trim();
  if (!code) return res.redirect(303, `${NAV}/projects/${req.params.id}?classify=none`);

  // The code must be one this scheme actually publishes, and the version comes
  // from the scheme row rather than from the form.
  const { rows: cat } = await query(
    `SELECT c.code, s.version
       FROM esg_taxonomy_categories c
       JOIN esg_taxonomy_schemes s ON s.id = c.scheme_id
      WHERE c.code = $1 AND s.code = 'CCPT' AND s.is_current`, [code]);
  if (!cat[0]) return res.redirect(303, `${NAV}/projects/${req.params.id}?classify=unknown`);

  await query(
    `UPDATE esg_green_projects
        SET ccpt_category_code = $2, ccpt_scheme_version = $3,
            classification_basis = 'human_assigned',
            classified_by = $4, classified_at = now()
      WHERE id = $1`, [req.params.id, cat[0].code, cat[0].version, req.user.id]);
  res.redirect(303, `${NAV}/projects/${req.params.id}?classify=saved`);
}));

/** The financing requirement and the EXPECTED benefit.
 *
 *  Expected is not actual: this is what the company believes the project will
 *  save before it exists, and expected_benefit_basis records whether that came
 *  from a guess, a supplier's quotation or an engineering study. The measured
 *  result lives in esg_green_project_baselines and is never written here. */
router.post('/green-finance/projects/:id/financing', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const { rows: owned } = await query(
    `SELECT id, estimated_cost_myr FROM esg_green_projects WHERE id = $1 AND company_id = $2`,
    [req.params.id, companyId]);
  if (!owned[0]) return res.status(404).send(layout('Not found',
    emptyState('zero', { title: 'Project not found', body: 'It may belong to another company.' }),
    req.user, NAV));

  const b = req.body || {};
  // A blank field CLEARS the value rather than storing a zero. An unanswered
  // "how much do you need" is not a request for nothing.
  const num = (v) => {
    const t = String(v === undefined || v === null ? '' : v).trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const pick = (v, allowed) => (allowed.includes(String(v)) ? String(v) : null);

  await query(
    `UPDATE esg_green_projects
        SET financing_required_myr = $2, own_contribution_myr = $3, financing_purpose = $4,
            expected_benefit_metric = $5, expected_benefit_value = $6, expected_benefit_basis = $7
      WHERE id = $1`,
    [req.params.id,
      num(b.financing_required_myr), num(b.own_contribution_myr),
      pick(b.financing_purpose, ['capex', 'working_capital', 'refinancing', 'mixed']),
      pick(b.expected_benefit_metric, ['electricity_kwh', 'fuel_litres', 'water_m3', 'waste_kg', 'kg_co2e']),
      num(b.expected_benefit_value),
      pick(b.expected_benefit_basis, ['user_estimate', 'supplier_quotation', 'engineering_study'])]);
  res.redirect(303, `${NAV}/projects/${req.params.id}?financing=saved`);
}));

/** Potential financing routes for one project. A separate page because the
 *  register is long and the reasoning per programme is the point of it. */
router.get('/green-finance/projects/:id/routes', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const result = await financeMatch.potentialRoutes(companyId, req.params.id);
  if (!result) return res.status(404).send(layout('Not found',
    emptyState('zero', { title: 'Project not found', body: 'It may belong to another company.' }),
    req.user, NAV));

  const { context: ctx } = result;
  const card = (c) => `
    <div class="esg-card"><div class="esg-card__body">
      <div class="esg-q__head">
        <span class="esg-q__text">${esc(c.product.institution_name)} — ${esc(c.product.product_name)}</span>
        <span class="esg-astate esg-astate--${c.unknownChecks ? 'declared' : 'verified'}">${
  esc(c.unknownChecks ? `${c.knownChecks} of ${c.knownChecks + c.unknownChecks} terms published` : 'All terms published')}</span>
      </div>
      <p class="esg-q__guide">${esc(copy.FINANCING_TYPE_LABELS[c.product.financing_type] || c.product.financing_type)}
        · ${esc(copy.BORROWER_SCOPE_LABELS[c.product.borrower_scope] || c.product.borrower_scope)}</p>
      <details class="esg-evidence">
        <summary>Why it was not ruled out</summary>
        <div class="esg-evidence__body">
          ${c.checks.map((k) => `<span class="esg-evidence__k">${esc(k.label)}</span>
            <span class="esg-evidence__v">${k.verdict === 'unknown'
    ? `<em>not published</em> — ${esc(k.why)}`
    : esc(k.why)}</span>`).join('')}
          <span class="esg-evidence__k">Source</span>
          <span class="esg-evidence__v"><a href="${esc(c.product.source_url)}" rel="noopener noreferrer" target="_blank">${
  esc(c.product.source_publisher)}</a>, last read ${esc(dayOf(c.product.last_verified))}</span>
        </div>
      </details>
    </div></div>`;

  res.send(layout('Potential financing routes', `
    <div class="esg-page">
      ${disclaimerBlock()}
      <section class="esg-hero esg-enter">
        <div>
          <p class="esg-hero__eyebrow">${esc(ctx.projectTitle)}</p>
          <h2 class="esg-hero__headline">${esc(result.candidates.length)} of ${esc(result.totalProducts)} programmes are not ruled out</h2>
          <p class="esg-hero__sub">Not ruled out is the whole claim. Each one below survived every
            check that its own institution publishes enough information to make — nothing here has
            been discussed with any institution, and none of it is an eligibility decision.</p>
        </div>
        <div class="esg-next">
          <span class="esg-next__label">What was not checked</span>
          <h3 class="esg-next__title">Whether the facility covers this kind of project</h3>
          <p class="esg-next__why">The register records what each institution publishes, and none of
            them publishes which project categories its facility covers. That mapping is a judgement
            nobody has made, so it is not made here.</p>
          <div class="esg-next__actions">
            <a class="btn btn-outline" href="${NAV}/projects/${esc(ctx.projectId)}">Back to the project</a>
          </div>
        </div>
      </section>

      ${ctx.financingRequired === null ? `<div class="esg-ai esg-ai--idle">
        <span class="esg-ai__dot" style="color:var(--esg-caution)" aria-hidden="true"></span>
        <div class="esg-ai__body">
          <p class="esg-ai__title">No financing requirement stated</p>
          <p class="esg-ai__detail">Two of the five checks — the published minimum and maximum —
            cannot run without one, so every programme below is shown with those terms unchecked
            rather than passed.</p>
        </div></div>` : ''}

      <section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">Not ruled out</h2>
          <span class="esg-section__note">Most-checkable first · a programme that publishes nothing is not a better match</span>
        </div>
        ${result.candidates.length
    ? `<div class="esg-stack">${result.candidates.map(card).join('')}</div>`
    : emptyState('zero', { title: 'Every programme was ruled out',
      body: 'Each one is excluded by a term its own institution publishes. The reasons are listed below.' })}
      </section>

      ${result.excluded.length ? `<section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">Ruled out, and why</h2>
          <span class="esg-section__note">${esc(result.excluded.length)} programmes</span>
        </div>
        <div class="esg-card"><div class="esg-card__body">
          ${result.excluded.map((c) => `<div class="esg-rec">
            <span class="esg-rec__head">${esc(c.product.institution_name)} — ${esc(c.product.product_name)}</span>
            <span class="esg-astate esg-astate--dismissed">Ruled out</span>
            <p class="esg-rec__text">${esc(c.exclusions.join('. '))}.</p>
          </div>`).join('')}
        </div></div>
      </section>` : ''}
    </div>`, req.user, NAV));
}));


/* ═══════════════════════════════════════════════════════════════════════════
   ESG IMPACT                                                       (Run 62/P7)
   ───────────────────────────────────────────────────────────────────────────
   Expected, baseline and actual, kept apart on the page as strictly as they are
   kept apart in the database. The comparison a reader is shown is between two
   MEASUREMENTS; the forecast is reported separately, as forecast accuracy.
   ═══════════════════════════════════════════════════════════════════════════ */

const IMPACT_OUTCOME = Object.freeze({
  measured: '<div class="alert alert-success" role="status" aria-live="polite"><div class="alert-body">'
    + '<strong>Measurement recorded.</strong> It is derived from your carbon entries for that period '
    + 'and is marked measured, not verified — a person confirms it separately.</div></div>',
  empty: '<div class="alert alert-warning" role="alert"><div class="alert-body">'
    + '<strong>No carbon entries in that period.</strong> Nothing was recorded — a measurement with '
    + 'no readings behind it would be a claim about a period nobody measured.</div></div>',
  verified: '<div class="alert alert-success" role="status" aria-live="polite"><div class="alert-body">'
    + '<strong>Measurement verified.</strong> It is now recorded against your name.</div></div>',
  notfound: '<div class="alert alert-warning" role="alert"><div class="alert-body">'
    + '<strong>That measurement is no longer there.</strong> Nothing was changed.</div></div>',
});

/** One figure, with the status word that says what kind of figure it is. */
/* P8 MOVED THIS ONTO §20's .esg-fact, and the reason is the locked principle
   rather than the styling. EXPECTED ≠ MEASURED ≠ VERIFIED, and .esg-tally is a
   row of bare numbers with no edge between them — three figures in one strip
   read as three readings of ONE thing, which invites exactly the reading the
   principle forbids: that the forecast turned into the measurement.

   Each figure is now a bounded cell with its own provenance line, and the one
   that does not exist renders as a DASHED cell saying what is absent rather
   than as an em-dash in a row of solid ones. Nothing about the arithmetic
   changed; nothing here computes anything at all. */
function figure(label, value, unit, status, meta) {
  const absent = value === null || value === undefined;
  // The top edge is the only colour, and it separates DERIVED from CONFIRMED.
  // An expected figure gets no colour at all, because a forecast is not a
  // measurement and must not look like the beginning of one.
  const tone = absent ? ' esg-fact--absent'
    : status === 'verified' ? ' esg-fact--verified'
      : status === 'measured' ? ' esg-fact--measured' : '';
  const WORD = { expected: 'Expected', measured: 'Measured', verified: 'Verified', missing: 'Not measured' };
  return `<div class="esg-fact${tone}">
    <span class="esg-fact__label">${esc(label)}</span>
    <span class="esg-fact__value esg-num">${absent
    ? esc(WORD[status] || 'Not measured')
    : `${esc(Number(value).toLocaleString('en-MY'))}${unit ? ` <span class="esg-unit">${esc(unit)}</span>` : ''}`}</span>
    ${absent ? '' : `<span class="esg-astate esg-astate--${
  esc({ expected: 'declared', measured: 'documented', verified: 'verified' }[status] || 'missing')}${
  status === 'verified' ? ' esg-settled' : ''}">${esc(WORD[status] || status)}</span>`}
    ${meta ? `<span class="esg-fact__from">${esc(meta)}</span>` : ''}
  </div>`;
}

function impactCard(pic) {
  const p = pic.project;
  const comparisons = pic.comparisons.length ? pic.comparisons.map((c) => `
    <div class="esg-card esg-card--quiet"><div class="esg-card__body">
      <div class="esg-q__head">
        <span class="esg-q__text">${esc(c.label)}</span>
        <span class="esg-q__map">${esc(c.unit)}</span>
      </div>
      <div class="esg-facts">
        ${pic.expected && pic.expected.metric === c.metric
    ? figure('Expected saving', pic.expected.value, c.unit, 'expected',
      pic.expected.basisLabel || 'Basis not stated')
    : figure('Expected saving', null, c.unit, 'missing', 'No forecast for this metric')}
        ${c.baseline
    ? figure('Baseline', c.baseline.value, c.unit, 'measured', `${c.baseline.period} · ${c.baseline.source}`)
    : figure('Baseline', null, c.unit, 'missing', 'Not measured yet')}
        ${c.actual
    ? figure('Actual', c.actual.value, c.unit, c.actual.status,
      `${c.actual.period} · ${c.actual.source}${c.actual.verifiedBy ? ` · verified by ${c.actual.verifiedBy}` : ''}`)
    : figure('Actual', null, c.unit, 'missing', 'Nothing measured since implementation')}
      </div>

      ${c.change !== null ? `<p class="esg-q__guide" style="margin-top:12px">
        <strong>Change against the baseline: ${esc(c.change > 0 ? '+' : '')}${esc(Number(c.change).toLocaleString('en-MY'))} ${esc(c.unit)}.</strong>
        Both figures are measurements over their own periods. This is the impact — it is not the
        forecast, and the forecast was not used to produce it.</p>` : ''}

      ${c.forecast ? `<details class="esg-evidence">
        <summary>How the forecast compared</summary>
        <div class="esg-evidence__body">
          <span class="esg-evidence__k">Expected</span>
          <span class="esg-evidence__v">${esc(Number(c.forecast.expected).toLocaleString('en-MY'))} ${esc(c.unit)} — a forecast made before the project existed</span>
          <span class="esg-evidence__k">Actual</span>
          <span class="esg-evidence__v">${esc(Number(c.forecast.actual).toLocaleString('en-MY'))} ${esc(c.unit)} — measured over a defined period</span>
          <span class="esg-evidence__k">Difference</span>
          <span class="esg-evidence__v">${esc(c.forecast.difference > 0 ? '+' : '')}${esc(Number(c.forecast.difference).toLocaleString('en-MY'))} ${esc(c.unit)}.
            This is FORECAST ACCURACY, not impact — comparing a measurement against an estimate says
            how good the estimate was, not what the project achieved.</span>
        </div>
      </details>` : ''}

      ${c.actual && c.actual.status === 'measured' ? `
      <form method="post" action="${NAV}/projects/${esc(p.id)}/measurements/${esc(c.actual.id)}/verify" style="margin-top:12px">
        <button class="btn btn-outline" type="submit">Confirm this reading</button>
        <span class="esg-meta">Measured means the platform derived it. Verified means a person checked it.</span>
      </form>` : ''}
    </div></div>`).join('') : emptyState('instrumented_but_empty', {
    title: 'Nothing to compare yet',
    body: 'Impact is a measurement against a baseline. Neither has been recorded for this project, '
        + 'so there is nothing to compare — and a forecast on its own is not an impact.' });

  return `<section class="esg-section">
    <div class="esg-section__head">
      <h2 class="esg-section__title">${esc(p.title)}</h2>
      <span class="esg-section__note">${esc(p.status)} · ${esc(pic.counts.actuals)} reading${
  pic.counts.actuals === 1 ? '' : 's'}${pic.counts.verified ? `, ${esc(pic.counts.verified)} verified` : ''}</span>
    </div>

    <div class="esg-card"><div class="esg-card__body">
      <div class="esg-ladder">
        ${pic.stages.map((s, i) => `<div class="esg-ladder__step${s.reached ? ' esg-ladder__step--ours' : ' esg-ladder__step--not-ours'}">
          <span class="esg-ladder__n">${esc(pad2(i + 1))}</span>
          <div><div class="esg-ladder__what">${esc(s.label)}</div>
               <div class="esg-ladder__who">${esc(s.why)}</div></div>
          <span class="esg-astate esg-astate--${s.current ? 'review' : (s.reached ? 'verified' : (s.blocked ? 'na' : 'missing'))}">${
  esc(s.current ? 'You are here' : (s.reached ? 'Done' : (s.blocked ? 'Not built' : 'Not yet')))}</span>
        </div>`).join('')}
      </div>
    </div></div>

    ${comparisons}

    <div class="esg-card"><div class="esg-card__body">
      <h3 class="esg-card__title">Record a reading</h3>
      <p class="esg-q__guide">A reading is derived from the carbon entries you have already recorded
        for the period you choose. Nothing is copied from the forecast, and a period with no entries
        records nothing at all.</p>
      <form method="post" action="${NAV}/projects/${esc(p.id)}/measure">
        <div class="esg-q__controls">
          <div class="esg-q__control"><label for="ms-${esc(p.id)}">Period start</label>
            <input id="ms-${esc(p.id)}" name="period_start" type="date" required></div>
          <div class="esg-q__control"><label for="me-${esc(p.id)}">Period end</label>
            <input id="me-${esc(p.id)}" name="period_end" type="date" required></div>
          <button class="btn btn-primary" type="submit">Record</button>
        </div>
      </form>
    </div></div>
  </section>`;
}

router.get('/impact', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const pictures = await impact.forCompany(companyId);

  const { rows: ctx } = await query(
    `SELECT (SELECT count(*)::int FROM esg_scores s
               JOIN esg_assessments a ON a.id = s.assessment_id
              WHERE a.company_id = $1 AND s.scope = 'OVERALL') AS scored,
            (SELECT count(*)::int FROM esg_green_projects WHERE company_id = $1) AS projects`,
    [companyId]);
  const verified = pictures.reduce((n, p) => n + p.counts.verified, 0);
  const sustnet = frameworks.statusFor(frameworks.SUSTNET,
    { scored: ctx[0].scored > 0, projects: ctx[0].projects, verifiedImpacts: verified });
  const cert = frameworks.statusFor(frameworks.CERTIFICATION,
    { scored: ctx[0].scored > 0, projects: ctx[0].projects, verifiedImpacts: verified });

  const reservedBlock = (f, pillars) => `
    <div class="esg-reserved">
      <span class="esg-reserved__mark" aria-hidden="true">${icon(pillars ? 'journey' : 'governance')}</span>
      <div>
        <h3 class="esg-reserved__title">${esc(f.name)}</h3>
        <p class="esg-reserved__body">${esc(f.explanation)}</p>
        <p class="esg-meta" style="margin-top:8px">Becomes available when: ${esc(f.precondition)}.</p>
        <ul class="esg-readiness__gaps" style="margin-top:10px">
          ${f.foundation.map((x) => `<li class="esg-readiness__gap">
            <span class="esg-chip esg-chip--${x.present ? 'done' : 'blocked'}">${x.present ? 'Built' : 'Not yet'}</span>
            ${esc(x.label)}</li>`).join('')}
        </ul>
        <p class="esg-meta" style="margin-top:8px">These are facts about your own data, not progress
          toward the framework — there is no framework to progress toward yet.</p>
      </div>
      <span class="esg-reserved__status">${esc(f.statusLabel)}</span>
      ${pillars ? `<div class="esg-pillars-named">
        ${pillars.map((p) => `<span class="esg-pillar-name">${esc(p.label)}</span>`).join('')}
      </div>` : ''}
    </div>`;

  res.send(layout('ESG Impact', `
    <div class="esg-page">
      ${IMPACT_OUTCOME[req.query.done] || ''}

      <div class="esg-ai esg-ai--idle">
        <span class="esg-ai__dot" style="color:var(--border-2)" aria-hidden="true"></span>
        <div class="esg-ai__body">
          <p class="esg-ai__title">Expected is not actual</p>
          <p class="esg-ai__detail">A forecast is what you thought a project would save before it
            existed. An actual is a reading over a defined period, derived from the carbon entries
            you recorded. This platform keeps them in different places and never turns one into the
            other — so a project can show a confident forecast and no impact at all, and that is the
            honest picture rather than a gap.</p>
        </div>
      </div>

      ${pictures.length
    ? pictures.map(impactCard).join('')
    : `<section class="esg-section">
        <div class="esg-section__head"><h2 class="esg-section__title">No green projects yet</h2></div>
        ${emptyState('instrumented_but_empty', {
    title: 'Impact is measured against a project',
    body: 'There is nothing to measure until a project exists. Define one, record what it will be '
        + 'measured against, and readings can then be taken for periods after it is implemented.' })}
        <div class="esg-row"><a class="btn btn-primary" href="${NAV}/projects/new">Define a green project</a></div>
      </section>`}

      <section class="esg-section">
        <div class="esg-section__head">
          <h2 class="esg-section__title">Reserved for what comes next</h2>
          <span class="esg-section__note">Defined, and deliberately not yet operational</span>
        </div>
        <div class="esg-stack">
          ${reservedBlock(sustnet, frameworks.SUSTNET.pillars)}
          ${reservedBlock(cert, null)}
        </div>
      </section>
    </div>`, req.user, '/impact'));
}));

/** Record an ACTUAL reading for a period.
 *
 *  Derived from carbon entries exactly as a baseline is — the same function,
 *  the same provenance, a different kind. Nothing is copied from the project's
 *  forecast, and a period with no entries writes nothing rather than a zero. */
router.post('/green-finance/projects/:id/measure', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const start = String((req.body && req.body.period_start) || '').trim();
  const end = String((req.body && req.body.period_end) || '').trim();
  if (!start || !end) return res.redirect(303, '/impact?done=empty');

  const out = await baselines.computeMeasurement(req.params.id, companyId, start, end, 'actual');
  if (!out) return res.redirect(303, '/impact?done=notfound');
  return res.redirect(303, `/impact?done=${out.empty ? 'empty' : 'measured'}`);
}));

/** A PERSON confirms a reading. Measured becomes verified only here. */
router.post('/green-finance/projects/:id/measurements/:mid/verify', wrap(async (req, res) => {
  const companyId = companyIdOf(req);
  const { rows } = await query(
    `UPDATE esg_green_project_baselines b
        SET verified_by = $3, verified_at = now(),
            verification_note = 'Confirmed by the company'
       FROM esg_green_projects p
      WHERE b.id = $1 AND b.project_id = p.id AND p.company_id = $2
        AND b.kind = 'actual' AND b.verified_at IS NULL
      RETURNING b.id`, [req.params.mid, companyId, req.user.id]);
  return res.redirect(303, `/impact?done=${rows[0] ? 'verified' : 'notfound'}`);
}));

module.exports = router;

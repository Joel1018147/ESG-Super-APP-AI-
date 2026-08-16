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
const { layout, esc, emptyState } = require('../utils/layout');
const { requireRoles } = require('../middleware/auth');
const copy = require('../services/financeCopy');

const router = express.Router();

// Express 4 hangs a request forever on an unhandled rejection instead of
// 500-ing, which reads as a network fault and logs nothing worth reading.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const NAV = '/green-finance';

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
        <td>${esc(r.institution_name)}<br>
            <span class="text-muted text-sm">${esc(copy.labelFor(copy.INSTITUTION_KIND_LABELS, r.institution_kind))}</span></td>
        <td><a href="${NAV}/register/${esc(r.id)}">${esc(r.product_name)}</a>${
          r.is_active ? '' : ' <span class="badge badge-gray">not current</span>'}</td>
        <td>${esc(copy.labelFor(copy.FINANCING_TYPE_LABELS, r.financing_type))}</td>
        <td>${esc(copy.labelFor(copy.BORROWER_SCOPE_LABELS, r.borrower_scope))}</td>
        <td><span class="badge ${r.availability_status === 'open' ? 'badge-green' : 'badge-amber'}">${
          esc(copy.labelFor(copy.AVAILABILITY_LABELS, r.availability_status))}</span></td>
        <td>${ageBadge(r.days_since_verified)}</td>
      </tr>`).join('');
    body = `<div class="table-wrap"><table>
      <thead><tr><th>Institution</th><th>Programme</th><th>Financing type</th>
                 <th>Borrower</th><th>Availability</th><th>Source last read</th></tr></thead>
      <tbody>${trs}</tbody></table></div>
      <p class="text-muted text-sm">${esc(rows.length)} programme${rows.length === 1 ? '' : 's'} shown.
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

  res.send(layout(p.product_name, `
    <h2 class="page-title">${esc(p.product_name)}</h2>
    <p class="text-muted">${esc(p.institution_name)} ·
       ${esc(copy.labelFor(copy.INSTITUTION_KIND_LABELS, p.institution_kind))}</p>
    ${disclaimerBlock()}

    <div class="card">
      <h3 class="section-title">Status</h3>
      <p><span class="badge ${p.availability_status === 'open' ? 'badge-green' : 'badge-amber'}">${
        esc(copy.labelFor(copy.AVAILABILITY_LABELS, p.availability_status))}</span>
        ${p.is_active ? '' : ' <span class="badge badge-gray">not current</span>'}
        ${ageBadge(p.days_since_verified)}</p>
      <p>${esc(p.status_note)}</p>
    </div>

    <div class="card">
      <h3 class="section-title">What the institution publishes</h3>
      <div class="table-wrap"><table><tbody>
        <tr><th scope="row">Financing type</th><td>${esc(copy.labelFor(copy.FINANCING_TYPE_LABELS, p.financing_type))}</td></tr>
        <tr><th scope="row">Borrower</th><td>${esc(copy.labelFor(copy.BORROWER_SCOPE_LABELS, p.borrower_scope))}</td></tr>
      </tbody></table></div>
      ${terms}
    </div>

    <div class="card">
      <h3 class="section-title">Where this came from</h3>
      <p>${esc(copy.labelFor(copy.SOURCE_PUBLISHER_LABELS, p.source_publisher))} ·
         read ${esc(String(p.last_verified).slice(0, 10))}</p>
      <p><a href="${esc(p.source_url)}" rel="noreferrer noopener" target="_blank">${esc(p.source_url)}</a></p>
    </div>
    <p><a class="btn btn-outline" href="${NAV}/register">Back to the register</a></p>`,
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
  const today = new Date().toISOString().slice(0, 10);
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
    <form class="card" id="editForm">
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
        fetch('/api/finance-products/${esc(p.id)}', {
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

module.exports = router;

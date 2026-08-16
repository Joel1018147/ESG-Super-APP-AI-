'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN FINANCE — the register's invariants                       (Run 47)
   ───────────────────────────────────────────────────────────────────────────
   The expensive failure this module can produce is not a crash. It is a
   confident wrong sentence about someone else's money: telling an SME that a
   retired facility is open, that a corporate product with a RM50m floor is
   available to them, or that a bank publishes no terms when it does.

   So the assertions here are about MEANING, not about shape:

     * every row carries where it came from and when that was last read
     * the four rows that are expensive to get wrong are checked BY NAME
     * a NULL term renders as "the institution does not publish this",
       distinguishably from zero and from "nothing matched your filter"
     * no rendered page can say "approved", "you qualify", "eligible for" or
       "guaranteed" — the register is a reference, not a decision

   THE ROUTER IS MOUNTED AND DRIVEN OVER REAL HTTP (checklist #21). A suite that
   reads a route file as text and asserts about strings cannot tell a
   structurally-perfect file from a behaviourally-broken one. Twelve of the
   assertions below go through a listening server.

   The database layer is stubbed for those, and the stub's export names are
   asserted to be a SUBSET of the real module's (checklist #18) — a harness that
   can invent an export tests a program that does not exist.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');
const SCHEMA = fs.readFileSync(path.join(SRC, 'db', 'schema.sql'), 'utf8');
const SEED = fs.readFileSync(path.join(SRC, 'db', 'seed.sql'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log('green-finance-register-test');

const copy = require('../src/services/financeCopy');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · STRUCTURE — the schema and the seed as text
   ═══════════════════════════════════════════════════════════════════════════ */

// The Run 47 block only. Asserting over the whole schema would re-test what
// no-model-figures-test.js already covers and would drown this run's additions.
const RUN47 = (() => {
  const i = SCHEMA.indexOf('11. GREEN FINANCE');
  assert.ok(i > 0, 'the Run 47 schema section is gone — the anchor "11. GREEN FINANCE" no longer appears');
  return SCHEMA.slice(i);
})();

test('the vocabulary in financeCopy.js is exactly the schema CHECK set — every one', () => {
  // RULE 6b: a value the database can hold and the UI cannot name would render
  // as a bare enum token. The failure is silent in CSS and silent here too
  // unless something compares the two lists, so this is that something.
  const pairs = [
    ['financing_type', copy.FINANCING_TYPE_LABELS],
    ['borrower_scope', copy.BORROWER_SCOPE_LABELS],
    ['availability_status', copy.AVAILABILITY_LABELS],
    ['institution_kind', copy.INSTITUTION_KIND_LABELS],
    ['source_publisher', copy.SOURCE_PUBLISHER_LABELS],
  ];
  for (const [column, labels] of pairs) {
    const m = new RegExp(`CHECK\\s*\\(${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i').exec(RUN47);
    // A regex that matches nothing must FAIL, not silently pass over an empty
    // set — contract §7b rule 4, a scanner that cannot report what it parsed.
    assert.ok(m, `no CHECK (${column} IN (...)) found in the Run 47 schema block`);
    const inSchema = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
    const inCode = Object.keys(labels).sort();
    assert.deepStrictEqual(inCode, inSchema,
      `${column}: financeCopy knows [${inCode}] and the schema allows [${inSchema}]`);
  }
});

test('every table this run creates has a writer in the same change (checklist #22)', () => {
  const created = [...RUN47.matchAll(/CREATE TABLE IF NOT EXISTS (esg_\w+)/g)].map((m) => m[1]);
  assert.strictEqual(created.length, 4, `expected 4 new tables, found ${created.length}: ${created}`);
  for (const t of created) {
    const writes = (SEED.match(new RegExp(`INSERT INTO ${t}\\b`, 'g')) || []).length;
    assert.ok(writes > 0,
      `${t} has no INSERT INTO anywhere in seed.sql — a table with no writer answers "nothing found", `
      + 'which is byte-identical to the honest answer');
  }
  // esg_finance_products has a SECOND writer, and the fact that it needs one is
  // the reason last_verified exists at all.
  const api = fs.readFileSync(path.join(SRC, 'routes', 'api.js'), 'utf8');
  assert.ok(/INSERT INTO esg_finance_products/.test(api), 'no POST writer for the register');
  assert.ok(/UPDATE esg_finance_products/.test(api), 'no PATCH writer for the register');
});

test('no nullable UNIQUE added, and every new partial unique index carries a comment', () => {
  // Column-level UNIQUE without NOT NULL on the same line is the trap
  // (checklist #9): Postgres admits unlimited NULLs past one.
  for (const line of RUN47.split(/\r?\n/)) {
    const code = line.replace(/--.*$/, '');
    if (/\bUNIQUE\b/.test(code) && !/CREATE UNIQUE INDEX/i.test(code)) {
      assert.ok(/NOT NULL/.test(code), `column-level UNIQUE on a nullable column: ${line.trim()}`);
    }
  }
  const lines = RUN47.split(/\r?\n/);
  let partials = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/CREATE UNIQUE INDEX/i.test(lines[i])) continue;
    // The WHERE may sit on this line or the next one or two — and COMMENTS ARE
    // STRIPPED FIRST. The first version of this did not, and matched the word
    // "where" inside the very comment it was checking for, reporting a
    // correctly-documented index as undocumented. Checklist #16's "strip
    // comments first", reproduced by the person who had just read it.
    const stmt = lines.slice(i, i + 3).map((l) => l.replace(/--.*$/, '')).join(' ');
    if (!/\bWHERE\b/i.test(stmt)) continue;
    partials += 1;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j -= 1;
    assert.ok(j >= 0 && lines[j].trim().startsWith('--'),
      `partial unique index with no comment naming the rows it covers: ${lines[i].trim()}`);
  }
  assert.strictEqual(partials, 2,
    `expected 2 partial unique indexes in this run, found ${partials} — if that changed, the comment rule above changed with it`);
});

test('project types seed NULL BM and Chinese labels, deliberately', () => {
  const i = SEED.indexOf('INSERT INTO esg_project_types');
  assert.ok(i > 0, 'the project-type seed is gone');
  const stmt = SEED.slice(i, SEED.indexOf(';', i));
  assert.ok(!/label_bm|label_zh/.test(stmt),
    'the project-type seed names label_bm or label_zh — no source publishes those terms, and a '
    + 'machine-translated financial term is a wrong term in two more languages');
});

test('the disclaimer has exactly ONE definition', () => {
  const sentence = 'not a financing approval, a credit decision';
  for (const f of ['routes/greenFinance.js', 'routes/api.js', 'routes/pages.js']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!src.includes(sentence),
      `${f} hardcodes the disclaimer instead of importing it — two near-identical legal sentences `
      + 'in two files is how they drift into meaning different things');
  }
  assert.ok(copy.DISCLAIMER.includes(sentence), 'services/financeCopy.js no longer holds the disclaimer');
});

test('the seeded register text contains no phrase that promises a decision', () => {
  const block = SEED.slice(SEED.indexOf('INSERT INTO esg_finance_products'));
  for (const phrase of copy.BANNED_PHRASES) {
    assert.ok(!new RegExp(phrase, 'i').test(block),
      `the seed says "${phrase}" — the register is a reference, not a decision`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · BEHAVIOUR — the real router, mounted, over real HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

const FULL = {
  id: '11111111-1111-1111-1111-111111111111',
  institution_name: 'Example Bank', institution_kind: 'bank',
  product_name: 'Fully Published Green Facility',
  financing_type: 'use_of_proceeds_green', borrower_scope: 'sme',
  max_financing_myr: 10000000, min_financing_myr: null, amount_note: null,
  tenure_note: 'Up to 10 years', rate_note: 'Up to 5% per annum.',
  documentation_note: 'Six months of bank statements.',
  eligibility_note: 'SME as defined by the central bank.',
  availability_status: 'open', status_note: 'Open. Read from the institution page.',
  source_url: 'https://example.test/green', source_publisher: 'institution_own',
  last_verified: '2026-08-15', is_active: true, updated_by: null, days_since_verified: 1,
};

// The state the register exists to report honestly: a real product whose
// institution publishes nothing at all about it.
const SILENT = {
  id: '22222222-2222-2222-2222-222222222222',
  institution_name: 'Silent Bank', institution_kind: 'bank',
  product_name: 'Undisclosed Terms Facility',
  financing_type: 'sustainability_linked', borrower_scope: 'unstated',
  max_financing_myr: null, min_financing_myr: null, amount_note: null,
  tenure_note: null, rate_note: null, documentation_note: null, eligibility_note: null,
  availability_status: 'open', status_note: 'Open. The institution publishes no terms.',
  source_url: 'https://silent.test/green', source_publisher: 'institution_own',
  last_verified: '2025-06-01', is_active: true, updated_by: null, days_since_verified: 441,
};

const TAXONOMY_SCHEME = {
  id: 'scheme-1', code: 'CCPT', version: '2021-04-30', publisher: 'Bank Negara Malaysia',
  source_url: 'https://example.test/ccpt', effective_from: '2021-04-30', is_current: true,
};

function makeDbStub(state) {
  const calls = [];
  return {
    calls,
    exports: {
      query: async (text, params) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        calls.push({ sql, params });
        if (sql.includes('count(*)::int AS n FROM esg_finance_products')) return { rows: [{ n: state.total }] };
        if (sql.includes('WHERE ($1::text IS NULL OR financing_type')) {
          const [type, scope, status] = params;
          return { rows: state.products.filter((r) => (!type || r.financing_type === type)
            && (!scope || r.borrower_scope === scope) && (!status || r.availability_status === status)) };
        }
        if (sql.includes('FROM esg_finance_products WHERE id = $1')) {
          const row = state.products.find((r) => r.id === params[0]);
          return { rows: row ? [row] : [] };
        }
        if (sql.includes('FROM esg_finance_products ORDER BY')) return { rows: state.products };
        if (sql.startsWith('UPDATE esg_finance_products')) {
          const row = state.products.find((r) => r.id === params[0]);
          return { rows: row ? [{ ...row, last_verified: params[2], updated_by: params[3] }] : [] };
        }
        if (sql.includes('FROM esg_taxonomy_schemes WHERE code = $1')) {
          return { rows: params[0] === 'CCPT' ? [TAXONOMY_SCHEME] : [] };
        }
        if (sql.includes('FROM esg_taxonomy_categories WHERE scheme_id = $1')) {
          return { rows: [{ code: 'C1', label_en: 'Climate Supporting', definition_en: null, kind: 'classification', sort_order: 110 }] };
        }
        if (sql.includes('FROM esg_project_types ORDER BY')) {
          return { rows: [{ code: 'SOLAR_PV', label_en: 'Solar PV', label_bm: null, label_zh: null,
            sort_order: 10, is_active: true, default_ccpt_category_id: null, default_asean_objective_id: null }] };
        }
        // A stub that answers a query it has no fixture for is the #18 defect
        // one level down: the suite would be testing the stub's imagination.
        throw new Error(`green-finance test stub has no fixture for: ${sql.slice(0, 140)}`);
      },
      pool: { connect: async () => { throw new Error('the stub pool has no client — no route here needs one'); } },
    },
  };
}

/** Mount the REAL routers with the database stubbed, and listen. */
function serve(user, state) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const stub = makeDbStub(state);

  // checklist #18 — names only; the implementations are supposed to differ.
  const extra = Object.keys(stub.exports).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `the stub invents exports the real src/db lacks: ${extra}`);

  const cached = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub.exports };
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
  }

  let app;
  try {
    const { requireAuth, denyWritesForReadOnly } = require('../src/middleware/auth');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = user;
      req.isAuthenticated = () => Boolean(user);
      next();
    });
    app.use('/api', requireAuth, denyWritesForReadOnly, require('../src/routes/api'));
    app.use('/', requireAuth, denyWritesForReadOnly, require('../src/routes/greenFinance'));
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
      console.error('   (route threw)', err.message);
      res.status(500).json({ error: err.message });
    });
  } finally {
    require.cache[dbPath] = cached;
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  }

  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return {
    stub,
    close: () => new Promise((r) => server.close(r)),
    get: (p, headers) => fetch(base() + p, { redirect: 'manual', headers: headers || { Accept: 'text/html' } }),
    send: (method, p, body, headers) => fetch(base() + p, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(headers || {}) },
      body: JSON.stringify(body),
    }),
  };
}

const ADMIN = { id: 'u-admin', name: 'A', email: 'a@example.test', role: 'super_admin', company_id: 'c1' };
const MEMBER = { id: 'u-member', name: 'M', email: 'm@example.test', role: 'company_admin', company_id: 'c1' };

(async () => {
  /* ── the register, populated ─────────────────────────────────────────── */
  const app = serve(MEMBER, { products: [FULL, SILENT], total: 2 });

  const landing = await (await app.get('/green-finance')).text();
  const register = await (await app.get('/green-finance/register')).text();
  const fullPage = await (await app.get(`/green-finance/register/${FULL.id}`)).text();
  const silentPage = await (await app.get(`/green-finance/register/${SILENT.id}`)).text();
  const filtered = await (await app.get('/green-finance/register?scope=corporate')).text();

  await atest('the landing page renders through a mounted router and carries the disclaimer', () => {
    assert.ok(landing.includes('Use-of-proceeds green'), 'the two concepts are not explained');
    assert.ok(landing.includes('not a financing approval'), 'the disclaimer is missing');
  });

  await atest('the register lists both programmes and prints each row\'s verification age', () => {
    assert.ok(register.includes(FULL.product_name), 'the published product is missing');
    assert.ok(register.includes(SILENT.product_name), 'the silent product is missing');
    assert.ok(register.includes('verified 1 day ago'), 'a fresh row does not print its age');
    assert.ok(register.includes('verified 441 days ago'), 'a stale row does not print its age');
  });

  await atest('a row older than the staleness threshold renders VISIBLY stale', () => {
    assert.ok(/badge-amber[^>]*>verified 441 days ago/.test(register),
      'the 441-day-old row is not marked stale; a figure nobody has re-read for over a year reads as current');
    assert.ok(!/badge-amber[^>]*>verified 1 day ago/.test(register),
      'a one-day-old row is marked stale — the threshold is not being applied');
  });

  await atest('no rendered page in this module promises a decision', () => {
    for (const [label, html] of [['landing', landing], ['register', register],
      ['detail(published)', fullPage], ['detail(silent)', silentPage], ['filtered', filtered]]) {
      const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
      for (const phrase of copy.BANNED_PHRASES) {
        const hit = new RegExp(phrase, 'i').exec(text);
        assert.ok(!hit, `${label} renders "${hit && hit[0]}" — context: `
          + `…${text.slice(Math.max(0, text.search(new RegExp(phrase, 'i')) - 60), text.search(new RegExp(phrase, 'i')) + 60)}…`);
      }
    }
  });

  await atest('a NULL term renders instrumented_but_empty, naming the INSTITUTION as the silent one', () => {
    assert.ok(silentPage.includes('No terms published'), 'the silent product shows no empty state');
    assert.ok(silentPage.includes('Silent Bank publishes no amount'),
      'the copy does not name the institution — "this product has no terms" is a claim about the product, '
      + 'and the true statement is that the institution does not publish them');
    assert.ok(!fullPage.includes('No terms published'), 'a fully published product shows the empty state too');
  });

  await atest('a filter matching nothing renders `zero`, and it is NOT the same HTML as `instrumented_but_empty`', () => {
    assert.ok(filtered.includes('No programme matches this filter'), 'a dead filter does not say so');
    assert.ok(!filtered.includes('The register holds nothing yet'),
      'a dead filter is being reported as an empty register — those are different facts');
    assert.notStrictEqual(filtered, silentPage, 'the two empty states render identical pages');
    assert.ok(!filtered.includes('No terms published') && !silentPage.includes('No programme matches this filter'),
      'the two empty states share their copy');
  });

  await atest('an unrecognised filter value is REPORTED, never silently dropped', () => {
    // Silently ignoring it shows the unfiltered list under a filtered heading —
    // a wrong answer wearing a right answer's clothes.
    return app.get('/green-finance/register?status=probably').then((r) => r.text()).then((html) => {
      assert.ok(html.includes('Filter not applied'), 'an unknown filter value was swallowed');
      assert.ok(html.includes('status=probably'), 'the page does not say WHICH filter it ignored');
      assert.ok(html.includes(FULL.product_name), 'the unfiltered list should still render');
    });
  });

  await atest('the register with no rows at all renders `uninstrumented`, distinct from `zero`', async () => {
    const empty = serve(MEMBER, { products: [], total: 0 });
    const html = await (await empty.get('/green-finance/register')).text();
    await empty.close();
    assert.ok(html.includes('The register holds nothing yet'), 'an empty register does not say it is empty');
    assert.ok(!html.includes('No programme matches this filter'), 'an empty register is reported as a dead filter');
    assert.notStrictEqual(html, filtered, 'uninstrumented and zero render identical pages');
  });

  /* ── authorisation ───────────────────────────────────────────────────── */
  await atest('a company_admin POSTing to /api/finance-products gets 403 WITH a JSON body', async () => {
    const r = await app.send('POST', '/api/finance-products', { institution_name: 'X' });
    assert.strictEqual(r.status, 403, `expected 403, got ${r.status}`);
    const body = await r.json();
    assert.strictEqual(body.error, 'Forbidden', `expected a JSON error body, got ${JSON.stringify(body)}`);
  });

  await atest('a company_admin navigating to an admin page gets 403 RENDERED IN PLACE, not a 302', async () => {
    const r = await app.get('/green-finance/admin/products', { Accept: 'text/html' });
    assert.strictEqual(r.status, 403,
      `expected 403, got ${r.status} — 401 means we do not know who you are, 403 means we know exactly who you are`);
    const html = await r.text();
    assert.ok(html.includes('<!DOCTYPE html>'), 'the 403 did not render a page');
    assert.ok(html.includes('do not have access'), 'the 403 page does not say what happened');
  });

  await atest('a super_admin DOES reach the admin screens', async () => {
    const admin = serve(ADMIN, { products: [FULL, SILENT], total: 2 });
    const list = await admin.get('/green-finance/admin/products', { Accept: 'text/html' });
    assert.strictEqual(list.status, 200, `admin list returned ${list.status}`);
    const edit = await admin.get(`/green-finance/admin/products/${FULL.id}/edit`, { Accept: 'text/html' });
    assert.strictEqual(edit.status, 200, `admin edit returned ${edit.status}`);
    const html = await edit.text();
    assert.ok(html.includes('name="last_verified"'), 'the edit form cannot set a verification date');
    assert.ok(html.includes("fetch('/api/finance-products/"),
      'the edit form posts nowhere — a control that renders must change something (UI Contract §4.3c)');
    await admin.close();
  });

  /* ── the writer ──────────────────────────────────────────────────────── */
  await atest('PATCH without last_verified is REJECTED — a correction that keeps the old date is a lie with a date on it', async () => {
    const admin = serve(ADMIN, { products: [FULL], total: 1 });
    const r = await admin.send('PATCH', `/api/finance-products/${FULL.id}`, { rate_note: 'changed' });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
    const body = await r.json();
    assert.ok(/last_verified/.test(body.error), `the error does not name the field: ${JSON.stringify(body)}`);
    // and nothing reached the database
    assert.ok(!admin.stub.calls.some((c) => c.sql.startsWith('UPDATE')),
      'the handler ran an UPDATE despite rejecting the request');
    await admin.close();
  });

  await atest('PATCH with last_verified stamps BOTH the date and the editor', async () => {
    const admin = serve(ADMIN, { products: [FULL], total: 1 });
    const r = await admin.send('PATCH', `/api/finance-products/${FULL.id}`,
      { rate_note: 'Up to 4% per annum.', last_verified: '2026-08-16' });
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status} ${await r.text()}`);
    const call = admin.stub.calls.find((c) => c.sql.startsWith('UPDATE esg_finance_products'));
    assert.ok(call, 'no UPDATE was issued');
    assert.strictEqual(call.params[2], '2026-08-16', 'last_verified was not passed to the UPDATE');
    assert.strictEqual(call.params[3], ADMIN.id, 'updated_by was not stamped with the editor');
    assert.ok(/last_verified = \$3::date/.test(call.sql.replace(/\s+/g, ' ')),
      'last_verified is not set unconditionally by the UPDATE — it must not be optional in SQL either');
    await admin.close();
  });

  await atest('PATCH refuses a future verification date and an unknown enum value', async () => {
    const admin = serve(ADMIN, { products: [FULL], total: 1 });
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const a = await admin.send('PATCH', `/api/finance-products/${FULL.id}`, { last_verified: future });
    assert.strictEqual(a.status, 400, `a future date was accepted (${a.status})`);
    const b = await admin.send('PATCH', `/api/finance-products/${FULL.id}`,
      { last_verified: '2026-08-16', availability_status: 'probably' });
    assert.strictEqual(b.status, 400, `an unknown availability_status was accepted (${b.status})`);
    const c = await admin.send('PATCH', `/api/finance-products/${FULL.id}`,
      { last_verified: '2026-08-16', status_note: '   ' });
    assert.strictEqual(c.status, 400, 'a NOT NULL note was allowed to be emptied');
    await admin.close();
  });

  /* ── the JSON half ───────────────────────────────────────────────────── */
  await atest('the JSON endpoints answer, and an unknown filter value is a 400 rather than a silent full list', async () => {
    const ok = await app.send('GET', '/api/finance-products', undefined);
    assert.strictEqual(ok.status, 200, `list returned ${ok.status}`);
    const body = await ok.json();
    assert.strictEqual(body.products.length, 2);
    assert.ok(body.disclaimer.includes('not a financing approval'), 'the API omits the disclaimer');
    const bad = await app.send('GET', '/api/finance-products?type=free-money', undefined);
    assert.strictEqual(bad.status, 400, `an unknown financing_type returned ${bad.status}, not 400`);
  });

  await atest('the taxonomy endpoint answers for a known code and 404s for an unknown one', async () => {
    const ok = await app.send('GET', '/api/taxonomy/CCPT', undefined);
    assert.strictEqual(ok.status, 200);
    const body = await ok.json();
    assert.strictEqual(body.scheme.code, 'CCPT');
    assert.ok(body.categories.length > 0, 'no categories returned');
    const missing = await app.send('GET', '/api/taxonomy/NOSUCH', undefined);
    assert.strictEqual(missing.status, 404, 'an unknown taxonomy did not 404');
  });

  await atest('the project-type endpoint reports the translation state rather than hiding it', async () => {
    const r = await app.send('GET', '/api/project-types', undefined);
    const body = await r.json();
    assert.strictEqual(body.project_types[0].translation_status, 'pending_no_official_source',
      'a NULL BM/Chinese label is being served as though it were translated');
  });

  await app.close();

  /* ═════════════════════════════════════════════════════════════════════════
     3 · THE SEEDED ROWS — needs a real database
     ═════════════════════════════════════════════════════════════════════════ */
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — the seeded register itself was NOT checked.');
    console.error('  The four rows that are expensive to get wrong (LCTF, HTG, GTFS 4.0, GTFS 5.0),');
    console.error('  the taxonomy counts and the Maybank RM50m floor are all in that half.');
    console.error('  This is not a pass.\n');
    console.log(`green-finance-register-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: products } = await c.query(
    `SELECT institution_name, product_name, financing_type, borrower_scope,
            max_financing_myr, min_financing_myr, amount_note, rate_note,
            availability_status, status_note, source_url, source_publisher,
            last_verified, is_active
       FROM esg_finance_products ORDER BY institution_name, product_name`);

  await atest('the register is populated before anything walks it (an empty walk is checklist #14)', () => {
    assert.strictEqual(products.length, 31, `expected 31 seeded programmes, found ${products.length}`);
  });

  await atest('every row carries a source, a publisher class and a verification date', () => {
    const PUBLISHERS = Object.keys(copy.SOURCE_PUBLISHER_LABELS);
    for (const p of products) {
      const who = `${p.institution_name} / ${p.product_name}`;
      assert.ok(p.source_url && /^https?:\/\//.test(p.source_url), `${who}: source_url is not a URL`);
      assert.ok(PUBLISHERS.includes(p.source_publisher), `${who}: source_publisher '${p.source_publisher}' is outside the CHECK set`);
      assert.ok(p.last_verified instanceof Date, `${who}: last_verified is ${typeof p.last_verified}`);
      assert.ok(p.availability_status, `${who}: availability_status is null`);
      assert.ok(String(p.status_note).trim().length > 0, `${who}: status_note is empty`);
    }
  });

  const byName = (institution, product) => {
    const row = products.find((p) => p.institution_name === institution && p.product_name === product);
    assert.ok(row, `the register no longer has ${institution} / ${product}`);
    return row;
  };

  await atest('LCTF, HTG and GTFS 4.0 are NOT open — the rows that cost the most to get wrong', () => {
    const lctf = byName('Bank Negara Malaysia', 'Low Carbon Transition Facility (LCTF)');
    assert.strictEqual(lctf.availability_status, 'unclear',
      'LCTF is not marked unclear — it is absent from BNM\'s own fund page while two banks still market it');
    const htg = byName('Bank Negara Malaysia', 'High Tech and Green Facility (HTG)');
    assert.strictEqual(htg.availability_status, 'unclear',
      'HTG is not marked unclear — BNM\'s brochure says availability ended 31 Dec 2023');
    const gtfs4 = byName('MGTC', 'Green Technology Financing Scheme (GTFS) 4.0');
    assert.strictEqual(gtfs4.availability_status, 'superseded', 'GTFS 4.0 is not marked superseded');
    assert.strictEqual(gtfs4.is_active, false, 'GTFS 4.0 is still active');
    for (const r of [lctf, htg, gtfs4]) {
      assert.notStrictEqual(r.availability_status, 'open',
        `${r.product_name} is marked open; telling an SME a retired facility is available is the most expensive error here`);
    }
  });

  await atest('GTFS 5.0 records that it DROPPED the rebate, and carries none of 4.0\'s figures', () => {
    const gtfs5 = byName('MGTC', 'Green Technology Financing Scheme (GTFS) 5.0');
    assert.strictEqual(gtfs5.availability_status, 'open');
    assert.ok(/no longer provide rebates/i.test(gtfs5.rate_note),
      'GTFS 5.0\'s rate_note does not record that the rebate was dropped');
    assert.ok(!/^[^.]*\b1\.5%\s*(per annum|p\.a\.)\s*rebate\b/i.test(String(gtfs5.rate_note).replace(/belonged[\s\S]*$/, '')),
      'GTFS 5.0 is being credited with 4.0\'s 1.5% rebate');
    assert.strictEqual(gtfs5.max_financing_myr, null, 'GTFS 5.0 publishes no cap; one has been invented');
  });

  await atest('a tiered cap is NULL with the tiers verbatim — picking one tier is the enrichment this forbids', () => {
    const tiered = [
      ['MGTC', 'Green Technology Financing Scheme (GTFS) 4.0'],
      ['Maybank', 'Low Carbon Transition Facility/-i'],
      ['Bank Islam Malaysia', 'SME SMART Eco Financing Program-i (ECO)'],
      ['Credit Guarantee Corporation', 'BizJamin/-i High Tech & Green Facility Scheme'],
    ];
    for (const [inst, prod] of tiered) {
      const r = byName(inst, prod);
      assert.strictEqual(r.max_financing_myr, null, `${prod}: a single maximum has been picked from a tiered cap`);
      assert.ok(String(r.amount_note || '').trim().length > 0, `${prod}: the tiers are not recorded at all`);
    }
  });

  await atest('Maybank\'s SLL carries its RM50m MINIMUM, and is scoped corporate', () => {
    const sll = byName('Maybank', 'Sustainability-Linked Loan Programme');
    assert.strictEqual(Number(sll.min_financing_myr), 50000000,
      'the RM50m floor is missing — without it an SME gets routed to a corporate product');
    assert.strictEqual(sll.borrower_scope, 'corporate', 'the SLL is not scoped corporate');
  });

  await atest('the two products with no published terms are marked as news-sourced', () => {
    assert.strictEqual(byName('CIMB Group', 'GreenBizReady Sustainability-Linked Financing Programme').source_publisher, 'news');
    assert.strictEqual(byName('Bank Islam Malaysia',
      'IHSAN Financing for Business Resilience, Sustainability and Green Transition (IFiRST)').source_publisher, 'news');
  });

  await atest('NULL stays distinguishable from zero for every undisclosed term', () => {
    // HSBC, AmBank and Public Bank publish nothing. A zero would say the
    // institution offers nothing, which is a different and false claim.
    for (const inst of ['HSBC Malaysia', 'AmBank Group', 'Public Bank']) {
      const rows = products.filter((p) => p.institution_name === inst);
      assert.ok(rows.length > 0, `${inst} has no rows`);
      for (const r of rows) {
        assert.notStrictEqual(r.max_financing_myr, 0, `${inst} / ${r.product_name}: an undisclosed amount was seeded as zero`);
        assert.notStrictEqual(r.min_financing_myr, 0, `${inst} / ${r.product_name}: an undisclosed minimum was seeded as zero`);
      }
    }
  });

  await atest('each taxonomy seed group has exactly the expected codes', () => {
    return c.query(
      `SELECT s.code AS scheme, t.kind, t.code
         FROM esg_taxonomy_categories t JOIN esg_taxonomy_schemes s ON s.id = t.scheme_id
        ORDER BY s.code, t.kind, t.code`).then(({ rows }) => {
      const group = (scheme, kind, filter) => rows
        .filter((r) => r.scheme === scheme && r.kind === kind && (!filter || filter.test(r.code)))
        .map((r) => r.code).sort();
      assert.deepStrictEqual(group('CCPT', 'classification'), ['C1', 'C2', 'C3', 'C4', 'C5'], 'CCPT classifications');
      assert.deepStrictEqual(group('CCPT', 'principle'), ['GP1', 'GP2', 'GP3', 'GP4', 'GP5'], 'CCPT guiding principles');
      assert.deepStrictEqual(group('ASEAN', 'tier', /^FF_/), ['FF_AMBER', 'FF_GREEN', 'FF_RED'], 'ASEAN Foundation Framework tiers');
      assert.deepStrictEqual(group('ASEAN', 'tier', /^PS_/),
        ['PS_AMBER_T2', 'PS_AMBER_T3', 'PS_GREEN_T1', 'PS_RED'], 'ASEAN Plus Standard tiers');
      assert.strictEqual(group('ASEAN', 'objective').length, 4, 'ASEAN environmental objectives');
      assert.strictEqual(group('ASEAN', 'criterion').length, 3, 'ASEAN essential criteria');
    });
  });

  await atest('the two taxonomies are NOT merged, and each has exactly one current revision', () => {
    return c.query(
      `SELECT code, count(*) FILTER (WHERE is_current)::int AS current, count(*)::int AS revisions
         FROM esg_taxonomy_schemes GROUP BY code ORDER BY code`).then(({ rows }) => {
      assert.strictEqual(rows.length, 2, `expected 2 taxonomies, found ${rows.length}`);
      for (const r of rows) {
        assert.strictEqual(r.current, 1, `${r.code} has ${r.current} current revisions; the partial unique index should permit exactly one`);
      }
    });
  });

  await atest('every project type is untranslated, deliberately and provably', () => {
    return c.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE label_bm IS NULL AND label_zh IS NULL)::int AS untranslated,
              count(*) FILTER (WHERE default_ccpt_category_id IS NOT NULL
                                  OR default_asean_objective_id IS NOT NULL)::int AS classified
         FROM esg_project_types`).then(({ rows: [r] }) => {
      assert.strictEqual(r.n, 12, `expected 12 project types, found ${r.n}`);
      assert.strictEqual(r.untranslated, 12,
        'a BM or Chinese label has appeared — no source publishes these terms, so a later '
        + 'machine-translation pass has to be a deliberate decision, not a side effect');
      assert.strictEqual(r.classified, 0,
        'a default taxonomy classification has been seeded — that judgement belongs to the routing run, '
        + 'where a wrong mapping is visible because it produces a wrong route');
    });
  });

  await atest('the partial unique index really does allow GTFS 4.0 and 5.0 to coexist', () => {
    return c.query(
      `SELECT count(*)::int AS n FROM esg_finance_products
        WHERE product_name LIKE 'Green Technology Financing Scheme%'`).then(({ rows: [r] }) => {
      assert.ok(r.n >= 3, `expected the 4.0, the 5.0 and CGC's channel of it, found ${r.n}`);
    });
  });

  await c.end();
  console.log(`\ngreen-finance-register-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('green-finance-register-test FAILED:', e.stack || e.message); process.exit(1); });

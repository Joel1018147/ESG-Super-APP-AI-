'use strict';
/* NOT A TEST OF THE PRIVATE-PREVIEW LOCK.
   previewLock.js fails closed, so this suite's own fixture users — which are
   not on the allowlist — would be refused at sign-in or by layer 3, and every
   assertion below would measure the lock instead of what it was written for.
   The lock has its own suite in this repo, test/private-preview-test.js,
   which sets this variable itself and asserts all three layers. */
process.env.PREVIEW_LOCK = 'off';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN PROJECTS — the invariants                                  (Run 48)
   ───────────────────────────────────────────────────────────────────────────
   The expensive failure here is not a crash. It is a number the model made up
   reaching a lender, or a project silently re-classifying itself when the
   ASEAN taxonomy is revised. So the assertions are about containment:

     * the opportunities table has NO column a model-authored figure could
       occupy — the guard is the schema, not a code comment
     * an invented project type code never reaches a row
     * a malformed line is skipped, never repaired
     * nothing becomes a project without a human
     * a Groq failure and a successful-empty scan are DIFFERENT ROWS and
       DIFFERENT HTML — asserted by comparing, not by eye
     * classification is stamped, so changing a default cannot rewrite history
     * two tenants can scan at once — the dedupe_key check, which is
       impossible to make with one tenant

   The router is mounted and driven over real HTTP (checklist #21), and the db
   stub's exports are asserted to be a subset of the real module's (#18).
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');
const SCHEMA = fs.readFileSync(path.join(SRC, 'db', 'schema.sql'), 'utf8');

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
console.log('green-projects-test');

const svc = require('../src/services/opportunityService');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · CONTAINMENT — the schema is the guard
   ═══════════════════════════════════════════════════════════════════════════ */

// Same shape as layer2-test.js's "the extractions table has no column a
// model-authored figure could occupy".
const RUN48 = (() => {
  const i = SCHEMA.indexOf('12. GREEN PROJECTS');
  assert.ok(i > 0, 'the Run 48 schema section is gone — the anchor moved');
  // BOUNDED AT THE NEXT NUMBERED SECTION. Unbounded, this slice ran to the end
  // of the file, so it swallowed Run 52's three tables the moment section 13
  // was appended and the four-tables assertion went red in a run that had not
  // touched this feature at all. That is anchor rot
  // (test-harness-integrity-audit.md), and the fix is a bound rather than a
  // bigger number.
  const rest = SCHEMA.slice(i + 1);
  const next = /\n-- \d+\. /.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
})();

function tableBlock(name) {
  const start = RUN48.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.ok(start > -1, `${name} is not declared in the Run 48 section`);
  const end = RUN48.indexOf('\n);', start);
  assert.ok(end > start, `${name}'s declaration is unterminated`);
  return RUN48.slice(start, end);
}

test('the opportunities table has no column a model-authored figure could occupy', () => {
  const block = tableBlock('esg_green_opportunities');
  const numeric = block.split('\n').filter((l) => /\b(numeric|integer|bigint|decimal|real|double|money)\b/i.test(l)
    && !/^\s*--/.test(l));
  assert.deepStrictEqual(numeric, [],
    `esg_green_opportunities has a numeric column, so a model-authored figure now has somewhere to land:\n      ${numeric.join('\n      ')}`);
});

test('every table this run creates has a writer in the same change (checklist #22)', () => {
  const created = [...RUN48.matchAll(/CREATE TABLE IF NOT EXISTS (esg_\w+)/g)].map((m) => m[1]);
  assert.strictEqual(created.length, 4, `expected 4 new tables, found ${created.length}: ${created}`);
  const writers = ['routes/api.js', 'services/opportunityService.js', 'services/baselineService.js']
    .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  for (const t of created) {
    assert.ok(new RegExp(`INSERT INTO ${t}\\b`).test(writers),
      `${t} has no INSERT INTO in this change — a table with no writer answers "nothing found", `
      + 'which is byte-identical to the honest answer');
  }
});

test('the evidence junction is unique on the pair, and cascades from both sides', () => {
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_esg_green_project_evidence[\s\S]*?\(project_id, document_id\)/.test(RUN48),
    'no unique index on (project_id, document_id)');
  const block = tableBlock('esg_green_project_evidence');
  assert.ok(/project_id[^\n]*REFERENCES esg_green_projects\(id\) ON DELETE CASCADE/.test(block), 'project_id does not cascade');
  assert.ok(/document_id[^\n]*REFERENCES esg_documents\(id\) ON DELETE CASCADE/.test(block), 'document_id does not cascade');
});

test('the classification columns are TEXT codes, not foreign keys', () => {
  const block = tableBlock('esg_green_projects');
  for (const col of ['ccpt_category_code', 'asean_ff_code', 'asean_ps_code']) {
    const line = block.split('\n').find((l) => l.trim().startsWith(col));
    assert.ok(line, `${col} is missing`);
    assert.ok(/\btext\b/.test(line), `${col} is not text`);
    assert.ok(!/REFERENCES/.test(line),
      `${col} is a foreign key — it would follow the taxonomy row when it is corrected, which is `
      + 'exactly the silent re-classification the stamp exists to prevent');
  }
  assert.ok(/ccpt_scheme_version\s+text/.test(block), 'no ccpt_scheme_version stamped');
  assert.ok(/asean_scheme_version\s+text/.test(block), 'no asean_scheme_version stamped');
});

test('every green-project query in api.js is company-scoped, at the SQL', () => {
  // AIMED AT THE DECISION SITE, NOT AT THE BEHAVIOUR. The behavioural
  // cross-tenant test below runs against a stubbed pool, and a stub filters in
  // JavaScript — so it enforces the tenancy the SQL is supposed to enforce and
  // stays green when the SQL loses it. That was not hypothetical: a mutation
  // replacing `company_id = $2` with `($2 IS NOT NULL)` passed the behavioural
  // test cleanly. Checklist #15's question — "if someone changed one line
  // somewhere else, would this test still pass while authorisation broke?" —
  // answered yes, so the check moved here.
  const api = fs.readFileSync(path.join(SRC, 'routes', 'api.js'), 'utf8');
  const owned = api.slice(api.indexOf('async function ownedProject'), api.indexOf('router.get(\'/green-projects\''));
  assert.ok(owned.length > 100, 'ownedProject not found — the anchor moved');
  assert.ok(/company_id = \$2/.test(owned),
    'ownedProject no longer scopes by company_id — any signed-in user could read any project by guessing a uuid');

  // Every statement naming a green table must carry a tenant predicate, either
  // directly or by having been reached through ownedProject's id.
  const stmts = [...api.matchAll(/`([^`]*esg_green_[a-z_]+[^`]*)`/g)].map((m) => m[1]);
  assert.ok(stmts.length >= 6, `expected several green-table statements, found ${stmts.length}`);
  for (const s of stmts) {
    // Four legitimate shapes, and no file is ever named — a guard with an
    // exemption list dissolves one legitimate use at a time (checklist #13).
    const scoped = /company_id\s*=\s*\$/.test(s)                                   // read/write scoped by tenant
      || /^\s*INSERT INTO esg_green_\w+\s*\([^)]*\b(company_id|project_id)\b/.test(s) // write, scope written from an owned value
      || /project_id\s*=\s*\$/.test(s)                                             // reached via an already-owned project id
      || /FROM esg_project_types/.test(s);                                         // reference data, not tenant data
    assert.ok(scoped, `a green-table statement carries no tenant predicate:\n      ${s.slice(0, 110)}`);
  }
});

test('the interaction log is called with the KEYS logInteraction actually reads', () => {
  // Run 48 passed snake_case to a camelCase reader. Every column except
  // feature, model and ok landed NULL — including error_message on the failure
  // path — and NOTHING THREW, because logInteraction swallows its own errors.
  // Silent in both directions, and only visible by reading a row back.
  //
  // Asserted on the SOURCE of both call sites, because the mismatch is a
  // spelling, and a behavioural test would need a real database to see it.
  const svcSrc = fs.readFileSync(path.join(SRC, 'services', 'opportunityService.js'), 'utf8');
  const groqSrc = fs.readFileSync(path.join(SRC, 'services', 'groqService.js'), 'utf8');

  const reader = groqSrc.slice(groqSrc.indexOf('async function logInteraction'));
  const readKeys = [...reader.matchAll(/row\.([a-zA-Z]+)/g)].map((m) => m[1]);
  assert.ok(readKeys.length >= 7, `logInteraction reads only ${readKeys.length} keys — the anchor moved`);

  const calls = [...svcSrc.matchAll(/logOrReport\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
  assert.strictEqual(calls.length, 2, `expected 2 logOrReport call sites, found ${calls.length}`);
  for (const call of calls) {
    // Split on top-level commas so `x: a || null` yields the key `x`, not `null`.
    const parts = [];
    let depth = 0; let cur = '';
    for (const ch of call) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const written = parts.map((p) => p.trim()).filter(Boolean)
      .map((p) => (p.match(/^([a-zA-Z_$][\w$]*)\s*(?::|$)/) || [])[1])
      .filter(Boolean);
    assert.ok(written.length >= 5, `only parsed ${written.length} keys out of a logOrReport call — the parser broke`);
    const unread = written.filter((k) => !readKeys.includes(k));
    assert.deepStrictEqual(unread, [],
      `logOrReport passes key(s) logInteraction never reads: ${unread.join(', ')} — `
      + `they land as NULL and nothing throws. It reads: ${[...new Set(readKeys)].join(', ')}`);
  }
  // and the two that matter most are actually present
  for (const k of ['companyId', 'error']) {
    assert.ok(calls.some((c) => new RegExp(`\\b${k}\\b`).test(c)),
      `no call site passes ${k} — the log cannot say whose scan failed, or why`);
  }
});

test('a scan that failed but is RETRYING is reported, not just a terminal failure', () => {
  // jobRunner leaves a job 'pending' until attempts >= max_attempts, so keying
  // on status === 'failed' alone says nothing about the first failures. Proven
  // against a real 401 driven to exhaustion in the Run 48 addendum.
  const s = svc.scanState;
  assert.strictEqual(s(null).state, 'none');
  assert.strictEqual(s({ status: 'done', attempts: 1, max_attempts: 3, last_error: null }).state, 'ok');
  assert.strictEqual(s({ status: 'failed', attempts: 3, max_attempts: 3, last_error: 'Groq 401' }).state, 'failed');
  assert.strictEqual(
    s({ status: 'pending', attempts: 1, max_attempts: 3, last_error: 'Groq 401' }).state, 'retrying',
    'a pending job that has already burned an attempt and recorded an error is reported as ok');
  // A brand-new queued job has not failed and must not be reported as though it had.
  assert.strictEqual(s({ status: 'pending', attempts: 0, max_attempts: 3, last_error: null }).state, 'pending');
  assert.strictEqual(s({ status: 'running', attempts: 1, max_attempts: 3, last_error: null }).state, 'running');
});

test('no setTimeout schedules anything in the new code', () => {
  for (const f of ['services/opportunityService.js', 'services/baselineService.js']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/setTimeout|setInterval/.test(src), `${f} schedules with a timer instead of esg_scheduled_jobs`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE PARSER — drop, never repair
   ═══════════════════════════════════════════════════════════════════════════ */

const CODES = new Set(['SOLAR_PV', 'ENERGY_EFFICIENCY', 'WASTE_MANAGEMENT']);

test('a proposed type code not in esg_project_types never reaches a proposal', () => {
  const r = svc.parseProposals('SOLAR_FARM | we invented this one\nSOLAR_PV | roof is unshaded', CODES);
  assert.deepStrictEqual(r.proposals.map((p) => p.code), ['SOLAR_PV']);
  assert.strictEqual(r.dropped.length, 1);
  assert.strictEqual(r.dropped[0].why, 'unknown project type code');
});

test('a near-miss code is DROPPED, not closest-matched to a real one', () => {
  const r = svc.parseProposals('SOLAR_PVV | one character out\nSOLARPV | no underscore', CODES);
  assert.strictEqual(r.proposals.length, 0,
    'a near-miss was repaired into a real code — a model typo must not become a company project');
  assert.strictEqual(r.dropped.length, 2);
});

test('a malformed line is skipped, not repaired', () => {
  const r = svc.parseProposals('SOLAR_PV no separator here\nENERGY_EFFICIENCY |', CODES);
  assert.strictEqual(r.proposals.length, 0);
  assert.deepStrictEqual(r.dropped.map((d) => d.why), ['no separator', 'no rationale']);
});

test('NONE and duplicates are handled without inventing a proposal', () => {
  assert.strictEqual(svc.parseProposals('NONE', CODES).proposals.length, 0);
  const dup = svc.parseProposals('SOLAR_PV | a\nSOLAR_PV | b', CODES);
  assert.strictEqual(dup.proposals.length, 1);
  assert.strictEqual(dup.dropped[0].why, 'duplicate code');
});

test('at most five proposals survive, however many the model emits', () => {
  const many = Array.from({ length: 9 }, (_, i) => `SOLAR_PV${i} | x`).join('\n');
  const codes = new Set(Array.from({ length: 9 }, (_, i) => `SOLAR_PV${i}`));
  assert.strictEqual(svc.parseProposals(many, codes).proposals.length, 5);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · THE PROMPT — the model is shown no figure it could echo
   ═══════════════════════════════════════════════════════════════════════════ */

test('the prompt contains no measured value — only codes, bands and states', () => {
  const prompt = svc.buildPrompt({
    msic_code: '25113', industry: 'Metal fabrication', employee_band: 'small (5-29)',
    state: 'Selangor', grid_region: 'peninsular', esg_maturity: 'basic',
    project_types: [{ code: 'SOLAR_PV', label_en: 'Solar PV' }],
    indicators: [{ code: 'E-02', state: 'answered' }, { code: 'E-04', state: 'unanswered' }],
    carbon_categories: [{ scope: 2, category: 'grid_electricity' }],
  });
  // The company's actual electricity consumption, cost and headcount must not
  // appear anywhere. A model cannot echo a figure it was never shown.
  assert.ok(!/\b\d{4,}\b/.test(prompt.replace(/25113/g, '')),
    'the prompt carries a multi-digit figure the model could echo back as a project size');
  assert.ok(prompt.includes('small (5-29)'), 'the employee count is not banded');
  assert.ok(!/employee[_ ]count|47|headcount:/i.test(prompt), 'a raw headcount reached the prompt');
  assert.ok(/must not produce one|not invent any/.test(prompt), 'the prompt does not forbid producing a number');
  assert.ok(prompt.includes('E-02:answered'), 'indicator states are missing');
  assert.ok(!/value|kWh|RM/.test(prompt.split('ESG indicator states:')[1] || ''),
    'an indicator VALUE reached the prompt; only codes and states may');
});

test('an employee headcount is banded, never passed through', () => {
  assert.strictEqual(svc.employeeBand(47), 'medium (30-74)');
  assert.strictEqual(svc.employeeBand(3), 'micro (under 5)');
  assert.strictEqual(svc.employeeBand(null), 'unknown');
  for (const n of [1, 12, 47, 900]) {
    assert.ok(!svc.employeeBand(n).includes(String(n)), `the band for ${n} leaks the exact number`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · BEHAVIOUR — the real routers, mounted, over real HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const COMPANY_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const PROJECT_A = '11111111-0000-0000-0000-000000000001';

function makeState() {
  return {
    projects: [{
      id: PROJECT_A, company_id: COMPANY_A, project_type_id: null, title: 'Rooftop solar',
      description: 'Panels', estimated_cost_myr: null, status: 'draft',
      ccpt_category_code: null, ccpt_scheme_version: null, asean_ff_code: null,
      asean_ps_code: null, asean_scheme_version: null, classification_basis: null,
      classified_at: null, created_at: '2026-08-17',
    }],
    enqueued: [],
    scanRow: null,
  };
}

function makeDbStub(state) {
  const calls = [];
  return {
    calls,
    exports: {
      query: async (text, params) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        calls.push({ sql, params });
        if (sql.startsWith('SELECT id, company_id, project_type_id')) {
          const row = state.projects.find((p) => p.id === params[0] && p.company_id === params[1]);
          return { rows: row ? [row] : [] };
        }
        if (sql.includes('FROM esg_green_projects p')) {
          return { rows: state.projects.filter((p) => p.company_id === params[0]) };
        }
        if (sql.includes('FROM esg_green_project_baselines')) return { rows: [] };
        if (sql.includes('FROM esg_green_project_evidence')) return { rows: [] };
        if (sql.includes('FROM esg_green_opportunities o')) return { rows: [] };
        if (sql.includes('FROM esg_scheduled_jobs')) return { rows: state.scanRow ? [state.scanRow] : [] };
        if (sql.startsWith('INSERT INTO esg_scheduled_jobs')) {
          // Mirrors the live partial index: unique on (job_type, dedupe_key)
          // among pending/running rows. With no dedupe_key every company
          // collapses onto '' and the second insert returns nothing.
          //
          // The payload arrives as an OBJECT — node-postgres serialises it to
          // jsonb itself. Parsing it as a string gave
          // `"[object Object]" is not valid JSON`, which read as a product bug
          // for a minute and was this stub's.
          const payload = params[1] && typeof params[1] === 'string' ? JSON.parse(params[1]) : (params[1] || {});
          const key = payload.dedupe_key || '';
          if (state.enqueued.some((e) => e.key === key)) return { rows: [] };
          const id = `job-${state.enqueued.length + 1}`;
          state.enqueued.push({ key, id });
          return { rows: [{ id }] };
        }
        if (sql.includes('FROM esg_project_types')) {
          // HONOUR THE LOOKUP. Returning a row for every code made the
          // "an unknown project_type_code is refused" assertion pass against a
          // stub that had resolved the unknown code for it — the test would
          // have been green whatever the route did.
          const all = [{ id: 'pt-1', code: 'SOLAR_PV', label_en: 'Solar PV',
            default_ccpt_category_id: null, default_asean_objective_id: null }];
          if (/WHERE code = \$1/.test(sql)) {
            return { rows: all.filter((t) => t.code === params[0]) };
          }
          return { rows: all };
        }
        if (sql.includes('FROM esg_carbon_entries')) return { rows: [{ n: 0 }] };
        if (sql.startsWith('INSERT INTO esg_green_projects')) {
          // ECHO THE PARAMETERS, never a fixed row. Returning a hardcoded
          // estimated_cost_myr:null made the "no cost nobody typed" assertion
          // pass against a stub that was supplying the null itself — a mutation
          // seeding 50000 sailed straight through it. A double that answers on
          // the code's behalf is testing its own construction (checklist #18).
          return { rows: [{ id: 'new-project', title: params[2], status: params[5],
            estimated_cost_myr: params[4], classification_basis: params[11], created_at: '2026-08-17' }] };
        }
        throw new Error(`green-projects stub has no fixture for: ${sql.slice(0, 120)}`);
      },
      pool: { connect: async () => { throw new Error('the stub pool has no client'); } },
    },
  };
}

function serve(user, state) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const stub = makeDbStub(state);
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
    app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => Boolean(user); next(); });
    app.use('/api', requireAuth, denyWritesForReadOnly, require('../src/routes/api'));
    app.use('/', requireAuth, denyWritesForReadOnly, require('../src/routes/greenFinance'));
    app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); }); // eslint-disable-line
  } finally {
    require.cache[dbPath] = cached;
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  }
  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return {
    stub, state,
    close: () => new Promise((r) => server.close(r)),
    get: (p, h) => fetch(base() + p, { redirect: 'manual', headers: h || { Accept: 'text/html' } }),
    send: (m, p, b) => fetch(base() + p, {
      method: m, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    }),
  };
}

const USER_A = { id: 'u-a', name: 'A', email: 'a@x.test', role: 'company_admin', company_id: COMPANY_A };
const USER_B = { id: 'u-b', name: 'B', email: 'b@x.test', role: 'company_admin', company_id: COMPANY_B };

(async () => {
  const app = serve(USER_A, makeState());

  await atest('cross-tenant: company B cannot read, patch or baseline company A\'s project', async () => {
    const b = serve(USER_B, makeState());
    for (const [method, url, body] of [
      ['GET', `/api/green-projects/${PROJECT_A}`, undefined],
      ['PATCH', `/api/green-projects/${PROJECT_A}`, { title: 'stolen' }],
      ['POST', `/api/green-projects/${PROJECT_A}/baseline`, { period_start: '2026-01-01', period_end: '2026-12-31' }],
      ['POST', `/api/green-projects/${PROJECT_A}/evidence`, { document_id: 'd1' }],
    ]) {
      const r = await b.send(method, url, body);
      assert.strictEqual(r.status, 404, `${method} ${url} returned ${r.status} for another tenant`);
    }
    await b.close();
  });

  await atest('an accepted-style creation leaves estimated_cost_myr NULL', async () => {
    const r = await app.send('POST', '/api/green-projects', { title: 'Chiller replacement', project_type_code: 'SOLAR_PV' });
    // Read the body ONCE — passing `await r.text()` as the assertion message
    // consumes the stream, and the later r.json() then throws "Body has already
    // been read", which masks the real status with a stream error.
    const body = await r.json();
    assert.strictEqual(r.status, 201, JSON.stringify(body));
    assert.strictEqual(body.project.estimated_cost_myr, null,
      'a created project carries a cost nobody typed');
  });

  await atest('a project type with no default leaves the classification NULL, not a false basis', async () => {
    const call = app.stub.calls.find((c) => c.sql.startsWith('INSERT INTO esg_green_projects'));
    assert.ok(call, 'no project insert was issued');
    // params[11] is classification_basis
    assert.strictEqual(call.params[11], null,
      'classification_basis claims project_type_default when the type carries no default — '
      + 'a basis recorded for a classification that never happened');
    assert.strictEqual(call.params[6], null, 'a CCPT code was invented');
  });

  await atest('an unknown project_type_code is refused, never inferred', async () => {
    const r = await app.send('POST', '/api/green-projects', { title: 'x', project_type_code: 'NOT_A_TYPE' });
    assert.strictEqual(r.status, 400);
    const b = await r.json();
    assert.ok(/unknown project_type_code/.test(b.error));
  });

  await atest('TWO COMPANIES CAN EACH HOLD A PENDING SCAN — the dedupe_key check', async () => {
    // Impossible to make with one tenant: with no dedupe_key the live index
    // coalesces every company onto '' and company B's scan silently collides
    // with company A's, which is a cross-tenant denial of service that looks
    // perfectly healthy in a single-tenant test.
    const shared = makeState();
    const a = serve(USER_A, shared);
    const b = serve(USER_B, shared);
    const ra = await a.send('POST', '/api/green-opportunities/scan');
    const rb = await b.send('POST', '/api/green-opportunities/scan');
    const ja = await ra.json();
    const jb = await rb.json();
    assert.ok(ja.jobId, `company A got no job id: ${JSON.stringify(ja)}`);
    assert.ok(jb.jobId, `company B's scan collided with company A's: ${JSON.stringify(jb)}`);
    assert.notStrictEqual(ja.jobId, jb.jobId, 'both companies were given the same job');
    assert.deepStrictEqual(shared.enqueued.map((e) => e.key).sort(), [COMPANY_A, COMPANY_B].sort(),
      'the dedupe_key is not the company id');
    await a.close(); await b.close();
  });

  await atest('a FAILED scan renders differently from a scan that found nothing', async () => {
    const emptyState = makeState();
    emptyState.scanRow = { id: 'j1', status: 'done', last_error: null, attempts: 1, updated_at: '2026-08-17' };
    const okApp = serve(USER_A, emptyState);
    const okHtml = await (await okApp.get('/green-finance/opportunities')).text();

    const failState = makeState();
    failState.scanRow = { id: 'j2', status: 'failed', attempts: 3, updated_at: '2026-08-17',
      last_error: 'Green opportunity analysis did not run: Groq 503' };
    const failApp = serve(USER_A, failState);
    const failHtml = await (await failApp.get('/green-finance/opportunities')).text();

    assert.notStrictEqual(okHtml, failHtml,
      'a failed analysis and an empty result render byte-identical pages — the carbonImportService defect');
    assert.ok(failHtml.includes('did not complete'), 'the failed page does not say the analysis failed');
    assert.ok(failHtml.includes('Groq 503'), 'the failed page does not surface the reason');
    assert.ok(okHtml.includes('No suggestions yet'), 'the empty page does not say it found nothing');
    assert.ok(!okHtml.includes('did not complete'), 'the empty page claims the analysis failed');

    // AND the retrying state, which Run 48 rendered as silence.
    const retryState = makeState();
    retryState.scanRow = { id: 'j3', status: 'pending', attempts: 1, max_attempts: 3,
      updated_at: '2026-08-17', last_error: 'Green opportunity analysis did not run: Groq 401' };
    const retryApp = serve(USER_A, retryState);
    const retryHtml = await (await retryApp.get('/green-finance/opportunities')).text();
    assert.ok(/is being retried/.test(retryHtml),
      'a scan that has already failed once renders as though nothing had happened');
    assert.ok(retryHtml.includes('Groq 401'), 'the retrying page hides the reason');
    assert.ok(!retryHtml.includes('No suggestions yet'),
      'the retrying page also claims the analysis found nothing');
    assert.notStrictEqual(retryHtml, okHtml, 'retrying renders identically to a clean empty result');
    assert.notStrictEqual(retryHtml, failHtml, 'retrying renders identically to a terminal failure');
    await retryApp.close();

    await okApp.close(); await failApp.close();
  });

  await atest('the API reports the same four scan states the page can (CLAUDE.md §9)', async () => {
    // Without this the page fix is half a fix: a JSON client keying on
    // status === 'failed' stays blind to the first failures, which is the
    // defect the page just stopped having.
    const cases = [
      [{ id: 'j1', status: 'done', attempts: 1, max_attempts: 3, last_error: null, updated_at: '2026-08-17' }, 'ok'],
      [{ id: 'j2', status: 'failed', attempts: 3, max_attempts: 3, last_error: 'Groq 503', updated_at: '2026-08-17' }, 'failed'],
      [{ id: 'j3', status: 'pending', attempts: 1, max_attempts: 3, last_error: 'Groq 401', updated_at: '2026-08-17' }, 'retrying'],
      [{ id: 'j4', status: 'pending', attempts: 0, max_attempts: 3, last_error: null, updated_at: '2026-08-17' }, 'pending'],
      [null, 'none'],
    ];
    for (const [row, want] of cases) {
      const st = makeState();
      st.scanRow = row;
      const a = serve(USER_A, st);
      const body = await (await a.get('/api/green-opportunities')).json();
      assert.strictEqual(body.scan && body.scan.state, want,
        `a ${row ? row.status : 'missing'} scan with ${row ? row.attempts : 0} attempt(s) is reported to the API `
        + `as "${body.scan && body.scan.state}", not "${want}"`);
      await a.close();
    }
  });

  await atest('the opportunities page states that the model never produces a figure', async () => {
    const html = await (await app.get('/green-finance/opportunities')).text();
    assert.ok(/never estimates a cost/.test(html), 'the page does not tell the user what the model will not do');
  });

  await app.close();

  /* ═════════════════════════════════════════════════════════════════════════
     5 · THE SEEDED / LIVE HALF — needs a real database
     ═════════════════════════════════════════════════════════════════════════ */
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — the stamped-classification invariant and the');
    console.error('  provisional-baseline invariant did NOT run. This is not a pass.\n');
    console.log(`green-projects-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  const { Client } = require('pg');
  /* SSL COMES FROM THE APP'S OWN sslConfig, NOT FROM A LITERAL HERE.
     Hardcoding `ssl: { rejectUnauthorized: false }` demanded TLS from every
     server, and CI's postgres:16 service on localhost does not offer it — so
     this suite failed test-with-db with "The server does not support SSL
     connections" while the app it tests connected fine, because
     src/db/index.js has always turned SSL off for localhost. One decision,
     one place; sslConfig is already unit-tested in no-model-figures-test.js. */
  const { sslConfig } = require('../src/db');
  const c = new Client({ connectionString: process.env.DATABASE_URL,
                         ssl: sslConfig(process.env.DATABASE_URL) });
  await c.connect();

  await atest('the four tables exist with the columns this run declares', async () => {
    const { rows } = await c.query(
      `SELECT table_name, count(*)::int cols FROM information_schema.columns
        WHERE table_name IN ('esg_green_projects','esg_green_project_baselines',
                             'esg_green_project_evidence','esg_green_opportunities')
        GROUP BY table_name ORDER BY table_name`);
    assert.strictEqual(rows.length, 4, `found ${rows.length} of 4 tables`);
  });

  await atest('esg_green_opportunities has NO numeric column, in the live database', async () => {
    const { rows } = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'esg_green_opportunities'
          AND data_type IN ('numeric','integer','bigint','double precision','real','money')`);
    assert.deepStrictEqual(rows, [],
      `a model-authored figure now has somewhere to land: ${rows.map((r) => r.column_name).join(', ')}`);
  });

  await atest('classification is STAMPED — changing a project type default cannot rewrite history', async () => {
    const co = (await c.query(
      `INSERT INTO esg_companies (name) VALUES ('Run48 stamp test') RETURNING id`)).rows[0].id;
    const pt = (await c.query(`SELECT id FROM esg_project_types WHERE code='SOLAR_PV'`)).rows[0].id;
    const cat = (await c.query(
      `SELECT c.id FROM esg_taxonomy_categories c JOIN esg_taxonomy_schemes s ON s.id=c.scheme_id
        WHERE s.code='CCPT' AND c.code='C1'`)).rows[0].id;
    try {
      const proj = (await c.query(
        `INSERT INTO esg_green_projects (company_id, project_type_id, title,
            ccpt_category_code, ccpt_scheme_version, classification_basis)
         VALUES ($1,$2,'stamped','C1','2021-04-30','human_assigned') RETURNING id`, [co, pt])).rows[0].id;
      // Move the type's default. The project must not follow it.
      await c.query(`UPDATE esg_project_types SET default_ccpt_category_id=$2 WHERE id=$1`, [pt, cat]);
      const after = (await c.query(
        `SELECT ccpt_category_code, ccpt_scheme_version FROM esg_green_projects WHERE id=$1`, [proj])).rows[0];
      assert.strictEqual(after.ccpt_category_code, 'C1', 'the project re-classified itself');
      assert.strictEqual(after.ccpt_scheme_version, '2021-04-30', 'the stamped scheme version moved');
    } finally {
      await c.query(`UPDATE esg_project_types SET default_ccpt_category_id=NULL WHERE id=$1`, [pt]);
      await c.query(`DELETE FROM esg_companies WHERE id=$1`, [co]);
    }
  });

  await atest('a baseline built from ANY provisional entry is itself provisional', async () => {
    const co = (await c.query(
      `INSERT INTO esg_companies (name, grid_region) VALUES ('Run48 baseline test','peninsular') RETURNING id`)).rows[0].id;
    try {
      const proj = (await c.query(
        `INSERT INTO esg_green_projects (company_id, title) VALUES ($1,'baseline') RETURNING id`, [co])).rows[0].id;
      // One verified electricity entry, one provisional fuel entry.
      await c.query(
        `INSERT INTO esg_carbon_entries (company_id, period_start, period_end, scope, category,
            activity_amount, activity_unit, factor_value_used, factor_version_used,
            factor_source_used, factor_verification_used, is_provisional, kg_co2e)
         VALUES ($1,'2026-01-01','2026-03-31',2,'grid_electricity',1000,'kWh',0.74,'2022-2024','ST','verified',false,740),
                ($1,'2026-01-01','2026-03-31',1,'mobile_combustion',100,'litre',2.68,'placeholder-1','DEFRA','unverified',true,268)`,
        [co]);
      const svcB = require('../src/services/baselineService');
      const out = await svcB.computeBaseline(proj, co, '2026-01-01', '2026-03-31');
      assert.ok(out && !out.empty, 'no baseline was computed');
      const co2 = out.metrics.find((m) => m.metric === 'kg_co2e');
      assert.ok(co2, 'no kg_co2e total was written');
      assert.strictEqual(co2.is_provisional, true,
        'a total mixing a verified and an unverified factor was written as verified');
      const elec = out.metrics.find((m) => m.metric === 'electricity_kwh');
      assert.strictEqual(elec.is_provisional, false,
        'the electricity metric rests only on a verified factor and must not be marked provisional');
      const reasons = await svcB.provisionalReasons(co, '2026-01-01', '2026-03-31');
      assert.ok(reasons.length > 0, 'nothing names WHICH factor made it provisional');
    } finally {
      await c.query(`DELETE FROM esg_companies WHERE id=$1`, [co]);
    }
  });

  await c.end();
  console.log(`\ngreen-projects-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('green-projects-test FAILED:', e.stack || e.message); process.exit(1); });

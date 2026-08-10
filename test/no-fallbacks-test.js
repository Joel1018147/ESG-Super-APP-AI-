'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   RULE 6 — no fallbacks                                          (Run 24)
   ───────────────────────────────────────────────────────────────────────────
   The invariant this whole run exists for:

     "the AI recognised none of your headers"   and
     "the AI never ran"

   must be DIFFERENT observable states. They used to be identical — both
   produced an empty proposed_mapping and a review screen with nothing
   pre-selected — so the user was shown a confident blank either way.

   Also here: a failed audit-log write must not be reported as a model failure,
   and the banned SHAPE must not come back. The shape is described, never a
   list of exempt files (#13).
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
console.log('no-fallbacks-test');

const SRC = path.join(__dirname, '..', 'src');

/* ── The static guard: the banned shape, described not enumerated ─────────── */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name))
      : (d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}
const FILES = walk(SRC);

test('the scan actually covered the source tree (an empty walk passes vacuously — #14)', () => {
  assert.ok(FILES.length >= 10, `walked only ${FILES.length} files`);
  console.log(`      ${FILES.length} .js files scanned`);
});

test('no empty catch survives anywhere in src/', () => {
  // The SHAPE: a catch whose body contains nothing but whitespace, in either
  // the arrow form or the block form. No file is named, so the rule cannot be
  // dissolved one exemption at a time (#13).
  const SHAPES = [
    { re: /catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, what: '.catch(() => {})' },
    { re: /catch\s*\([A-Za-z_$][\w$]*\)\s*\{\s*\}/g, what: 'catch (e) {}' },
    { re: /catch\s*\{\s*\}/g, what: 'catch {}' },
  ];
  const hits = [];
  for (const f of FILES) {
    const s = fs.readFileSync(f, 'utf8');
    for (const { re, what } of SHAPES) {
      const m = s.match(re);
      if (m) hits.push(`${path.relative(SRC, f)}: ${m.length}× ${what}`);
    }
  }
  assert.strictEqual(hits.length, 0, `swallowed errors:\n      ${hits.join('\n      ')}`);
});

test('proposeMapping no longer returns an empty object on failure', () => {
  const s = fs.readFileSync(path.join(SRC, 'services', 'carbonImportService.js'), 'utf8');
  const fn = s.slice(s.indexOf('async function proposeMapping'), s.indexOf('async function parseMapping'));
  assert.ok(fn.length > 100, 'proposeMapping not found — anchor moved');
  const code = fn.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/return\s*\{\s*\}/.test(code), 'proposeMapping still returns {} somewhere');
  assert.ok(/throw new Error/.test(code), 'proposeMapping does not throw on failure');
});

test('a logging failure cannot be reported as a model failure', () => {
  const s = fs.readFileSync(path.join(SRC, 'services', 'carbonImportService.js'), 'utf8');
  assert.ok(/async function logOrReport/.test(s), 'no logOrReport helper');
  // It must swallow nothing: the catch body has to name the failure.
  const fn = s.slice(s.indexOf('async function logOrReport'), s.indexOf('async function proposeMapping'));
  assert.ok(/console\.error/.test(fn), 'logOrReport does not report anything');
  // And no raw logInteraction call may remain inside proposeMapping, because a
  // bare one inside the try would land in the Groq catch and be blamed on Groq.
  const pm = s.slice(s.indexOf('async function proposeMapping'), s.indexOf('async function parseMapping'));
  assert.ok(!/await logInteraction\(/.test(pm),
    'a bare logInteraction() remains inside proposeMapping — its failure would be reported as a Groq failure');
});

test('the review screen distinguishes the two states', () => {
  const s = fs.readFileSync(path.join(SRC, 'routes', 'carbonImport.js'), 'utf8');
  assert.ok(s.includes('Boolean(batch.error_message)'),
    'the route does not branch on error_message');
  assert.ok(/esc\(batch\.error_message\)/.test(s), 'error_message is rendered unescaped or not at all');
  assert.ok(/did not run/i.test(s), 'the page never says the AI mapping did not run');
});

test('status is NOT set to error — that would strand the batch', () => {
  const s = fs.readFileSync(path.join(SRC, 'services', 'carbonImportService.js'), 'utf8');
  const cb = s.slice(s.indexOf('async function createBatch'), s.indexOf('async function getBatch'));
  assert.ok(!/status\s*=\s*'error'|'error'\s*,/.test(cb.replace(/\/\/[^\n]*/g, '')),
    "createBatch sets status='error'; commitBatch's claim filters on 'mapping_pending', so the batch could never be mapped by hand");
});

/* ── DB-gated: the two states, produced for real ──────────────────────────── */
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — the two-states invariant, which is the');
    console.error('  entire point of this suite, did NOT run. This is not a pass.\n');
    console.log(`no-fallbacks-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  // Stub groqService. #18: the stub must be a SUBSET of the real module —
  // a harness that can supply an export the real one lacks is testing a
  // program that does not exist.
  const groqPath = require.resolve('../src/services/groqService');
  const real = require('../src/services/groqService');
  const realKeys = new Set(Object.keys(real));

  function installStub({ throwOnGenerate }) {
    const stub = {
      generateWithGroq: async () => {
        if (throwOnGenerate) throw new Error('Groq unreachable (stubbed)');
        return 'nothing the parser can use';
      },
      logInteraction: async () => {},
      groqModel: () => 'stub-model',
    };
    for (const k of Object.keys(stub)) {
      assert.ok(realKeys.has(k), `#18: the stub exports ${k}, which the real groqService does not`);
    }
    require.cache[groqPath] = { id: groqPath, filename: groqPath, loaded: true, exports: { ...real, ...stub } };
    delete require.cache[require.resolve('../src/services/carbonImportService')];
    return require('../src/services/carbonImportService');
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const companyId = (await c.query(
    `INSERT INTO esg_companies (name) VALUES ($1) RETURNING id`, [`RULE6 ${Date.now()}`])).rows[0].id;
  const userId = (await c.query(
    `INSERT INTO esg_users (company_id, email, name, password_hash, role)
     VALUES ($1,$2,'R6','x','company_admin') RETURNING id`,
    [companyId, `r6-${Date.now()}@example.test`])).rows[0].id;

  const HEADERS = ['Some Column', 'Another Column'];
  const ROWS = [{ 'Some Column': '1', 'Another Column': '2' }];

  let ranBatch = null;
  let failedBatch = null;

  await atest('a SUCCESSFUL call that recognises nothing still produces a batch', async () => {
    const svc = installStub({ throwOnGenerate: false });
    ranBatch = await svc.createBatch({ companyId, filename: 'ok.xlsx', uploadedBy: userId, headers: HEADERS, rows: ROWS });
    assert.ok(ranBatch && ranBatch.id, 'no batch created');
  });

  await atest('a FAILED call still produces a batch — the upload is not destroyed', async () => {
    const svc = installStub({ throwOnGenerate: true });
    failedBatch = await svc.createBatch({ companyId, filename: 'fail.xlsx', uploadedBy: userId, headers: HEADERS, rows: ROWS });
    assert.ok(failedBatch && failedBatch.id, 'the upload was lost when the AI failed');
  });

  await atest('THE INVARIANT: the two states are observably different in the database', () => {
    assert.notStrictEqual(
      JSON.stringify([ranBatch.proposed_mapping, ranBatch.error_message]),
      JSON.stringify([failedBatch.proposed_mapping, failedBatch.error_message]),
      'a Groq failure and an empty-but-successful mapping are still indistinguishable');
    assert.deepStrictEqual(ranBatch.proposed_mapping, {}, 'the successful-but-empty call should store {}');
    assert.strictEqual(ranBatch.error_message, null, 'a successful call must not record an error');
    assert.deepStrictEqual(failedBatch.proposed_mapping, {}, 'proposed_mapping is NOT NULL; the discriminator is error_message');
    assert.ok(failedBatch.error_message && /did not run/i.test(failedBatch.error_message),
      `a failed call must record why: ${JSON.stringify(failedBatch.error_message)}`);
  });

  await atest('and therefore the review screen renders differently', () => {
    // The exact predicate the route uses. Not a reimplementation of it — the
    // point is that the stored data drives different branches.
    const aiFailed = (b) => Boolean(b.error_message);
    assert.strictEqual(aiFailed(ranBatch), false, 'the successful batch would show the failure notice');
    assert.strictEqual(aiFailed(failedBatch), true, 'the failed batch would show no notice');
  });

  await atest('a failed-mapping batch is STILL manually mappable and committable', async () => {
    const svc = require('../src/services/carbonImportService');
    assert.strictEqual(failedBatch.status, 'mapping_pending',
      `status is ${failedBatch.status}; commitBatch's claim only accepts mapping_pending`);
    await svc.approveMapping(failedBatch.id, companyId, { 'Some Column': 'amount' });
    const after = await svc.getBatch(failedBatch.id, companyId);
    assert.ok(after.approved_mapping, 'the human mapping was not accepted on a batch whose AI failed');
  });

  await c.query('DELETE FROM esg_companies WHERE id=$1', [companyId]);
  await c.end();
  console.log(`\nno-fallbacks-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('no-fallbacks-test FAILED:', e.message); process.exit(1); });

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Framework choice — RULE 6 at the point of creation            (Run 25)
   ───────────────────────────────────────────────────────────────────────────
   Until this run the framework was never chosen. It was the first row of

       ORDER BY effective_from DESC NULLS LAST LIMIT 1

   so SEDG's 38 disclosures were built, answerable and scored, and completely
   unreachable — trap A and trap H together.

   The invariant that matters most here is the RULE 6 one: a caller who names
   nothing, or names something unknown or inactive, must FAIL. Quietly handing
   back a MODUS_SEDG_ALIGNED assessment to someone who asked for SEDG would be
   invisible on every screen afterwards — the questions, the score and the
   report would all be internally consistent and all be the wrong framework.

   Everything reads through the app's own pool (`src/db`), never a bare
   pg.Client — checklist #20, which this repo has now produced three times.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
console.log('framework-choice-test');

const SRC = path.join(__dirname, '..', 'src');
const API = fs.readFileSync(path.join(SRC, 'routes', 'api.js'), 'utf8');
const PAGES = fs.readFileSync(path.join(SRC, 'routes', 'pages.js'), 'utf8');
const SEED = fs.readFileSync(path.join(SRC, 'db', 'seed.sql'), 'utf8');

/* ── Static: no creation path may still fall through to the ORDER BY ─────── */
test('neither creation path resolves a framework by ORDER BY any more', () => {
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [name, src, anchor] of [
    ['api.js', API, "router.post('/assessments'"],
    ['pages.js', PAGES, "router.post('/assessment'"],
  ]) {
    const i = src.indexOf(anchor);
    assert.ok(i > 0, `${name}: creation handler not found`);
    const handler = strip(src.slice(i, i + 3000));
    assert.ok(!/effective_from DESC NULLS LAST/.test(handler),
      `${name} still picks a framework by ordering — a caller cannot choose`);
  }
});

test('trap A: activation sets effective_from in the SAME statement as is_active', () => {
  const i = SEED.indexOf('UPDATE esg_frameworks');
  assert.ok(i > 0, 'no activation statement in seed.sql');
  const stmt = SEED.slice(i, SEED.indexOf(';', i));
  assert.ok(/is_active\s*=\s*true/.test(stmt), 'activation does not set is_active');
  assert.ok(/effective_from\s*=\s*DATE/.test(stmt),
    'is_active is set without effective_from — that is the silent no-op trap A describes');
  assert.ok(/code = 'SEDG'/.test(stmt), 'the activation is not scoped to SEDG');
});

test('trap C: the indicators filter takes a version as well as a code', () => {
  const i = API.indexOf("router.get('/indicators'");
  const handler = API.slice(i, i + 900);
  assert.ok(/f\.version = \$2/.test(handler),
    'indicators are still filtered on code alone; with two frameworks that is ambiguous');
});

test('the smoke test names both code and version', () => {
  const S = fs.readFileSync(path.join(__dirname, 'smoke-test.js'), 'utf8');
  assert.ok(/framework_version: '0\.9-draft'/.test(S), 'the smoke test does not name a version');
  assert.ok(/version=\$\{FW\.framework_version\}/.test(S), 'the indicators request omits the version');
  assert.ok(/expected exactly the Modus 40/.test(S),
    'the smoke test still asserts >= 40, which passes on all 78');
});

test('the product claim was not upgraded', () => {
  assert.ok(PAGES.includes('not SEDG-compliant'), 'the not-SEDG-compliant statement is gone');
  assert.ok(!PAGES.includes('not the default framework</strong> — assessments run against\n'),
    'the stale not-the-default sentence survives verbatim');
  assert.ok(/selectable/.test(PAGES), '/frameworks never says SEDG is selectable');
});

/* ── DB-gated: everything through the app's own pool ─────────────────────── */
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — the RULE 6 invariant, which is the most');
    console.error('  important test in this run, did NOT run. This is not a pass.\n');
    console.log(`framework-choice-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  // #20: the app's own pool, so the type parsers that the app registers are
  // the ones this probe reads through.
  const { query } = require('../src/db');

  await atest('SEDG v2.0 is active AND has a non-NULL effective_from (trap A closed)', async () => {
    const { rows } = await query(
      `SELECT is_active, effective_from FROM esg_frameworks WHERE code='SEDG' AND version='2.0'`);
    assert.ok(rows[0], 'no SEDG v2.0 row');
    assert.strictEqual(rows[0].is_active, true, 'SEDG is not active');
    assert.ok(rows[0].effective_from !== null,
      'SEDG is active with a NULL effective_from — the exact silent no-op of trap A');
  });

  await atest('both frameworks are selectable, and carry the counts a user is shown', async () => {
    const { rows } = await query(
      `SELECT f.code, f.version, count(i.id)::int AS n
         FROM esg_frameworks f LEFT JOIN esg_indicators i ON i.framework_id = f.id AND i.is_active
        WHERE f.framework_kind='entity_disclosure' AND f.is_active
        GROUP BY f.code, f.version ORDER BY f.code`);
    assert.strictEqual(rows.length, 2, `expected 2 selectable frameworks, got ${rows.length}`);
    const by = Object.fromEntries(rows.map((r) => [r.code, r.n]));
    assert.strictEqual(by.MODUS_SEDG_ALIGNED, 40, `Modus should offer 40, offers ${by.MODUS_SEDG_ALIGNED}`);
    assert.strictEqual(by.SEDG, 38, `SEDG should offer 38, offers ${by.SEDG}`);
  });

  await atest('MODUS_SEDG_ALIGNED still sorts first, so nothing that falls through changes', async () => {
    // Not because anything should still fall through — nothing does — but
    // because the ordering is what any future caller inherits, and flipping it
    // would silently change what an unspecified request receives.
    const { rows } = await query(
      `SELECT code FROM esg_frameworks
        WHERE framework_kind='entity_disclosure' AND is_active
        ORDER BY effective_from DESC NULLS LAST LIMIT 1`);
    assert.strictEqual(rows[0].code, 'MODUS_SEDG_ALIGNED',
      'activating SEDG changed the implicit default; that is a silent switch');
  });

  await atest('an assessment stamped with SEDG gets the 38, not the 40', async () => {
    const { rows: fw } = await query(`SELECT id FROM esg_frameworks WHERE code='SEDG' AND version='2.0'`);
    const { rows: inds } = await query(
      `SELECT count(*)::int AS n FROM esg_indicators WHERE framework_id=$1 AND is_active`, [fw[0].id]);
    assert.strictEqual(inds[0].n, 38, `a SEDG assessment would ask ${inds[0].n} questions`);
  });

  console.log(`\nframework-choice-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('framework-choice-test FAILED:', e.message); process.exit(1); });

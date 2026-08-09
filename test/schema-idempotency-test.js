'use strict';
// Replays schema.sql and seed.sql three times against a real PostgreSQL.
//
// Two passes prove idempotency; the third catches a statement that is idempotent
// only on a table it created itself. Requires DATABASE_URL — skipped, loudly,
// when absent, because a silently skipped test is worse than no test.

const fs = require('fs');
const path = require('path');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('schema-idempotency-test: SKIPPED (no DATABASE_URL)');
    console.log('  ⚠️  This is the test that stops a boot quietly running last week\'s schema. Run it before every deploy.');
    return;
  }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const seed   = fs.readFileSync(path.join(__dirname, '../src/db/seed.sql'), 'utf8');

  for (const pass of [1, 2, 3]) {
    await c.query(schema);
    await c.query(seed);
    console.log(`  ✓ pass ${pass}: schema + seed applied cleanly`);
  }

  const { rows: t } = await c.query(
    `SELECT count(*)::int n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name LIKE 'esg\\_%'`);
  // PER FRAMEWORK, deliberately not a global total. This assertion was
  // `count(*) = 40` across the whole table until Run 22, and importing SEDG's
  // 38 would have made it read 78. Bumping the number to 78 is the wrong fix:
  // it re-arms exactly the same trap for the next framework, and it stops the
  // guard from noticing that rows landed under the WRONG framework — 39 Modus
  // and 39 SEDG also totals 78. Scoping it per framework catches both.
  const { rows: perFramework } = await c.query(
    `SELECT f.code, count(i.id)::int n
       FROM esg_frameworks f LEFT JOIN esg_indicators i ON i.framework_id = f.id
      GROUP BY f.code ORDER BY f.code`);
  const counts = Object.fromEntries(perFramework.map((r) => [r.code, r.n]));
  const i = [{ n: perFramework.reduce((a, r) => a + r.n, 0) }];
  const { rows: s } = await c.query(`SELECT count(*)::int n FROM esg_weighting_schemes WHERE is_active`);
  const { rows: b } = await c.query(`SELECT count(*)::int n FROM esg_rating_bands`);
  const { rows: f } = await c.query(`SELECT count(*)::int n FROM esg_emission_factors`);

  console.log(`  ✓ ${t[0].n} esg_ tables, ${i[0].n} indicators, ${b[0].n} bands, ${f[0].n} emission factors`);
  if (s[0].n !== 1) { console.error(`  ✗ expected exactly 1 active weighting scheme, found ${s[0].n}`); process.exitCode = 1; }
  // Seeds must not multiply on replay, and each framework owns its own count.
  const EXPECTED = { MODUS_SEDG_ALIGNED: 40, SEDG: 38 };
  for (const [code, want] of Object.entries(EXPECTED)) {
    const got = counts[code];
    if (got !== want) {
      console.error(`  ✗ ${code}: expected ${want} indicators, found ${got === undefined ? 'no framework row' : got}`);
      process.exitCode = 1;
    }
  }
  for (const [code, got] of Object.entries(counts)) {
    if (!(code in EXPECTED) && got !== 0) {
      console.error(`  ✗ ${code}: ${got} indicators under a framework this test does not know about`);
      process.exitCode = 1;
    }
  }
  console.log(`  ✓ indicators per framework: ${perFramework.map((r) => `${r.code}=${r.n}`).join(', ')}`);
  await c.end();
  console.log('schema-idempotency-test: done');
})().catch((e) => { console.error('schema-idempotency-test FAILED:', e.message); process.exit(1); });

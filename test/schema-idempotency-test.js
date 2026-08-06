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
  const { rows: i } = await c.query(`SELECT count(*)::int n FROM esg_indicators`);
  const { rows: s } = await c.query(`SELECT count(*)::int n FROM esg_weighting_schemes WHERE is_active`);
  const { rows: b } = await c.query(`SELECT count(*)::int n FROM esg_rating_bands`);
  const { rows: f } = await c.query(`SELECT count(*)::int n FROM esg_emission_factors`);

  console.log(`  ✓ ${t[0].n} esg_ tables, ${i[0].n} indicators, ${b[0].n} bands, ${f[0].n} emission factors`);
  if (s[0].n !== 1) { console.error(`  ✗ expected exactly 1 active weighting scheme, found ${s[0].n}`); process.exitCode = 1; }
  // Seeds must not multiply on replay.
  if (i[0].n !== 40) { console.error(`  ✗ indicator count drifted on replay: ${i[0].n}`); process.exitCode = 1; }
  await c.end();
  console.log('schema-idempotency-test: done');
})().catch((e) => { console.error('schema-idempotency-test FAILED:', e.message); process.exit(1); });

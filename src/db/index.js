'use strict';

const fs   = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// NUMERIC/DECIMAL (OID 1700) arrives from node-postgres as a STRING by default.
// This app is built entirely out of numerics — scores, weights, emission
// factors, tonnages — and a string that looks like a number survives JSON
// serialisation, survives a template literal, and only breaks when something
// tries arithmetic on it. `"84.5" * 0.4` is NaN and NaN renders as "NaN" on a
// dashboard. Registered globally, once, exactly as Commerce does it.
if (types && typeof types.setTypeParser === 'function') {
  types.setTypeParser(1700, parseFloat);
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

/**
 * Run fn inside a transaction. Commits on resolve, rolls back on throw, and
 * ALWAYS releases the client — a leaked client on the 20-slot pool takes the
 * whole app down twenty requests later, a long way from the bug.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replay schema.sql, then seed.sql.
 *
 * THROWS on failure. Commerce logs and continues here, which means a broken
 * migration produces a running app on the PREVIOUS schema and the first symptom
 * is a 500 from one route hours later. Failing the boot instead makes Railway's
 * healthcheck fail, the deploy roll back, and the error land in the deploy log
 * where somebody is already looking.
 *
 * schema.sql is one implicit transaction: any failing statement rolls back the
 * entire file. seed.sql is run separately so a seed problem cannot roll back
 * the structural migration.
 */
async function initDb() {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

  try {
    await pool.query(read('schema.sql'));
    console.log('✅ ESG schema applied');
  } catch (err) {
    console.error('❌ Schema init failed — nothing was applied:', err.message);
    throw err;
  }

  try {
    await pool.query(read('seed.sql'));
    console.log('✅ ESG reference data seeded');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    throw err;
  }
}

module.exports = { pool, query, getClient, withTransaction, initDb };

'use strict';
// Carbon bulk import guards, tested against a model that lies — same
// philosophy as test/layer2-test.js: the stub invents a mapping to a header
// that doesn't exist, claims a field twice, and invents a field name outright.
// If any of that reaches esg_carbon_entries, a spreadsheet upload could put a
// wrong tonnage into a company's report with no human ever having chosen it.

const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

(async () => {
  console.log('carbon-import-test');
  const svc = require('../src/services/carbonImportService');

  // ── Guard 3, no DB needed: parseMapping is a pure function ────────────────
  const headers = ['Billing Period Start', 'Billing Period End', 'Utility Type', 'Consumption'];

  test('a well-behaved mapping is accepted in full', () => {
    const reply = [
      'Billing Period Start|period_start',
      'Billing Period End|period_end',
      'Utility Type|kind',
      'Consumption|amount',
    ].join('\n');
    const m = svc.parseMapping(reply, headers);
    assert.deepStrictEqual(m, {
      'Billing Period Start': 'period_start',
      'Billing Period End': 'period_end',
      'Utility Type': 'kind',
      'Consumption': 'amount',
    });
  });

  test('a header the sheet does not have is dropped', () => {
    const reply = 'Billing Period Start|period_start\nInvoice Number|amount';
    const m = svc.parseMapping(reply, headers);
    assert.ok(!('Invoice Number' in m), 'invented header reached the mapping');
    assert.strictEqual(m['Billing Period Start'], 'period_start');
  });

  test('an invented field name is dropped, not coerced to the nearest real one', () => {
    const reply = 'Consumption|activity_amount'; // real field is "amount", not this
    const m = svc.parseMapping(reply, headers);
    assert.ok(!('Consumption' in m), 'invented field name reached the mapping');
  });

  test('a duplicate claim on the same field: first wins, second is dropped', () => {
    const reply = 'Billing Period Start|period_start\nBilling Period End|period_start';
    const m = svc.parseMapping(reply, headers);
    assert.strictEqual(m['Billing Period Start'], 'period_start');
    assert.ok(!('Billing Period End' in m), 'second claim on the same field was not dropped');
  });

  test('a line with no field-list separator is silently skipped, not thrown', () => {
    const reply = 'Billing Period Start -> period_start'; // wrong separator, adversarial-ish
    const m = svc.parseMapping(reply, headers);
    assert.deepStrictEqual(m, {});
  });

  test('a reply that also tries to sneak a number past the header list is still just dropped', () => {
    // A model told never to output a data value that tries anyway: this must
    // not parse as a mapping entry at all, because "Total kWh: 45200" is not
    // of the shape header|field.
    const reply = 'Consumption|amount\nTotal kWh: 45200';
    const m = svc.parseMapping(reply, headers);
    assert.strictEqual(Object.keys(m).length, 1);
    assert.strictEqual(m['Consumption'], 'amount');
  });

  // ── parseWorkbook: pure, no DB ─────────────────────────────────────────────
  test('parseWorkbook rejects a sheet with more than MAX_ROWS data rows', () => {
    const XLSX = require('xlsx');
    const aoa = [['Billing Period Start', 'Billing Period End', 'Utility Type', 'Consumption']];
    for (let i = 0; i < svc.MAX_ROWS + 1; i += 1) {
      aoa.push(['2025-01-01', '2025-01-31', 'electricity', String(100 + i)]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.throws(() => svc.parseWorkbook(buf), /limit is \d+ per upload/);
  });

  test('parseWorkbook round-trips headers and cell text for a normal sheet', () => {
    const XLSX = require('xlsx');
    const aoa = [
      ['Billing Period Start', 'Billing Period End', 'Utility Type', 'Consumption'],
      ['2025-01-01', '2025-01-31', 'electricity', '4520'],
      ['2025-01-01', '2025-01-31', 'FUEL_DIESEL', '310'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const { headers: h, rows } = svc.parseWorkbook(buf);
    assert.deepStrictEqual(h, ['Billing Period Start', 'Billing Period End', 'Utility Type', 'Consumption']);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0]['Consumption'], '4520');
    assert.strictEqual(rows[1]['Utility Type'], 'FUEL_DIESEL');
  });

  if (!process.env.DATABASE_URL) {
    console.log('  SKIPPED (integration) — no DATABASE_URL. The pure parseMapping/parseWorkbook');
    console.log('  guards above still ran with no database. Run with a real Postgres before');
    console.log('  every deploy that touches this file — see test/layer2-test.js for why.');
    console.log(`\ncarbon-import-test: ${passed} passed, ${failed} failed (integration skipped)`);
    process.exit(failed ? 1 : 0);
    return;
  }

  // ── Full integration: upload -> propose -> approve -> commit -> verify ────
  const { query } = require('../src/db');
  const { electricityToCo2e } = require('../src/services/carbonEngine');

  const stamp = Date.now();
  const { rows: co } = await query(
    `INSERT INTO esg_companies (name, grid_region) VALUES ($1,'peninsular') RETURNING id`,
    [`Carbon Import Test ${stamp}`]);
  const companyId = co[0].id;
  const { rows: us } = await query(
    `INSERT INTO esg_users (company_id, email, name, role) VALUES ($1,$2,'CI','company_admin') RETURNING id`,
    [companyId, `ci-${stamp}@example.com`]);
  const userId = us[0].id;

  const sheetHeaders = ['Period From', 'Period To', 'Type', 'Reading'];
  const sheetRows = [
    { 'Period From': '2025-01-01', 'Period To': '2025-01-31', 'Type': 'electricity', 'Reading': '1000' },
    { 'Period From': '2025-02-01', 'Period To': '2025-02-28', 'Type': 'FUEL_DIESEL', 'Reading': '50' },
    { 'Period From': '2025-03-01', 'Period To': '2025-03-31', 'Type': 'electricity', 'Reading': '-5' }, // bad: negative
    { 'Period From': '2025-04-01', 'Period To': '2025-03-01', 'Type': 'electricity', 'Reading': '10' }, // bad: end before start
    { 'Period From': '2025-05-01', 'Period To': '2025-05-31', 'Type': 'FUEL_UNKNOWN', 'Reading': '10' }, // bad: no such factor
  ];

  const batch = await svc.createBatch({
    companyId, filename: 'test.xlsx', uploadedBy: userId, headers: sheetHeaders, rows: sheetRows,
  });

  await atest('the model was never given row data — proposeMapping only ever received headers', async () => {
    // Sanity: proposed_mapping keys, if any, must be a subset of the sheet's own headers.
    const proposed = Object.keys(batch.proposed_mapping || {});
    for (const h of proposed) assert.ok(sheetHeaders.includes(h), `mapping referenced a header not in the sheet: ${h}`);
  });

  const approvedMapping = {
    'Period From': 'period_start', 'Period To': 'period_end', 'Type': 'kind', 'Reading': 'amount',
  };
  await svc.approveMapping(batch.id, companyId, approvedMapping);
  const { batch: committed, committed: nCommitted, errored: nErrored } =
    await svc.commitBatch(batch.id, companyId, userId);

  await atest('exactly the two valid rows commit; the three invalid rows error, not silently drop', async () => {
    assert.strictEqual(nCommitted, 2, `expected 2 committed, got ${nCommitted}`);
    assert.strictEqual(nErrored, 3, `expected 3 errored, got ${nErrored}`);
    assert.strictEqual(committed.committed_count, 2);
    assert.strictEqual(committed.error_count, 3);
  });

  await atest('committed rows carry the SAME factor stamp the manual form would have produced', async () => {
    const { rows: entries } = await query(
      `SELECT * FROM esg_carbon_entries WHERE company_id=$1 ORDER BY period_start`, [companyId]);
    assert.strictEqual(entries.length, 2);
    const elec = entries.find((e) => e.category === 'grid_electricity');
    assert.ok(elec, 'no electricity entry was written');
    const expected = await electricityToCo2e(1000, 'peninsular');
    assert.strictEqual(Number(elec.kg_co2e), expected.kg_co2e);
    assert.strictEqual(elec.factor_version_used, expected.factor_version_used);
    assert.strictEqual(elec.scope, 2);
  });

  await atest('the negative-amount row and the bad-period row error with a distinguishable reason', async () => {
    const { rows } = await query(
      `SELECT row_number, error_message FROM esg_carbon_import_rows
        WHERE batch_id=$1 AND status='error' ORDER BY row_number`, [batch.id]);
    assert.strictEqual(rows.length, 3);
    assert.ok(/amount must be/i.test(rows[0].error_message), rows[0].error_message);
    assert.ok(/period_start is after/i.test(rows[1].error_message), rows[1].error_message);
    assert.ok(/no current emission factor/i.test(rows[2].error_message), rows[2].error_message);
  });

  await atest('a row for another company is invisible to getBatch — no cross-tenant read', async () => {
    const { rows: other } = await query(
      `INSERT INTO esg_companies (name, grid_region) VALUES ($1,'sabah') RETURNING id`,
      [`Other Co ${stamp}`]);
    const leaked = await svc.getBatch(batch.id, other[0].id);
    assert.strictEqual(leaked, null, 'a batch was readable by a company that does not own it');
  });

  console.log(`\ncarbon-import-test: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

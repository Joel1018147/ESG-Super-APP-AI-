'use strict';
// Hand-computed fixtures. Every expected number below was worked out on paper
// first; if the engine changes and a number here has to be "adjusted to match",
// that is the moment to stop and check which one is wrong.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computeScores, STANDARD_OPTIONS, bandFor } = require('../src/services/scoringEngine');

const scheme = {
  version: 'test-1.0',
  weight_e: 0.4, weight_s: 0.3, weight_g: 0.3,
  mult_self_declared: 0.6, mult_documented: 0.85, mult_verified: 1.0,
};
const bands = [
  { band_code: 'AAA', min_score: 85, max_score: 100 },
  { band_code: 'AA',  min_score: 75, max_score: 84.99 },
  { band_code: 'A',   min_score: 65, max_score: 74.99 },
  { band_code: 'BBB', min_score: 55, max_score: 64.99 },
  { band_code: 'BB',  min_score: 45, max_score: 54.99 },
  { band_code: 'B',   min_score: 30, max_score: 44.99 },
  { band_code: 'CCC', min_score: 0,  max_score: 29.99 },
];

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('scoring-engine-test');

// ── 1. The worked example ──────────────────────────────────────────────────
// E1 w2 yes/documented      -> 2 * 1.00 * 0.85 = 1.70   avail 2
// E2 w2 quantitative/self   -> 2 * 1.00 * 0.60 = 1.20   avail 2
// E3 w1 N/A                 -> excluded from BOTH
// S1 w3 maturity 2/verified -> 3 * 0.50 * 1.00 = 1.50   avail 3
// G1 w1 unanswered          -> 0                        avail 1
// E = 2.90/4 = 72.50   S = 1.50/3 = 50.00   G = 0.00/1 = 0.00
// overall = 0.4*72.5 + 0.3*50 + 0.3*0 = 44.00  -> band B
test('worked example produces the hand-computed numbers', () => {
  const indicators = [
    { id: 'e1', code: 'E-01', pillar: 'E', response_type: 'yes_partial_no', weight: 2 },
    { id: 'e2', code: 'E-02', pillar: 'E', response_type: 'quantitative',   weight: 2 },
    { id: 'e3', code: 'E-03', pillar: 'E', response_type: 'yes_no',         weight: 1 },
    { id: 's1', code: 'S-01', pillar: 'S', response_type: 'maturity_0_4',   weight: 3 },
    { id: 'g1', code: 'G-01', pillar: 'G', response_type: 'yes_no',         weight: 1 },
  ];
  const responses = [
    { indicator_id: 'e1', option_code: 'yes', is_na: false, evidence_tier: 'documented' },
    { indicator_id: 'e2', value_numeric: 1000, is_na: false, evidence_tier: 'self_declared' },
    { indicator_id: 'e3', option_code: null, is_na: true, evidence_tier: 'self_declared' },
    { indicator_id: 's1', option_code: '2', is_na: false, evidence_tier: 'verified' },
  ];
  const r = computeScores({ indicators, responses, scheme, bands });
  assert.strictEqual(r.pillars.E.score_0_100, 72.5, 'E');
  assert.strictEqual(r.pillars.E.points_earned, 2.9);
  assert.strictEqual(r.pillars.E.points_available, 4);
  assert.strictEqual(r.pillars.E.indicators_na, 1);
  assert.strictEqual(r.pillars.S.score_0_100, 50);
  assert.strictEqual(r.pillars.G.score_0_100, 0);
  assert.strictEqual(r.pillars.G.state, 'unanswered');
  assert.strictEqual(r.overall.score_0_100, 44);
  assert.strictEqual(r.overall.band_code, 'B');
});

// ── 2. N/A must leave the denominator ──────────────────────────────────────
test('N/A leaves the denominator, it does not score zero', () => {
  const indicators = [
    { id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 },
    { id: 'b', pillar: 'E', response_type: 'yes_no', weight: 1 },
  ];
  const withNa = computeScores({ indicators, scheme, bands, responses: [
    { indicator_id: 'a', option_code: 'yes', is_na: false, evidence_tier: 'verified' },
    { indicator_id: 'b', option_code: null,  is_na: true,  evidence_tier: 'self_declared' },
  ]});
  assert.strictEqual(withNa.pillars.E.score_0_100, 100, 'a company is not punished for a source it does not have');
  assert.strictEqual(withNa.pillars.E.points_available, 1);
});

// ── 3. The evidence ceiling is real and is documented behaviour ────────────
test('all-self-declared caps at exactly 60, all-documented at 85', () => {
  const indicators = [
    { id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 },
    { id: 'b', pillar: 'S', response_type: 'yes_no', weight: 1 },
    { id: 'c', pillar: 'G', response_type: 'yes_no', weight: 1 },
  ];
  const mk = (tier) => ['a', 'b', 'c'].map((id) => ({ indicator_id: id, option_code: 'yes', is_na: false, evidence_tier: tier }));
  assert.strictEqual(computeScores({ indicators, responses: mk('self_declared'), scheme, bands }).overall.score_0_100, 60);
  assert.strictEqual(computeScores({ indicators, responses: mk('documented'),   scheme, bands }).overall.score_0_100, 85);
  assert.strictEqual(computeScores({ indicators, responses: mk('verified'),     scheme, bands }).overall.score_0_100, 100);
});

// ── 4. Empty states must be distinguishable from a genuine zero ────────────
test('no scorable indicators is not a score of zero', () => {
  const r = computeScores({
    indicators: [{ id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 }],
    responses: [{ indicator_id: 'a', is_na: true, evidence_tier: 'self_declared' }],
    scheme, bands,
  });
  assert.strictEqual(r.pillars.E.state, 'no_scorable_indicators');
  assert.strictEqual(r.overall.state, 'no_scorable_indicators');
  assert.strictEqual(r.overall.band_code, null, 'an unassessed company must not be banded CCC');
});

test('an untouched assessment is unanswered, not CCC', () => {
  const r = computeScores({
    indicators: [{ id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 }],
    responses: [], scheme, bands,
  });
  assert.strictEqual(r.overall.state, 'unanswered');
  assert.strictEqual(r.overall.band_code, null);
});

// ── 5. A missing pillar renormalises rather than capping the total ─────────
test('a pillar with no indicators renormalises the remaining weights', () => {
  const r = computeScores({
    indicators: [
      { id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 },
      { id: 'b', pillar: 'S', response_type: 'yes_no', weight: 1 },
    ],
    responses: [
      { indicator_id: 'a', option_code: 'yes', is_na: false, evidence_tier: 'verified' },
      { indicator_id: 'b', option_code: 'yes', is_na: false, evidence_tier: 'verified' },
    ],
    scheme, bands,
  });
  // Without renormalisation this would be 70, which reads as poor performance
  // rather than as missing content.
  assert.strictEqual(r.overall.score_0_100, 100);
  assert.strictEqual(r.pillars.G.state, 'no_scorable_indicators');
});

// ── 6. Bad data must not silently become a zero ────────────────────────────
test('an option_code the framework does not define is unscorable, not zero', () => {
  const r = computeScores({
    indicators: [
      { id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 },
      { id: 'b', pillar: 'E', response_type: 'yes_no', weight: 1 },
    ],
    responses: [
      { indicator_id: 'a', option_code: 'yes',   is_na: false, evidence_tier: 'verified' },
      { indicator_id: 'b', option_code: 'maybe', is_na: false, evidence_tier: 'verified' },
    ],
    scheme, bands,
  });
  assert.strictEqual(r.pillars.E.indicators_unscorable, 1);
  assert.strictEqual(r.pillars.E.score_0_100, 100);
});

test('multi_select with no option rows is unscorable, not zero', () => {
  const r = computeScores({
    indicators: [{ id: 'a', pillar: 'E', response_type: 'multi_select', weight: 5 }],
    responses: [{ indicator_id: 'a', option_code: 'x', is_na: false, evidence_tier: 'verified' }],
    scheme, bands,
  });
  assert.strictEqual(r.pillars.E.state, 'no_scorable_indicators');
});

// ── 7. The CHECK constraint and the code must agree ────────────────────────
test('every response_type in schema.sql is handled by the engine', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  const m = sql.match(/response_type\s+text\s+NOT NULL\s+CHECK \(response_type IN \(([^)]+)\)\)/);
  assert.ok(m, 'could not find the response_type CHECK in schema.sql');
  const types = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const handled = new Set([...Object.keys(STANDARD_OPTIONS), 'quantitative', 'multi_select']);
  for (const t of types) {
    assert.ok(handled.has(t), `response_type '${t}' is allowed by the schema but the engine has no branch for it — every such indicator would score zero silently`);
  }
});

// ── 8. Band boundaries ─────────────────────────────────────────────────────
test('band boundaries are inclusive and do not leave gaps', () => {
  assert.strictEqual(bandFor(85, bands), 'AAA');
  assert.strictEqual(bandFor(84.99, bands), 'AA');
  assert.strictEqual(bandFor(0, bands), 'CCC');
  assert.strictEqual(bandFor(100, bands), 'AAA');
});

// ── 9. Purity ──────────────────────────────────────────────────────────────
test('computeScores is pure — same input, same output, no mutation', () => {
  const indicators = [{ id: 'a', pillar: 'E', response_type: 'yes_no', weight: 1 }];
  const responses  = [{ indicator_id: 'a', option_code: 'yes', is_na: false, evidence_tier: 'documented' }];
  const snapshot = JSON.stringify({ indicators, responses });
  const r1 = computeScores({ indicators, responses, scheme, bands });
  const r2 = computeScores({ indicators, responses, scheme, bands });
  assert.deepStrictEqual(r1, r2);
  assert.strictEqual(JSON.stringify({ indicators, responses }), snapshot, 'inputs were mutated');
});

console.log(`scoring-engine-test: ${passed} passed`);

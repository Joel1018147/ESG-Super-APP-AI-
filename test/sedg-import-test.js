'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SEDG v2 import — the invariants, as tests                    (Run 22)
   ───────────────────────────────────────────────────────────────────────────
   The claim this run exists to make is "the 38 official SEDG disclosures are
   implemented". That sentence is only worth saying if something checks it, so:

     1. 38 rows, 17 E / 11 S / 10 G, tiers 16 / 13 / 9 — per pillar and per
        tier, not just the total. A total alone passes on 38 wrong rows.
     2. Every question_en matches docs/SEDG_V2_SOURCE.md §3 STRING FOR STRING.
        That document quotes the publisher's PDF, so this is what makes
        mapping_status='official' checkable rather than asserted.
     3. The two frameworks' indicator sets are disjoint. Existing Modus scores
        cannot move.
     4. The disclosure ratio, against hand-computed fixtures.
     5. The schema CHECK and the engine agree about which types exist.

   Pure checks (2 partially, 4, 5) run always. The DB-gated ones announce
   themselves rather than passing quietly — a skipped test and a passing test
   are indistinguishable in a summary line (§7b-ii).
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

console.log('sedg-import-test');

/* ── Parse the source document ────────────────────────────────────────────
   The publisher's text lives in a markdown table. Parsed by an exact
   structural split on the pipe, not a regex over the whole file — §7b rule 2.
   A parse that finds the wrong number of rows is a hard failure, because
   every comparison below would otherwise pass over an empty set (#14). */
const SRC = path.join(__dirname, '..', 'docs', 'SEDG_V2_SOURCE.md');
function parseSource() {
  const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
  const out = new Map();
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // ['', code, topic, tier, question, unit, '']
    if (cells.length < 6) continue;
    const rawCode = cells[1];
    if (!/SEDG-[ESG]\d/.test(rawCode)) continue;
    const code = rawCode.replace(/\*/g, '').replace(/\(new in v2\)/, '').trim();
    out.set(code, { tier: cells[3].toLowerCase(), question: cells[4], pillar: code.charAt(5) });
  }
  return out;
}
const SOURCE = parseSource();

test('the source document parses to exactly 38 disclosures', () => {
  assert.strictEqual(SOURCE.size, 38, `parsed ${SOURCE.size} — the parser or the document changed`);
});

test('the source document itself splits 17 E / 11 S / 10 G and 16 / 13 / 9', () => {
  const by = (k, v) => [...SOURCE.values()].filter((r) => r[k] === v).length;
  assert.strictEqual(by('pillar', 'E'), 17, 'E');
  assert.strictEqual(by('pillar', 'S'), 11, 'S');
  assert.strictEqual(by('pillar', 'G'), 10, 'G');
  assert.strictEqual(by('tier', 'basic'), 16, 'basic');
  assert.strictEqual(by('tier', 'intermediate'), 13, 'intermediate');
  assert.strictEqual(by('tier', 'advanced'), 9, 'advanced');
});

/* ── 5. The schema CHECK and the engine agree ─────────────────────────────── */
test('the response_type CHECK in schema.sql lists disclosure', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  const m = schema.match(/CHECK \(response_type IN \(([^)]*)\)\)/g);
  assert.ok(m && m.length, 'no response_type CHECK found at all');
  const last = m[m.length - 1];
  assert.ok(last.includes("'disclosure'"), `the effective CHECK does not permit disclosure: ${last}`);
});

test('the engine scores every type the CHECK permits, except the one known hole', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  const all = schema.match(/CHECK \(response_type IN \(([^)]*)\)\)/g);
  const types = all[all.length - 1].match(/'([a-z_0-9]+)'/g).map((s) => s.replace(/'/g, ''));
  const engine = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'scoringEngine.js'), 'utf8');

  // multi_select is a PRE-EXISTING hole, not one this run opened: trap D in
  // docs/SEDG_V2_SOURCE.md — esg_indicator_options has never had a row
  // inserted, so the engine returns null for it. Named here so the assertion
  // stays honest instead of being loosened until it passes. Run 22 did not
  // fix it (out of scope) and did not seed any SEDG row as multi_select.
  const KNOWN_UNSCORABLE = ['multi_select'];

  for (const t of types) {
    if (KNOWN_UNSCORABLE.includes(t)) continue;
    // A type is handled either as a STANDARD_OPTIONS key (`yes_no:`) or as a
    // quoted literal (`'quantitative'`, `'disclosure'`).
    const known = engine.includes(`'${t}'`) || new RegExp(`^\\s*${t}\\s*:`, 'm').test(engine);
    assert.ok(known, `the schema permits response_type '${t}' and the engine never mentions it`);
  }
  // The pairing §4 actually cares about: adding disclosure to one side only
  // must go red.
  assert.ok(types.includes('disclosure'), 'the CHECK does not permit disclosure');
  assert.ok(engine.includes("'disclosure'"), 'the engine has no disclosure branch');

  // And no SEDG row may quietly be seeded as the unscorable type.
  const seed = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'seed.sql'), 'utf8');
  const sedgBlock = seed.slice(seed.indexOf("'SEDG-E1.1'"));
  assert.ok(!/'multi_select'/.test(sedgBlock.slice(0, sedgBlock.indexOf('ON CONFLICT'))),
    'a SEDG row is seeded as multi_select, which scores null and vanishes from the score with no trace');
});

/* ── 4. The disclosure ratio, hand-computed ───────────────────────────────── */
const { computeScores } = require('../src/services/scoringEngine');
const scheme = { e_weight: 1, s_weight: 0, g_weight: 0 };
const bands = [{ code: 'A', min_score: 0, max_score: 100, label: 'A' }];

function ratioOf(line_items, value_json, extra = {}) {
  const indicators = [{ id: 'd1', code: 'X', pillar: 'E', response_type: 'disclosure', weight: 1, line_items }];
  const responses = [{ indicator_id: 'd1', value_json, is_na: false, evidence_tier: 'verified', ...extra }];
  const r = computeScores({ indicators, responses, scheme, bands });
  return { earned: r.pillars.E.points_earned, available: r.pillars.E.points_available };
}
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];

test('disclosure: all parts present scores 1.0', () => {
  const parts = {}; SIX.forEach((k) => { parts[k] = { value: 1 }; });
  assert.strictEqual(ratioOf(SIX, { parts }).earned, 1);
});

test('disclosure: 3 of 6 parts present scores 0.5', () => {
  const parts = {}; SIX.slice(0, 3).forEach((k) => { parts[k] = { value: 1 }; });
  assert.strictEqual(ratioOf(SIX, { parts }).earned, 0.5);
});

test('disclosure: 4 present + 2 not-applicable is COMPLETE (4/4), not 4/6', () => {
  const parts = {};
  SIX.slice(0, 4).forEach((k) => { parts[k] = { value: 10 }; });
  parts.e = { na: true }; parts.f = { na: true };
  assert.strictEqual(ratioOf(SIX, { parts }).earned, 1);
});

test('disclosure: no parts at all scores 0, and still counts in the denominator', () => {
  const r = ratioOf(SIX, { parts: {} });
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.available, 1);
});

test('disclosure: every part N/A is UNSCORABLE — it leaves the denominator, it is not zero', () => {
  const parts = {}; SIX.forEach((k) => { parts[k] = { na: true }; });
  const r = ratioOf(SIX, { parts });
  assert.strictEqual(r.available, 0, 'an all-N/A disclosure must not sit in the denominator');
});

test('disclosure: open list (line_items null) — non-empty text is 1.0', () => {
  assert.strictEqual(ratioOf(null, { text: 'Code of Conduct; Whistleblowing Policy' }).earned, 1);
});

test('disclosure: open list — empty text is 0', () => {
  assert.strictEqual(ratioOf(null, { text: '   ' }).earned, 0);
});

test('disclosure: number + narrative — both halves present is 1.0, one half is 0.5', () => {
  const both = ratioOf(['Number', 'Nature'], { parts: { Number: { value: 0 }, Nature: { value: 'bribery, resolved' } } });
  assert.strictEqual(both.earned, 1, 'zero is a disclosed figure — 0 incidents is an answer');
  const half = ratioOf(['Number', 'Nature'], { parts: { Number: { value: 2 } } });
  assert.strictEqual(half.earned, 0.5);
});

test('disclosure: line_items and value_json survive arriving as JSON strings', () => {
  const parts = JSON.stringify({ parts: { a: { value: 1 }, b: { value: 2 } } });
  assert.strictEqual(ratioOf('["a","b"]', parts).earned, 1);
});

/* ── DB-gated: 1, 2, 3 ────────────────────────────────────────────────────── */
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL is not set — the import invariants (counts, verbatim');
    console.error('  text, framework disjointness) did NOT run. This is not a pass.\n');
    console.log(`sedg-import-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `SELECT i.code, i.pillar, i.tier, i.question_en, i.question_bm, i.question_zh,
            i.response_type, i.weight, i.allows_na, i.external_ref, i.mapping_status, i.line_items
       FROM esg_indicators i JOIN esg_frameworks f ON f.id = i.framework_id
      WHERE f.code = 'SEDG' AND f.version = '2.0' ORDER BY i.code`);

  await atest('38 SEDG rows exist', () => {
    assert.strictEqual(rows.length, 38, `found ${rows.length}`);
  });

  await atest('pillars split 17 E / 11 S / 10 G', () => {
    const by = (p) => rows.filter((r) => r.pillar === p).length;
    assert.strictEqual(by('E'), 17, 'E'); assert.strictEqual(by('S'), 11, 'S'); assert.strictEqual(by('G'), 10, 'G');
  });

  await atest('tiers split 16 basic / 13 intermediate / 9 advanced', () => {
    const by = (t) => rows.filter((r) => r.tier === t).length;
    assert.strictEqual(by('basic'), 16, 'basic');
    assert.strictEqual(by('intermediate'), 13, 'intermediate');
    assert.strictEqual(by('advanced'), 9, 'advanced');
  });

  await atest('every question_en matches docs/SEDG_V2_SOURCE.md verbatim', () => {
    assert.strictEqual(rows.length, SOURCE.size, 'row count differs from the source before comparing text');
    for (const r of rows) {
      const src = SOURCE.get(r.code);
      assert.ok(src, `${r.code} is in the database and not in the source document`);
      assert.strictEqual(r.question_en, src.question,
        `${r.code} text drifted from the publisher's\n      db:  ${JSON.stringify(r.question_en)}\n      src: ${JSON.stringify(src.question)}`);
      assert.strictEqual(r.tier, src.tier, `${r.code} tier`);
    }
  });

  await atest('no BM or ZH text was invented — the official translations are v1 only', () => {
    const bad = rows.filter((r) => r.question_bm !== null || r.question_zh !== null).map((r) => r.code);
    assert.strictEqual(bad.length, 0, `translated: ${bad.join(', ')}`);
  });

  await atest('all 38 are weight 1.000, mapping_status official, external_ref = their own code', () => {
    for (const r of rows) {
      assert.strictEqual(Number(r.weight), 1, `${r.code} weight`);
      assert.strictEqual(r.mapping_status, 'official', `${r.code} mapping_status`);
      assert.strictEqual(r.external_ref, r.code, `${r.code} external_ref`);
    }
  });

  await atest('allows_na is true exactly where the published text says so', () => {
    for (const r of rows) {
      const says = /if applicable|if any/.test(r.question_en);
      assert.strictEqual(r.allows_na, says,
        `${r.code}: allows_na=${r.allows_na} but the text ${says ? 'DOES' : 'does NOT'} carry an applicability caveat`);
    }
  });

  await atest('every disclosure row with fixed parts has a non-empty line_items array', () => {
    for (const r of rows.filter((x) => x.response_type === 'disclosure' && x.line_items !== null)) {
      assert.ok(Array.isArray(r.line_items) && r.line_items.length > 0, `${r.code} line_items`);
    }
  });

  await atest('the two frameworks are disjoint — no code appears under both', () => {
    // Existing MODUS_SEDG_ALIGNED scores cannot move if no row is shared.
    return c.query(
      `SELECT i.code FROM esg_indicators i JOIN esg_frameworks f ON f.id = i.framework_id
        WHERE f.code = 'MODUS_SEDG_ALIGNED'`).then(({ rows: modus }) => {
      const sedg = new Set(rows.map((r) => r.code));
      const overlap = modus.map((m) => m.code).filter((code) => sedg.has(code));
      assert.strictEqual(overlap.length, 0, `shared codes: ${overlap.join(', ')}`);
      assert.strictEqual(modus.length, 40, `Modus should still hold exactly 40, found ${modus.length}`);
    });
  });

  await atest('SEDG is NOT the default framework — activation is a separate run', () => {
    return c.query(
      `SELECT code FROM esg_frameworks
        WHERE framework_kind = 'entity_disclosure' AND is_active
        ORDER BY effective_from DESC NULLS LAST LIMIT 1`).then(({ rows: def }) => {
      assert.strictEqual(def[0] && def[0].code, 'MODUS_SEDG_ALIGNED',
        'the default framework changed — this import must not have flipped it');
    });
  });

  await c.end();
  console.log(`\nsedg-import-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('sedg-import-test FAILED:', e.message); process.exit(1); });

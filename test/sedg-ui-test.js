'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SEDG disclosure UI — the invariants                            (Run 23)
   ───────────────────────────────────────────────────────────────────────────
   The one most likely to be wrong, and the hardest to notice, is that ZERO IS
   A DISCLOSURE. A company reporting 0 tonnes of hazardous waste has answered.
   There are three distinct outcomes and a renderer or a parser that collapses
   any two of them is silently wrong:

     value 0      -> disclosed, scores
     unanswered   -> not disclosed, scores 0, stays in the denominator
     N/A          -> leaves the denominator entirely

   Nothing here recomputes completeness. The assertions run the real
   scoringEngine, because a second ratio in the test would prove only that the
   test agrees with itself.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { computeScores } = require('../src/services/scoringEngine');

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
console.log('sedg-ui-test');

const scheme = { e_weight: 1, s_weight: 0, g_weight: 0 };
const bands = [{ code: 'A', min_score: 0, max_score: 100, label: 'A' }];
const PARTS = ['Generated', 'Diverted from disposal', 'Directed to disposal'];

function score(value_json) {
  const indicators = [{ id: 'd', code: 'SEDG-E4.1', pillar: 'E', response_type: 'disclosure', weight: 1, line_items: PARTS }];
  const responses = value_json === undefined ? [] : [{ indicator_id: 'd', value_json, is_na: false, evidence_tier: 'verified' }];
  const r = computeScores({ indicators, responses, scheme, bands });
  return { earned: r.pillars.E.points_earned, available: r.pillars.E.points_available };
}

/* ── Zero is a disclosure: the three outcomes, kept apart ─────────────────── */
test('ZERO is a disclosure — 0 in every part scores full marks', () => {
  const parts = {}; PARTS.forEach((p) => { parts[p] = { value: 0 }; });
  assert.strictEqual(score({ parts }).earned, 1, '0 tonnes is an answer, not a blank');
});

test('unanswered is NOT the same as zero — it scores 0 and stays in the denominator', () => {
  const r = score({ parts: {} });
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.available, 1, 'an unanswered disclosure must remain in the denominator');
});

test('N/A is NOT the same as zero — it leaves the denominator', () => {
  const parts = {}; PARTS.forEach((p) => { parts[p] = { na: true }; });
  assert.strictEqual(score({ parts }).available, 0);
});

test('the three are mutually distinguishable in one disclosure', () => {
  // one populated, one zero, one N/A -> 2 disclosed of 2 applicable = 1.0
  const r = score({ parts: {
    [PARTS[0]]: { value: 12.5 },
    [PARTS[1]]: { value: 0 },
    [PARTS[2]]: { na: true },
  } });
  assert.strictEqual(r.earned, 1, 'a populated part plus a zero part plus an N/A part is complete');
  assert.strictEqual(r.available, 1);
});

test('a zero part and an unanswered part are scored differently in the same row', () => {
  const zero = score({ parts: { [PARTS[0]]: { value: 0 }, [PARTS[1]]: { value: 0 }, [PARTS[2]]: { value: 0 } } });
  const some = score({ parts: { [PARTS[0]]: { value: 0 } } });
  assert.strictEqual(zero.earned, 1);
  assert.strictEqual(some.earned, round2(1 / 3));
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
});

/* ── The renderer and the parser use the same field grammar ───────────────── */
const PAGES = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pages.js'), 'utf8');

test('EVERY field name the renderer emits is read by the parser', () => {
  // Not "at least one of each prefix exists". The first version of this
  // assertion tested exactly that, and a mutation renaming ONE of the two
  // dv_ sites — the renderer has a numeric branch and a narrative branch —
  // sailed straight through it, because the other site still matched. A
  // renamed input would have posted a field nobody reads, and the answer
  // would have vanished on save with no error anywhere.
  const block = PAGES.slice(PAGES.indexOf('const disclosureField'), PAGES.indexOf('const field = (i)'));
  assert.ok(block.length > 200, 'disclosureField not found — the anchor moved');

  const emitted = [...block.matchAll(/name="([a-z]+)_\$\{esc\(i\.id\)\}/g)].map((m) => m[1] + '_');
  assert.ok(emitted.length >= 3, `expected at least 3 emitted fields, found ${emitted.length}`);

  const route = PAGES.slice(PAGES.indexOf("router.post('/assessment/:id'"));
  for (const nm of new Set(emitted)) {
    assert.ok(route.includes('req.body[`' + nm),
      `the renderer emits a ${nm}* field that the POST handler never reads — it would post into nothing`);
  }
  // and the reverse: nothing read that is never emitted
  const read = [...route.matchAll(/req\.body\[`(d[a-z]+)_\$\{i\.id\}/g)].map((m) => m[1] + '_');
  for (const nm of new Set(read)) {
    assert.ok(new Set(emitted).has(nm), `the parser reads a ${nm}* field the renderer never emits`);
  }
});

test('the UI does not compute its own completeness ratio', () => {
  // One definition. A second ratio in the route would drift from the engine's.
  //
  // COMMENTS ARE STRIPPED FIRST. The first version of this assertion matched
  // the word "applicable" inside the handler's own comment explaining that an
  // N/A part leaves the denominator — so a correctly-documented handler failed.
  // That is exactly the trap recurring-bugs-checklist.md #16 records under
  // "Scanning for it", reproduced here by the person who had just read it.
  const route = PAGES.slice(PAGES.indexOf("router.post('/assessment/:id'"), PAGES.indexOf("router.post('/assessment/:id'") + 5000);
  const code = route.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const smell of ['points_earned', 'points_available', 'evidenceMultiplier', 'computeScores']) {
    assert.ok(!code.includes(smell),
      `the POST handler references ${smell}; scoring belongs to scoringEngine.js alone`);
  }
  // A bare division in the persistence path would be a second ratio.
  const divisions = (code.match(/\w\s*\/\s*\w/g) || []).filter((d) => !/\/\//.test(d));
  assert.strictEqual(divisions.length, 0, `arithmetic in the persistence path: ${divisions.join(' ')}`);
});

test('every rendered disclosure value is escaped', () => {
  const block = PAGES.slice(PAGES.indexOf('const disclosureField'), PAGES.indexOf('const field = (i)'));
  assert.ok(block.length > 200, 'disclosureField not found — the anchor moved');
  // Every interpolation of a label or a stored value must go through esc().
  const bare = block.match(/\$\{(?!esc\()(?!parts\.map)(?!isNa)(?!input)(?!idx)[^}]*\}/g) || [];
  const suspicious = bare.filter((s) => /label|val|text|i\.unit|i\.id/.test(s));
  assert.strictEqual(suspicious.length, 0, `unescaped interpolation(s): ${suspicious.join(' ')}`);
});

test('/frameworks no longer contains the sentence that became false', () => {
  assert.ok(!PAGES.includes('not answerable'),
    'the page still says the disclosures are not answerable');
  const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
  assert.ok(!api.includes('not answerable'), 'the API note still says not answerable');
  assert.ok(api.includes('completeness_of_disclosure'), 'the API does not say what it scores on');
});

test('the overall product claim was NOT upgraded', () => {
  assert.ok(PAGES.includes('not SEDG-compliant'), 'the page dropped the not-SEDG-compliant statement');
  assert.ok(PAGES.includes('SEDG-ALIGNED (DRAFT)'), 'the ceiling badge changed');
});

/* ── DB-gated ─────────────────────────────────────────────────────────────── */
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — renderability of all 38 and the value_json');
    console.error('  round-trip did NOT run. This is not a pass.\n');
    console.log(`sedg-ui-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows } = await c.query(
    `SELECT i.code, i.response_type, i.line_items, i.unit
       FROM esg_indicators i JOIN esg_frameworks f ON f.id = i.framework_id
      WHERE f.code = 'SEDG' AND f.version = '2.0' ORDER BY i.code`);

  await atest('all 38 are present before the renderability walk (an empty walk is #14)', () => {
    assert.strictEqual(rows.length, 38, `found ${rows.length}`);
  });

  await atest('every one of the 38 renders a control', () => {
    assert.strictEqual(rows.length, 38, 'guard: the walk must cover 38');
    const RENDERABLE = new Set(['quantitative', 'disclosure']);
    let controls = 0;
    for (const r of rows) {
      assert.ok(RENDERABLE.has(r.response_type), `${r.code}: response_type '${r.response_type}' has no renderer`);
      if (r.response_type === 'disclosure' && r.line_items !== null) {
        assert.ok(Array.isArray(r.line_items) && r.line_items.length > 0, `${r.code}: line_items is not a non-empty array`);
        for (const l of r.line_items) {
          assert.ok(typeof l === 'string' && l.trim() !== '', `${r.code}: a blank part label renders a nameless input`);
        }
        controls += r.line_items.length;
      } else {
        controls += 1;
      }
    }
    assert.ok(controls >= 38, `only ${controls} controls across 38 disclosures`);
    console.log(`      ${controls} form controls across the 38`);
  });

  await atest('value_json round-trips through Postgres with types intact', () => {
    // The shape the POST handler writes: a populated part, a ZERO part, an N/A
    // part. jsonb must give back a number for the numbers — checklist #8 is
    // about NUMERIC, but a jsonb number surviving as a string would break the
    // engine the same way, and only a live database can show it.
    const payload = { parts: { [PARTS[0]]: { value: 12.5 }, [PARTS[1]]: { value: 0 }, [PARTS[2]]: { na: true } } };
    return c.query('SELECT $1::jsonb AS j', [JSON.stringify(payload)]).then(({ rows: [r] }) => {
      assert.strictEqual(typeof r.j, 'object', 'jsonb came back unparsed');
      assert.strictEqual(typeof r.j.parts[PARTS[0]].value, 'number', `first part value is ${typeof r.j.parts[PARTS[0]].value}`);
      assert.strictEqual(r.j.parts[PARTS[0]].value, 12.5);
      assert.strictEqual(typeof r.j.parts[PARTS[1]].value, 'number', 'ZERO must survive as a number, not a string or null');
      assert.strictEqual(r.j.parts[PARTS[1]].value, 0);
      assert.strictEqual(r.j.parts[PARTS[2]].na, true);
      assert.ok(!('value' in r.j.parts[PARTS[2]]), 'an N/A part must not carry a value');
      // and the engine agrees with the fixture on the round-tripped object
      const s = score(r.j);
      assert.strictEqual(s.earned, 1, 'round-tripped payload should score 1.0 (2 disclosed of 2 applicable)');
    });
  });

  await c.end();
  console.log(`\nsedg-ui-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('sedg-ui-test FAILED:', e.message); process.exit(1); });

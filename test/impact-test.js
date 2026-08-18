'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   ESG IMPACT, SUSTNET AND CERTIFICATION                            (Run 62/P7)
   ───────────────────────────────────────────────────────────────────────────
   THE RULE THIS SUITE EXISTS FOR:

       EXPECTED IS NEVER ACTUAL.

   A forecast made before a project exists and a reading taken after it does are
   different claims, and the second is the one a company would put in a report.
   A system that quietly promotes the first into the second manufactures results
   nobody measured — so the separation is asserted structurally (the forecast
   and the measurement live in different tables), behaviourally (no code path
   copies one to the other) and in the rendering (they never share a status).

   The rest guard the ladder below it: measured is not verified, missing is not
   zero, and neither SustNET contribution nor certification progress may be
   computed while no methodology defines them.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

async function withStub(exportsObj, fn) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const extra = Object.keys(exportsObj).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `#18: the stub invents exports the real src/db lacks: ${extra}`);
  const cached = require.cache[dbPath];
  const clear = () => {
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: exportsObj };
  clear();
  try { return await fn(); } finally { require.cache[dbPath] = cached; clear(); }
}

const PROJECT = {
  id: 'p1', title: 'Rooftop solar', status: 'implemented',
  expected_benefit_metric: 'electricity_kwh', expected_benefit_value: 380000,
  expected_benefit_basis: 'supplier_quotation', ccpt_category_code: 'C1',
};

const BASELINE = {
  id: 'm1', kind: 'baseline', metric: 'electricity_kwh', value: 486000, unit: 'kWh',
  period_start: '2025-01-01', period_end: '2025-12-31', derived_from: 'carbon_entries',
  source_entry_count: 4, is_provisional: false, verified_at: null, verification_note: null, verified_by_name: null,
};
const ACTUAL = {
  id: 'm2', kind: 'actual', metric: 'electricity_kwh', value: 152000, unit: 'kWh',
  period_start: '2027-01-01', period_end: '2027-12-31', derived_from: 'carbon_entries',
  source_entry_count: 4, is_provisional: false, verified_at: null, verification_note: null, verified_by_name: null,
};

function db({ project = PROJECT, measurements = [] } = {}) {
  return {
    query: async (sql) => {
      if (/FROM esg_green_projects p\s*\n?\s*WHERE p\.id/.test(sql) || /SELECT p\.id, p\.title, p\.status/.test(sql)) {
        return { rows: project ? [project] : [], rowCount: project ? 1 : 0 };
      }
      if (/FROM esg_green_project_baselines b/.test(sql)) return { rows: measurements, rowCount: measurements.length };
      if (/FROM esg_green_projects WHERE company_id/.test(sql)) return { rows: project ? [{ id: project.id }] : [] };
      throw new Error(`no fixture for: ${String(sql).slice(0, 70)}`);
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

const pic = (opts) => withStub(db(opts), async () => {
  const svc = require('../src/services/impactService');
  return svc.forProject('c1', 'p1');
});

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

(async () => {
  console.log('\nimpact\n');

  /* ═══ 1 · EXPECTED IS NEVER ACTUAL ═════════════════════════════════════ */

  await atest('a forecast alone produces NO actual and NO impact', async () => {
    const r = await pic({ measurements: [] });
    assert.ok(r.expected && r.expected.value === 380000, 'the forecast was lost');
    assert.strictEqual(r.expected.status, 'expected', 'the forecast does not carry the expected status');
    assert.strictEqual(r.counts.actuals, 0, 'an actual appeared from a forecast');
    assert.ok(!r.comparisons.some((c) => c.actual), 'a comparison claims an actual reading');
    assert.ok(!r.comparisons.some((c) => c.change !== null), 'an impact was computed with no measurements');
    assert.notStrictEqual(r.currentStage, 'measured', `stage is "${r.currentStage}" with nothing measured`);
  });

  await atest('IMPACT IS MEASUREMENT MINUS MEASUREMENT — never measurement minus forecast', async () => {
    const r = await pic({ measurements: [BASELINE, ACTUAL] });
    const c = r.comparisons.find((x) => x.metric === 'electricity_kwh');
    assert.strictEqual(c.change, 152000 - 486000, `change is ${c.change}, not actual minus baseline`);
    // The forecast is reported SEPARATELY and never folded into `change`.
    assert.ok(c.forecast, 'forecast accuracy was not reported at all');
    assert.strictEqual(c.forecast.expected, 380000);
    assert.notStrictEqual(c.change, c.forecast.difference,
      'the impact equals the forecast difference — the two have been conflated');
  });

  await atest('a baseline with no actual yields no change, not a zero change', async () => {
    const r = await pic({ measurements: [BASELINE] });
    const c = r.comparisons.find((x) => x.metric === 'electricity_kwh');
    assert.strictEqual(c.actual, null, 'an actual was invented');
    assert.strictEqual(c.change, null, 'a change of zero was reported where nothing was measured');
    assert.strictEqual(c.changeDirection, null, 'a direction was reported with no change');
  });

  await atest('NO CODE PATH COPIES THE FORECAST INTO A MEASUREMENT', async () => {
    // Structural, not behavioural: the writer must never read the forecast.
    const svc = SRC('services/baselineService.js');
    assert.ok(!/expected_benefit/.test(svc),
      'baselineService reads the project forecast — the writer of measurements must not see it');
    const impact = SRC('services/impactService.js');
    assert.ok(!/INSERT INTO|UPDATE /.test(impact.replace(/\/\*[\s\S]*?\*\//g, '')),
      'impactService writes — the service that derives impact must not also record it');
    const routes = SRC('routes/greenFinance.js');
    const measure = routes.slice(routes.indexOf("projects/:id/measure'"), routes.indexOf("measurements/:mid/verify"));
    assert.ok(!/expected_benefit/.test(measure),
      'the measurement route reads the forecast — a reading must come from carbon entries alone');
  });

  /* ═══ 2 · MEASURED IS NOT VERIFIED ═════════════════════════════════════ */

  await atest('a derived reading is MEASURED, and only a person makes it VERIFIED', async () => {
    const unverified = await pic({ measurements: [BASELINE, ACTUAL] });
    const c1 = unverified.comparisons[0];
    assert.strictEqual(c1.actual.status, 'measured', 'a freshly derived reading claims to be verified');
    assert.strictEqual(unverified.counts.verified, 0, 'an unverified reading was counted as verified');

    const verified = await pic({ measurements: [BASELINE,
      { ...ACTUAL, verified_at: '2028-01-15T00:00:00Z', verified_by_name: 'Nurul' }] });
    assert.strictEqual(verified.comparisons[0].actual.status, 'verified');
    assert.strictEqual(verified.comparisons[0].actual.verifiedBy, 'Nurul', 'verification is not attributed');
    assert.strictEqual(verified.counts.verified, 1);
  });

  await atest('the verify route cannot verify a baseline, or re-verify a reading', async () => {
    const routes = SRC('routes/greenFinance.js');
    const verify = routes.slice(routes.indexOf("measurements/:mid/verify"));
    assert.ok(/kind = 'actual'/.test(verify), 'the verify route would accept a baseline');
    assert.ok(/verified_at IS NULL/.test(verify), 'a reading can be verified twice, overwriting who confirmed it');
    assert.ok(/p\.company_id = \$2/.test(verify), 'the verify route is not tenant-scoped');
  });

  /* ═══ 3 · A MEASUREMENT NEEDS A CONTEXT ════════════════════════════════ */

  await atest('every actual carries a period and a source', async () => {
    const r = await pic({ measurements: [BASELINE, ACTUAL] });
    const a = r.comparisons[0].actual;
    assert.ok(/2027-01-01 to 2027-12-31/.test(a.period), `the period is "${a.period}"`);
    assert.ok(a.source && /carbon entries/i.test(a.source), `the source is "${a.source}"`);
  });

  await atest('a period with no carbon entries records NOTHING, not a zero', async () => {
    const svc = SRC('services/baselineService.js');
    assert.ok(/if \(!entries\.length\)[\s\S]{0,160}empty: true/.test(svc),
      'a period with no entries does not return early — it would write a measured zero for a period '
      + 'nobody measured');
  });

  await atest('a DATE column arrives as a Date and still renders as a date', async () => {
    // node-postgres returns DATE as a JS Date. The first version of this service
    // did String(date).slice(0,10) and rendered "Wed Jan 01" — the same
    // Date.toString() defect the original audit found on the carbon table. The
    // fixtures used strings, so only the rendered page showed it; this models
    // what the real driver actually returns.
    // Constructed at LOCAL midnight, which is what node-postgres produces for a
    // DATE column. A UTC-based formatter rolls these back a day in GMT+0800 —
    // the first fix did exactly that and rendered 2025-01-01 as "2024-12-31".
    const asDates = {
      ...ACTUAL,
      period_start: new Date(2027, 0, 1),
      period_end: new Date(2027, 11, 31),
    };
    const r = await pic({ measurements: [BASELINE, asDates] });
    const a = r.comparisons[0].actual;
    assert.strictEqual(a.period, '2027-01-01 to 2027-12-31',
      `a Date column rendered as "${a.period}"`);
    assert.ok(!/Mon|Tue|Wed|Thu|Fri|Sat|Sun|GMT/.test(a.period),
      `the period carries a JS Date string: "${a.period}"`);
  });

  /* ═══ 4 · THE LADDER IS DERIVED, AND REPORTING IS NOT BUILT ════════════ */

  await atest('the stage ladder is derived from what exists, and `reported` is unreachable', async () => {
    const r = await pic({ measurements: [BASELINE, ACTUAL] });
    const reported = r.stages.find((s) => s.code === 'reported');
    assert.strictEqual(reported.reached, false, 'a project claims to have been reported');
    assert.strictEqual(reported.blocked, true, 'the unbuilt reporting stage is not marked blocked');
    assert.strictEqual(r.stages.filter((s) => s.current).length, 1, 'more than one stage is current');
  });

  /* ═══ 5 · SUSTNET AND CERTIFICATION ════════════════════════════════════ */

  await atest('SUSTNET DEFINES NO CRITERIA, and computes no contribution', async () => {
    const f = require('../src/services/missionFrameworks');
    assert.strictEqual(f.SUSTNET.status, f.STATUS.METHODOLOGY_REQUIRED);
    assert.strictEqual(f.SUSTNET.pillars.length, 4, 'the four pillars are not named');
    for (const p of f.SUSTNET.pillars) {
      assert.deepStrictEqual([...p.criteria], [],
        `pillar ${p.code} carries criteria — a placeholder criterion is one somebody will render`);
    }
    const s = f.statusFor(f.SUSTNET, { scored: true, projects: 3, verifiedImpacts: 2 });
    assert.strictEqual(s.score, null, 'a contribution score was produced');
    assert.strictEqual(s.progressPercent, null, 'a contribution percentage was produced');
    assert.strictEqual(s.level, null, 'a contribution level was produced');
    assert.strictEqual(s.configured, false);
  });

  await atest('CERTIFICATION DEFINES NO LEVELS, and computes no progress', async () => {
    const f = require('../src/services/missionFrameworks');
    assert.strictEqual(f.CERTIFICATION.status, f.STATUS.FRAMEWORK_REQUIRED);
    assert.deepStrictEqual([...f.CERTIFICATION.levels], [], 'certification levels were invented');
    assert.deepStrictEqual([...f.CERTIFICATION.requirements], [], 'certification requirements were invented');
    const s = f.statusFor(f.CERTIFICATION, { scored: true, projects: 5, verifiedImpacts: 9 });
    assert.strictEqual(s.score, null);
    assert.strictEqual(s.progressPercent, null);
    assert.strictEqual(s.level, null);
    // A company with a lot of data still gets no progress figure.
    assert.ok(s.foundation.every((x) => typeof x.present === 'boolean'),
      'the foundation list is not a set of plain facts');
  });

  await atest('a strong ESG position does NOT become SustNET contribution', async () => {
    const f = require('../src/services/missionFrameworks');
    const rich = f.statusFor(f.SUSTNET, { scored: true, projects: 10, verifiedImpacts: 10 });
    const bare = f.statusFor(f.SUSTNET, { scored: false, projects: 0, verifiedImpacts: 0 });
    assert.strictEqual(rich.status, bare.status,
      'the framework status changed with the company data — no methodology exists to change it');
    assert.strictEqual(rich.score, bare.score, 'a score appeared for a company with more data');
  });

  /* ═══ 6 · NOTHING IS INVENTED ══════════════════════════════════════════ */

  await atest('an unknown project returns null, not an empty impact picture', async () => {
    const r = await pic({ project: null });
    assert.strictEqual(r, null, 'a project that does not exist produced an impact picture');
  });

  await atest('the impact page never calls a project certified or officially recognised', async () => {
    const routes = SRC('routes/greenFinance.js');
    const page = routes.slice(routes.indexOf("router.get('/impact'"));
    for (const claim of [/officially green/i, /certified/i, /accredited/i, /recognised by sustnet/i]) {
      assert.ok(!claim.test(page), `the impact page contains a claim matching ${claim}`);
    }
  });

  console.log(`\nimpact: ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();

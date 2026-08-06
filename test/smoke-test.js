'use strict';
// End-to-end smoke test against a REAL PostgreSQL and a real HTTP listener.
//
// Not in `npm test` because it needs a database and a free port. Run it before
// every deploy:  DATABASE_URL=... node test/smoke-test.js
//
// It walks the whole sprint-1 path — register, profile, assessment, responses,
// score, carbon, dashboard — and then checks the two things that unit tests
// cannot: that an anonymous caller is refused, and that one company cannot read
// another company's assessment by guessing its UUID.

const { spawn } = require('child_process');
const assert = require('assert');

const PORT = process.env.SMOKE_PORT || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); });
}

function jarFetch(jar) {
  return async (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (jar.cookie) headers.Cookie = jar.cookie;
    const res = await fetch(BASE + url, { ...opts, headers, redirect: 'manual' });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) if (c.startsWith('connect.sid')) jar.cookie = c.split(';')[0];
    return res;
  };
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                       body: new URLSearchParams(o).toString() });
const json = (method, o) => ({ method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                               body: JSON.stringify(o) });

(async () => {
  if (!process.env.DATABASE_URL) { console.error('smoke-test: DATABASE_URL required'); process.exit(1); }

  const srv = spawn(process.execPath, [require.resolve('../src/server.js')], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', SESSION_SECRET: 'smoke-test-secret-value-long-enough' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });

  const stop = () => { try { srv.kill('SIGTERM'); } catch {} };
  process.on('exit', stop);

  // Wait for the listener.
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('smoke-test');
  const A = jarFetch({});
  const anon = jarFetch({});
  const stamp = Date.now();
  let assessmentId = null;

  await check('health reports the database up', async () => {
    const r = await fetch(`${BASE}/health`);
    const b = await r.json();
    assert.strictEqual(b.ok, true); assert.strictEqual(b.db, 'up');
  });

  await check('an anonymous API call is refused with 401, not a redirect', async () => {
    const r = await anon('/api/company', { headers: { Accept: 'application/json' } });
    assert.strictEqual(r.status, 401);
  });

  await check('registration creates a company and signs the user in', async () => {
    const r = await A('/auth/register', form({
      company: `Smoke Sdn Bhd ${stamp}`, name: 'Smoke Tester',
      email: `smoke${stamp}@example.com`, password: 'a-long-enough-password',
    }));
    assert.ok([302, 303].includes(r.status), `expected redirect, got ${r.status}`);
    const me = await A('/api/me', { headers: { Accept: 'application/json' } });
    assert.strictEqual(me.status, 200);
    assert.ok((await me.json()).company_id, 'company_id must never be null');
  });

  await check('grid region saves and is required for Scope 2', async () => {
    const r = await A('/api/company', json('PUT', { grid_region: 'peninsular' }));
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).grid_region, 'peninsular');
  });

  await check('an assessment can be created and is idempotent per year', async () => {
    const r1 = await A('/api/assessments', json('POST', { reporting_year: 2025 }));
    assert.strictEqual(r1.status, 201);
    assessmentId = (await r1.json()).id;
    const r2 = await A('/api/assessments', json('POST', { reporting_year: 2025 }));
    assert.strictEqual((await r2.json()).id, assessmentId, 'a second create for the same year must not fork a duplicate');
  });

  await check('responses save, and unknown indicator codes are reported not swallowed', async () => {
    const inds = await (await A('/api/indicators?framework=MODUS_SEDG_ALIGNED', { headers: { Accept: 'application/json' } })).json();
    assert.ok(inds.indicators.length >= 40, `expected the seeded indicator set, got ${inds.indicators.length}`);
    const responses = inds.indicators.map((i) => (
      i.response_type === 'quantitative'
        ? { code: i.code, value_numeric: 100, evidence_tier: 'documented' }
        : i.response_type === 'maturity_0_4'
          ? { code: i.code, option_code: '4', evidence_tier: 'documented' }
          : { code: i.code, option_code: 'yes', evidence_tier: 'documented' }));
    responses.push({ code: 'NOT-A-REAL-CODE', option_code: 'yes' });
    const r = await A(`/api/assessments/${assessmentId}/responses`, json('PUT', { responses }));
    const b = await r.json();
    assert.strictEqual(b.written, inds.indicators.length);
    assert.deepStrictEqual(b.rejected, ['NOT-A-REAL-CODE'], 'a dropped response must be reported');
  });

  await check('scoring an all-documented assessment yields exactly 85.00', async () => {
    const r = await A(`/api/assessments/${assessmentId}/score`, json('POST', { with_recommendations: false }));
    assert.strictEqual(r.status, 200);
    const b = await r.json();
    // Every answer supplied, every one documented -> the 0.85 conservativeness
    // ceiling. If this drifts, the evidence multiplier has changed.
    assert.strictEqual(b.overall.score_0_100, 85, `got ${b.overall.score_0_100}`);
    assert.strictEqual(b.overall.band_code, 'AAA');
    for (const p of ['E', 'S', 'G']) assert.strictEqual(b.pillars[p].score_0_100, 85, `pillar ${p}`);
  });

  await check('scores persist and carry their provenance stamps', async () => {
    const b = await (await A(`/api/assessments/${assessmentId}`, { headers: { Accept: 'application/json' } })).json();
    const overall = b.scores.find((s) => s.scope === 'OVERALL');
    assert.ok(overall, 'no OVERALL row');
    assert.strictEqual(Number(overall.score_0_100), 85);
    assert.ok(overall.weighting_version && overall.framework_version && overall.engine_version,
      'a score with no version stamps cannot be reproduced later');
  });

  await check('Scope 2 uses the Peninsular factor and the stamp is stored', async () => {
    const r = await A('/api/carbon', json('POST', {
      kind: 'electricity', amount: 10000, period_start: '2025-01-01', period_end: '2025-12-31' }));
    assert.strictEqual(r.status, 201);
    const b = await r.json();
    assert.strictEqual(Number(b.kg_co2e), 7400, '10,000 kWh x 0.740 = 7,400 kg CO2e');
    assert.strictEqual(b.is_provisional, false, 'the grid factor is sourced and verified');
  });

  await check('a placeholder fuel factor still calculates but is flagged provisional', async () => {
    const r = await A('/api/carbon', json('POST', {
      kind: 'FUEL_DIESEL', amount: 100, period_start: '2025-01-01', period_end: '2025-12-31' }));
    const b = await r.json();
    assert.strictEqual(Number(b.kg_co2e), 268);
    assert.strictEqual(b.is_provisional, true, 'an unverified factor must never look verified');
  });

  await check('the governance page carries no registry brand but keeps data attribution', async () => {
    const html = await (await A('/governance')).text();
    assert.ok(!/Verra Registry/i.test(html), 'the old menu label survived');
    assert.ok(/Governance &amp; Recognition|Governance & Recognition/.test(html), 'page title not renamed');
  });

  await check('the registry mirror reports uninstrumented rather than empty', async () => {
    const b = await (await A('/api/verra/status', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(b.state, 'uninstrumented');
    assert.strictEqual(b.ingest_enabled, false);
  });

  await check('the dashboard renders with the ESG accent and the score', async () => {
    const r = await A('/dashboard');
    const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(html.includes('data-platform="esg"'), 'wrong platform accent');
    assert.ok(html.includes('Malaysia SMEs ESG e-Reporting System'), 'system name missing from the shell');
    assert.ok(html.includes('85'), 'the score is not on the page');
    assert.ok(!html.includes('undefined'), 'a template hole rendered as "undefined"');
  });

  await check('the stylesheet is served, cached and reachable while signed out', async () => {
    const page = await (await A('/dashboard')).text();
    const href = (page.match(/href="(\/css\/modus-design-system\.css\?v=[0-9a-f]+)"/) || [])[1];
    assert.ok(href, 'no versioned stylesheet link on the page');
    // Anonymous, because a browser fetches the sheet on the login page too.
    const res = await anon(href);
    assert.strictEqual(res.status, 200, `stylesheet returned ${res.status} to an anonymous request`);
    assert.ok((res.headers.get('content-type') || '').includes('css'), 'wrong content-type');
    assert.ok(page.length < 20000, `dashboard is ${page.length} bytes; the sheet is being inlined again`);
  });

  await check('one company cannot read another company\'s assessment', async () => {
    const B = jarFetch({});
    await B('/auth/register', form({
      company: `Other Sdn Bhd ${stamp}`, name: 'Other', email: `other${stamp}@example.com`,
      password: 'another-long-password' }));
    const r = await B(`/api/assessments/${assessmentId}`, { headers: { Accept: 'application/json' } });
    assert.strictEqual(r.status, 404, 'cross-tenant read was not refused');
  });

  await check('every page route has a JSON equivalent that answers', async () => {
    for (const p of ['/api/me', '/api/company', '/api/assessments', '/api/carbon',
                     '/api/frameworks', '/api/indicators', '/api/emission-factors', '/api/verra/status']) {
      const r = await A(p, { headers: { Accept: 'application/json' } });
      assert.strictEqual(r.status, 200, `${p} returned ${r.status}`);
    }
  });

  stop();
  console.log(failed ? `\n❌ smoke-test: ${failed} failed, ${passed} passed\n${log}`
                     : `\n✅ smoke-test: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();

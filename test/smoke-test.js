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

  // TRAP C. Two frameworks are selectable now, so naming a code without a
  // version stopped being unambiguous. Both are named here and in the
  // /api/indicators request below; if either filter loses its version again,
  // this test fails rather than quietly asserting against the wrong set.
  const FW = { framework: 'MODUS_SEDG_ALIGNED', framework_version: '0.9-draft' };

  await check('creating an assessment REQUIRES a framework — there is no default', async () => {
    const r = await A('/api/assessments', json('POST', { reporting_year: 2025 }));
    assert.strictEqual(r.status, 400, 'a create with no framework must be refused, not silently defaulted');
    const b = await r.json();
    assert.match(b.error || '', /framework is required/i, JSON.stringify(b));
  });

  await check('an unknown framework is refused, not substituted', async () => {
    const r = await A('/api/assessments', json('POST', { reporting_year: 2025, framework: 'NOT_A_FRAMEWORK' }));
    assert.strictEqual(r.status, 400, 'an unknown framework must not fall back to the Modus 40');
  });

  await check('an assessment can be created and is idempotent per year', async () => {
    const r1 = await A('/api/assessments', json('POST', { reporting_year: 2025, ...FW }));
    assert.strictEqual(r1.status, 201);
    assessmentId = (await r1.json()).id;
    const r2 = await A('/api/assessments', json('POST', { reporting_year: 2025, ...FW }));
    assert.strictEqual((await r2.json()).id, assessmentId, 'a second create for the same year must not fork a duplicate');
  });

  await check('responses save, and unknown indicator codes are reported not swallowed', async () => {
    const inds = await (await A(`/api/indicators?framework=${FW.framework}&version=${FW.framework_version}`, { headers: { Accept: 'application/json' } })).json();
    // EXACTLY 40, not "at least". With SEDG selectable the old >= 40 would
    // have passed on 78 — every indicator in the database — and the responses
    // built from it would have been posted against the wrong framework.
    assert.strictEqual(inds.indicators.length, 40, `expected exactly the Modus 40, got ${inds.indicators.length}`);
    assert.ok(inds.indicators.every((i) => i.framework_version === FW.framework_version),
      'the version filter is not being applied — indicators from another framework version came back');
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
    // Same reasoning as the unit guard: pin this to the inline style block, not
    // to total page size, so it survives the app growing real markup.
    const inlineBytes = (page.match(/<style>[\s\S]*?<\/style>/g) || [])
      .reduce((n, blk) => n + Buffer.byteLength(blk, 'utf8'), 0);
    assert.ok(inlineBytes < 12000,
      `dashboard carries ${inlineBytes} bytes of inline <style>; the sheet is being inlined again`);
  });

  let documentId = null;
  await check('a PDF uploads, stores and lists', async () => {
    const { makePdf } = require('./fixtures/makePdf');
    const pdf = makePdf([['Sustainability Report', 'We publish an anti-bribery policy.']]);
    const fd = new FormData();
    fd.append('doc_type', 'esg_report');
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'report.pdf');
    const r = await A('/documents', { method: 'POST', body: fd });
    assert.ok([302, 303].includes(r.status), `upload returned ${r.status}`);
    const list = await (await A('/api/documents', { headers: { Accept: 'application/json' } })).json();
    const doc = list.documents.find((d) => d.filename === 'report.pdf');
    assert.ok(doc, 'uploaded file is not in the list');
    assert.strictEqual(doc.text_status, 'pending', 'a fresh upload should not claim to be analysed');
    documentId = doc.id;
  });

  await check('analysis is queued, and a second request is reported not silently dropped', async () => {
    const first = await A(`/api/documents/${documentId}/analyse`, json('POST', {}));
    assert.strictEqual(first.status, 202, 'first analyse was not queued');
    assert.strictEqual((await first.json()).queued, true);
    // The per-target dedupe key means a duplicate is refused rather than
    // queued twice — and the caller is told, rather than being left to wonder
    // why nothing happened.
    const second = await A(`/api/documents/${documentId}/analyse`, json('POST', {}));
    const b = await second.json();
    assert.strictEqual(b.queued, false, 'the same document was queued twice');
  });

  await check('the evidence page renders the document and its true status', async () => {
    const html = await (await A(`/documents/${documentId}`)).text();
    assert.ok(html.includes('report.pdf'), 'filename missing');
    assert.ok(!html.includes('is not built yet'), 'the old stub page is still being served');
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
                     '/api/frameworks', '/api/frameworks/sedg-v2', '/api/indicators',
                     '/api/emission-factors', '/api/verra/status', '/api/documents',
                     '/api/analytics', '/api/kpis', '/api/assistant',
                     '/api/workflow', '/api/users', '/api/integrations',
                     '/api/finance-products', '/api/project-types',
                     '/api/taxonomy/CCPT', '/api/taxonomy/ASEAN',
                     '/api/journey', '/api/missions', '/api/xp',
                     `/api/assessments/${assessmentId}/extractions`]) {
      const r = await A(p, { headers: { Accept: 'application/json' } });
      assert.strictEqual(r.status, 200, `${p} returned ${r.status}`);
    }
  });

  await check('the journey is derived from the rows this run actually wrote', async () => {
    // GATE 2 IN ONE CHECK. By this point the suite has a completed profile, a
    // fully answered and scored assessment, two carbon entries and an uploaded
    // document — all written through real HTTP — so the journey is the only
    // surface that can prove those rows and the derived figures agree.
    const j = await (await A('/api/journey', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(j.state, 'ok', `journey reported ${j.state}`);
    const by = Object.fromEntries(j.stages.map((s) => [s.stage_code, s]));

    // THE PROFILE IS GENUINELY PART-DONE AT THIS POINT — registration set the
    // name and the grid region and nothing has set an SSM number, an MSIC code
    // or a headcount. So the honest answer is 2 of 5, and asserting it here is
    // what makes the flip below mean something. This assertion was written the
    // other way round first and the engine was right: a derived figure that
    // disagrees with a fixture is a finding about the fixture.
    assert.strictEqual(by.COMPANY_PROFILE.state, 'in_progress',
      `a half-filled profile reports ${by.COMPANY_PROFILE.state}`);
    assert.strictEqual(by.COMPANY_PROFILE.done, 2,
      `expected 2 of 5 profile fields, got ${by.COMPANY_PROFILE.done} of ${by.COMPANY_PROFILE.total}`);

    assert.strictEqual(by.ASSESSMENT_ANSWERED.state, 'completed',
      `every indicator was answered but the stage says ${by.ASSESSMENT_ANSWERED.state}`);
    assert.strictEqual(by.ASSESSMENT_ANSWERED.total, 40,
      `the denominator resolved to ${by.ASSESSMENT_ANSWERED.total}, not the Modus 40`);
    assert.strictEqual(by.ASSESSMENT_SCORED.state, 'completed', 'a scored assessment did not complete its stage');
    assert.strictEqual(by.CARBON_DATA.state, 'completed', 'two carbon entries did not complete their stage');
    assert.strictEqual(by.CERTIFICATION.state, 'blocked', 'certification is not reported as blocked');
    assert.strictEqual(by.CERTIFICATION.blocked_reason_code, 'CERTIFICATION');

    const xp = await (await A('/api/xp', { headers: { Accept: 'application/json' } })).json();
    assert.ok(xp.total > 0, 'nothing earned any XP after a full run through the product');
    assert.ok(xp.awards.length >= 4, `only ${xp.awards.length} awards for a completed assessment`);
    for (const a of xp.awards) {
      assert.ok(a.source_table && a.source_id && a.earned_at,
        `award ${a.mission_code} reached the API with no provenance`);
    }
    // §4.3b: codes over the wire, never a display string.
    assert.ok(!JSON.stringify(j).includes('Set up your company profile'),
      'the journey API sends an English label');

    // AND THE FIGURE MOVES WHEN THE ROWS MOVE. Filling the three missing profile
    // fields through the real API must flip the stage and add its XP, with no
    // journey-specific write anywhere — which is the entire claim this run makes.
    const put = await A('/api/company', json('PUT', {
      ssm_number: `SMOKE${stamp}`, msic_code: '25113', employee_count: 12 }));
    assert.strictEqual(put.status, 200);
    const j2 = await (await A('/api/journey', { headers: { Accept: 'application/json' } })).json();
    const profile2 = j2.stages.find((s) => s.stage_code === 'COMPANY_PROFILE');
    assert.strictEqual(profile2.state, 'completed',
      `filling the remaining profile fields left the stage at ${profile2.state} — the figure is not derived`);
    const xp2 = await (await A('/api/xp', { headers: { Accept: 'application/json' } })).json();
    assert.ok(xp2.total > xp.total,
      `XP did not move when the underlying rows did: ${xp.total} then ${xp2.total}`);
    const profileAward = xp2.awards.find((a) => a.source_table === 'esg_companies');
    assert.ok(profileAward, 'the profile mission earned no award after the profile was completed');
  });

  await check('every navigable screen renders signed-in', async () => {
    // The demo is "one navigable screen per requirement section". A 500 or a
    // redirect on any of them is the whole thing failing in front of someone.
    //
    // THE COUNT PIN MOVED TO THE END OF THIS CHECK, and that is the point of
    // the change rather than a tidy-up. It used to run FIRST, so when P1–P7
    // took the nav from 16 entries to 20 the assertion aborted before a single
    // screen had been fetched — the suite reported one failure and had in fact
    // verified nothing at all about any of the twenty. A tripwire that
    // suppresses the check it guards is worse than no tripwire.
    //
    // It is still a pin: a nav change still has to be deliberate. It just no
    // longer decides whether the real work runs.
    const { MODULES } = require('../src/utils/layout');
    for (const m of MODULES) {
      const r = await A(m.path);
      assert.strictEqual(r.status, 200, `${m.path} returned ${r.status}`);
      const html = await r.text();
      // Not just "did it 200" — a page that renders the shell and nothing else
      // still looks like a working screen in a screenshot.
      assert.ok(html.includes('modus-design-system.css'), `${m.path} rendered unstyled`);
      assert.ok(html.includes('data-platform="esg"'), `${m.path} lost the platform accent`);
      // THE SAME INVARIANT, AGAINST THE COMPONENTS THE PAGES NOW USE.
      // P8 moved the product onto the additive ESG layer, so a migrated page
      // renders .esg-card / .esg-section and no .card at all. The question this
      // asks is unchanged — "did this screen render a real content block, or
      // just the shell?" — and answering it against a component set the product
      // has stopped using would have made it pass vacuously on every page P8
      // touched. The master names stay for the pages still on them.
      assert.ok(/class="(card|empty-state|coming-soon|stat-card|alert|esg-card|esg-section|esg-page-header|esg-hero|esg-facts|esg-track|esg-table-scroll|esg-ai|esg-reserved)/.test(html),
        `${m.path} rendered no real content block`);

      // THE SAME VISIBLE-TEXT RULE AS THE UNIT GUARD, BUT WITH REAL DATA.
      //
      // The unit guard renders every page against an EMPTY database, so any
      // string that only appears once a row exists is invisible to it. That is
      // not hypothetical: /dashboard and /assessment both printed the raw
      // framework code `MODUS_SEDG_ALIGNED` in a provenance line and a table
      // cell that render only when an assessment exists. Both passed the unit
      // guard and both leaked in production.
      //
      // This suite has a scored assessment by the time it gets here, so it is
      // the only place that check can actually fire. Same shape: strip script
      // and style bodies, strip every tag and therefore every attribute.
      const text = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      for (const re of [/modus/i, /verra/i]) {
        const hit = text.match(re);
        assert.ok(!hit, `${m.path} visible text contains "${hit && hit[0]}": `
          + `…${text.slice(Math.max(0, text.search(re) - 80), text.search(re) + 80)}…`);
      }
    }

    // THE PIN, after every screen above has actually been fetched and checked.
    // 14 until Run 47 added Green Finance; 15 until Run 52 added ESG Journey;
    // 20 after P1–P7 added Green projects, Finance readiness, AI suggestions
    // and ESG Impact. A change here must be deliberate — but it can no longer
    // stop the twenty screens above from being verified.
    assert.strictEqual(MODULES.length, 20,
      `the nav is ${MODULES.length} entries, not 20 — every one of them rendered, so this is a `
      + 'deliberate-change pin rather than a failure: update the count and the history line above');
  });

  await check('the official disclosure set is complete and not claimed as implemented', async () => {
    const r = await A('/api/frameworks/sedg-v2', { headers: { Accept: 'application/json' } });
    const b = await r.json();
    assert.strictEqual(b.disclosures.length, 38, `expected 38 disclosures, got ${b.disclosures.length}`);
    assert.strictEqual(b.counts.pillars.E, 17, 'E count');
    assert.strictEqual(b.counts.pillars.S, 11, 'S count');
    assert.strictEqual(b.counts.pillars.G, 10, 'G count');
    // STALE SINCE RUN 23, found by running this suite in Run 47. `8479e65`
    // ("SEDG: answerable in the UI") flipped api.js:59 to `implemented: true`
    // because the 38 disclosures genuinely became answerable and scored; this
    // assertion kept demanding `false` and has been the only red line in this
    // suite ever since. RULE 3 — the artefact wins and the document gets fixed.
    //
    // The claim that must NOT be upgraded is a different one: SEDG-ALIGNED
    // (DRAFT) rather than SEDG-compliant. That is asserted on its own, in
    // sedg-ui-test.js, and is unaffected.
    assert.strictEqual(b.implemented, true, 'the API no longer reports SEDG as implemented');
    assert.strictEqual(b.scored_on, 'completeness_of_disclosure',
      'the API does not say WHAT it scores the disclosures on');
    assert.strictEqual(b.is_default_framework, false, 'SEDG has silently become the default framework');
  });

  stop();
  console.log(failed ? `\n❌ smoke-test: ${failed} failed, ${passed} passed\n${log}`
                     : `\n✅ smoke-test: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();

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
                     // P9's six. CLAUDE.md #9: no feature ships without its
                     // API equivalent, and this is where that is checked.
                     '/api/actions', '/api/gaps', '/api/roadmap',
                     '/api/report-readiness', '/api/consultation',
                     `/api/assessments/${assessmentId}/extractions`]) {
      const r = await A(p, { headers: { Accept: 'application/json' } });
      assert.strictEqual(r.status, 200, `${p} returned ${r.status}`);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     P9 · THE OPERATING WORKFLOW, AGAINST THE ROWS THIS RUN ACTUALLY WROTE
     ─────────────────────────────────────────────────────────────────────
     GATE 2 FOR P9. By this point the suite has a part-filled profile, a fully
     answered and SCORED assessment, two carbon entries and an uploaded
     document — written through real HTTP against a real Postgres. That is the
     only state in which these three can be checked as anything other than
     shapes: an action list, a gap list and a roadmap all derive from exactly
     those rows.

     A 200 is not the assertion. What is asserted is that the figures agree
     with what this run put in the database, and that the honesty rules hold on
     live data rather than on a fixture.
     ═════════════════════════════════════════════════════════════════════ */
  await check('P9 · the action list derives from this run\'s own rows, and every priority explains itself', async () => {
    const a = await (await A('/api/actions', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(a.state, 'ok', `the action list reported ${a.state}`);
    assert.ok(a.actions.length > 0, 'no action at all was derived');

    for (const x of a.actions) {
      assert.ok(x.basis && x.basis.length > 20, `${x.code} carries no basis`);
      assert.ok(x.cta && x.href, `${x.code} has no verb or no destination`);
      for (const generic of ['get started', 'learn more', 'explore', 'view details']) {
        assert.notStrictEqual(x.cta.toLowerCase().trim(), generic,
          `${x.code} uses the generic CTA "${x.cta}"`);
      }
    }

    // THE PROFILE IS PART-DONE AT THIS POINT, exactly as the journey check
    // below asserts, so the profile stage must be OPEN and not completed.
    const profile = a.actions.find((x) => x.code === 'STAGE_COMPANY_PROFILE');
    assert.ok(profile, 'the profile stage produced no action');
    assert.notStrictEqual(profile.state, 'completed',
      'a half-filled profile was reported as a completed action');

    // The scored assessment's stage IS completed, and a completed action is
    // outside the open count.
    const scored = a.actions.find((x) => x.code === 'STAGE_ASSESSMENT_SCORED');
    assert.strictEqual(scored.state, 'completed',
      `a scored assessment's stage reports ${scored.state}`);

    // A blocked stage renders its reason and is not counted as work.
    const blocked = a.actions.filter((x) => x.state === 'blocked');
    assert.ok(blocked.length > 0, 'the seeded blocked stages produced no blocked action');
    for (const b of blocked) assert.ok(b.why.length > 30, `${b.code} is blocked with no reason`);

    // And the seven states are published with their meanings, so a client
    // cannot invent its own vocabulary for them.
    assert.strictEqual(a.states.length, 7);

    /* THE TOP BAR AND THIS LIST MAY NEVER DISAGREE.
       shellContext renders "N need review" on every page, and it is
       extractions_pending + suggestions_pending. FOUND ON STAGING during this
       run: the chip read 5 and the list mentioned none of them, because the
       suggestion queue was surfaced only while a company had no green project.
       Asserted here over real HTTP as well as at unit level, because it is a
       disagreement between two independent queries and only a live run puts
       both in front of the same rows. */
    const me = await (await A('/api/me', { headers: { Accept: 'application/json' } })).json();
    assert.ok(me.company_id, 'the session carries no company');
    const chip = a.actions.filter((x) => /proposal|suggestion/i.test(x.cta + ' ' + x.what));
    const queued = a.counts.urgent + a.counts.priority + a.counts.recommended;
    assert.ok(queued >= 0);
    // Whatever review work exists must be NAMED by exactly one action each.
    const suggestions = a.actions.filter((x) => /suggestion/i.test(x.cta + ' ' + x.what));
    const proposals = a.actions.filter((x) => /proposal/i.test(x.cta + ' ' + x.what));
    assert.ok(suggestions.length <= 1,
      `${suggestions.length} cards ask about the same suggestion queue`);
    assert.ok(proposals.length <= 1,
      `${proposals.length} cards ask about the same proposal queue`);
    assert.ok(chip.length === suggestions.length + proposals.length);
  });

  await check('P9 · the gap list carries the ENGINE\'s points, one row per indicator', async () => {
    const g = await (await A('/api/gaps', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(g.state, 'ok', `the gap analysis reported ${g.state}`);

    // This run answers every indicator as `documented`, not `verified`, so the
    // evidence multiplier leaves points on the table and the engine writes
    // recommendation rows. A gap list of zero here would mean the scoring
    // engine stopped writing them, which is a finding either way.
    assert.ok(g.gaps.length > 0,
      'a documented-but-unverified assessment produced no gap at all — the engine writes a '
      + 'recommendation row for every indicator short of full weight');

    const ids = g.gaps.map((x) => x.indicator_id);
    assert.strictEqual(new Set(ids).size, ids.length,
      'the same indicator appears twice — the engine row and its ai_phrasing sibling were both '
      + 'counted, which doubles every figure on the page');

    for (const x of g.gaps) {
      assert.ok(typeof x.points_missed === 'number' && x.points_missed > 0,
        `${x.code} carries no engine figure`);
      assert.ok(['unanswered', 'unevidenced', 'partial'].includes(x.kind), `${x.code}: kind ${x.kind}`);
      assert.ok(typeof x.evidence.configured === 'boolean',
        `${x.code} does not say whether its evidence requirement is configured`);
      // WHO SHOULD ACT: the platform has no owner column and must say so.
      assert.ok(/nobody is assigned/i.test(x.who), `${x.code} nominates an owner: "${x.who}"`);
    }

    // The total is the sum of the parts, rounded once.
    const summed = Math.round(g.gaps.reduce((n, x) => n + x.points_missed, 0) * 100) / 100;
    assert.strictEqual(g.counts.points_missed, summed,
      `the headline total (${g.counts.points_missed}) is not the sum of the gaps (${summed})`);
  });

  await check('P9 · the roadmap says how each rung is joined, and never claims a report', async () => {
    const r = await (await A('/api/roadmap', { headers: { Accept: 'application/json' } })).json();
    assert.ok(r.steps.length >= 9, `only ${r.steps.length} rungs`);

    for (const s of r.steps) {
      assert.ok(['derived', 'recorded', 'sequence', 'none'].includes(s.link),
        `${s.code} claims link kind "${s.link}"`);
      assert.ok(s.link_meaning, `${s.code} publishes no meaning for its link kind`);
      assert.ok(!/\d+\s?%/.test(`${s.what} ${s.detail || ''}`),
        `${s.code} states a percentage over a set of discrete facts`);
    }

    // THE CLAIM THAT MATTERS. Nothing in this system establishes that a green
    // opportunity answers an ESG gap — the scan is never told the gaps.
    assert.strictEqual(r.steps.find((s) => s.code === 'OPPORTUNITY').link, 'sequence',
      'the roadmap claims a green opportunity is computed from an ESG gap');

    assert.strictEqual(r.steps.find((s) => s.code === 'REPORTED').state, 'not_configured',
      'the roadmap reached a reported state — nothing here writes a report file');
  });

  await check('P9 · reporting readiness reports what exists, and refuses to generate', async () => {
    const rr = await (await A('/api/report-readiness', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(rr.generator.built, false,
      'the reporting page claims a generator this codebase does not contain');
    assert.deepStrictEqual(rr.generator.formats, [], 'a format is offered by a generator that is not built');

    const by = Object.fromEntries(rr.sections.map((s) => [s.code, s]));
    // This run wrote a score, answers, a document and carbon entries.
    for (const code of ['SCORE', 'ANSWERS', 'EVIDENCE', 'CARBON']) {
      assert.strictEqual(by[code].state, 'available',
        `${code} is reported as ${by[code].state} after this run wrote rows for it`);
    }
    // And it wrote no green project, which is "nothing recorded" — an empty
    // account, not a platform limit.
    assert.strictEqual(by.PROJECTS.state, 'missing',
      `no project was created and PROJECTS reports ${by.PROJECTS.state}`);
    // The three that cannot exist for anybody say WHY.
    for (const code of ['SUSTNET', 'CERTIFICATION', 'ASSURANCE']) {
      assert.strictEqual(by[code].state, 'not_configured');
      assert.ok(by[code].why && by[code].why.length > 40,
        `${code} does not say why it cannot exist, so it reads as a gap in the company's data`);
    }
  });

  await check('P9 · expert support is triggered by a situation and never by a score', async () => {
    const c = await (await A('/api/consultation', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(c.considered, 6, `${c.considered} rules were considered, not 6`);
    assert.strictEqual(c.booking.built, false, 'a booking capability is claimed that does not exist');
    assert.ok(Object.keys(c.thresholds).length === 6,
      'the thresholds are not published, so the rule cannot be checked by a reader');
    // Every fired trigger names the rows it fired on, with a figure in it.
    for (const t of c.triggers) {
      assert.ok(/\d/.test(t.because), `${t.code} fired without naming a figure: "${t.because}"`);
    }
    // The signals are counts of rows, and none of them is a score.
    assert.ok(!('score' in c.signals) && !('band' in c.signals),
      'the consultation signals carry a score — the directive rules that out explicitly');
  });

  await check('P9 · the copilot answers one disclosure and produces no figure', async () => {
    /* THE SUBJECT COMES FROM THE GAP LIST, NOT FROM /api/indicators.
       The first draft took it from /api/indicators and got a 400 — that
       endpoint deliberately returns a framework's questions by CODE and does
       not publish the row id, because a code is the public identifier of a
       disclosure and an id is not. The gap list does carry indicator_id, and
       it is the better subject anyway: a real outstanding disclosure of this
       company's, which is exactly what a user would be asking about. */
    const g = await (await A('/api/gaps', { headers: { Accept: 'application/json' } })).json();
    assert.strictEqual(g.state, 'ok', `the gap list reported ${g.state}`);
    assert.ok(g.gaps.length > 0, 'no gap could be read to ask the copilot about');
    const subject = { id: g.gaps[0].indicator_id, code: g.gaps[0].code };
    assert.ok(subject.id, 'the gap list published no indicator id');

    const r = await A('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ intent: 'explain_requirement', subject_id: subject.id }),
    });
    assert.strictEqual(r.status, 200, `/api/copilot returned ${r.status}`);
    const out = await r.json();

    // WITHOUT A GROQ KEY THIS RUNS THE DETERMINISTIC PATH, and that is a real
    // result rather than a skipped one: the guarantee is that BOTH paths
    // produce no figure and both declare which they are.
    assert.ok(['ai', 'template'].includes(out.mode), `copilot mode was ${out.mode}`);
    assert.ok(out.text && out.text.length > 40, 'the copilot answered with nothing');
    assert.ok(out.basis && out.basis.length > 40, 'the copilot did not say where its answer came from');
    if (out.mode === 'ai') {
      assert.ok(!/\d/.test(out.text),
        `a generated copilot answer carries a figure: "${out.text}"`);
    }

    // A closed vocabulary: an intent outside the four is a 400 that names them.
    const bad = await A('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ intent: 'write_my_report', subject_id: subject.id }),
    });
    assert.strictEqual(bad.status, 400, `an unknown intent returned ${bad.status}, not 400`);
    const err = await bad.json();
    assert.strictEqual(err.intents.length, 4, 'the refusal does not name the four intents');
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
    // and ESG Impact; 22 after P9 added Improvement and Expert support. A
    // change here must be deliberate — but it can no longer stop the screens
    // above from being verified.
    //
    // P9 ALSO FLIPPED Reports FROM built:false TO built:true WITHOUT CHANGING
    // THIS COUNT, which is worth recording because the count alone would not
    // have shown it. The page now renders reporting READINESS; the report
    // GENERATOR is still not built, and reportReadiness.js carries
    // generator.built = false as a stated constant with its own test.
    assert.strictEqual(MODULES.length, 22,
      `the nav is ${MODULES.length} entries, not 22 — every one of them rendered, so this is a `
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

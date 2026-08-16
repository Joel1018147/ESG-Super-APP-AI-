'use strict';
// The guard tests. These are static-source assertions, deliberately: a runtime
// test can only catch a path that was exercised, and the failure mode being
// guarded against here — a model-authored number reaching a score — would look
// entirely normal at runtime.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
let passed = 0;
// AN ASYNC TEST IN A SYNC HARNESS COUNTS AS A PASS WHATEVER IT ASSERTS —
// recurring-bugs-checklist.md #14, third shape. This harness was synchronous,
// so the first async test added to it would have gone green without running.
// It now refuses a promise by name instead of swallowing one. Use `atest`.
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      throw new Error('async function passed to sync test(); use atest()');
    }
    passed += 1; console.log(`  ✓ ${name}`);
  } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// Async variant. Registered, awaited before the summary line, and its failure
// sets the exit code the same way — so run-all.js sees it.
const pending = [];
function atest(name, fn) {
  pending.push(
    Promise.resolve().then(fn).then(
      () => { passed += 1; console.log(`  ✓ ${name}`); },
      (e) => { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; },
    ),
  );
}
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const readRaw = (p) => fs.readFileSync(p, 'utf8');
const rel     = (p) => path.relative(path.join(__dirname, '..'), p);

// COMMENTS ARE STRIPPED BEFORE EVERY SCAN BELOW.
// The first version of this file did not do that and produced three failures,
// all of them the test reading its own explanatory prose: aiAdvisor.js "wrote
// to esg_scores" because a comment names the table, and schema.sql had a
// "nullable UNIQUE" because a comment warns against them. A guard test that
// cries wolf gets muted, and a muted guard is worse than none.
const stripJsComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripSqlComments = (src) => src.replace(/^\s*--.*$/gm, '');
const read = (p) => stripJsComments(readRaw(p));

console.log('no-model-figures-test');

test('only scoringEngine.js writes to esg_scores', () => {
  for (const f of files) {
    if (f.endsWith('scoringEngine.js')) continue;
    const src = read(f);
    assert.ok(!/INSERT INTO esg_scores/i.test(src), `${rel(f)} inserts into esg_scores`);
    assert.ok(!/UPDATE esg_scores/i.test(src),      `${rel(f)} updates esg_scores`);
  }
});

test('the AI layer never writes a numeric score column', () => {
  const src = read(path.join(SRC, 'services/aiAdvisor.js'));
  assert.ok(!/esg_scores/.test(src), 'aiAdvisor.js references esg_scores');
  assert.ok(!/score_0_100/.test(src), 'aiAdvisor.js references score_0_100');
});

test('the AI layer scrubs any figure it was not given', () => {
  const src = read(path.join(SRC, 'services/aiAdvisor.js'));
  assert.ok(/stripFigures\s*\(\s*reply\s*,\s*allowed\s*\)/.test(src),
    'the Groq reply must pass through stripFigures() with the allow-list before use');
});

test('stripFigures actually removes an invented number', () => {
  const { stripFigures } = require('../src/services/aiAdvisor');
  const out = stripFigures('You could gain 2.5 points and save RM 18000.', [2.5]);
  assert.ok(out.includes('2.5'), 'a supplied figure must survive');
  assert.ok(!out.includes('18000'), 'an invented figure must not survive');
});

test('a Groq failure produces a template, never a blank and never a guess', () => {
  const { templateFor } = require('../src/services/aiAdvisor');
  const t = templateFor({ code: 'E-01', question_en: 'Do you track electricity?', answered: false });
  assert.ok(typeof t === 'string' && t.length > 40, 'fallback must produce real prose');
  assert.ok(!/\d/.test(t.replace('E-01', '')), 'the fallback template must not contain a figure');
});

test('only groqService.js reads GROQ_MODEL', () => {
  for (const f of files) {
    if (f.endsWith('groqService.js')) continue;
    assert.ok(!/process\.env\.GROQ_MODEL/.test(read(f)),
      `${rel(f)} reads process.env.GROQ_MODEL directly — the model name has exactly one owner`);
  }
});

test('reasoning controls are gated on the model actually sent', () => {
  const { supportsReasoningControls } = require('../src/services/groqService');
  assert.strictEqual(supportsReasoningControls('qwen/qwen3.6-27b'), true);
  assert.strictEqual(supportsReasoningControls('llama-3.3-70b-versatile'), false);
  assert.strictEqual(supportsReasoningControls(undefined), false);
});

atest('thinking is off by default on every Groq call', async () => {
  // Layer 2 shipped broken and silent because this was opt-in. qwen3.6 spends
  // its entire max_tokens budget on a <think> block, so the extractor's reply
  // was truncated before its first `CODE|option|quote` line, the strict parser
  // matched nothing, and every upload produced an empty review queue with no
  // error anywhere.
  //
  // The suite could not have caught it: layer2-test.js injects a fake
  // `generate`, so the real request body had never been asserted. This test
  // asserts the BODY, with fetch stubbed — no network, no API key.
  const { generateWithGroq } = require('../src/services/groqService');
  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  try {
    await generateWithGroq('p', { apiKey: 'k', model: 'qwen/qwen3.6-27b' });
    assert.strictEqual(sent[0].reasoning_effort, 'none', 'thinking is not disabled by default');
    assert.strictEqual(sent[0].reasoning_format, 'hidden', 'reasoning output is not hidden by default');

    // A caller that genuinely needs deliberation can still ask for it.
    await generateWithGroq('p', { apiKey: 'k', model: 'qwen/qwen3.6-27b', reasoningEffort: 'default' });
    assert.strictEqual(sent[1].reasoning_effort, 'default', 'an explicit effort is not honoured');

    // Still gated: sending these to a model that does not accept them is a 400
    // on every call.
    await generateWithGroq('p', { apiKey: 'k', model: 'llama-3.3-70b-versatile' });
    assert.ok(!('reasoning_effort' in sent[2]),
      'reasoning controls sent to a model that does not support them');
  } finally {
    global.fetch = realFetch;
  }
});

test('setTimeout is never used to schedule work', () => {
  // The rule is about SCHEDULING, not about the function. Work that must happen
  // later belongs in esg_scheduled_jobs, because a timer dies with the
  // container and Railway restarts containers whenever it likes.
  //
  // This used to be enforced by exempting three files by name, which is how a
  // rule quietly becomes a suggestion — the fourth legitimate use just gets
  // added to the list. Instead the two legitimate SHAPES are stripped first,
  // and anything still standing is a real violation in any file.
  const ALLOWED = [
    // An awaited delay inside already-running code: rate-limit pauses.
    /await new Promise\(\s*\(\s*\w+\s*\)\s*=>\s*setTimeout\(\s*\w+\s*,[^)]*\)\s*\)/g,
    // A request timeout paired with an AbortController.
    /setTimeout\(\s*\(\)\s*=>\s*\w+\.abort\(\)\s*,[^)]*\)/g,
  ];
  for (const f of files) {
    let src = read(f);
    for (const shape of ALLOWED) src = src.replace(shape, '');
    assert.ok(!/setTimeout\s*\(/.test(src),
      `${rel(f)} uses setTimeout in a shape that is not an awaited delay or an abort timer — ` +
      `scheduled work belongs in esg_scheduled_jobs`);
  }
});

test('no SELECT * anywhere', () => {
  for (const f of files) {
    assert.ok(!/SELECT\s+\*/i.test(read(f)), `${rel(f)} uses SELECT *`);
  }
});

test('no string-concatenated SQL values', () => {
  // Catches `WHERE id = ${x}` inside a template literal — the only SQL
  // interpolation this codebase permits is $1-style parameters.
  // A literal is SQL if it OPENS with a SQL verb, or names an esg_ table in a
  // FROM/INTO/UPDATE position. Matching a bare keyword anywhere was wrong: HTML
  // in this app contains <select>, and every page template tripped it.
  const looksLikeSql = (lit) =>
    /^`\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|WITH)\b/i.test(lit) ||
    /\b(FROM|INTO|UPDATE)\s+esg_\w+/i.test(lit);
  for (const f of files) {
    const src = read(f);
    for (const lit of src.match(/`[^`]*`/g) || []) {
      if (!looksLikeSql(lit)) continue;
      assert.ok(!/\$\{/.test(lit), `${rel(f)} interpolates into a SQL template literal: ${lit.slice(0, 90)}`);
    }
  }
});

test('the schema has no nullable UNIQUE constraint', () => {
  const sql = stripSqlComments(fs.readFileSync(path.join(SRC, 'db/schema.sql'), 'utf8'));
  // A column-level UNIQUE without NOT NULL on the same line is the trap:
  // Postgres admits unlimited NULLs past it.
  for (const line of sql.split('\n')) {
    if (!/\bUNIQUE\b/.test(line)) continue;
    if (/CREATE UNIQUE INDEX/i.test(line)) continue;
    assert.ok(/NOT NULL/.test(line),
      `nullable UNIQUE is not a uniqueness guarantee — use a partial unique index instead: ${line.trim()}`);
  }
});

test('every esg_ table in the schema has created_at and updated_at', () => {
  const sql = stripSqlComments(fs.readFileSync(path.join(SRC, 'db/schema.sql'), 'utf8'));
  const blocks = sql.split(/CREATE TABLE IF NOT EXISTS /).slice(1);
  for (const b of blocks) {
    const name = b.split(/\s|\(/)[0];
    if (!name.startsWith('esg_')) continue;
    const body = b.slice(0, b.indexOf('\n);'));
    assert.ok(/created_at\s+timestamptz/.test(body), `${name} has no created_at`);
    assert.ok(/updated_at\s+timestamptz/.test(body), `${name} has no updated_at`);
  }
});

test('SSL is decided by the connection target, not by NODE_ENV', () => {
  // Regression. The old code keyed SSL off NODE_ENV, which forced anyone
  // connecting a laptop to the hosted database into NODE_ENV=production — and
  // that also turns on secure session cookies, which http://localhost never
  // sends. Login would fail silently.
  const { sslConfig } = require('../src/db');
  assert.strictEqual(sslConfig('postgresql://u:p@localhost:5432/db'), false);
  assert.strictEqual(sslConfig('postgresql://u:p@127.0.0.1:5432/db'), false);
  assert.strictEqual(sslConfig('postgresql://u:p@postgres.railway.internal:5432/db'), false);
  assert.deepStrictEqual(sslConfig('postgresql://u:p@shuttle.proxy.rlwy.net:1234/db'),
                         { rejectUnauthorized: false });
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.strictEqual(sslConfig('postgresql://u:p@localhost:5432/db'), false,
    'NODE_ENV must have no influence on the SSL decision');
  process.env.NODE_ENV = prev;
});

test('a signed-out page renders no navigation and no sign-out link', () => {
  // Regression. The login page shipped with the full sidebar and a "Sign out"
  // button: seven links that bounce an anonymous visitor, and an invitation to
  // end a session they never had.
  const { layout } = require('../src/utils/layout');
  const out = layout('Sign in', '<form></form>', null, '');
  assert.ok(!/Sign out/i.test(out), 'signed-out page offers a sign-out link');
  assert.ok(!/class="nav-item/.test(out), 'signed-out page renders the sidebar');
  assert.ok(!/class="bottom-nav/.test(out), 'signed-out page renders the bottom nav');
  assert.ok(/data-platform="esg"/.test(out), 'signed-out page lost the platform accent');

  const signedIn = layout('Dashboard', '<div></div>', { name: 'Joel', role: 'company_admin' }, '/dashboard');
  assert.ok(/class="nav-item/.test(signedIn), 'signed-in page lost its sidebar');
});

test('an asset 404 does not render the HTML shell', () => {
  // Regression. /favicon.ico was answered with a 99,170-byte HTML page —
  // the full design system inlined, to say "not found" about an icon.
  const src = readRaw(path.join(SRC, 'server.js'));
  assert.ok(/app\.get\('\/favicon\.ico'/.test(src), 'no /favicon.ico route');
  assert.ok(src.indexOf("app.get('/favicon.ico'") < src.indexOf("app.use('/api'"),
    '/favicon.ico must be mounted before the auth guards or it 302s anonymous visitors');
  assert.ok(/\[a-z0-9\]\{2,5\}\$\/i\.test\(req\.path\)/.test(src),
    'the 404 handler must short-circuit paths with a file extension');
});

test('no third-party registry brand appears in the navigation', () => {
  // The menu item and page title are branding and are Joel's call. Source
  // attribution on the mirrored RECORDS is not branding — it is provenance and
  // a term of the registry's public licence — so that line stays and is
  // asserted separately in smoke-test.js.
  const { MODULES } = require('../src/utils/layout');
  for (const m of MODULES) {
    assert.ok(!/verra/i.test(m.label), `nav label still names the registry: ${m.label}`);
    assert.ok(!/verra/i.test(m.path),  `nav path still names the registry: ${m.path}`);
  }
  assert.ok(MODULES.some((m) => m.path === '/governance'), 'no /governance entry');
});

test('every page shell carries the official system name', () => {
  const { layout } = require('../src/utils/layout');
  const NAME = 'Malaysia SMEs ESG e-Reporting System';
  assert.ok(layout('Dashboard', '', { name: 'J' }, '/dashboard').includes(NAME), 'signed-in shell');
  assert.ok(layout('Sign in', '', null, '').includes(NAME), 'signed-out shell');
});

// ═══════════════════════════════════════════════════════════════════════════
// NO INTERNAL OR THIRD-PARTY BRAND IN VISIBLE TEXT
//
// The rule is about what a USER CAN READ, so the check is defined on rendered
// text, not on source. It is a SHAPE, not an exemption list (checklist #13):
//
//   1. <script> and <style> bodies are removed  → the `modus-theme`
//      localStorage key and any CSS survive untouched, because they are not
//      text a user reads.
//   2. every TAG is removed, which removes every ATTRIBUTE with it → the
//      stylesheet path /css/modus-design-system.css and data-platform="esg"
//      are structurally out of scope. No file is named, no class is exempted,
//      and a new asset path added tomorrow is covered automatically.
//
// What remains is exactly the text nodes — what a person actually reads.
//
// KNOWN LIMIT, stated rather than papered over: `title="…"` is an attribute,
// so a tooltip is NOT covered by this shape. pages.js's draft badge carries
// one and was fixed by hand. If tooltips become load-bearing, this needs a
// second, narrower check — not a widening of this one.
// ═══════════════════════════════════════════════════════════════════════════
// Shells and signed-in pages: NO "modus" in any form. The builder attribution
// is a marketing-page thing; inside the product the only name that matters is
// the system's own. `m-?easy\s*esg` is listed because it names the product as
// ours WITHOUT containing the substring "modus" — see the attribution section
// further down, which shares this rule and states the shape.
const FORBIDDEN_IN_TEXT = [/modus/i, /verra/i, /m-?easy\s*esg/i];

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')    // comments are not text a user reads
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')            // every tag, and therefore every attribute
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Renders a page route for real by calling its handler. Returns the HTML that
 *  the route passed to res.send(). Throws if the route did not render — a
 *  handler that silently produced nothing must fail the test rather than
 *  quietly contribute zero coverage (contract §7b rule 4). */
function renderRoute(router, routePath, req) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.get);
  assert.ok(layer, `no GET handler for ${routePath}`);
  let html = null;
  let failed = null;
  const res = {
    send(body) { html = body; },
    json(body) { html = JSON.stringify(body); },
    redirect() { failed = 'redirected instead of rendering'; },
    status() { return res; },
  };
  const next = (err) => { failed = err ? err.message : 'called next() instead of rendering'; };
  const out = layer.route.stack[0].handle(req, res, next);
  // Every page handler in this repo is either sync or an async function whose
  // body is fully synchronous up to the first await. The DB-backed ones await,
  // so they are exercised through the stubbed pool below and resolve
  // immediately — but assert it rather than assume it.
  if (out && typeof out.then === 'function') return out.then(() => ({ html, failed }));
  return Promise.resolve({ html, failed });
}

atest('no rendered page shows an internal or registry brand in visible text', async () => {
  const { layout, bareLayout, MODULES } = require('../src/utils/layout');
  const checked = [];

  const assertClean = (label, html) => {
    assert.ok(typeof html === 'string' && html.length > 200,
      `${label}: rendered nothing to check (${typeof html}, ${html && html.length} bytes)`);
    const text = visibleText(html);
    for (const re of FORBIDDEN_IN_TEXT) {
      const m = text.match(re);
      assert.ok(!m, `${label}: visible text contains "${m && m[0]}" — `
        + `context: …${text.slice(Math.max(0, text.search(re) - 70), text.search(re) + 70)}…`);
    }
    checked.push(label);
  };

  // ── Both shells ──────────────────────────────────────────────────────────
  assertClean('shell: signed-out', bareLayout('Sign in', '<form><label>Email</label></form>'));
  // Once per nav path, so the active-state branch and every nav label, group
  // heading, brand line and topbar string is rendered at least once.
  for (const m of MODULES) {
    assertClean(`shell: signed-in @ ${m.path}`,
      layout(m.label, '<div class="card">content</div>', { name: 'Joel', email: 'j@example.com' }, m.path));
  }

  // ── Every page route, rendered for real ──────────────────────────────────
  // The DB is stubbed so the data-backed pages render their real templates.
  // Rows come back empty, which is the honest shape for a fresh company and
  // exercises the empty-state branches.
  const dbPath = require.resolve('../src/db');
  const realDb = require.cache[dbPath];
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true, exports: {
      query: async () => ({ rows: [], rowCount: 0 }),
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    },
  };
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
  }

  try {
    const pages = require('../src/routes/pages');
    const req = {
      user: { id: 'u1', name: 'Joel', email: 'j@example.com', role: 'company_admin', company_id: 'c1' },
      query: {}, params: {},
    };
    // Two nav paths are served by their own routers rather than by pages.js.
    // They are rendered below, individually, so the denominator at the bottom
    // still covers every entry in MODULES.
    const ELSEWHERE = { '/documents': '../src/routes/documents', '/green-finance': '../src/routes/greenFinance' };
    for (const m of MODULES) {
      if (ELSEWHERE[m.path]) continue;
      const { html, failed } = await renderRoute(pages, m.path, req);
      assert.ok(!failed, `${m.path}: ${failed}`);
      assertClean(`page: ${m.path}`, html);
    }
    for (const [routePath, mod] of Object.entries(ELSEWHERE)) {
      const { html, failed } = await renderRoute(require(mod), routePath, req);
      assert.ok(!failed, `${routePath}: ${failed}`);
      assertClean(`page: ${routePath}`, html);
    }
  } finally {
    require.cache[dbPath] = realDb;
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  }

  // A loop that covered nothing passes every assertion inside it. Assert the
  // DENOMINATOR: 15 nav paths + 15 signed-in shells + 1 signed-out shell.
  // 14 until Run 47 added Green Finance.
  assert.strictEqual(MODULES.length, 15, `expected 15 nav entries, found ${MODULES.length}`);
  assert.strictEqual(checked.length, 31,
    `expected 31 rendered surfaces checked, got ${checked.length}: ${checked.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT NAMING vs DEVELOPER ATTRIBUTION
//
// The rule that actually holds is not "the string Modus never appears". It is:
//
//   the PRODUCT is never named as a Modus product, anywhere;
//   the BUILDER may be credited, on the public marketing page only.
//
// "Modus ESG" and "M-EasyESG" name the product. "Modus AI Associates" credits
// the firm that built it. The first is a claim about what this platform IS —
// which SSEO owns, not Modus — and it is wrong on the landing page and wrong on
// the dashboard. The second is ordinary attribution and belongs on a marketing
// page, the same way any agency's work is credited.
//
// This is a SHAPE, not an exempt-files array (checklist #13). The shape is:
// the ONLY permitted "modus" token in visible text is the exact attribution
// string, and it is permitted only where a visitor is being told who built the
// thing. Strip that one exact string and assert nothing is left — so a new
// construction invented tomorrow ("Modus ESG Platform", "the Modus system") is
// caught without anyone adding it to a list.
//
// LLP is asserted separately and negatively: ecosystem-context.md's branding
// rule is client-facing "Modus AI Associates", internal/legal only
// "Modus AI Associates LLP". The landing page is as client-facing as it gets.
// ═══════════════════════════════════════════════════════════════════════════

// Product-as-Modus constructions that do NOT contain the substring "modus" and
// so would survive the residue check below. Everything that DOES contain it is
// caught structurally and needs no pattern here.
const PRODUCT_AS_MODUS = [/m-?easy\s*esg/i];

// Two constants, deliberately. A /g regex is STATEFUL under .test() — lastIndex
// carries between calls, so the same pattern used for both stripping and
// presence returns alternating true/false and the guard silently half-works.
// That is recurring-bugs #14 with extra steps.
const ATTRIBUTION_G  = /Modus AI Associates/g;
const ATTRIBUTION_1  = /Modus AI Associates/;
const ATTRIBUTION_LLP = /Modus AI Associates[\s,]*LLP\b/i;

test('the landing page credits the builder without naming the product as ours', () => {
  const landing = readRaw(path.join(__dirname, '../public/index.html'));
  const t = visibleText(landing);
  assert.ok(t.length > 500, `landing rendered only ${t.length} chars of visible text`);

  // The attribution is REQUIRED, not merely tolerated — it is the one thing on
  // this page that a later edit could quietly drop.
  assert.ok(ATTRIBUTION_1.test(t), 'the "Modus AI Associates" attribution is missing');

  // …and never with LLP after it.
  assert.ok(!ATTRIBUTION_LLP.test(t), 'client-facing copy must never append LLP');

  for (const re of PRODUCT_AS_MODUS) {
    const m = t.match(re);
    assert.ok(!m, `the product is named as a Modus product: "${m && m[0]}"`);
  }
  assert.ok(!/verra/i.test(t), 'the registry brand appears on the landing page');

  // THE SHAPE: strip the one permitted string, assert nothing survives.
  const residue = t.replace(ATTRIBUTION_G, ' ');
  const m = residue.match(/modus/i);
  assert.ok(!m, `"modus" appears outside the attribution — context: `
    + `…${residue.slice(Math.max(0, residue.search(/modus/i) - 70), residue.search(/modus/i) + 70)}…`);
});

// ═══════════════════════════════════════════════════════════════════════════
// smecorp=false — THE ENDORSEMENT THAT IS NOT CLAIMED
//
// The governance source document carries a Strategic Endorsement section naming
// a government agency, marked "subject to formal approval", under a footnote
// requiring formal WRITTEN approval before the statement or logo is used. That
// approval does not exist yet, so the name appears nowhere in this software —
// not the name, not the logo, not an "endorsement pending" line. A qualifier in
// a proposal and a rendered claim in working software are different things, and
// the second is the one a partner's due diligence asks about.
//
// This is asserted here rather than written in a paragraph because prose decays
// and a red build does not. The rule holds until Joel confirms written approval,
// at which point this test is deleted deliberately — not edited around.
//
// SCOPE IS A SHAPE, NOT A FILE LIST (checklist #13): everything SHIPPED —
// src/**/*.js and public/**/*.html. docs/ is deliberately outside it, because
// docs/GOVERNANCE_SOURCE.md is where the exclusion is recorded and must be free
// to name what it excludes. Nothing under docs/ is served to a user.
//
// Source is scanned with comments stripped, so the reasoning may be explained
// in a comment but never rendered. HTML is scanned RAW as well as on visible
// text — raw catches the `title="…"` tooltip case that the visibleText shape
// above documents as its known limit.
// ═══════════════════════════════════════════════════════════════════════════
const UNAPPROVED_ENDORSEMENT = /sme\s*\.?\s*corp/i;

test('no shipped file claims an endorsement that has not been granted', () => {
  const checked = [];

  for (const f of files) {
    const m = read(f).match(UNAPPROVED_ENDORSEMENT);
    assert.ok(!m, `${rel(f)} names the endorsing body ("${m && m[0]}") in shipped source`);
    checked.push(rel(f));
  }

  const PUBLIC = path.join(__dirname, '../public');
  const htmlFiles = [];
  (function walkHtml(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walkHtml(p);
      else if (p.endsWith('.html')) htmlFiles.push(p);
    }
  }(PUBLIC));

  for (const f of htmlFiles) {
    const raw = readRaw(f);
    const m = raw.match(UNAPPROVED_ENDORSEMENT);
    assert.ok(!m, `${rel(f)} names the endorsing body ("${m && m[0]}")`);
    assert.ok(!UNAPPROVED_ENDORSEMENT.test(visibleText(raw)), `${rel(f)}: visible text`);
    checked.push(rel(f));
  }

  // ASSERT THE DENOMINATOR. A walk that covered nothing passes every assertion
  // inside it (§7b rule 4). The landing page is named explicitly because it is
  // the one surface an anonymous visitor reads, and a rename that dropped it
  // from the walk would otherwise be invisible.
  // Not an exact count — src/ legitimately grows. Low enough to survive a
  // refactor, high enough that a broken walk (the real failure mode) cannot
  // pass it: src/ is 18 files today.
  assert.ok(files.length > 12, `source walk covered only ${files.length} files`);
  assert.ok(checked.includes(path.join('public', 'index.html')),
    `the landing page was not covered; checked: ${checked.join(', ')}`);
});

// A JSON body has no tags, so the HTML shape does not transfer. The equivalent
// structural split is IDENTIFIER vs PROSE, and it is a shape, not a list of
// exempt field names (checklist #13):
//
//   identifier — SCREAMING_SNAKE_CASE, a bare code like `0.9-draft`, a URL, or
//                a UUID. Opaque tokens a client passes back to the server.
//   prose      — everything else: any string a person would read.
//
// `MODUS_SEDG_ALIGNED` is an identifier and stays, exactly as §3.3 rules for
// the /api/verra/* paths. `Modus SME ESG Assessment (SEDG-aligned draft)` is
// prose and must not be returned. No field is named anywhere in this rule, so
// a new field added tomorrow is covered by whichever half it falls into.
const IDENTIFIER = /^(?:[A-Z][A-Z0-9_]*|[0-9][0-9a-z.-]*|https?:\/\/\S+|[0-9a-f-]{36})$/;

function* proseStrings(value, where) {
  if (typeof value === 'string') {
    if (!IDENTIFIER.test(value)) yield [where, value];
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* proseStrings(value[i], `${where}[${i}]`);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* proseStrings(v, `${where}.${k}`);
  }
}

atest('no JSON response body carries an internal or registry brand', async () => {
  // A JSON body has no tags to strip, so the whole payload IS readable text —
  // and /api/frameworks used to return `name` and `publisher` straight from
  // seed.sql. The stored row stays factual; the response must not carry it.
  //
  // Route paths are NOT part of this check: /api/verra/* is an identifier, not
  // something rendered, and renaming live routes for a demo is churn with
  // deploy risk. Only the BODY is asserted.
  const dbPath = require.resolve('../src/db');
  const realDb = require.cache[dbPath];
  const FRAMEWORK_ROWS = [
    { code: 'MODUS_SEDG_ALIGNED', version: '0.9-draft', name: 'Modus SME ESG Assessment (SEDG-aligned draft)',
      publisher: 'Modus AI Associates LLP', framework_kind: 'entity_disclosure', is_active: true, source_url: null },
    { code: 'VERRA_VCS', version: '4.x', name: 'Verified Carbon Standard', publisher: 'Verra',
      framework_kind: 'project_crediting', is_active: false, source_url: 'https://verra.org/' },
  ];
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true, exports: {
      query: async (sql) => ({
        rows: /FROM esg_frameworks/.test(sql) ? FRAMEWORK_ROWS : [], rowCount: 0,
      }),
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    },
  };
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
  }

  try {
    const api = require('../src/routes/api');
    // The stub feeds rows that DO contain both brands, so a handler that passes
    // its row through unchanged fails here. A stub returning [] would make this
    // test vacuous — it would pass on an unfixed route.
    for (const routePath of ['/frameworks', '/frameworks/sedg-v2', '/analytics', '/kpis',
                             '/assistant', '/workflow', '/users', '/integrations']) {
      const layer = api.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.get);
      assert.ok(layer, `no GET handler for /api${routePath}`);
      let body = null;
      const res = { json(b) { body = b; }, status() { return res; } };
      await layer.route.stack[0].handle({ user: { id: 'u1', company_id: 'c1' }, query: {}, params: {} },
        res, (e) => { throw e || new Error(`/api${routePath} called next()`); });
      assert.ok(body, `/api${routePath} returned no JSON`);
      for (const [where, value] of proseStrings(body, `/api${routePath}`)) {
        for (const re of FORBIDDEN_IN_TEXT) {
          const m = value.match(re);
          assert.ok(!m, `${where} carries "${m && m[0]}": "${value.slice(0, 120)}"`);
        }
      }
    }
    // Prove the stub actually reached the handler, so a silently-empty result
    // cannot masquerade as a clean one.
    const fw = api.stack.find((l) => l.route && l.route.path === '/frameworks');
    let body = null;
    await fw.route.stack[0].handle({ user: { id: 'u1', company_id: 'c1' }, query: {}, params: {} },
      { json(b) { body = b; }, status() { return this; } }, (e) => { throw e; });
    assert.strictEqual(body.frameworks.length, 2, 'the stub rows never reached the handler');
    assert.ok(body.frameworks.every((f) => f.display_name), 'display_name is missing');
  } finally {
    require.cache[dbPath] = realDb;
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  }
});

test('robots.txt and the favicon are reachable without a session', () => {
  // Both are mounted above the auth guard. Railway's HTTP log caught
  // GET /robots.txt -> 302: a crawler reads that as "no robots.txt" and
  // indexes what it can reach, which for this app is the login page of a
  // system holding company ESG data.
  const src = readRaw(path.join(SRC, 'server.js'));
  const guardAt = src.indexOf("app.use('/api'");
  for (const route of ["app.get('/favicon.ico'", "app.get('/robots.txt'"]) {
    const at = src.indexOf(route);
    assert.ok(at !== -1, `${route} is missing`);
    assert.ok(at < guardAt, `${route} is mounted behind the auth guard`);
  }
  const robots = fs.readFileSync(path.join(SRC, '../public/robots.txt'), 'utf8');
  assert.ok(/Disallow:\s*\/\s*$/m.test(robots), 'robots.txt does not disallow indexing');
});

test('the boot banner names the system, not the old working title', () => {
  const src = readRaw(path.join(SRC, 'server.js'));
  assert.ok(/listening on/.test(src), 'no startup log');
  assert.ok(!/Modus ESG listening/.test(src),
    'the boot banner still says "Modus ESG" — this is the line a stakeholder reads in the deploy log');
});

test('every design token layout.js uses actually exists in the stylesheet', () => {
  // This repo's copy of the design system is SYNCED FROM MASTER by a separate
  // ecosystem-wide process (see commit 08dac9b). A sync can rename or drop a
  // token at any time, and the failure is silent: CSS never warns, nothing
  // throws, the element just renders transparent or inherits. This test is the
  // only thing that turns that into a red build.
  const css = fs.readFileSync(path.join(SRC, '../public/css/modus-design-system.css'), 'utf8');
  const layoutSrc = readRaw(path.join(SRC, 'utils/layout.js'));

  const used = new Set();
  for (const m of layoutSrc.matchAll(/var\((--[a-z0-9-]+)\)/gi)) used.add(m[1]);
  assert.ok(used.size >= 10, `expected layout.js to consume the design system, found ${used.size} tokens`);

  const defined = new Set();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);

  const missing = [...used].filter((t) => !defined.has(t));
  assert.deepStrictEqual(missing, [],
    `layout.js uses tokens the stylesheet does not define: ${missing.join(', ')}`);
});

test('the ESG accent survives a design-system sync, in both themes', () => {
  const css = fs.readFileSync(path.join(SRC, '../public/css/modus-design-system.css'), 'utf8');
  assert.ok(/\[data-platform="esg"\]/.test(css), 'the esg accent block is gone');
  assert.ok(/#4D7C0F/i.test(css), 'the esg accent value changed from the canonical #4D7C0F');
  assert.ok(/\[data-theme="dark"\]\[data-platform="esg"\]/.test(css),
    'the esg dark-mode block is gone — dark mode would fall back to the default accent silently');
});

test('the stylesheet is linked, not inlined, and cache-busted by content', () => {
  const { layout, bareLayout, CSS_HREF, CSS_VERSION } = require('../src/utils/layout');
  for (const [name, html] of [['signed-in', layout('D', '', { name: 'J' }, '/dashboard')],
                              ['signed-out', bareLayout('Sign in', '')]]) {
    assert.ok(html.includes(`<link rel="stylesheet" href="${CSS_HREF}">`), `${name}: sheet not linked`);
    // A rule from deep in the file. If this appears, the whole sheet is being
    // inlined again and the ~97 KB per response is back.
    assert.ok(!html.includes('.table-wrap'), `${name}: full stylesheet is inlined`);
    // Measure the INLINE STYLE, not the page. Asserting total page size would
    // start failing for an honest reason the day a page carries real markup —
    // the assessment form already renders 40 indicators — and a test that
    // fails for the wrong reason gets its threshold raised until it means
    // nothing. What is being guarded is the stylesheet coming back inline.
    const inlineBytes = (html.match(/<style>[\s\S]*?<\/style>/g) || [])
      .reduce((n, blk) => n + Buffer.byteLength(blk, 'utf8'), 0);
    assert.ok(inlineBytes < 12000,
      `${name}: ${inlineBytes} bytes of inline <style>; the design system is being inlined again`);
  }
  // Content-derived, because express.static caches for 7 days and the sheet is
  // synced from master by a separate process. A fixed version string would
  // leave returning users on a stale sheet for a week after every sync.
  assert.ok(/^[0-9a-f]{8}$/.test(CSS_VERSION), `CSS_VERSION is not a content hash: ${CSS_VERSION}`);
});

test('the inlined floor carries every token block it claims to', () => {
  // The floor exists for one situation: the stylesheet fails to load. A floor
  // missing a block fails ONLY in that situation, which is why this is asserted
  // rather than eyeballed — a double-escaped selector list once reduced it to
  // :root alone and dev looked perfect, because the linked sheet covered it.
  const { TOKENS_CSS } = require('../src/utils/layout');
  assert.ok(/--accent:/.test(TOKENS_CSS), 'no :root tokens');
  assert.ok(/#4D7C0F/i.test(TOKENS_CSS), 'no esg accent — pages would fall back to the default blue');
  assert.ok(/\[data-theme="dark"\]/.test(TOKENS_CSS), 'no dark-mode tokens');
  assert.ok(TOKENS_CSS.length < 8000, `floor is ${TOKENS_CSS.length} bytes; it should be tokens only`);
});

test('data-platform is never set without the stylesheet that gives it meaning', () => {
  // `data-platform="esg"` on its own does NOTHING. It selects a block inside
  // modus-design-system.css; without that sheet the attribute is inert and the
  // page renders in whatever palette it happens to have, with no warning.
  //
  // Found across the ecosystem on four M-EasyMember pages, which set the
  // attribute and never load the sheet. This repo has no static HTML today —
  // every page goes through layout.js — so the check covers BOTH: the rendered
  // shells (real coverage now) and any .html later dropped into public/ (the
  // regression being prevented).
  const { layout, bareLayout } = require('../src/utils/layout');
  const check = (name, html) => {
    const hasAttr  = /data-platform="[^"]+"/.test(html);
    const hasSheet = /modus-design-system\.css/.test(html);
    if (hasAttr) {
      assert.ok(hasSheet, `${name}: sets data-platform but never loads the stylesheet — the attribute is inert`);
    }
  };
  check('signed-in shell',  layout('D', '', { name: 'J' }, '/dashboard'));
  check('signed-out shell', bareLayout('Sign in', ''));

  const pubDir = path.join(SRC, '../public');
  const walkHtml = (dir, out = []) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, f.name);
      if (f.isDirectory()) walkHtml(fp, out);
      else if (fp.endsWith('.html')) out.push(fp);
    }
    return out;
  };
  for (const f of walkHtml(pubDir)) {
    check(path.relative(pubDir, f), fs.readFileSync(f, 'utf8'));
  }
});

test('the PDF parser is never loaded at module scope', () => {
  // server.js requires routes/documents at BOOT, which reaches
  // extractionService -> pdfService. pdfjs v5 is ESM-only and touches browser
  // globals on load; anything that throws there would take down login,
  // dashboard and /health over an unused feature. The import lives inside an
  // async function for that reason.
  //
  // read(), not readRaw(): this comment names the module in prose and the raw
  // text would match. Same trap the helper at the top of this file exists for.
  const src = read(path.join(SRC, 'services/pdfService.js'));
  const beforeFirstFn = src.slice(0, src.search(/^(async )?function /m));
  assert.ok(!/require\(['"]pdfjs-dist/.test(beforeFirstFn) && !/^import /m.test(beforeFirstFn),
    'pdfjs is loaded at module scope — a load failure would break boot, not just extraction');
  assert.doesNotThrow(() => require('../src/routes/documents'),
    'the documents router cannot be required — the app would not boot');
});

// NOT async. The harness at the top of this file calls fn() synchronously and
// counts a returned promise as a pass, so an async test here would report green
// no matter what it asserted. The body is execFileSync for that reason.
test('text extraction needs no native binding', () => {
  // THE REASON THIS EXISTS. pdf-parse@2 depends hard on @napi-rs/canvas —
  // eleven prebuilt binaries — because it can also rasterise pages. That
  // binding does not load on every platform, and on the Windows machine this
  // project is developed on it does not load at all. The consequence was that
  // all twelve Layer 2 guards — the ones keeping a language model away from an
  // ESG score — could only be run by deploying.
  //
  // Text extraction never rasterises anything, so pdfjs alone suffices with
  // three stub globals. This test PROVES that rather than assuming it: a child
  // process is started in which @napi-rs/canvas cannot be resolved at all, and
  // extraction must still work there.
  const { execFileSync } = require('child_process');
  const script = `
    const Module = require('module');
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (req, ...rest) {
      if (String(req).startsWith('@napi-rs/canvas')) {
        const e = new Error("Cannot find module '" + req + "'"); e.code = 'MODULE_NOT_FOUND'; throw e;
      }
      return orig.call(this, req, ...rest);
    };
    (async () => {
      const { makePdf, makeScannedPdf } = require(${JSON.stringify(path.join(__dirname, 'fixtures/makePdf.js'))});
      const { extractText } = require(${JSON.stringify(path.join(SRC, 'services/pdfService.js'))});
      const r = await extractText(makePdf([['Report 2025','The Board adopted an anti-bribery policy in March 2024.']]));
      if (r.status !== 'extracted') throw new Error('status was ' + r.status);
      if (!r.text.replace(/\\s+/g,' ').includes('anti-bribery policy in March 2024')) throw new Error('text missing');
      const s = await extractText(makeScannedPdf());
      if (s.status !== 'no_text_layer') throw new Error('scan status was ' + s.status);
      console.log('OK');
    })().catch(e => { console.error(e.message); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  assert.match(out, /OK/, 'extraction failed when the native canvas binding was unresolvable');
});

test('the font URL is built as a file URL, not by concatenating a path separator', () => {
  // A SHAPE guard, because no assertion about the resulting VALUE could catch
  // this on Linux. The original was `path.join(...) + path.sep`, which yields a
  // trailing "/" on Linux and "\\" on Windows; pdfjs requires "/", so
  // getDocument() threw on every extraction — but only on Windows.
  //
  // The irony is the point: that line existed purely to silence a log warning,
  // and it broke the one machine the change it rode along with was written to
  // unblock. It passed every test, on every platform anyone could test it on.
  const src = read(path.join(SRC, 'services/pdfService.js'));
  assert.ok(/pathToFileURL/.test(src),
    'the standard-fonts URL must be built with pathToFileURL, which normalises separators and the drive letter');
  assert.ok(!/standardFontDataUrl[\s\S]{0,200}?\+\s*path\.sep/.test(src) &&
            !/return\s+\w+\s*\+\s*path\.sep/.test(src),
    'the font URL is being built by concatenating path.sep — that produces a backslash on Windows');

  const { extractText } = require('../src/services/pdfService');
  assert.strictEqual(typeof extractText, 'function');
});

Promise.all(pending).then(() => {
  console.log(`no-model-figures-test: ${passed} passed`);
});

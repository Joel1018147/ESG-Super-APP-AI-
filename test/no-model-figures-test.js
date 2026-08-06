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
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
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

test('no setTimeout is used to schedule work outside the job poller', () => {
  for (const f of files) {
    if (f.endsWith('jobRunner.js') || f.endsWith('groqService.js') || f.endsWith('verraService.js')) continue;
    const src = read(f);
    assert.ok(!/setTimeout\s*\(/.test(src),
      `${rel(f)} uses setTimeout — scheduled work belongs in esg_scheduled_jobs, not in a timer that dies with the container`);
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

console.log(`no-model-figures-test: ${passed} passed`);

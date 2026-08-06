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

console.log(`no-model-figures-test: ${passed} passed`);

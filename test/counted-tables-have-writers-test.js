'use strict';
/* No UI counts a table that has no writer.
 *
 *   node test/counted-tables-have-writers-test.js
 *
 * ── The defect this generalises ─────────────────────────────────────────────
 * `esg_verra_methodologies` had zero writers and was COUNTED and DISPLAYED, so
 * /governance showed "Methodologies 0" for ever, beside a "Projects mirrored"
 * card that was genuinely populated. A confident zero next to a real number
 * reads as a real zero. That is recurring-bugs-checklist.md #22, and its cost
 * is not the missing feature — it is the registered promise: a wrong number
 * gets checked the first time somebody cares, a false "nothing here" never
 * does, because the person who asked has stopped asking.
 *
 * ── Why it is written as a RULE ─────────────────────────────────────────────
 * recurring-bugs-checklist.md #24: a check handed a LIST of its subjects passes
 * for ever on exactly that list, and the subject added tomorrow is invisible to
 * it rather than failed by it. So nothing here is enumerated. The tables come
 * from schema.sql, the writers from the source, and the counts from the source,
 * all at check time — with FLOOR assertions on each derived set, because a
 * derived list that collapses to zero passes vacuously (#14 by another road).
 *
 * ── What it deliberately does NOT assert ────────────────────────────────────
 * That every table has a writer. Two do not and both are correct:
 * `esg_indicator_options` is a documented OVERRIDE table whose empty state is
 * the designed default (scoringEngine.js falls back to STANDARD_OPTIONS), and
 * `session` is written by connect-pg-simple. Neither is counted anywhere, and
 * "no writer" is only a defect once something REPORTS the table. Widening this
 * to "every table needs a writer" would fail on correct code and get switched
 * off, which is #13 arriving from the other direction.
 */

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const SRC = path.join(APP, 'src');

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, e !== undefined ? JSON.stringify(e) : '')); };

/**
 * Blank out comments, preserving length and line breaks so reported line
 * numbers stay true.
 *
 * NOT optional, and the first run of this file proved why:
 * recurring-bugs-checklist.md #16 records that "the sentence explaining the fix
 * contains the string it bans, so a naive grep reports every properly-
 * documented fix as unfixed". It happened here immediately. The Run 61 comment
 * in schema.sql says "there is no INSERT INTO esg_verra_methodologies anywhere
 * in src/", and the comment in verraService.js quotes the count it removed —
 * so the unstripped scanner read the table as BOTH written and counted, on the
 * strength of two sentences saying it was neither.
 *
 * `://` is excluded so a URL does not eat the rest of its line.
 */
function stripComments(text, isSql) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  if (isSql) return text.replace(/--[^\n]*/g, blank);
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
}

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// ── 1. TABLES — derived from the schema, not listed here ────────────────────
const SCHEMA = fs.readFileSync(path.join(SRC, 'db/schema.sql'), 'utf8');
const tables = new Set(
  [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z_0-9]*)/gi)].map((m) => m[1]));

{
  const probe = stripComments('-- INSERT INTO ghost_table (x)\nINSERT INTO real_table (x)', true);
  ok('the comment stripper blanks a commented write and keeps a real one',
     !/INSERT INTO ghost_table/.test(probe) && /INSERT INTO real_table/.test(probe), probe);
  const jsProbe = stripComments(
    "// count(*) FROM ghost\nq('count(*) FROM real'); // x\nurl('https://a//b');", false);
  ok('the comment stripper handles // without eating a URL',
     !/FROM ghost/.test(jsProbe) && /FROM real/.test(jsProbe) && /https:/.test(jsProbe), jsProbe);
  ok('the stripper preserves line numbers',
     stripComments('a\n// b\nc', false).split('\n').length === 3);
}

ok('tables are derived from schema.sql, and there are as many as this app is known to have',
   tables.size >= 30, { found: tables.size });

// ── 2. WRITERS — every INSERT/COPY in the shipped source AND the seed ───────
// Both matter. Most reference tables in this app are populated by seed.sql, not
// by JS, so a writer scan over .js alone would report a dozen correct tables as
// having none — and a check that cries wolf a dozen times is a check somebody
// deletes.
const sourceFiles = [
  ...walk(SRC, ['.js']),
  path.join(SRC, 'db/seed.sql'),
  path.join(SRC, 'db/schema.sql'),
];
const sources = sourceFiles.map((f) => ({
  file: path.relative(APP, f),
  text: stripComments(fs.readFileSync(f, 'utf8'), f.endsWith('.sql')),
}));

const WRITE_RE = /\b(?:INSERT\s+INTO|COPY)\s+([a-z_][a-z_0-9]*)/gi;
const writers = new Map();
for (const { file, text } of sources) {
  for (const m of text.matchAll(WRITE_RE)) {
    if (!writers.has(m[1])) writers.set(m[1], new Set());
    writers.get(m[1]).add(file);
  }
}
ok('writers are derived from the source, and a plausible number were found',
   writers.size >= 15, { tablesWithWriters: writers.size });

// ── 3. COUNTS — every `count(*) … FROM <table>` the app issues ──────────────
// Scoped to .js, because that is where a count becomes a number on a screen or
// in an API response. A count inside seed.sql or schema.sql reports nothing to
// anyone.
const COUNT_RE = /\bcount\s*\(\s*\*\s*\)(?:\s*::\s*\w+)?(?:\s+AS\s+\w+)?\s+FROM\s+([a-z_][a-z_0-9]*)/gi;
const counted = new Map();
for (const { file, text } of sources) {
  if (!file.endsWith('.js')) continue;
  for (const m of text.matchAll(COUNT_RE)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (!counted.has(m[1])) counted.set(m[1], []);
    counted.get(m[1]).push(`${file}:${line}`);
  }
}
ok('counted tables are derived from the source, and the finder still matches',
   counted.size >= 3, { countedTables: [...counted.keys()] });

// Every counted name must be a real table. A count against something the schema
// does not create means either a typo or a table that moved — both of which
// would otherwise make this whole check quietly skip that name.
const countedGhosts = [...counted.keys()].filter((t) => !tables.has(t));
ok('every counted name is a table this schema actually creates',
   countedGhosts.length === 0, countedGhosts);

// ── 4. THE INVARIANT ────────────────────────────────────────────────────────
const countedWithoutWriter = [...counted.entries()]
  .filter(([t]) => tables.has(t) && !writers.has(t))
  .map(([t, sites]) => ({ table: t, countedAt: sites }));

ok('THE INVARIANT — no UI counts a table that has no writer',
   countedWithoutWriter.length === 0, countedWithoutWriter);

// ── 5. The specific tables Run 61 acted on stay acted upon ──────────────────
// Stated as behaviour rather than as prose in a comment, so a revert shows up
// as a red build rather than as a document nobody re-reads.
ok('esg_verra_methodologies still has no writer — so nothing may count it',
   !writers.has('esg_verra_methodologies'), [...(writers.get('esg_verra_methodologies') || [])]);
ok('…and nothing counts it',
   !counted.has('esg_verra_methodologies'), counted.get('esg_verra_methodologies'));
ok('esg_verra_projects, its populated sibling, does have a writer',
   writers.has('esg_verra_projects'), [...(writers.get('esg_verra_projects') || [])]);
ok('esg_audit_log is gone from the schema, not sitting in it empty',
   !tables.has('esg_audit_log'));

console.log(`\n  PASS ${pass}   FAIL ${fail}\n`);
process.exit(fail ? 1 : 0);

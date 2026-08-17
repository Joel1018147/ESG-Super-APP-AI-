'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   NEGATIVE CONTROLS FOR THE DASHBOARD                         (Run 55 · 56)
   ───────────────────────────────────────────────────────────────────────────
   Every guard dashboard-test.js added in Run 55 and Run 56 is shown the exact
   defect it claims to catch, and must go RED. This is the pattern
   Modus-Agent-OS/skills/test-harness-integrity-audit.md names as canonical,
   and this repo's CLAUDE.md has recorded its absence here since Run 17 — nine
   suites, fifty assertions, no plants, five of them mutation-tested by hand.
   This closes it for the dashboard.

   RUN IT DELIBERATELY:  node test/dashboard-plants.js

   IT IS NOT IN run-all.js AND MUST NOT BE. It REWRITES src/routes/pages.js,
   src/utils/layout.js, test/dashboard-test.js and
   public/css/modus-design-system.css in place and restores them afterwards,
   which is safe on a clean tree and destructive on a dirty one. A guard that can eat uncommitted work does not belong in the
   command people run without thinking. The clean-tree check below is the
   safety, and it refuses rather than warns.

   A PLANT THAT DOES NOT LAND IS REPORTED, NEVER COUNTED AS CAUGHT. The failure
   mode this file is most likely to develop is plant rot: an anchor string the
   source no longer contains, whose plant then "passes" by never having been
   applied. NOT LANDED is a failure here, exactly like MISSED.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const PAGES = path.join(REPO, 'src/routes/pages.js');
const TEST = path.join(REPO, 'test/dashboard-test.js');
const CSS = path.join(REPO, 'public/css/modus-design-system.css');
const LAYOUT = path.join(REPO, 'src/utils/layout.js');   // Run 56: the content cap lives here

const PLANTS = [
  // ── THE DASHBOARD IS A GRID, NOT A STACK ──
  ['every row becomes a single full-width column', PAGES,
    /class="col-(\d+)"/g, 'class="col-12"'],
  ['the rows lose the grid entirely', PAGES,
    /class="grid-12 reveal"/g, 'class="reveal"'],
  ['the master stops collapsing .col-* on a phone', CSS,
    /\.col-7, \.col-8, \.col-9, \.col-10, \.col-11, \.col-12 \{ grid-column: span 1; \}/,
    '.col-7, .col-8, .col-9, .col-10, .col-11, .col-12 { grid-column: span 7; }'],

  // ── NOTHING BLOCKED IS RENDERED AS AVAILABLE ──
  ['an AI confidence percentage comes back', PAGES,
    "const reviewPanel = panel('review', 'Review queue', `",
    "const reviewPanel = panel('review', 'Review queue', `<span>AI Confidence</span><span>87%</span>"],
  ['a peer percentile comes back', PAGES,
    /No industry comparison/, 'Better than 68% of companies in your industry'],
  ['a downloadable certificate comes back', PAGES,
    /Open green finance<\/a>/, 'Download Certificate</a>'],
  ['a consultation booking comes back', PAGES,
    /Open carbon<\/a>/, 'View Consultation Options</a>'],
  ['a pillar contribution level comes back', PAGES,
    /Open evidence<\/a>/, 'Your Contribution: High</a>'],
  ['a progress bar returns to a recommendation', PAGES,
    /<span class="metric-row-value">\$\{esc\(r\.points_missed\)\}<\/span>/,
    '<span class="metric-row-value">${esc(r.points_missed)}</span>'
    + '<div class="progress"><span class="progress-bar"></span></div><!-- recommendation -->'],

  // ── THE EMPTY DASHBOARD LEADS WITH THE RAIL ──
  ['the empty account gets the mature reading order', PAGES,
    /: `\$\{rowB\}\$\{statCards\}\$\{rowC\}\$\{rowD\}`/,
    ': `${statCards}${rowB}${rowC}${rowD}`'],
  ['the empty account leads with the rail but in the NARROW column', PAGES,
    /<div class="col-7">\$\{railPanel\}<\/div>\s*<div class="col-5">\$\{scorePanel\}<\/div>/,
    '<div class="col-7">${scorePanel}</div>\n          <div class="col-5">${railPanel}</div>'],

  // ── ANIMATED FIGURES ARE IN THE DOM AS TEXT ──
  ['the hero ring stops rendering its number server-side', PAGES,
    /<span class="score-ring-value">\$\{known \? esc\(value\) : '—'\}<\/span$/m,
    '<span class="score-ring-value"></span'],
  ['the hero ring loses its denominator', PAGES,
    /><span class="score-ring-den">\/\$\{esc\(opts\.den\)\}<\/span>/,
    '><span class="score-ring-den"></span>'],

  // ── the anchors themselves ──
  ['the .stat-card anchor disappears (the ordering test must not compare to -1)', PAGES,
    /class="stat-card\$\{glow \? ' stat-card--glow' : ''\}"/,
    'class="counter-card${glow ? \' counter-card--glow\' : \'\'}"'],

  // ── CONTRAST, on the §52 pairs Run 55 introduced ──
  ['.panel-index goes back to the raw accent on a surface', CSS,
    /\.panel-index \{\n  font-family: var\(--font-display\);\n  font-size: 13px;\n  font-weight: 700;\n  color: var\(--accent-text\);/,
    '.panel-index {\n  font-family: var(--font-display);\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--muted-2, #b8c4d4);'],

  // ── RUN 56 · THE COPY, THE ROUNDING AND THE FRAME ──
  ['the methodology paragraph returns under the score', PAGES,
    'items-start">${pillarRings}</div>',
    'items-start">${pillarRings}</div><p class="text-sm">Weighting v1.0 · engine v1.0.0. Every '
    + 'figure here is arithmetic over your own answers. No part of it is generated by AI.</p>'],
  ['the peer-comparison absence stops being named anywhere', PAGES,
    /title: 'No industry comparison',/, "title: 'Peer benchmarking',"],
  ['the score keeps its two decimal places', PAGES,
    /return Number\.isFinite\(n\) \? Math\.round\(n\) : null;/,
    'return Number.isFinite(n) ? n : null;'],
  ['the content column loses its cap entirely', LAYOUT,
    /\.app-main > \*\{max-width:var\(--content-max,\d+px\);margin-inline:auto\}\n/, ''],
  ['the cap hardcodes the length instead of reading the master token', LAYOUT,
    /max-width:var\(--content-max,(\d+px)\)/, 'max-width:$1'],
  ['the content column is capped but not centred', LAYOUT,
    /;margin-inline:auto\}/, '}'],

  // ── the harness's own honesty ──
  ['EMPTY_DB answers an aggregate with no row at all', TEST,
    /if \(isAggregate\(sql\)\) return \{ rows: \[\{ \.\.\.AGGREGATE_ZEROES \}\], rowCount: 1 \};/,
    ''],
  ['a fixture for one of the new aggregates goes missing', TEST,
    /\[\/AS proposals_live\/, \[\{ proposals_live: 3, proposals_pending: 2 \}\]\],/, ''],
];

const originals = new Map();
const read = (f) => { if (!originals.has(f)) originals.set(f, fs.readFileSync(f, 'utf8')); return originals.get(f); };
const restore = () => { for (const [f, s] of originals) fs.writeFileSync(f, s); };

function run() {
  try {
    const out = execFileSync(process.execPath, ['test/dashboard-test.js'],
      { cwd: REPO, encoding: 'utf8' });
    return { red: false, out };
  } catch (e) { return { red: true, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

/* THE CLEAN-TREE CHECK. This file rewrites tracked source and restores it from
   memory; if the process is killed between the two, the restore never runs and
   git is the only way back. So it refuses on a dirty tree rather than warning
   about one — a warning on a destructive default is a decision handed to
   whoever is not reading. */
const TOUCHED = ['src/routes/pages.js', 'test/dashboard-test.js',
  'public/css/modus-design-system.css', 'src/utils/layout.js'];
try {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...TOUCHED],
    { cwd: REPO, encoding: 'utf8' }).trim();
  if (dirty) {
    console.log('REFUSING: these files have uncommitted changes and this harness rewrites them.\n');
    console.log(dirty.split('\n').map((l) => `  ${l}`).join('\n'));
    console.log('\nCommit or stash first. The restore is held in memory, so a killed process loses them.');
    process.exit(1);
  }
} catch (e) {
  console.log(`REFUSING: could not ask git whether the tree is clean — ${e.message}`);
  process.exit(1);
}

const base = run();
console.log(`baseline: ${base.red ? 'RED (fix before planting)' : 'GREEN'}\n`);
if (base.red) { console.log(base.out.slice(-1500)); process.exit(1); }

let caught = 0; let missed = 0; let notLanded = 0;
for (const [name, file, find, replace] of PLANTS) {
  const src = read(file);
  const before = src;
  const after = src.replace(find, replace);
  if (after === before) {
    console.log(`  NOT LANDED  ${name}  — the anchor is not in ${path.basename(file)}`);
    notLanded++;
    continue;
  }
  fs.writeFileSync(file, after);
  const r = run();
  restore();
  if (r.red) {
    const line = (r.out.match(/✗[^\n]*/) || ['✗ (unnamed)'])[0].trim();
    console.log(`  caught      ${name}\n                 → ${line.slice(0, 110)}`);
    caught++;
  } else {
    console.log(`  MISSED      ${name}`);
    missed++;
  }
}

restore();
const after = run();
console.log(`\n  ${caught} caught, ${missed} missed, ${notLanded} not landed`);
console.log(`  restored baseline: ${after.red ? 'RED — RESTORE FAILED' : 'GREEN'}`);
process.exit(missed || notLanded || after.red ? 1 : 0);

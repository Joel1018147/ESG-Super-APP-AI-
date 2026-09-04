#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT-HASH THE LANDING PAGE'S MEDIA                             (Run 149)
   ───────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   express.static serves public/ with `maxAge: 7d` in production. That is the
   right setting for media — it is where the bytes are — but ONLY if a given
   URL always returns the same bytes. It did not: three different hero videos
   shipped to /media/hero.mp4 in one afternoon, and browsers that had cached
   the first one kept playing it, with no request to the server, for a week.
   The symptom was reported as "why is it only showing one scenery repeatedly".

   A cache header cannot fix that after the fact — a browser inside max-age
   does not revalidate, so it never learns the file changed. The only fix that
   reaches an already-cached visitor is a DIFFERENT URL. So every media file
   is named for a hash of its own content:

       hero.mp4  ->  hero.9f3c1a72.mp4

   New bytes mean a new name mean a new URL, which no cache can hold stale.
   And because a URL now maps to exactly one version of the content, the long
   max-age becomes correct rather than merely convenient.

   USAGE
     node scripts/hash-media.js            # rename + rewrite references
     node scripts/hash-media.js --check    # verify only, non-zero if drifted

   The --check mode is what test/landing-cta-test.js runs, so a file swapped
   without re-hashing fails the suite instead of silently serving stale.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MEDIA = path.join(ROOT, 'public', 'media');
const HTML = path.join(ROOT, 'public', 'index.html');
const SKIP = new Set(['CREDITS.md']);
const CHECK = process.argv.includes('--check');

const hash8 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

// strip any hash this script previously applied, so re-running is idempotent
const baseName = (name) => {
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  return stem.replace(/\.[0-9a-f]{8}$/, '') + ext;
};

const hashedName = (name, h) => {
  const base = baseName(name);
  const ext = path.extname(base);
  return base.slice(0, -ext.length) + '.' + h + ext;
};

const files = fs.readdirSync(MEDIA).filter((f) => !SKIP.has(f) && fs.statSync(path.join(MEDIA, f)).isFile());
let html = fs.readFileSync(HTML, 'utf8');
const renames = [];
const drift = [];

for (const name of files) {
  const full = path.join(MEDIA, name);
  const want = hashedName(name, hash8(full));
  if (want === name) continue;
  drift.push(`${name} -> ${want}`);
  if (!CHECK) {
    fs.renameSync(full, path.join(MEDIA, want));
    renames.push([name, want]);
  }
}

if (!CHECK) {
  // Rewrite by BASE name, so a reference to an older hash of the same asset is
  // caught too — matching on the exact old filename would miss those.
  for (const [, want] of renames) {
    const base = baseName(want);
    const ext = path.extname(base);
    const stem = base.slice(0, -ext.length);
    const re = new RegExp('/media/' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '(?:\\.[0-9a-f]{8})?' + ext.replace('.', '\\.'), 'g');
    html = html.replace(re, '/media/' + want);
  }
  fs.writeFileSync(HTML, html);
}

// Every /media/ reference in the HTML must exist on disk. Scoped to real
// src=/poster= ATTRIBUTES: a bare /media/ scan also matches prose inside
// comments — CREDITS.md is named in one — and then reports a documentation
// sentence as a broken asset reference.
const referenced = [...html.matchAll(/(?:src|poster)="\/media\/([^"]+)"/g)].map((m) => m[1]);
const missing = [...new Set(referenced)].filter((r) => !fs.existsSync(path.join(MEDIA, r)));
const unhashed = [...new Set(referenced)].filter((r) => !/\.[0-9a-f]{8}\.[a-z0-9]+$/.test(r));

if (CHECK) {
  const problems = [];
  if (drift.length) problems.push(`${drift.length} file(s) whose content no longer matches their hashed name:\n    ` + drift.join('\n    '));
  if (missing.length) problems.push(`${missing.length} reference(s) with no file on disk:\n    ` + missing.join('\n    '));
  if (unhashed.length) problems.push(`${unhashed.length} reference(s) not content-hashed:\n    ` + unhashed.join('\n    '));
  if (problems.length) {
    console.error('hash-media --check FAILED\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`hash-media --check: ${referenced.length} reference(s), all hashed and present`);
  process.exit(0);
}

console.log(`renamed ${renames.length} file(s):`);
renames.forEach(([a, b]) => console.log(`  ${a}  ->  ${b}`));
console.log(`${[...new Set(referenced)].length} reference(s) in index.html`);
if (missing.length) {
  console.error('BROKEN REFERENCES (no file on disk):\n  ' + missing.join('\n  '));
  process.exit(1);
}
if (unhashed.length) {
  console.error('NOT HASHED:\n  ' + unhashed.join('\n  '));
  process.exit(1);
}
console.log('every reference resolves to a file on disk');

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE JOURNEY, MISSIONS AND XP — the invariants                    (Run 52)
   ───────────────────────────────────────────────────────────────────────────
   The expensive failure here is not a crash. It is an XP total that has
   quietly stopped agreeing with the rows it claims to describe — on a page
   that also carries an ESG score, where a user cannot tell the two kinds of
   number apart.

   So the assertions are about DERIVATION:

     * nothing stores XP, progress or completion — the guard is the schema,
       not a comment, and the Run 52 section declares no company_id at all
     * the engine writes nothing and calls no model
     * the three compute functions are pure — called twice, deep-equal
     * every XP award resolves to exactly one real row, and its date is that
       row's own date
     * DELETING A SOURCE ROW LOWERS XP. This is the load-bearing test: it is
       the only one that could not pass if XP were stored anywhere
     * blocked renders differently from pending, compared as whole strings
       rather than by substring — the same discipline as Run 48's
       retrying-vs-failed fix
     * the stage count is data-driven, proven by adding a stage and rendering
     * the answered denominator is COMPUTED: /40 on MODUS_SEDG_ALIGNED and /38
       on SEDG@2.0, asserted both ways
     * cross-tenant, asserted at the SQL text as well as behaviourally,
       because Run 48 found a stub answering the tenancy question on the
       code's behalf
     * the API sends codes and never an English label (§4.3b)
     * every class the page renders exists in the stylesheet the page loads —
       a class that merely LOOKS like a design-system class fails silently

   The routers are mounted and driven over real HTTP (checklist #21), and the
   db stub's exports are asserted to be a subset of the real module's (#18).
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SCHEMA = fs.readFileSync(path.join(SRC, 'db', 'schema.sql'), 'utf8');
const SEED = fs.readFileSync(path.join(SRC, 'db', 'seed.sql'), 'utf8');
const ENGINE_SRC = fs.readFileSync(path.join(SRC, 'services', 'journeyEngine.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(SRC, 'routes', 'journey.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'modus-design-system.css'), 'utf8');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log('journey-test');

const engine = require('../src/services/journeyEngine');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · CONTAINMENT — the schema is the guard
   ═══════════════════════════════════════════════════════════════════════════ */

const RUN52 = (() => {
  const i = SCHEMA.indexOf('13. THE JOURNEY, MISSIONS AND XP');
  assert.ok(i > 0, 'the Run 52 schema section is gone — the anchor moved');
  return SCHEMA.slice(i);
})();

function tableBlock(name) {
  const start = RUN52.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.ok(start > -1, `${name} is not declared in the Run 52 section`);
  const end = RUN52.indexOf('\n);', start);
  assert.ok(end > start, `${name}'s declaration is unterminated`);
  return RUN52.slice(start, end);
}

const RUN52_TABLES = ['esg_journey_stages', 'esg_missions', 'esg_xp_levels'];

test('NOTHING THIS RUN CREATES IS COMPANY-SCOPED — so nothing can store progress', () => {
  // The strongest form of "no table stores XP, journey progress or mission
  // completion": a table with no tenant column cannot hold one company's
  // anything. Checked before the narrower column-name check below, because a
  // future author who wanted to store progress would have to add company_id
  // first, and this fires on that line rather than on the one after it.
  for (const t of RUN52_TABLES) {
    const block = tableBlock(t);
    const code = block.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    assert.ok(!/\bcompany_id\b/.test(code),
      `${t} declares company_id — a per-company row on a definition table is a stored counter `
      + 'waiting to happen, and a derived figure needs none');
  }
});

test('no column named xp, progress, completed_at or earned_at exists anywhere in this run', () => {
  const banned = /^\s*(xp|progress|completed_at|earned_at|points|total_xp|level_reached)\s+/i;
  const hits = [];
  for (const t of RUN52_TABLES) {
    for (const line of tableBlock(t).split('\n')) {
      if (/^\s*--/.test(line)) continue;
      if (banned.test(line)) hits.push(`${t}: ${line.trim()}`);
    }
  }
  assert.deepStrictEqual(hits, [],
    `a progress column was added:\n      ${hits.join('\n      ')}\n      `
    + 'XP is derived; an integer a route increments drifts the first time a request dies mid-write');
});

test('xp_award is on the DEFINITION table only, and is strictly positive', () => {
  const missions = tableBlock('esg_missions');
  assert.ok(/xp_award\s+integer NOT NULL CHECK \(xp_award > 0\)/.test(missions),
    'esg_missions.xp_award is missing or not constrained positive');
  // and it is a price, not a balance: no other table mentions xp at all
  for (const t of ['esg_journey_stages']) {
    assert.ok(!/\bxp\b/i.test(tableBlock(t).replace(/--[^\n]*/g, '')), `${t} mentions xp`);
  }
});

test('every table this run creates has a writer in the same change (checklist #22)', () => {
  const created = [...RUN52.matchAll(/CREATE TABLE IF NOT EXISTS (esg_\w+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(created, RUN52_TABLES, `expected exactly ${RUN52_TABLES} , found ${created}`);
  for (const t of created) {
    assert.ok(new RegExp(`INSERT INTO ${t}\\b`).test(SEED),
      `${t} has no INSERT INTO in seed.sql — a table with no writer answers "nothing found", `
      + 'which is byte-identical to the honest answer');
  }
});

test('the blocked stages carry a reason, and it is the annotation\'s own wording', () => {
  // Taken from docs/design/UI_REFERENCE_ANNOTATED.md §1.3-§1.5. Asserted against
  // the seed so that softening one later is a failing test rather than an edit
  // nobody notices.
  for (const fragment of [
    'SustNET publishes no methodology mapping company activity to the four pillars',
    'No SustNET ESG certification scheme is published',
    'Expert consultation is not built into the platform yet',
  ]) {
    assert.ok(SEED.includes(fragment), `the seeded blocked_reason no longer says: ${fragment}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE ENGINE — writes nothing, calls nothing, and is pure
   ═══════════════════════════════════════════════════════════════════════════ */

test('journeyEngine.js contains no INSERT, UPDATE or DELETE', () => {
  const code = ENGINE_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const verb of ['INSERT INTO', 'UPDATE ', 'DELETE FROM']) {
    assert.ok(!new RegExp(verb).test(code),
      `journeyEngine.js contains ${verb.trim()} — the engine that derives a figure must not also `
      + 'be able to write one');
  }
});

/** Comments stripped. The sentence documenting a banned thing contains the
 *  banned thing — checklist #16's "strip comments first", which this suite got
 *  wrong on its first run: the header comment saying `generateWithGroq` does
 *  not appear was itself the only match. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Template-literal bodies, by an exact structural split on the backtick and
 *  segment parity. A `` `([^`]*)` `` regex cannot tell an opening backtick from
 *  a closing one and pairs the end of one literal with the start of the next,
 *  which is MODUS_UI_CONTRACT §7b rule 2 — and is what this test did on its
 *  first run, reporting ordinary JavaScript as an unscoped SQL statement. */
function templateLiterals(src) {
  return src.split('`').filter((_, i) => i % 2 === 1);
}

test('journeyEngine.js calls no model', () => {
  assert.ok(!/generateWithGroq|groqService/.test(stripComments(ENGINE_SRC)),
    'the journey engine reaches the model layer — XP is arithmetic over committed facts and a '
    + 'model has nothing to contribute to it');
});

test('the three compute functions touch no database, no clock and no randomness', () => {
  // Sliced by name so the assertion is about THOSE functions, not about the
  // file: gatherFacts legitimately queries, and xpSince legitimately takes a
  // date from its caller.
  const bounds = ['function computeJourney', 'function computeMissions', 'function computeXp', 'function xpSince'];
  for (let i = 0; i < 3; i++) {
    const from = ENGINE_SRC.indexOf(bounds[i]);
    const to = ENGINE_SRC.indexOf(bounds[i + 1]);
    assert.ok(from > 0 && to > from, `${bounds[i]} not found — the anchor moved`);
    const body = ENGINE_SRC.slice(from, to).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const impure of ['await ', 'query(', 'Date.now', 'new Date', 'Math.random']) {
      assert.ok(!body.includes(impure),
        `${bounds[i]} uses ${impure} — it is documented as pure and the suite tests it as pure`);
    }
  }
});

/* ── a hand-built fixture, so purity can be tested without a database ────── */

function factsFixture(overrides) {
  const base = {
    never: { done: 0, total: 1, satisfied: false, source: null },
    company_profile_complete: { done: 5, total: 5, satisfied: true, source: { source_table: 'esg_companies', source_id: 'c1', earned_at: '2026-08-10T00:00:00.000Z' } },
    documents_uploaded: { done: 1, total: 1, satisfied: true, source: { source_table: 'esg_documents', source_id: 'd1', earned_at: '2026-08-11T00:00:00.000Z' } },
    extraction_run: { done: 0, total: 1, satisfied: false, source: null },
    proposals_reviewed: { done: 2, total: 5, satisfied: false, source: null },
    assessment_answered: { done: 18, total: 40, satisfied: false, source: null },
    assessment_scored: { done: 0, total: 1, satisfied: false, source: null },
    carbon_entries_present: { done: 0, total: 1, satisfied: false, source: null },
    recommendations_present: { done: 0, total: 1, satisfied: false, source: null },
    green_project_defined: { done: 0, total: 1, satisfied: false, source: null },
    carbon_baselined: { done: 0, total: 1, satisfied: false, source: null },
  };
  return { predicates: Object.assign(base, overrides || {}) };
}

const STAGES_FIXTURE = [
  { code: 'COMPANY_PROFILE', sort_order: 10, label_en: 'Profile', description_en: null, group_code: 'assess', predicate_code: 'company_profile_complete', blocked_reason: null },
  { code: 'ASSESSMENT_ANSWERED', sort_order: 20, label_en: 'Answer', description_en: null, group_code: 'assess', predicate_code: 'assessment_answered', blocked_reason: null },
  { code: 'CARBON_DATA', sort_order: 30, label_en: 'Carbon', description_en: null, group_code: 'assess', predicate_code: 'carbon_entries_present', blocked_reason: null },
  { code: 'CERTIFICATION', sort_order: 40, label_en: 'Certify', description_en: null, group_code: 'certify', predicate_code: 'never', blocked_reason: 'No scheme is published.' },
];

const MISSIONS_FIXTURE = [
  { code: 'M_PROFILE', stage_code: 'COMPANY_PROFILE', label_en: 'Profile', description_en: null, predicate_code: 'company_profile_complete', xp_award: 40, sort_order: 10 },
  { code: 'M_UPLOAD', stage_code: 'COMPANY_PROFILE', label_en: 'Upload', description_en: null, predicate_code: 'documents_uploaded', xp_award: 30, sort_order: 20 },
  { code: 'M_ANSWER', stage_code: 'ASSESSMENT_ANSWERED', label_en: 'Answer', description_en: null, predicate_code: 'assessment_answered', xp_award: 120, sort_order: 30 },
];

const LEVELS_FIXTURE = [
  { level: 1, min_xp: 0, label_en: 'Seedling' },
  { level: 2, min_xp: 60, label_en: 'Sprout' },
  { level: 3, min_xp: 200, label_en: 'Sapling' },
];

test('computeJourney, computeMissions and computeXp are pure — same input, deep-equal output', () => {
  const f = factsFixture();
  assert.deepStrictEqual(engine.computeJourney(f, STAGES_FIXTURE), engine.computeJourney(f, STAGES_FIXTURE));
  assert.deepStrictEqual(engine.computeMissions(f, MISSIONS_FIXTURE), engine.computeMissions(f, MISSIONS_FIXTURE));
  assert.deepStrictEqual(engine.computeXp(f, MISSIONS_FIXTURE, LEVELS_FIXTURE),
    engine.computeXp(f, MISSIONS_FIXTURE, LEVELS_FIXTURE));
});

test('a blocked stage is blocked whatever its predicate says', () => {
  // Satisfy the blocked stage's predicate and it must STILL be blocked.
  const stages = STAGES_FIXTURE.map((s) => (s.code === 'CERTIFICATION'
    ? { ...s, predicate_code: 'company_profile_complete' } : s));
  const j = engine.computeJourney(factsFixture(), stages);
  const cert = j.stages.find((s) => s.stage_code === 'CERTIFICATION');
  assert.strictEqual(cert.state, 'blocked',
    'a stage with a blocked_reason resolved to its predicate — blocked means this cannot happen '
    + 'yet, and a satisfied predicate does not change that');
});

test('the four states are distinguished, and in_progress is not rounded to either end', () => {
  const j = engine.computeJourney(factsFixture(), STAGES_FIXTURE);
  const by = Object.fromEntries(j.stages.map((s) => [s.stage_code, s]));
  assert.strictEqual(by.COMPANY_PROFILE.state, 'completed');
  assert.strictEqual(by.ASSESSMENT_ANSWERED.state, 'in_progress');
  assert.strictEqual(by.CARBON_DATA.state, 'pending');
  assert.strictEqual(by.CERTIFICATION.state, 'blocked');
  assert.strictEqual(by.ASSESSMENT_ANSWERED.done, 18);
  assert.strictEqual(by.ASSESSMENT_ANSWERED.total, 40);
  assert.strictEqual(j.active_stage_code, 'ASSESSMENT_ANSWERED',
    'the next thing to do is not the first unfinished stage');
});

test('an unimplemented predicate THROWS rather than resolving to pending', () => {
  // RULE 6a. A predicate nobody implemented, scored as "not your turn yet",
  // is a stage that will never move and looks perfectly normal doing it.
  assert.throws(
    () => engine.computeJourney(factsFixture(), [{ code: 'X', sort_order: 1, label_en: 'X', group_code: 'assess', predicate_code: 'invented_predicate', blocked_reason: null }]),
    /unimplemented predicate: invented_predicate/);
});

test('EVERY predicate_code in seed.sql is implemented by the engine, and vice versa', () => {
  const seeded = new Set([...SEED.matchAll(/'([a-z_]+)',\s*(?:NULL|\d+|')/g)].map((m) => m[1])
    .filter((c) => engine.PREDICATE_CODES.includes(c) || /^[a-z]+(_[a-z]+)+$/.test(c)));
  // Narrow to the codes that actually appear in a predicate position: the
  // journey INSERT lists them as the second-to-last column, so read them from
  // the two Run 52 statements rather than from the whole file.
  const block = SEED.slice(SEED.indexOf('6a. STAGES'));
  const used = new Set([...block.matchAll(/'([a-z_]+)',\s*(?:NULL|'|\d)/g)].map((m) => m[1])
    .filter((c) => c !== 'never' ? /_/.test(c) : true));
  const predicates = [...used].filter((c) => engine.PREDICATE_CODES.includes(c) || /^(company|documents|extraction|proposals|assessment|carbon|recommendations|green)_/.test(c));
  assert.ok(predicates.length >= 10, `only found ${predicates.length} predicate codes in the seed — the reader broke`);
  for (const c of predicates) {
    assert.ok(engine.PREDICATE_CODES.includes(c),
      `seed.sql uses predicate ${c}, which journeyEngine does not implement — the page would throw`);
  }
  for (const c of engine.PREDICATE_CODES) {
    assert.ok(c === 'never' || predicates.includes(c) || seeded.has(c),
      `the engine implements ${c} but no seeded stage or mission uses it — dead code in a guard file`);
  }
});

test('XP awards carry provenance, and the total is their sum', () => {
  const xp = engine.computeXp(factsFixture(), MISSIONS_FIXTURE, LEVELS_FIXTURE);
  assert.deepStrictEqual(xp.awards.map((a) => a.mission_code), ['M_PROFILE', 'M_UPLOAD']);
  assert.strictEqual(xp.total, 70);
  assert.strictEqual(xp.max_xp, 190);
  assert.strictEqual(xp.level, 2);
  assert.strictEqual(xp.next_level_min_xp, 200);
  for (const a of xp.awards) {
    assert.ok(a.source_table && a.source_id && a.earned_at,
      `award ${a.mission_code} has no provenance`);
  }
});

test('a satisfied mission with no resolvable source row THROWS', () => {
  // An XP award nobody can trace is the one thing this design exists to make
  // impossible. Reporting it as unearned would hide the fault; awarding it
  // anyway would put an untraceable number beside an ESG score.
  const f = factsFixture({
    company_profile_complete: { done: 5, total: 5, satisfied: true, source: null },
  });
  assert.throws(() => engine.computeXp(f, MISSIONS_FIXTURE, LEVELS_FIXTURE),
    /no provenance/);
});

test('an empty level ladder throws instead of inventing a level', () => {
  assert.throws(() => engine.computeXp(factsFixture(), MISSIONS_FIXTURE, []),
    /No XP levels seeded/);
});

test('xpSince filters on each award\'s own source-row date', () => {
  const xp = engine.computeXp(factsFixture(), MISSIONS_FIXTURE, LEVELS_FIXTURE);
  assert.strictEqual(engine.xpSince(xp.awards, '2026-08-01T00:00:00.000Z'), 70);
  assert.strictEqual(engine.xpSince(xp.awards, '2026-08-11T00:00:00.000Z'), 30,
    'the week filter is not applied to the source row timestamp');
  assert.strictEqual(engine.xpSince(xp.awards, '2026-09-01T00:00:00.000Z'), 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · TENANCY, AT THE DECISION SITE
   ═══════════════════════════════════════════════════════════════════════════ */

test('EVERY statement in journeyEngine.js carries a tenant predicate, at the SQL', () => {
  // AIMED AT THE DECISION SITE, NOT AT THE BEHAVIOUR. The behavioural test
  // below runs against a stub, and a stub filters in JavaScript — so it would
  // enforce the tenancy the SQL is supposed to enforce and stay green when the
  // SQL loses it. Run 48 found exactly that.
  const REFERENCE_ONLY = ['esg_indicators', 'esg_journey_stages', 'esg_missions', 'esg_xp_levels'];
  const stmts = templateLiterals(ENGINE_SRC).filter((s) => /\besg_[a-z_]+\b/.test(s));
  assert.ok(stmts.length >= 12, `expected a dozen or more statements, found ${stmts.length}`);
  for (const s of stmts) {
    const tables = [...s.matchAll(/\b(esg_[a-z_]+)\b/g)].map((m) => m[1]);
    // Three legitimate shapes, and no file or line is ever named — a guard with
    // an exemption list dissolves one legitimate use at a time (#13).
    const scoped = /company_id = \$1/.test(s)                                  // the tenant filter itself
      || /FROM esg_companies\s+WHERE id = \$1/.test(s)                          // the company IS the tenant
      || tables.every((t) => REFERENCE_ONLY.includes(t));                       // reference data, no tenant in it
    assert.ok(scoped,
      `a statement in journeyEngine.js reads company data with no tenant predicate:\n      ${s.replace(/\s+/g, ' ').slice(0, 130)}`);
  }
});

test('the Run 52 API block issues no SQL of its own', () => {
  // Everything it needs comes from the engine, which is where the tenant
  // predicate lives. A second query path here is a second place for it to be
  // forgotten.
  const api = fs.readFileSync(path.join(SRC, 'routes', 'api.js'), 'utf8');
  const i = api.indexOf('THE JOURNEY, MISSIONS AND XP');
  assert.ok(i > 0, 'the Run 52 API section is gone — the anchor moved');
  const block = stripComments(api.slice(i));
  const named = [...block.matchAll(/\b(esg_[a-z_]+)\b/g)].map((m) => m[1]);
  assert.deepStrictEqual(named, [],
    `the journey API block names a table directly: ${named.join(', ')} — everything it needs comes `
    + 'from the engine, which is where the tenant predicate lives');
  assert.ok(!block.includes('`'), 'the journey API block carries a template literal, which is where SQL would hide');
});

test('routes/journey.js issues no SQL at all', () => {
  assert.ok(!/\besg_[a-z_]+\b/.test(stripComments(PAGE_SRC)),
    'the page names a table directly instead of going through the engine');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · BEHAVIOUR — the real routers, mounted, over real HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const COMPANY_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const FW_MODUS = 'ffffffff-0000-0000-0000-00000000004a';
const FW_SEDG = 'ffffffff-0000-0000-0000-000000000038';

const SEEDED_STAGES = [
  { code: 'COMPANY_PROFILE', sort_order: 10, label_en: 'Set up your company profile', label_bm: null, label_zh: null, description_en: 'Five fields.', group_code: 'assess', predicate_code: 'company_profile_complete', blocked_reason: null },
  { code: 'DOCUMENTS_UPLOADED', sort_order: 20, label_en: 'Upload the documents you already hold', label_bm: null, label_zh: null, description_en: null, group_code: 'evidence', predicate_code: 'documents_uploaded', blocked_reason: null },
  { code: 'ASSESSMENT_ANSWERED', sort_order: 30, label_en: 'Answer the assessment', label_bm: null, label_zh: null, description_en: null, group_code: 'assess', predicate_code: 'assessment_answered', blocked_reason: null },
  { code: 'CERTIFICATION', sort_order: 40, label_en: 'Certification', label_bm: null, label_zh: null, description_en: null, group_code: 'certify', predicate_code: 'never', blocked_reason: 'No SustNET ESG certification scheme is published. This platform assesses; it does not certify.' },
];

const SEEDED_MISSIONS = [
  { code: 'M_PROFILE', stage_code: 'COMPANY_PROFILE', label_en: 'Complete every profile field', description_en: null, predicate_code: 'company_profile_complete', xp_award: 40, sort_order: 10 },
  { code: 'M_UPLOAD', stage_code: 'DOCUMENTS_UPLOADED', label_en: 'Upload your first document', description_en: null, predicate_code: 'documents_uploaded', xp_award: 30, sort_order: 20 },
  { code: 'M_ANSWER', stage_code: 'ASSESSMENT_ANSWERED', label_en: 'Answer every indicator', description_en: null, predicate_code: 'assessment_answered', xp_award: 120, sort_order: 30 },
];

const SEEDED_LEVELS = [
  { level: 1, min_xp: 0, label_en: 'Seedling' },
  { level: 2, min_xp: 80, label_en: 'Sprout' },
  { level: 3, min_xp: 200, label_en: 'Sapling' },
];

function makeState(over) {
  return Object.assign({
    stages: SEEDED_STAGES,
    missions: SEEDED_MISSIONS,
    levels: SEEDED_LEVELS,
    // Per company. Nothing is defaulted for a company that is not named here:
    // an unknown tenant sees an empty world, which is what the SQL would do.
    companies: {
      [COMPANY_A]: { id: COMPANY_A, filled: 5, earned_at: '2026-08-10T00:00:00.000Z' },
      [COMPANY_B]: { id: COMPANY_B, filled: 1, earned_at: '2026-08-10T00:00:00.000Z' },
    },
    assessments: {
      [COMPANY_A]: { id: 'as-a', framework_id: FW_MODUS, framework_code: 'MODUS_SEDG_ALIGNED', framework_version: '0.9-draft', reporting_year: 2025, status: 'draft' },
    },
    indicatorCounts: { [FW_MODUS]: 40, [FW_SEDG]: 38 },
    documents: { [COMPANY_A]: { id: 'doc-a', earned_at: '2026-08-11T00:00:00.000Z' } },
    extractedDocuments: {},
    queue: {},
    firstAccepted: {},
    responses: { [COMPANY_A]: { answered: 18, na: 0, last: { id: 'r-a', earned_at: '2026-08-12T00:00:00.000Z' } } },
    scores: {},
    carbon: {},
    recommendations: {},
    projects: {},
    baselines: {},
  }, over || {});
}

function makeDbStub(state) {
  const calls = [];
  const one = (bag, key) => ({ rows: bag[key] ? [bag[key]] : [] });
  return {
    calls,
    exports: {
      query: async (text, params) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        calls.push({ sql, params });
        const c = params && params[0];

        if (sql.includes('FROM esg_journey_stages')) return { rows: state.stages };
        if (sql.includes('FROM esg_missions')) return { rows: state.missions };
        if (sql.includes('FROM esg_xp_levels')) return { rows: state.levels };

        if (sql.includes('FROM esg_assessments WHERE company_id')) {
          return one(state.assessments, c);
        }
        if (sql.includes('FROM esg_companies WHERE id')) {
          const row = state.companies[c];
          return { rows: row ? [{ id: row.id, filled: row.filled, earned_at: row.earned_at }] : [] };
        }
        if (sql.includes("text_status = 'extracted'")) return one(state.extractedDocuments, c);
        if (sql.includes('FROM esg_documents WHERE company_id')) return one(state.documents, c);
        if (sql.includes('AS live')) {
          const q = state.queue[c] || { live: 0, reviewed: 0, pending: 0, accepted: 0 };
          return { rows: [q] };
        }
        if (sql.includes('FROM esg_document_extractions e')) return one(state.firstAccepted, c);
        if (sql.includes('FROM esg_indicators')) {
          // HONOUR THE LOOKUP. Answering a fixed 40 here would make the
          // "/38 on SEDG" assertion pass against a stub that had computed the
          // denominator for the engine — a double answering on the code's
          // behalf is testing its own construction (checklist #18).
          const n = state.indicatorCounts[params[0]];
          return { rows: [{ n: n === undefined ? 0 : n }] };
        }
        if (sql.includes('AS answered')) {
          const r = state.responses[c] || { answered: 0, na: 0 };
          return { rows: [{ answered: r.answered, na: r.na }] };
        }
        if (sql.includes('FROM esg_responses r')) {
          const r = state.responses[c];
          return { rows: r && r.last ? [r.last] : [] };
        }
        if (sql.includes('FROM esg_scores s')) return one(state.scores, c);
        if (sql.includes('FROM esg_carbon_entries')) return one(state.carbon, c);
        if (sql.includes('FROM esg_recommendations r')) return one(state.recommendations, c);
        if (sql.includes('FROM esg_green_projects WHERE company_id')) return one(state.projects, c);
        if (sql.includes('FROM esg_green_project_baselines b')) return one(state.baselines, c);
        throw new Error(`journey stub has no fixture for: ${sql.slice(0, 120)}`);
      },
      pool: { connect: async () => { throw new Error('the stub pool has no client'); } },
    },
  };
}

function serve(user, state) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const stub = makeDbStub(state);
  const extra = Object.keys(stub.exports).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `the stub invents exports the real src/db lacks: ${extra}`);

  const cached = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub.exports };
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
  }
  let app;
  try {
    const { requireAuth, denyWritesForReadOnly } = require('../src/middleware/auth');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => Boolean(user); next(); });
    app.use('/api', requireAuth, denyWritesForReadOnly, require('../src/routes/api'));
    app.use('/', requireAuth, denyWritesForReadOnly, require('../src/routes/journey'));
    app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); }); // eslint-disable-line
  } finally {
    require.cache[dbPath] = cached;
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  }
  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return {
    stub, state,
    close: () => new Promise((r) => server.close(r)),
    get: (p, h) => fetch(base() + p, { redirect: 'manual', headers: h || { Accept: 'text/html' } }),
  };
}

const USER_A = { id: 'u-a', name: 'A', email: 'a@x.test', role: 'company_admin', company_id: COMPANY_A };
const USER_B = { id: 'u-b', name: 'B', email: 'b@x.test', role: 'company_admin', company_id: COMPANY_B };

/** The content region only. The shell's own classes are layout.js's business
 *  and predate this run; asserting on them would report a pre-existing gap as
 *  this run's regression. */
/** The page's own region. Both shell markers are accepted: `.content` was this
 *  repo's hand-rolled shell and `.app-main` is the design system's, which Run
 *  53 moved to. A helper that knows only one goes silently vacuous the moment
 *  the other is in place — which is the failure it exists to catch. */
function contentOf(html) {
  for (const marker of ['<main class="app-main"', '<main class="content"']) {
    const i = html.indexOf(marker);
    if (i < 0) continue;
    const j = html.lastIndexOf('</main>');
    if (j > i) return html.slice(html.indexOf('>', i) + 1, j);
  }
  assert.fail('the rendered page has no content region — the shell changed');
  return '';
}

/** The journey rail on its own. The milestone STRIP further down the page also
 *  carries locked badges — legitimately, for missions nobody has finished — so
 *  a page-wide substring check for `is-locked` says nothing about a node. This
 *  suite made that mistake on its first run. */
function railOf(html) {
  const i = html.indexOf('<div class="journey-rail">');
  const j = html.indexOf('Missions</h3>', i);
  assert.ok(i > -1 && j > i, 'the journey rail is not in the rendered page — the anchor moved');
  return html.slice(i, j);
}

/** One count per NODE. `class="journey-node` also prefixes `journey-node-label`
 *  and `journey-node-meta`, so an unanchored count reports three times the
 *  stages there are — which it did, on the first run. */
function countNodes(html) {
  return (html.match(/class="journey-node[ "]/g) || []).length;
}

(async () => {
  const app = serve(USER_A, makeState());

  await atest('the page renders one node per seeded stage, and the count is DATA', async () => {
    const html = await (await app.get('/journey')).text();
    const four = countNodes(contentOf(html));
    assert.strictEqual(four, 4, `rendered ${four} nodes for 4 seeded stages`);

    // Add a fifth stage and change no code at all.
    const st = makeState();
    st.stages = SEEDED_STAGES.concat([{
      code: 'GREEN_PROJECT', sort_order: 50, label_en: 'Define a green project', label_bm: null,
      label_zh: null, description_en: null, group_code: 'finance',
      predicate_code: 'green_project_defined', blocked_reason: null,
    }]);
    const five = serve(USER_A, st);
    const html5 = await (await five.get('/journey')).text();
    const n5 = countNodes(contentOf(html5));
    assert.strictEqual(n5, 5, `a fifth seeded stage rendered ${n5} nodes — the rail is not data-driven`);
    await five.close();
  });

  await atest('BLOCKED RENDERS DIFFERENTLY FROM PENDING — compared as whole strings', async () => {
    // Same stage, same predicate, same position. The ONLY difference is the
    // blocked_reason. Two substring checks could both pass on identical pages;
    // comparing the strings cannot.
    const pendingState = makeState();
    pendingState.stages = SEEDED_STAGES.map((s) => (s.code === 'CERTIFICATION'
      ? { ...s, blocked_reason: null } : s));
    const pendingApp = serve(USER_A, pendingState);
    const pendingHtml = contentOf(await (await pendingApp.get('/journey')).text());

    const blockedApp = serve(USER_A, makeState());
    const blockedHtml = contentOf(await (await blockedApp.get('/journey')).text());

    assert.notStrictEqual(pendingHtml, blockedHtml,
      'a blocked stage and a pending stage render byte-identical pages — pending means your turn '
      + 'next, blocked means this cannot happen yet, and drawing them the same way is the same '
      + 'error class as a failed AI call rendering like an empty one');
    const blockedRail = railOf(blockedHtml);
    const pendingRail = railOf(pendingHtml);
    // The blocked badge was `.milestone-badge.is-locked` until Run 53 measured
    // it at ~3.2:1 and the earned variant at 1.2:1. `.badge.badge-gray` is
    // 6.76:1 light / 5.71:1 dark and carries the same word. The state is still
    // never colour alone — the badge says "Blocked".
    assert.ok(blockedRail.includes('badge badge-gray'), 'the blocked node carries no badge');
    assert.ok(!pendingRail.includes('badge badge-gray'), 'the pending node carries the blocked badge');
    assert.ok(!blockedRail.includes('is-locked') && !blockedRail.includes('is-earned'),
      'the rail uses a §50 badge modifier that fails the 4.5:1 contrast rule');
    assert.ok(blockedRail.includes('>Blocked<'), 'the blocked node never says the word');
    assert.ok(pendingRail.includes('Not started yet'), 'the pending node does not say it has not started');
    // The state class is the other half: §50 has no blocked modifier, so a
    // blocked node deliberately carries NO state class rather than borrowing
    // the pending one.
    assert.ok(pendingRail.includes('journey-node is-pending'), 'the pending node lost its state class');
    assert.ok(!/journey-node is-pending[^>]*>[\s\S]{0,400}?Blocked/.test(blockedRail),
      'the blocked node is dressed as a pending one');
    await pendingApp.close(); await blockedApp.close();
  });

  await atest('a blocked stage names its reason, in the annotation\'s own words', async () => {
    const html = contentOf(await (await app.get('/journey')).text());
    assert.ok(html.includes('No SustNET ESG certification scheme is published'),
      'the blocked stage does not say why it is blocked');
    assert.ok(html.includes('This platform assesses; it does not certify'),
      'the second half of the reason was truncated');
  });

  await atest('THE ANSWERED DENOMINATOR IS COMPUTED — /40 on the Modus 40, /38 on SEDG', async () => {
    const html40 = contentOf(await (await app.get('/journey')).text());
    assert.ok(/18 of 40/.test(html40), 'a company on MODUS_SEDG_ALIGNED does not show 18 of 40');
    assert.ok(!/of 32/.test(html40), 'the reference image\'s hardcoded 32 reached the page');

    const st = makeState();
    st.assessments[COMPANY_A] = { id: 'as-s', framework_id: FW_SEDG, framework_code: 'SEDG', framework_version: '2.0', reporting_year: 2025, status: 'draft' };
    const sedgApp = serve(USER_A, st);
    const html38 = contentOf(await (await sedgApp.get('/journey')).text());
    assert.ok(/18 of 38/.test(html38), 'a company on SEDG@2.0 does not show 18 of 38');
    await sedgApp.close();
  });

  await atest('a not-applicable indicator leaves the denominator', async () => {
    const st = makeState();
    st.responses[COMPANY_A] = { answered: 38, na: 2, last: { id: 'r-a', earned_at: '2026-08-12T00:00:00.000Z' } };
    const a = serve(USER_A, st);
    const body = await (await a.get('/api/journey')).json();
    const stage = body.stages.find((s) => s.stage_code === 'ASSESSMENT_ANSWERED');
    assert.strictEqual(stage.total, 38, 'the two N/A indicators stayed in the denominator');
    assert.strictEqual(stage.state, 'completed',
      'answering every applicable indicator did not complete the stage — an N/A answer is being '
      + 'counted against the company');
    await a.close();
  });

  await atest('CROSS-TENANT: company B sees its own journey, not company A\'s', async () => {
    // Secondary to the SQL-text assertion above, and labelled as such: this
    // proves the ROUTE passes the right company id, which the SQL test cannot
    // see. It does not prove the SQL filters, because the stub filters in
    // JavaScript.
    const shared = makeState();
    const b = serve(USER_B, shared);
    const body = await (await b.get('/api/journey')).json();
    const profile = body.stages.find((s) => s.stage_code === 'COMPANY_PROFILE');
    assert.strictEqual(profile.state, 'in_progress',
      'company B was given company A\'s completed profile');
    assert.strictEqual(profile.done, 1, `company B's profile shows ${profile.done} of 5 fields`);
    const docs = body.stages.find((s) => s.stage_code === 'DOCUMENTS_UPLOADED');
    assert.strictEqual(docs.state, 'pending', 'company B was credited with company A\'s document');

    const xp = await (await b.get('/api/xp')).json();
    assert.strictEqual(xp.total, 0, `company B holds ${xp.total} XP earned by company A`);
    for (const call of b.stub.calls) {
      if (/esg_journey_stages|esg_missions|esg_xp_levels|esg_indicators/.test(call.sql)) continue;
      assert.ok(call.params && call.params.includes(COMPANY_B),
        `a company-data query was issued without company B's id: ${call.sql.slice(0, 90)}`);
      assert.ok(!JSON.stringify(call.params).includes(COMPANY_A),
        `company A's id reached a query made for company B: ${call.sql.slice(0, 90)}`);
    }
    await b.close();
  });

  await atest('THE API SENDS CODES, NEVER AN ENGLISH LABEL (§4.3b)', async () => {
    const bodies = [];
    for (const url of ['/api/journey', '/api/missions', '/api/xp']) {
      bodies.push(JSON.stringify(await (await app.get(url, { Accept: 'application/json' })).json()));
    }
    const joined = bodies.join('\n');
    for (const label of ['Set up your company profile', 'Upload the documents you already hold',
      'Answer the assessment', 'Certification', 'Seedling', 'Sprout',
      'No SustNET ESG certification scheme is published']) {
      assert.ok(!joined.includes(label),
        `the API sends the display string "${label}" — a server-supplied display string cannot be `
        + 'translated and is English forever; send the code and let the client look it up');
    }
    const j = JSON.parse(bodies[0]);
    const cert = j.stages.find((s) => s.stage_code === 'CERTIFICATION');
    assert.strictEqual(cert.blocked, true);
    assert.strictEqual(cert.blocked_reason_code, 'CERTIFICATION',
      'a blocked stage carries no reason code, so a client cannot render the reason at all');
  });

  await atest('the API reports the same states the page renders', async () => {
    const body = await (await app.get('/api/journey', { Accept: 'application/json' })).json();
    const by = Object.fromEntries(body.stages.map((s) => [s.stage_code, s.state]));
    assert.deepStrictEqual(by, {
      COMPANY_PROFILE: 'completed',
      DOCUMENTS_UPLOADED: 'completed',
      ASSESSMENT_ANSWERED: 'in_progress',
      CERTIFICATION: 'blocked',
    });
    assert.strictEqual(body.active_stage_code, 'ASSESSMENT_ANSWERED');
    const xp = await (await app.get('/api/xp', { Accept: 'application/json' })).json();
    assert.strictEqual(xp.total, 70, 'the API total does not agree with the two completed missions');
    assert.deepStrictEqual(xp.awards.map((a) => a.source_table), ['esg_companies', 'esg_documents']);
  });

  await atest('an unseeded deployment says UNINSTRUMENTED rather than answering empty', async () => {
    const st = makeState({ stages: [], missions: [], levels: [] });
    const bare = serve(USER_A, st);
    const html = contentOf(await (await bare.get('/journey')).text());
    assert.ok(/has not been set up/.test(html), 'a deployment with no stages renders as a company with no progress');
    const body = await (await bare.get('/api/journey', { Accept: 'application/json' })).json();
    assert.strictEqual(body.state, 'uninstrumented',
      'the API answers an unseeded deployment with an empty list a client cannot tell from stage zero');
    await bare.close();
  });

  await atest('every dynamic value on the page goes through esc()', async () => {
    // Behavioural rather than a regex over the source: a hostile label is
    // driven through the real renderer, and the assertion is on what came out.
    const st = makeState();
    const payload = '<script>alert(1)</script>';
    st.stages = SEEDED_STAGES.map((s) => (s.code === 'COMPANY_PROFILE'
      ? { ...s, label_en: payload, description_en: payload } : s));
    st.stages = st.stages.map((s) => (s.code === 'CERTIFICATION'
      ? { ...s, blocked_reason: payload } : s));
    st.missions = SEEDED_MISSIONS.map((m) => ({ ...m, label_en: payload, description_en: payload }));
    const hostile = serve(USER_A, st);
    const html = contentOf(await (await hostile.get('/journey')).text());
    assert.ok(!html.includes(payload), 'a label containing markup reached the page unescaped');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the payload did not render at all — the test is asserting nothing');
    await hostile.close();
  });

  await atest('EVERY CLASS THE PAGE RENDERS IS DEFINED IN THE STYLESHEET IT LOADS', async () => {
    // RULE 6b applied to class names. A class that merely LOOKS like a design
    // system class fails silently: CSS never warns, nothing throws, and the
    // element just renders unstyled. This repo already carries `.muted`,
    // `.sc-value` and `badge-warning`, none of which exist — see the report.
    const html = await (await app.get('/journey')).text();
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const available = `${CSS}\n${inline}`;
    assert.ok(available.length > 50000, 'the stylesheet did not load — this check would pass vacuously');

    const tokens = new Set();
    for (const m of contentOf(html).matchAll(/class="([^"]*)"/g)) {
      for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
    }
    assert.ok(tokens.size >= 12, `only found ${tokens.size} classes on the page — the reader broke`);
    const missing = [...tokens].filter((t) => !new RegExp(`\\.${t.replace(/[-]/g, '\\-')}(?![-\\w])`).test(available));
    assert.deepStrictEqual(missing, [],
      `the page renders class(es) nothing defines: ${missing.join(', ')}`);
  });

  await atest('the page does not build a leaderboard, a reward or a peer comparison', async () => {
    const html = contentOf(await (await app.get('/journey')).text());
    // The three the annotation rules out. Naming them as absent is allowed and
    // is what the page does; rendering a figure for one is not.
    assert.ok(!/better than \d+%|top \d+%|percentile/i.test(html),
      'a peer comparison reached the page — there is no cohort in the database');
    assert.ok(!/href="[^"]*leaderboard/i.test(html), 'a leaderboard link was rendered');
    assert.ok(/no leaderboard/i.test(html), 'the page does not say why there is no leaderboard');
  });

  await app.close();

  /* ═════════════════════════════════════════════════════════════════════════
     5 · THE LIVE HALF — needs a real database
     ═════════════════════════════════════════════════════════════════════════ */
  if (!process.env.DATABASE_URL) {
    console.error('\n  SKIPPED: DATABASE_URL unset — the award-resolves-to-a-real-row invariant and');
    console.error('  the DELETING-A-SOURCE-ROW-LOWERS-XP invariant, which is the load-bearing test');
    console.error('  in this suite, did NOT run. This is not a pass.\n');
    console.log(`journey-test: ${passed} passed, ${failures.length} failed, DB checks SKIPPED`);
    process.exit(failures.length ? 1 : 0);
  }

  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await atest('the three tables exist and are seeded', async () => {
    const { rows } = await c.query(
      `SELECT (SELECT count(*)::int FROM esg_journey_stages) AS stages,
              (SELECT count(*)::int FROM esg_missions)       AS missions,
              (SELECT count(*)::int FROM esg_xp_levels)      AS levels`);
    assert.ok(rows[0].stages >= 9, `only ${rows[0].stages} stages seeded`);
    assert.ok(rows[0].missions >= 9, `only ${rows[0].missions} missions seeded`);
    assert.ok(rows[0].levels >= 3, `only ${rows[0].levels} levels seeded`);
  });

  await atest('no mission hangs off a blocked stage', async () => {
    const { rows } = await c.query(
      `SELECT m.code FROM esg_missions m
         JOIN esg_journey_stages s ON s.code = m.stage_code
        WHERE s.blocked_reason IS NOT NULL`);
    assert.deepStrictEqual(rows, [],
      `XP nobody can earn sits next to XP they can: ${rows.map((r) => r.code).join(', ')}`);
  });

  await atest('label_bm and label_zh are NULL on every stage, as ruled', async () => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM esg_journey_stages
        WHERE label_bm IS NOT NULL OR label_zh IS NOT NULL`);
    assert.strictEqual(rows[0].n, 0,
      'a Bahasa Malaysia or Chinese label was invented — no source publishes these strings, and '
      + 'seed.sql:150-154 already records the ruling for this repo');
  });

  await atest('the seeded predicate codes are all implemented, in the live database', async () => {
    const { rows } = await c.query(
      `SELECT DISTINCT predicate_code FROM esg_journey_stages
       UNION SELECT DISTINCT predicate_code FROM esg_missions`);
    for (const r of rows) {
      assert.ok(engine.PREDICATE_CODES.includes(r.predicate_code),
        `the database holds predicate ${r.predicate_code}, which the engine does not implement`);
    }
  });

  // ── one company, real rows, real derivation ────────────────────────────
  const SOURCE_QUERIES = {
    esg_companies: 'SELECT updated_at AS ts FROM esg_companies WHERE id = $1',
    esg_documents: 'SELECT created_at AS ts FROM esg_documents WHERE id = $1',
    esg_document_extractions: 'SELECT reviewed_at AS ts FROM esg_document_extractions WHERE id = $1',
    esg_responses: 'SELECT updated_at AS ts FROM esg_responses WHERE id = $1',
    esg_scores: 'SELECT computed_at AS ts FROM esg_scores WHERE id = $1',
    esg_carbon_entries: 'SELECT created_at AS ts FROM esg_carbon_entries WHERE id = $1',
    esg_recommendations: 'SELECT created_at AS ts FROM esg_recommendations WHERE id = $1',
    esg_green_projects: 'SELECT created_at AS ts FROM esg_green_projects WHERE id = $1',
    esg_green_project_baselines: 'SELECT computed_at AS ts FROM esg_green_project_baselines WHERE id = $1',
  };

  let companyId = null;
  let extractionId = null;
  let xpWithExtraction = null;

  try {
    companyId = (await c.query(
      `INSERT INTO esg_companies (name, ssm_number, msic_code, employee_count, grid_region)
       VALUES ($1, $2, '25113', 12, 'peninsular') RETURNING id`,
      [`Run52 journey ${Date.now()}`, `R52${Date.now()}`])).rows[0].id;

    const fw = (await c.query(
      `SELECT id, code, version FROM esg_frameworks WHERE code = 'MODUS_SEDG_ALIGNED'`)).rows[0];
    const scheme = (await c.query(
      `SELECT id, version FROM esg_weighting_schemes WHERE is_active LIMIT 1`)).rows[0];
    const assessmentId = (await c.query(
      `INSERT INTO esg_assessments (company_id, framework_id, framework_code, framework_version,
          weighting_scheme_id, weighting_version, reporting_year)
       VALUES ($1,$2,$3,$4,$5,$6,2025) RETURNING id`,
      [companyId, fw.id, fw.code, fw.version, scheme.id, scheme.version])).rows[0].id;

    const documentId = (await c.query(
      `INSERT INTO esg_documents (company_id, assessment_id, doc_type, filename, text_status)
       VALUES ($1,$2,'policy','run52.pdf','extracted') RETURNING id`,
      [companyId, assessmentId])).rows[0].id;

    const indicatorId = (await c.query(
      `SELECT id FROM esg_indicators WHERE framework_id = $1 ORDER BY sort_order LIMIT 1`,
      [fw.id])).rows[0].id;

    extractionId = (await c.query(
      `INSERT INTO esg_document_extractions (document_id, assessment_id, indicator_id,
          proposed_option_code, evidence_quote, quote_verified, status, reviewed_at)
       VALUES ($1,$2,$3,'yes','a verbatim quote',true,'accepted', now()) RETURNING id`,
      [documentId, assessmentId, indicatorId])).rows[0].id;

    await atest('EVERY XP AWARD RESOLVES TO EXACTLY ONE REAL ROW, DATED BY THAT ROW', async () => {
      const facts = await engine.gatherFacts(companyId);
      const { missions, levels } = await engine.loadDefinitions();
      const xp = engine.computeXp(facts, missions, levels);
      xpWithExtraction = xp;
      assert.ok(xp.awards.length >= 3,
        `only ${xp.awards.length} awards for a company with a profile, a document and an accepted `
        + 'proposal — the fixture did not take');
      for (const a of xp.awards) {
        const q = SOURCE_QUERIES[a.source_table];
        assert.ok(q, `award ${a.mission_code} names source_table ${a.source_table}, which nothing can resolve`);
        const { rows } = await c.query(q, [a.source_id]);
        assert.strictEqual(rows.length, 1,
          `award ${a.mission_code} points at ${a.source_table}/${a.source_id}, which selects ${rows.length} rows`);
        assert.strictEqual(new Date(rows[0].ts).toISOString(), new Date(a.earned_at).toISOString(),
          `award ${a.mission_code} is dated ${a.earned_at} but its source row says ${rows[0].ts} — `
          + 'the award carries a date of its own, so "+130 this week" would be wrong');
      }
    });

    await atest('DELETING A SOURCE ROW LOWERS XP — the proof that nothing is stored', async () => {
      const before = xpWithExtraction;
      const award = before.awards.find((a) => a.source_table === 'esg_document_extractions');
      assert.ok(award, 'the accepted proposal earned no award — the fixture cannot prove anything');

      await c.query('DELETE FROM esg_document_extractions WHERE id = $1', [extractionId]);
      extractionId = null;

      const facts = await engine.gatherFacts(companyId);
      const { missions, levels } = await engine.loadDefinitions();
      const after = engine.computeXp(facts, missions, levels);

      assert.ok(!after.awards.some((a) => a.mission_code === award.mission_code),
        `${award.mission_code} survived the deletion of the only row that earned it — XP is being `
        + 'read from somewhere other than the source rows');
      assert.strictEqual(after.total, before.total - award.xp,
        `the total moved from ${before.total} to ${after.total}; deleting a ${award.xp} XP source `
        + `row should have left ${before.total - award.xp}`);
    });

    await atest('recomputing without changing anything returns an identical answer', async () => {
      const { missions, levels } = await engine.loadDefinitions();
      const a = engine.computeXp(await engine.gatherFacts(companyId), missions, levels);
      const b = engine.computeXp(await engine.gatherFacts(companyId), missions, levels);
      assert.deepStrictEqual(a, b, 'two consecutive derivations of the same facts disagree');
    });

    await atest('the live denominator is 40 on the Modus framework and 38 on SEDG', async () => {
      const facts = await engine.gatherFacts(companyId);
      assert.strictEqual(facts.predicates.assessment_answered.total, 40,
        'MODUS_SEDG_ALIGNED did not resolve to 40 applicable indicators');

      const sedg = (await c.query(
        `SELECT id, code, version FROM esg_frameworks WHERE code = 'SEDG' AND version = '2.0'`)).rows[0];
      const scheme2 = (await c.query(
        `SELECT id, version FROM esg_weighting_schemes WHERE is_active LIMIT 1`)).rows[0];
      await c.query(
        `INSERT INTO esg_assessments (company_id, framework_id, framework_code, framework_version,
            weighting_scheme_id, weighting_version, reporting_year)
         VALUES ($1,$2,$3,$4,$5,$6,2026)`,
        [companyId, sedg.id, sedg.code, sedg.version, scheme2.id, scheme2.version]);
      const facts2 = await engine.gatherFacts(companyId);
      assert.strictEqual(facts2.predicates.assessment_answered.total, 38,
        'SEDG@2.0 did not resolve to 38 applicable indicators — the denominator is hardcoded somewhere');
    });

    await atest('A TENTH STAGE RENDERS WITHOUT A CODE CHANGE, in the live database', async () => {
      await c.query(
        `INSERT INTO esg_journey_stages (code, sort_order, label_en, group_code, predicate_code)
         VALUES ('RUN52_PROBE', 999, 'A stage added by the test', 'assess', 'never')`);
      try {
        const { stages } = await engine.loadDefinitions();
        assert.ok(stages.some((s) => s.code === 'RUN52_PROBE'), 'the added stage was not loaded');
        const j = engine.computeJourney(await engine.gatherFacts(companyId), stages);
        assert.strictEqual(j.total_stages, stages.length,
          'the journey rendered a different number of stages than the table holds');
      } finally {
        await c.query(`DELETE FROM esg_journey_stages WHERE code = 'RUN52_PROBE'`);
      }
    });
  } finally {
    if (companyId) await c.query('DELETE FROM esg_companies WHERE id = $1', [companyId]);
  }

  await c.end();
  console.log(`\njourney-test: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('journey-test FAILED:', e.stack || e.message); process.exit(1); });

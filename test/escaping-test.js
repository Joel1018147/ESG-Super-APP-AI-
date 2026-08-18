'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE HOSTILE PAYLOAD, ON EVERY PAGE                            (Run 64/P10)
   ───────────────────────────────────────────────────────────────────────────
   dashboard-test.js has run this against /dashboard since P8, and it is the
   strongest guard in the repo: it puts markup in every string column and
   asserts the page renders it inert. The P10 audit found it was guarding ONE
   page out of twenty-one, while the other twenty render hundreds of dynamic
   values each.

   Running it product-wide found NO leak — the product was already clean, and
   what was missing was the guard, not the escaping. This file is that guard.

   ── WHY A PAGE THAT DOES NOT RENDER IS A FAILURE HERE ────────────────────
   Three outcomes are possible per page and only one is a pass:
     the payload appears ESCAPED   the page is proved safe
     the payload appears RAW       a leak
     the payload never appears     NOTHING WAS PROVED — the page either threw,
                                   or never rendered the column that was
                                   poisoned, and counting it green is the
                                   vacuous pass this repo's suites exist to
                                   avoid.
   All three are reported separately and the third fails the run.

   ── WHY SOME COLUMNS ARE NOT POISONED ────────────────────────────────────
   STRUCTURAL below holds the columns that drive CONTROL FLOW rather than
   content — ids, enum codes, statuses. Rewriting those does not test escaping;
   it sends the route down a different branch, or throws, and the page then
   proves nothing. Everything a human reads IS poisoned.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path = require('path');

const PAYLOAD = '<script>alert(1)</script>';
const ESCAPED = '&lt;script&gt;alert(1)&lt;/script&gt;';
const ATTR_PAYLOAD = '" onerror="alert(2)';

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

const STRUCTURAL = new Set([
  'id', 'company_id', 'assessment_id', 'indicator_id', 'document_id', 'project_id',
  'framework_id', 'weighting_scheme_id', 'scheme_id', 'user_id', 'source_opportunity_id',
  'status', 'text_status', 'state', 'scope', 'pillar', 'kind', 'verdict', 'source',
  'predicate_code', 'stage_code', 'group_code', 'mission_code', 'code', 'band_code',
  'response_type', 'evidence_tier', 'mapping_status', 'derived_from', 'derived_from_kind',
  'metric', 'unit', 'grid_region', 'framework_code', 'framework_version', 'classification_basis',
  'financing_type', 'borrower_scope', 'availability_status', 'source_publisher',
  'institution_kind', 'proposed_option_code', 'option_code', 'job_type', 'feature',
  'ccpt_category_code', 'asean_ff_code', 'asean_ps_code', 'expected_benefit_metric',
  'expected_benefit_basis', 'financing_purpose', 'esg_maturity', 'role', 'email',
]);

/* Every page renders against a stub, so this suite needs no database. The rows
 * are shaped generously — a column that is absent simply is not poisoned, and
 * a page that then renders nothing is REPORTED rather than skipped. */
const ROW = (extra = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Name', title: 'Title', label_en: 'Label', description_en: 'Description',
  question_en: 'Question?', guidance_en: 'Guidance', narrative_en: 'Narrative',
  filename: 'file.pdf', product_name: 'Product', institution_name: 'Institution',
  band_label: 'Band', blocked_reason: 'Reason', rationale_en: 'Rationale',
  status_note: 'Note', evidence_quote: 'Quote', verification_note: 'Note',
  amount_note: 'Amount', tenure_note: 'Tenure', rate_note: 'Rate',
  documentation_note: 'Docs', eligibility_note: 'Eligibility', type_label: 'Type',
  project_type_label: 'Type', industry_label: 'Industry', state: 'Selangor',
  answered_by_name: 'Person', verified_by_name: 'Person', source_url: 'https://example.test',
  ...extra,
});

/* THE JOURNEY DEFINITION TABLES GET REAL CODES.
   journeyEngine throws on an unrecognised predicate — deliberately, so a
   seed/code mismatch cannot hide behind a "pending" state — which means a
   generic fixture row cannot stand in for a stage. These are the seeded
   shapes, poisoned in their PROSE columns and left alone in their code ones,
   which is exactly the distinction STRUCTURAL draws. */
const JOURNEY = {
  stages: [
    { code: 'COMPANY_PROFILE', sort_order: 10, label_en: 'Profile', label_bm: null, label_zh: null,
      description_en: 'Five fields.', group_code: 'assess',
      predicate_code: 'company_profile_complete', blocked_reason: null },
    { code: 'CERTIFICATION', sort_order: 20, label_en: 'Certification', label_bm: null, label_zh: null,
      description_en: null, group_code: 'certify', predicate_code: 'never',
      blocked_reason: 'No scheme is published.' },
  ],
  missions: [{ code: 'M_PROFILE', stage_code: 'COMPANY_PROFILE', label_en: 'Complete it',
    description_en: null, predicate_code: 'company_profile_complete', xp_award: 40, sort_order: 10 }],
  levels: [{ level: 1, min_xp: 0, label_en: 'Seedling' }],
};

function stubDb(rowsFor) {
  return {
    query: async (text) => {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      if (/FROM esg_journey_stages/.test(sql)) return { rows: poison(JOURNEY.stages), rowCount: 2 };
      if (/FROM esg_missions/.test(sql)) return { rows: poison(JOURNEY.missions), rowCount: 1 };
      if (/FROM esg_xp_levels/.test(sql)) return { rows: poison(JOURNEY.levels), rowCount: 1 };
      const rows = rowsFor(sql);
      return { rows, rowCount: rows.length };
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

async function withStub(exportsObj, fn) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const extra = Object.keys(exportsObj).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `#18: the stub invents exports the real src/db lacks: ${extra}`);
  const cached = require.cache[dbPath];
  const clear = () => {
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: exportsObj };
  clear();
  try { return await fn(); } finally { require.cache[dbPath] = cached; clear(); }
}

/** Poison every non-structural string on the way OUT of the database. */
const poison = (rows) => rows.map((r) => {
  const out = { ...r };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && !STRUCTURAL.has(k)) out[k] = PAYLOAD;
  }
  return out;
});

const AGG = {
  n: 0, bytes: 0, entries: 0, provisional: 0, projects: 0, products: 0,
  proposals_live: 0, proposals_pending: 0, period_from: null, period_to: null,
  live: 0, reviewed: 0, pending: 0, accepted: 0, answered: 0, na: 0, filled: 0,
  documents_total: 0, documents_read: 0, documents_unreadable: 0, documents_unattached: 0,
  unanswered: 0, self_declared: 0, projects_total: 0, projects_implemented: 0,
  projects_forecast: 0, projects_unclassified: 0, projects_no_financing: 0,
  opportunities_pending: 0, unverified_actuals: 0, profile_filled: 0,
  answers_total: 0, answers_na: 0, answers_documented: 0, answers_verified: 0,
  answers_declared: 0, carbon_entries: 0, carbon_provisional: 0,
  report_docs_total: 0, report_docs_read: 0, report_projects_total: 0,
  report_projects_forecast: 0, report_baselines: 0, report_actuals: 0, report_verified: 0,
  trigger_gaps: 0, trigger_pillars: 0, trigger_draft: 0,
  trigger_unevidenced: 0, trigger_unreadable: 0, trigger_unclassified: 0,
  total: 0, documented: 0,
};

const isAggregate = (sql) => /\b(count|sum|min|max|avg)\s*\(/i.test(sql) && !/\bGROUP BY\b/i.test(sql);

function renderHandler(handler, req) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (html, failed) => { if (!done) { done = true; resolve({ html, failed }); } };
    const res = {
      send: (b) => fin(b, null), json: (b) => fin(JSON.stringify(b), null),
      redirect: (u) => fin(null, `redirect ${u}`), status: () => res, type: () => res,
      set: () => res, setHeader: () => res, end: () => fin(null, 'ended'),
    };
    Promise.resolve(handler(req, res, (e) => fin(null, e ? e.message : 'called next()')))
      .catch((e) => fin(null, e.message));
    setTimeout(() => fin(null, 'never answered'), 15000);
  });
}

const PAGES = [
  ['pages', '/dashboard'], ['journey', '/journey'],
  ['pages', '/assessment'], ['pages', '/assessment/:id'],
  ['documents', '/documents'], ['documents', '/documents/:id'],
  ['pages', '/carbon'], ['pages', '/company'], ['pages', '/governance'],
  ['pages', '/frameworks'], ['pages', '/reports'],
  ['greenFinance', '/green-finance'], ['greenFinance', '/green-finance/projects'],
  ['greenFinance', '/green-finance/projects/:id'], ['greenFinance', '/green-finance/readiness'],
  ['greenFinance', '/green-finance/opportunities'], ['greenFinance', '/green-finance/register'],
  ['greenFinance', '/green-finance/register/:id'], ['greenFinance', '/impact'],
  ['improvement', '/improvement'], ['improvement', '/consultation'],
];

console.log('escaping-test');

(async () => {
  const proved = [];
  const leaked = [];
  const provedNothing = [];

  await atest('EVERY PAGE RENDERS A HOSTILE STRING INERT', async () => {
    for (const [routerName, routePath] of PAGES) {
      const db = stubDb((sql) => (isAggregate(sql) ? poison([{ ...AGG, ...ROW() }]) : poison([ROW(), ROW()])));
      // eslint-disable-next-line no-await-in-loop
      const out = await withStub(db, async () => {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const router = require(`../src/routes/${routerName}`);
        const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.get);
        if (!layer) return { html: null, failed: 'no GET handler' };
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        return renderHandler(handler, {
          user: { id: 'u1', name: 'U', email: 'u@e.test', role: 'company_admin',
            company_id: 'c1', shell: { companyName: PAYLOAD, reportingYear: 2025,
              review: { total: 0, extractions: 0, suggestions: 0 }, provisionalCarbon: 0 } },
          params: { id: '11111111-1111-1111-1111-111111111111',
            documentId: '11111111-1111-1111-1111-111111111111' },
          query: {}, body: {}, headers: {}, isAuthenticated: () => true,
        });
      });

      if (!out.html) { provedNothing.push(`${routePath} — ${out.failed}`); continue; }
      const html = String(out.html);
      if (html.includes(PAYLOAD)) {
        const i = html.indexOf(PAYLOAD);
        leaked.push(`${routePath}: …${html.slice(Math.max(0, i - 80), i + 40).replace(/\s+/g, ' ')}…`);
      } else if (html.includes(ESCAPED)) {
        proved.push(routePath);
      } else {
        provedNothing.push(`${routePath} — rendered, but the payload never appeared`);
      }
    }

    assert.deepStrictEqual(leaked, [],
      `a database string containing markup reached a page UNESCAPED:\n${leaked.join('\n')}`);
    assert.deepStrictEqual(provedNothing, [],
      `these pages proved nothing — they did not render, or never showed the payload, so their `
      + `escaping is UNVERIFIED rather than good:\n${provedNothing.join('\n')}`);
    assert.ok(proved.length >= 20,
      `only ${proved.length} pages were proved; the walk is not covering the product`);
  });

  await atest('esc() neutralises an ATTRIBUTE break-out, not just a tag', () => {
    // A value interpolated into an attribute needs the quote escaped, which is
    // a different escape from < and >. Asserted on the helper directly, because
    // no fixture reliably lands a payload in every attribute position.
    const { esc } = require('../src/utils/layout');
    /* THE QUOTE IS THE BOUNDARY, AND THE QUOTE IS THE TEST.
       The first version of this assertion also demanded that the literal text
       `onerror=` not survive — and failed esc() for leaving it. That text is
       harmless: with the quotes escaped, the value cannot break out of the
       attribute it sits in, so `onerror=` renders as characters a reader sees
       rather than a handler the browser binds. Asserting on the word would
       demand escaping that protects nothing, and would fail any page that
       legitimately names an attribute in prose. */
    const out = esc(ATTR_PAYLOAD);
    assert.ok(!out.includes('"'), `esc() left a bare double quote in: ${out}`);
    assert.ok(!out.includes("'"), `esc() left a bare single quote in: ${out}`);
    const attr = `<img src="x" alt="${out}">`;
    assert.strictEqual((attr.match(/"/g) || []).length, 4,
      `the value broke out of its attribute: ${attr}`);
    for (const [raw, safe] of [['<', '&lt;'], ['>', '&gt;'], ['&', '&amp;'], ["'", '&#39;']]) {
      assert.ok(esc(raw) === safe, `esc(${raw}) produced ${esc(raw)}, expected ${safe}`);
    }
  });

  await atest('esc() is applied to the value, not to an already-escaped string twice', () => {
    const { esc } = require('../src/utils/layout');
    // & must escape once. Double-escaping renders &amp;lt; to a reader, which
    // is a correctness bug rather than a security one — and it is how a page
    // ends up showing markup entities as literal text.
    assert.strictEqual(esc('a & b'), 'a &amp; b');
    assert.strictEqual(esc(esc('a & b')), 'a &amp;amp; b',
      'esc() is not idempotent — that is expected, and it is why nothing may esc() twice');
  });

  console.log(`\n  proved escaped: ${proved.length} page(s)`);
  console.log(`escaping: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

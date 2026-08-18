'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE ASSESSMENT AS A VERIFICATION WORKFLOW                        (Run 62/P6)
   ───────────────────────────────────────────────────────────────────────────
   AI PROPOSES · A PERSON VERIFIES. This suite exists to stop the second half
   from quietly disappearing.

   The dangerous failure is not a broken page — it is a page that renders an
   AI proposal so confidently that a reader takes it for an answer their company
   has given. Every assertion below is about keeping those two things apart:

     · a pending proposal is never counted as an answer
     · its state says "needs your review" in WORDS, not by colour
     · the quote and its source document are shown with it
     · a proposal whose quote was never located cannot be accepted
     · there is NO confidence percentage, because the schema has no numeric
       column and inventing one is exactly the defect the schema prevents

   It renders the real route against a stubbed database, in the pattern
   test/dashboard-test.js established.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path   = require('path');

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

/* ── the stub, in dashboard-test.js's shape ──────────────────────────────── */
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

const REQ = {
  user: { id: 'u1', name: 'Joel', email: 'j@example.com', role: 'super_admin', company_id: 'c1' },
  query: {}, params: { id: 'a1' }, body: {}, path: '/', originalUrl: '/',
  headers: {}, isAuthenticated: () => true,
};

function renderHandler(handler, req) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (html, failed) => { if (!done) { done = true; resolve({ html, failed }); } };
    const res = {
      send(b) { finish(b, null); }, json(b) { finish(JSON.stringify(b), null); },
      redirect(u) { finish(null, `redirected to ${u}`); },
      status() { return res; }, type() { return res; }, set() { return res; },
      setHeader() { return res; }, end() { finish(null, 'ended with no body'); },
    };
    Promise.resolve(handler(req, res, (e) => finish(null, e ? e.message : 'called next()')))
      .catch((e) => finish(null, e.message));
    setTimeout(() => finish(null, 'never answered'), 3000);
  });
}

async function renderAssessment(db) {
  let out = null;
  await withStub(db, async () => {
    const router = require('../src/routes/pages');
    const layer = router.stack.find((l) => l.route && l.route.path === '/assessment/:id' && l.route.methods.get);
    assert.ok(layer, 'no GET handler for /assessment/:id');
    out = await renderHandler(layer.route.stack[layer.route.stack.length - 1].handle, REQ);
  });
  assert.ok(out && typeof out.html === 'string' && out.html.length > 400,
    `/assessment/:id rendered nothing: ${out && out.failed}`);
  return out.html;
}

/* ── fixtures ────────────────────────────────────────────────────────────── */
const ASSESSMENT = [{
  id: 'a1', framework_id: 'f1', framework_code: 'MODUS_SEDG_ALIGNED',
  framework_version: '0.9-draft', reporting_year: 2025, status: 'draft',
}];
const INDICATORS = [
  { id: 'i1', code: 'E-01', pillar: 'E', tier: null, question_en: 'Does the company track its monthly electricity consumption?',
    guidance_en: 'Meter readings or TNB bills.', response_type: 'yes_no', unit: null, weight: 1, allows_na: false, mapping_status: 'draft', line_items: null },
  { id: 'i2', code: 'E-02', pillar: 'E', tier: null, question_en: 'Does the company have an energy management policy?',
    guidance_en: null, response_type: 'yes_no', unit: null, weight: 1, allows_na: true, mapping_status: 'draft', line_items: null },
  { id: 'i3', code: 'S-01', pillar: 'S', tier: null, question_en: 'Total number of employees at year end',
    guidance_en: null, response_type: 'quantitative', unit: 'people', weight: 1, allows_na: false, mapping_status: 'official', line_items: null },
];

/** i1 answered from a document, i2 unanswered with a PENDING proposal, i3 N/A. */
function db({ quoteVerified = true, proposalStatus = 'pending' } = {}) {
  const RESPONSES = [
    { indicator_id: 'i1', option_code: 'yes', value_numeric: null, value_text: null, value_json: null,
      is_na: false, evidence_tier: 'documented', document_id: 'd1' },
    { indicator_id: 'i3', option_code: null, value_numeric: null, value_text: null, value_json: null,
      is_na: true, evidence_tier: 'self_declared', document_id: null },
  ];
  const PROPOSALS = [{
    id: 'x1', indicator_id: 'i2', proposed_option_code: 'yes',
    evidence_quote: 'The Company maintains an Energy Management Policy reviewed annually by the board.',
    page_no: 8, quote_verified: quoteVerified, status: proposalStatus, model: 'test-model',
    reviewed_at: proposalStatus === 'pending' ? null : '2026-08-18T00:00:00Z',
    document_id: 'd1', filename: 'Environmental Policy.pdf',
  }];
  return {
    query: async (sql) => {
      if (/FROM esg_assessments/.test(sql)) return { rows: ASSESSMENT, rowCount: 1 };
      if (/FROM esg_indicators/.test(sql)) return { rows: INDICATORS, rowCount: INDICATORS.length };
      if (/FROM esg_responses/.test(sql)) return { rows: RESPONSES, rowCount: RESPONSES.length };
      if (/FROM esg_document_extractions/.test(sql)) return { rows: PROPOSALS, rowCount: PROPOSALS.length };
      throw new Error(`no fixture for: ${String(sql).slice(0, 70)}`);
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  console.log('\nassessment-verification\n');

  await atest('a PENDING proposal is shown with its quote, its document and its page', async () => {
    const html = await renderAssessment(db());
    assert.ok(/class="esg-proposal"/.test(html), 'the proposal is not rendered inside the assessment');
    assert.ok(html.includes('The Company maintains an Energy Management Policy'),
      'the evidence quote is not shown — the reader cannot see what it read');
    assert.ok(/Environmental Policy\.pdf/.test(html), 'the source document is not named');
    assert.ok(/page 8/.test(html), 'the page number is not shown');
  });

  await atest('a pending proposal is NEVER counted as an answer', async () => {
    const html = await renderAssessment(db());
    const t = text(html);
    // E-02 has a proposal and no response row. It must read as needing review,
    // and must NOT be counted among the evidenced answers.
    assert.ok(/Needs your review/.test(t), 'no question states that it needs review');
    // One indicator is documented (i1); the header counts evidenced answers and
    // must say 1, not 2 — the proposal is not an answer until someone accepts.
    assert.ok(/1 of 3 evidenced/.test(t),
      `the evidenced count includes an unaccepted proposal: ${/\d+ of \d+ evidenced/.exec(t)}`);
  });

  await atest('every answer state is stated in WORDS, not by colour alone', async () => {
    const t = text(await renderAssessment(db()));
    for (const word of ['Needs your review', 'Verified from a document', 'Not applicable']) {
      assert.ok(t.includes(word), `the page never renders the state "${word}"`);
    }
  });

  await atest('THERE IS NO CONFIDENCE PERCENTAGE, and the schema is why', async () => {
    const html = await renderAssessment(db());
    const t = text(html);
    // A percentage next to a proposal is the model marking its own homework,
    // and esg_document_extractions deliberately carries no numeric column.
    assert.ok(!/confidence[^.]{0,20}\d+\s*%/i.test(t),
      'a confidence percentage is rendered — the extraction table has no numeric column to derive it from');
    assert.ok(/\d+\s*%/.test(t) === false || !/esg-proposal[\s\S]{0,600}\d+\s*%/.test(html),
      'a percentage appears inside a proposal block');
    // And the page says WHY there is none, rather than leaving a gap.
    assert.ok(/no confidence percentage/i.test(t),
      'the page does not explain why there is no confidence figure');
  });

  await atest('a proposal whose quote was NOT located cannot be accepted', async () => {
    const html = await renderAssessment(db({ quoteVerified: false }));
    assert.ok(!/form="accept-x1"/.test(html),
      'an accept control is offered for a proposal whose quote was never found — acceptProposal '
      + 'would throw, so the button is a promise the backend refuses to keep');
    assert.ok(/cannot be accepted/i.test(text(html)), 'the page does not say why it cannot be accepted');
  });

  await atest('the review controls are OUTSIDE the assessment form', async () => {
    const html = await renderAssessment(db());
    // Nesting a form inside a form is invalid HTML: the parser drops the inner
    // one and the button then submits the whole assessment instead of
    // accepting one proposal. The controls reference their form by id.
    const main = /<form method="post" action="\/assessment\/a1">([\s\S]*?)<\/form>/.exec(html);
    assert.ok(main, 'the assessment form is not rendered');
    assert.ok(!/<form/.test(main[1]), 'a form is nested inside the assessment form');
    assert.ok(/id="accept-x1"/.test(html) && /id="reject-x1"/.test(html),
      'the out-of-form review actions are missing');
    assert.ok(/form="accept-x1"/.test(html), 'the accept button does not reference its form');
  });

  await atest('accepting returns to the assessment, not to the document', async () => {
    const html = await renderAssessment(db());
    const form = /<form id="accept-x1"[\s\S]*?<\/form>/.exec(html)[0];
    assert.ok(/name="next" value="\/assessment\/a1"/.test(form),
      'no return path — the reviewer is dropped on the document page and loses their place');
  });

  await atest('a REVIEWED proposal is recorded, not erased', async () => {
    const html = await renderAssessment(db({ proposalStatus: 'accepted' }));
    const t = text(html);
    assert.ok(/already reviewed/i.test(t), 'the history of what was proposed is gone');
    assert.ok(/Accepted/.test(t), 'an accepted proposal does not say it was accepted');
    // And it is no longer offered for review.
    assert.ok(!/form="accept-x1"/.test(html), 'an already-accepted proposal is still offered for acceptance');
  });

  await atest('the page never claims the platform answered anything', async () => {
    const t = text(await renderAssessment(db()));
    for (const claim of [/AI answered/i, /automatically verified/i, /answer(ed)? for you/i]) {
      assert.ok(!claim.test(t), `the page implies the platform answered: ${claim}`);
    }
    assert.ok(/Accepting is what does that|Accepting it is what writes your answer/i.test(t),
      'the page does not state that acceptance is what writes the answer');
  });

  await atest('every dynamic value goes through esc()', async () => {
    const hostile = db();
    const inner = hostile.query;
    hostile.query = async (sql) => {
      const out = await inner(sql);
      if (/FROM esg_document_extractions/.test(sql)) {
        return { rows: out.rows.map((r) => ({ ...r, filename: '<script>alert(1)</script>.pdf',
          evidence_quote: 'quote with <img src=x onerror=alert(1)>' })), rowCount: out.rowCount };
      }
      return out;
    };
    const html = await renderAssessment(hostile);
    assert.ok(!/<script>alert\(1\)<\/script>/.test(html), 'a filename rendered as live markup');
    assert.ok(!/<img src=x onerror/.test(html), 'an evidence quote rendered as live markup');
    assert.ok(/&lt;script&gt;/.test(html), 'the hostile filename was dropped rather than escaped');
  });

  console.log(`\nassessment-verification: ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();

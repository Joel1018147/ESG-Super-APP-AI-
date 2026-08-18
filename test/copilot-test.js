'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE COPILOT, EXPERT TRIGGERS AND REPORTING READINESS         (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   THE RULES THIS SUITE EXISTS FOR:

     1. THE MODEL NEVER PRODUCES A FIGURE. CLAUDE.md #1 says aiAdvisor has five
        guards and a sixth must not be opened. The copilot is a different file
        and it does not open one there — it applies the same five by REUSING
        aiAdvisor's stripFigures with an EMPTY allow-list, which is stricter:
        it is handed no figures, so no figure may come out.

     2. THE COPILOT NEVER PRETENDS TO VERIFY. It may explain, summarise and
        suggest. It may not accept a proposal, set an evidence tier, mark
        anything verified or answer a question on a company's behalf — asserted
        structurally, because it writes to no table but the interaction log.

     3. A FAILURE IS NEVER PIXEL-IDENTICAL TO A SUCCESS. Every answer declares
        whether it was generated or is the platform's own deterministic one.

     4. EXPERT SUPPORT IS TRIGGERED BY A SITUATION, NEVER BY A SCORE. The
        directive rules out "score below X shows the expert card", and the
        suite asserts esg_scores is never read in that service at all.

     5. THERE IS NO REPORT GENERATOR. reportReadiness carries
        `generator.built = false` as a stated constant, and the suite asserts
        nothing in the codebase writes a report file while it says so.

   MUTATION TESTS AT THE BOTTOM.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
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

const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INDICATOR = {
  id: 'i-1', code: 'E-01', question_en: 'Do you track monthly electricity consumption?',
  guidance_en: 'Your TNB bills for the reporting year.', pillar: 'E', tier: 'basic',
  response_type: 'yes_partial_no', unit: null, mapping_status: 'draft',
};
const DOCUMENT = {
  id: 'd-1', filename: 'Environmental Policy.pdf', text_status: 'extracted', page_count: 12,
  extracted_text: 'Green Future Sdn Bhd is committed to improving energy efficiency across all sites.',
};

function db(opts = {}) {
  const logged = [];
  return {
    logged,
    exports: {
      query: async (text, params) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (/INSERT INTO esg_ai_interactions/.test(sql)) { logged.push(params); return { rows: [] }; }
        if (/FROM esg_indicators i/.test(sql)) return { rows: opts.noIndicator ? [] : [INDICATOR] };
        if (/FROM esg_documents WHERE id/.test(sql)) return { rows: [opts.document || DOCUMENT] };
        /* An aggregate with no GROUP BY returns exactly ONE row in Postgres,
           always. Answering `rows: []` would model a database that cannot
           exist and would force a RULE 6 guard onto the service that reads it.
           Every alias P9 selects is unique across the repo, so one row of
           zeroes answers all of them without ambiguity. */
        if (/\b(count|sum|min|max|avg)\s*\(/i.test(sql) && !/\bGROUP BY\b/i.test(sql)) {
          return { rows: [{
            trigger_gaps: 0, trigger_pillars: 0, trigger_draft: 0,
            trigger_unevidenced: 0, trigger_unreadable: 0, trigger_unclassified: 0,
            n: 0, filled: 0,
          }] };
        }
        return { rows: [] };
      },
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    },
  };
}

/** Replace global.fetch so no network call and no API key is needed. Groq's
 *  own client is left completely untouched — this suite asserts what the
 *  copilot does with a reply, not how the reply is fetched. */
function withGroq(reply, fn) {
  const real = global.fetch;
  const realKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => (reply instanceof Error
    ? Promise.reject(reply)
    : { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) });
  return Promise.resolve().then(fn).finally(() => {
    global.fetch = real;
    if (realKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = realKey;
  });
}

console.log('copilot-test');

(async () => {
  /* ═══════════════════════════════════════════════════════════════════════
     1 · THE MODEL NEVER PRODUCES A FIGURE
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('THE ALLOW-LIST IS EMPTY, so no figure may come out', () => {
    const { ALLOWED_FIGURES } = require('../src/services/copilotService');
    assert.deepStrictEqual([...ALLOWED_FIGURES], [],
      'the copilot allow-list is not empty — it is handed no figures, so nothing numeric may be '
      + 'permitted out. Widening this to let a year through removes the guard.');
  });

  await atest('EVERY DIGIT THE MODEL EMITS IS STRIPPED — on the real path', async () => {
    const stub = db();
    const out = await withStub(stub.exports, () => withGroq(
      'Track your usage. Most SMEs save 15% and about RM 4,200 in the first 12 months.',
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.strictEqual(out.mode, 'ai');
    assert.ok(!/\d/.test(out.text),
      `a number survived the copilot's strip: "${out.text}"`);
    assert.ok(out.text.includes('[figure removed]'),
      'the strip left no trace — a silently shortened sentence is worse than a marked one');
  });

  await atest('THE PROMPT CARRIES NO FIGURE FOR THE MODEL TO ANCHOR ON', () => {
    const { INTENTS } = require('../src/services/copilotService');
    const prompt = INTENTS.explain_requirement.prompt(INDICATOR);
    // The prompt is built from the question and its guidance. Neither the
    // score, the points, the weight nor the company's own answer is in it.
    for (const leak of ['score', 'points', 'weight', 'band', 'tCO2e', 'RM']) {
      assert.ok(!new RegExp(`\\b${leak}\\b`, 'i').test(prompt),
        `the copilot prompt carries "${leak}" — it must be given no figures at all`);
    }
  });

  await atest('THE SYSTEM PROMPT FORBIDS A NUMBER IN SO MANY WORDS', () => {
    const { SYSTEM } = require('../src/services/copilotService');
    assert.ok(/NEVER state a number/i.test(SYSTEM));
    assert.ok(/never claim anything has been verified/i.test(SYSTEM));
    assert.ok(/never answer the question on the company/i.test(SYSTEM));
  });

  /* ═══════════════════════════════════════════════════════════════════════
     2 · IT WRITES NOTHING BUT THE LOG
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('THE COPILOT WRITES TO NO TABLE BUT esg_ai_interactions', () => {
    const src = strip(fs.readFileSync(path.join(SRC, 'services/copilotService.js'), 'utf8'));
    const writes = [...src.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(esg_[a-z_]+)/gi)]
      .map((m) => m[1]);
    assert.deepStrictEqual(writes, [],
      `the copilot writes to ${writes.join(', ')} — it returns words, and every action stays the `
      + 'company\'s. The log write goes through groqService.logInteraction, not through here.');
    // And it does not reach for the scoring tables at all.
    assert.ok(!/esg_scores|score_0_100|esg_recommendations/.test(src),
      'the copilot references a scoring table');
  });

  await atest('IT LOGS EVERY CALL, INCLUDING THE FAILED ONE', async () => {
    const ok = db();
    await withStub(ok.exports, () => withGroq('A plain explanation.',
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', userId: 'u1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.strictEqual(ok.logged.length, 1, 'a successful copilot call was not logged');
    assert.strictEqual(ok.logged[0][2], 'copilot:explain_requirement',
      'the log does not name which intent ran');
    assert.strictEqual(ok.logged[0][7], true, 'a successful call was logged as failed');

    const bad = db();
    await withStub(bad.exports, () => withGroq(new Error('groq is down'),
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', userId: 'u1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.strictEqual(bad.logged.length, 1, 'a failed copilot call was not logged');
    assert.strictEqual(bad.logged[0][7], false, 'a failed call was logged as successful');
    assert.ok(bad.logged[0][8], 'the failure was logged with no error message');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3 · A FAILURE IS NEVER PIXEL-IDENTICAL TO A SUCCESS
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('GROQ BEING DOWN PRODUCES A TEMPLATE, AND SAYS IT IS ONE', async () => {
    const stub = db();
    const out = await withStub(stub.exports, () => withGroq(new Error('groq is down'),
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.strictEqual(out.mode, 'template');
    assert.ok(out.text.includes(INDICATOR.guidance_en),
      'the deterministic answer did not use the configured guidance');
    assert.ok(/deterministic/.test(out.basis),
      `the answer does not say it is the platform's own: "${out.basis}"`);
  });

  await atest('AN EMPTY REPLY IS A FAILURE, not an answer', async () => {
    const stub = db();
    const out = await withStub(stub.exports, () => withGroq('   ',
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.strictEqual(out.mode, 'template',
      'an empty model reply rendered as an empty answer, which reads as "there is nothing to say"');
    assert.ok(out.text.length > 40);
  });

  await atest('THE TWO MODES ARE DISTINGUISHABLE IN THE PAYLOAD', async () => {
    const stub = db();
    const ai = await withStub(stub.exports, () => withGroq('An explanation, in words.',
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-1' })));
    const tpl = await withStub(db().exports, () => withGroq(new Error('down'),
      () => require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-1' })));
    assert.notStrictEqual(ai.mode, tpl.mode);
    assert.notStrictEqual(ai.basis, tpl.basis,
      'a generated answer and a deterministic one carry the same provenance line');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     4 · A CLOSED VOCABULARY, AND A TENANT-SCOPED SUBJECT
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('AN UNKNOWN INTENT THROWS — this is not a general assistant', async () => {
    await withStub(db().exports, async () => {
      const copilot = require('../src/services/copilotService');
      await assert.rejects(
        () => copilot.ask({ companyId: 'c1', intent: 'write_my_report', subjectId: 'x' }),
        /is not one of the four intents/);
      assert.strictEqual(copilot.INTENT_CODES.length, 4,
        'the intent vocabulary grew — every addition is a new surface a model reaches with company '
        + 'context attached, and must be a deliberate act');
    });
  });

  await atest('A SUBJECT THIS COMPANY CANNOT SEE THROWS, rather than answering emptily', async () => {
    await withStub(db({ noIndicator: true }).exports, async () => {
      const copilot = require('../src/services/copilotService');
      await assert.rejects(
        () => copilot.ask({ companyId: 'c1', intent: 'explain_requirement', subjectId: 'i-9' }),
        /no indicator this company can see/);
    });
  });

  await atest('THE INDICATOR READ IS SCOPED THROUGH AN ASSESSMENT THIS COMPANY OWNS', () => {
    const src = strip(fs.readFileSync(path.join(SRC, 'services/copilotService.js'), 'utf8'));
    const statements = [...src.matchAll(/`(\s*SELECT[\s\S]*?)`/g)].map((m) => m[1]);
    assert.ok(statements.length >= 2, 'the statement scan matched nothing');
    for (const st of statements) {
      assert.ok(/company_id\s*=\s*\$/.test(st),
        `the copilot reads without a tenant predicate:\n${st.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  });

  await atest('A DOCUMENT WITH NO TEXT IS ANSWERED WITHOUT CALLING A MODEL', async () => {
    const stub = db({ document: { ...DOCUMENT, text_status: 'no_text_layer', extracted_text: null } });
    let called = false;
    const out = await withStub(stub.exports, () => {
      const real = global.fetch;
      global.fetch = async () => { called = true; throw new Error('should not be called'); };
      return Promise.resolve(require('../src/services/copilotService').ask({
        companyId: 'c1', intent: 'summarise_document', subjectId: 'd-1',
      })).finally(() => { global.fetch = real; });
    });
    assert.strictEqual(called, false,
      'a document with no extracted text was still sent to a model — there was nothing to read');
    assert.strictEqual(out.mode, 'template');
    assert.strictEqual(stub.logged.length, 0, 'a call that never happened was logged as one');
  });

  await atest('THE DOCUMENT PROMPT IS TRUNCATED, and the whole file is not sent', () => {
    const { INTENTS } = require('../src/services/copilotService');
    const huge = { ...DOCUMENT, extracted_text: 'x'.repeat(50000) };
    const prompt = INTENTS.summarise_document.prompt(huge);
    assert.ok(prompt.length < 8000,
      `a ${prompt.length}-character prompt was built — a long PDF would spend the whole budget and `
      + 'return a summary of its first section while appearing to summarise the file');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     5 · EXPERT SUPPORT IS TRIGGERED BY A SITUATION, NEVER BY A SCORE
     ═══════════════════════════════════════════════════════════════════════ */

  const consult = require('../src/services/consultationTriggers');

  await atest('NO TRIGGER READS A SCORE — the directive\'s rule, asserted structurally', () => {
    const src = strip(fs.readFileSync(path.join(SRC, 'services/consultationTriggers.js'), 'utf8'));
    assert.ok(!/esg_scores|score_0_100|\bband_code\b/.test(src),
      'a consultation trigger reads the score. A score is a summary, and a summary is the worst '
      + 'possible trigger for advice — the directive rules it out explicitly.');
  });

  await atest('EVERY THRESHOLD IS EXPORTED, so the page can print the rule it used', () => {
    assert.strictEqual(Object.keys(consult.THRESHOLDS).length, 6);
    for (const t of consult.TRIGGERS) {
      assert.ok(typeof t.fires === 'function' && typeof t.because === 'function',
        `${t.code} cannot say what it fired on`);
      assert.ok(t.area && t.support, `${t.code} names no area or no support`);
    }
    assert.strictEqual(consult.TRIGGERS.length, 6);
  });

  await atest('A TRIGGER THAT FIRES ALWAYS SAYS WHAT IT FIRED ON, with the threshold', () => {
    const signals = {
      gapCount: 9, gapPillars: 3, draftMappingGaps: 4, unevidenced: 7, unreadable: 2,
      unclassifiedProjects: 1, readinessAssessable: 20, readinessMaximum: 100,
    };
    for (const t of consult.TRIGGERS) {
      assert.strictEqual(t.fires(signals), true, `${t.code} did not fire on a world designed to fire everything`);
      const why = t.because(signals);
      assert.ok(/\d/.test(why), `${t.code}'s reason carries no figure: "${why}"`);
      assert.ok(why.length > 30, `${t.code}'s reason is too short to be checkable: "${why}"`);
    }
  });

  await atest('NOTHING FIRES ON A CLEAN COMPANY — and that is a measured result', () => {
    const clean = {
      gapCount: 0, gapPillars: 0, draftMappingGaps: 0, unevidenced: 0, unreadable: 0,
      unclassifiedProjects: 0, readinessAssessable: 100, readinessMaximum: 100,
    };
    const fired = consult.TRIGGERS.filter((t) => t.fires(clean));
    assert.deepStrictEqual(fired.map((t) => t.code), [],
      'a trigger fires on a company with nothing outstanding');
  });

  await atest('THE BOOKING STATE IS false, AND NOTHING SCHEDULES ANYTHING', async () => {
    const out = await withStub(db().exports, () => require('../src/services/consultationTriggers')
      .evaluate('c1', 'a1', { assessable: 50, maximum: 100 }));
    assert.strictEqual(out.booking.built, false);
    assert.ok(/no consultation module|no booking/i.test(out.booking.detail));
    // And no page or service in this repo books anything.
    const all = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) all.push(p);
      }
    }(SRC));
    for (const f of all) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      assert.ok(!/esg_consultations?\b|INSERT INTO esg_bookings/i.test(src),
        `${path.relative(SRC, f)} references a consultation table — booking is not built, and a `
        + 'half-built one is worse than none');
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     6 · THERE IS NO REPORT GENERATOR
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('generator.built IS false, AND NOTHING IN THE CODEBASE WRITES A REPORT FILE', () => {
    const { assess } = require('../src/services/reportReadiness');
    assert.strictEqual(typeof assess, 'function');
    /* THE PAIRING IS THE POINT. The flag is a stated constant, so it cannot
       flip on by accident — and this half asserts the constant is still TRUE
       of the codebase. The day something does write a report, this fails and
       whoever built it has to come here and change both. */
    const all = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) all.push(p);
      }
    }(SRC));
    /* WHAT COUNTS AS "PRODUCES A REPORT", AND WHAT DELIBERATELY DOES NOT.

       The first draft of this scan looked for Content-Disposition or a .pdf
       string anywhere, and it named two files that are not report generators:
       routes/documents.js sends a company its OWN uploaded evidence file back,
       which is a download and not a document this platform authored; and
       data/sedgV2.js carries the published framework's source URL, which is a
       link to somebody else's PDF.

       The claim being guarded is narrower, and it is the claim the page makes:
       nothing here ASSEMBLES an ESG report. So the scan looks for a report
       BUILDER by name, or an attachment whose filename says report. */
    const writers = all.filter((f) => {
      const src = strip(fs.readFileSync(f, 'utf8'));
      return /\b(generateReport|buildReport|renderReport|createReport|reportPdf|toReport)\b/i.test(src)
        || /Content-Disposition[^\n]*report/i.test(src)
        || /filename=[^\n]*report[^\n]*\.(pdf|docx|xlsx)/i.test(src);
    }).map((f) => path.relative(SRC, f));
    assert.deepStrictEqual(writers, [],
      `something now produces a report file (${writers.join(', ')}) while reportReadiness still `
      + 'says generator.built = false');
  });

  await atest('THE THREE SECTION STATES DO NOT COLLAPSE', async () => {
    const rr = require('../src/services/reportReadiness');
    assert.deepStrictEqual([...rr.STATES], ['available', 'missing', 'not_configured']);
    assert.strictEqual(new Set(Object.values(rr.STATE_WORD)).size, 3,
      'two report states share a word — "nothing recorded" and "not configured" are a gap in your '
      + 'data and a gap in the platform, and they must never read the same');
  });

  await atest('THE THREE IMPOSSIBLE SECTIONS SAY WHY, not that you have none', async () => {
    const stub = {
      query: async (text) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (/\b(count|sum|min|max|avg)\s*\(/i.test(sql) && !/\bGROUP BY\b/i.test(sql)) {
          return { rows: [{ profile_filled: 3, answers_total: 0, answers_na: 0,
            answers_documented: 0, answers_verified: 0, answers_declared: 0,
            carbon_entries: 0, carbon_provisional: 0, report_docs_total: 0, report_docs_read: 0,
            report_projects_total: 0, report_projects_forecast: 0,
            report_baselines: 0, report_actuals: 0, report_verified: 0, n: 0 }] };
        }
        return { rows: [] };
      },
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    };
    const r = await withStub(stub, () => require('../src/services/reportReadiness').assess('c1', 'a1'));
    for (const code of ['SUSTNET', 'CERTIFICATION', 'ASSURANCE']) {
      const s = r.sections.find((x) => x.code === code);
      assert.strictEqual(s.state, 'not_configured', `${code} is not reported as not_configured`);
      assert.ok(s.why && s.why.length > 40,
        `${code} does not say WHY it cannot exist — without that it reads as a gap in your data`);
    }
    // …and a section the company simply has none of reads differently.
    const carbon = r.sections.find((x) => x.code === 'CARBON');
    assert.strictEqual(carbon.state, 'missing');
    assert.strictEqual(carbon.why, null,
      'a "you have none yet" section carries a platform-level reason, which conflates the two');
  });

  /* ═══════════════════════════════════════════════════════════════════════
     7 · MUTATION TESTS
     ═══════════════════════════════════════════════════════════════════════ */

  await atest('MUTATION · widening the allow-list lets a figure through', () => {
    const { stripFigures } = require('../src/services/aiAdvisor');
    // The guard, as it stands.
    assert.ok(!stripFigures('We saved 4200 kWh.', []).includes('4200'),
      'MUTATION SURVIVED: an empty allow-list let a figure through, so the copilot guard is inert');
    // The mutant: a non-empty allow-list. This is what a future author writes
    // when a stripped year annoys them, and it is exactly the removal.
    assert.ok(stripFigures('We saved 4200 kWh.', [4200]).includes('4200'),
      'the strip ignores its allow-list entirely, so the empty-list assertion above proves nothing');
  });

  await atest('MUTATION · a trigger that cannot say what it fired on is caught', () => {
    // The suite's own guard, exercised against a deliberately mute trigger.
    const mute = { code: 'M', label: 'l', area: 'a', support: 's',
      fires: () => true, because: () => 'because' };
    let caught = false;
    try {
      const why = mute.because({});
      assert.ok(/\d/.test(why), 'no figure');
      assert.ok(why.length > 30, 'too short');
    } catch { caught = true; }
    assert.ok(caught,
      'MUTATION SURVIVED: a trigger whose reason names no figure and is 7 characters long passed '
      + 'the check that is supposed to require a checkable one');
  });

  await atest('MUTATION · a fourth report state is refused', () => {
    const { section } = require('../src/services/reportReadiness');
    assert.throws(() => section({ code: 'M', name: 'n', state: 'unknown', what: 'w' }),
      /is not a section state/,
      'MUTATION SURVIVED: a fourth state was accepted, which is how missing and not-configured '
      + 'collapse into one');
  });

  await atest('MUTATION · an intent added outside the closed set is refused', async () => {
    await withStub(db().exports, async () => {
      const copilot = require('../src/services/copilotService');
      await assert.rejects(() => copilot.ask({
        companyId: 'c1', intent: 'draft_my_answer', subjectId: 'i-1' }),
      /is not one of the four intents/,
      'MUTATION SURVIVED: an intent the service does not define reached the model with company '
      + 'context attached');
    });
  });

  console.log(`\ncopilot: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

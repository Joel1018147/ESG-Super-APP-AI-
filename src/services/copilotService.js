'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE ESG COPILOT — CONTEXTUAL, GROUNDED, AND UNABLE TO PRODUCE A FIGURE
                                                                   (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
   Not a chatbot. There is no free-text box, no conversation, no history and no
   "ask me anything". `/assistant` still says a conversational assistant is not
   built, because it is not.

   What P9 built instead is FOUR CONTEXTUAL ACTIONS, each attached to a row the
   user is already looking at:

     explain_requirement   indicator   what is this disclosure actually asking?
     evidence_for          indicator   what could I provide to support it?
     improve_area          pillar      how do I improve this pillar?
     summarise_document    document    what is in this file?

   A CLOSED SET. `INTENTS` is the whole vocabulary and `ask()` throws on
   anything else rather than treating it as a general question — an unrecognised
   intent reaching a model with the company's data attached is exactly the
   surface this design exists to not have.

   ── THE SAME RULE AS EVERY OTHER AI PATH HERE ────────────────────────────
   THE MODEL NEVER PRODUCES A FIGURE.

   CLAUDE.md #1 says aiAdvisor.js has five guards and a sixth must not be
   opened. This is a different file and it does not open one there; it applies
   THE SAME FIVE, by reusing aiAdvisor's own `stripFigures` rather than writing
   a second copy that could drift:

     1. The prompt carries only text — a question, its guidance, a pillar name,
        a document's own extracted words. No score, no points, no weight, no
        tonnage is ever put in front of the model, so there is nothing for it
        to repeat and nothing to anchor an invention on.
     2. NOTHING THIS FILE PRODUCES IS EVER STORED. It writes to no table but
        esg_ai_interactions, which is the log. There is no numeric column
        anywhere a reply could land, because there is no column at all.
     3. stripFigures() with an EMPTY allow-list. Since no figure is supplied,
        no figure is permitted out: every digit run in the reply is replaced.
        This is stricter than aiAdvisor, not looser.
     4. Groq being down produces a DETERMINISTIC ANSWER built from the
        configured guidance, never a blank and never a guess — and it says
        which of the two you are reading.
     5. test/copilot-test.js fails the build if this file gains a write to any
        table other than esg_ai_interactions, or if the allow-list stops being
        empty.

   ── AND IT NEVER PRETENDS TO VERIFY ──────────────────────────────────────
   The copilot may explain, summarise and suggest. It may not accept a
   proposal, set an evidence tier, mark anything verified or answer a question
   on the company's behalf. It returns TEXT to a person who then acts.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const { generateWithGroq, groqModel, logInteraction } = require('./groqService');
const { stripFigures } = require('./aiAdvisor');

/** GUARD 3'S ALLOW-LIST, AND IT IS EMPTY ON PURPOSE.
 *
 *  aiAdvisor hands the model figures it must be able to repeat, so its
 *  allow-list is those figures. This file hands it none, so nothing numeric
 *  may come back. Exported and asserted, because an author who later "fixes"
 *  a stripped year by widening this has removed the guard. */
const ALLOWED_FIGURES = Object.freeze([]);

const SYSTEM = [
  'You are an ESG copilot for a Malaysian SME, embedded in an assessment tool.',
  'You explain what is being asked and what would support an answer.',
  'NEVER state a number of any kind — no score, no percentage, no tonnage, no ringgit amount,',
  'no year, no count. You have been given no figures and any number you write will be removed.',
  'Never claim anything has been verified, approved, certified or accepted.',
  'Never answer the question on the company\'s behalf — describe what an answer needs.',
  'Plain English for an owner-manager. Three or four short sentences. No jargon, no preamble,',
  'no markdown, no bullet points.',
].join(' ');

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR INTENTS

   Each names the SUBJECT it needs, how to load it (scoped to the company), the
   prompt built from that subject, and the deterministic answer used when the
   model is unavailable. The template is not a lesser answer — for
   `explain_requirement` on an indicator with configured guidance it is very
   nearly the whole of what there is to say.
   ═══════════════════════════════════════════════════════════════════════════ */

/** An indicator, scoped to a framework this company is actually assessed on.
 *  A bare `WHERE id = $1` would let any company read any indicator on any
 *  framework — reference data, but still a row it has no assessment against. */
async function loadIndicator(companyId, id) {
  const { rows } = await query(
    `SELECT DISTINCT i.id, i.code, i.question_en, i.guidance_en, i.pillar, i.tier,
            i.response_type, i.unit, i.mapping_status
       FROM esg_indicators i
       JOIN esg_assessments a ON a.framework_id = i.framework_id
      WHERE i.id = $1 AND a.company_id = $2 AND i.is_active`, [id, companyId]);
  return rows[0] || null;
}

async function loadDocument(companyId, id) {
  const { rows } = await query(
    `SELECT id, filename, text_status, page_count, extracted_text
       FROM esg_documents WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return rows[0] || null;
}

const PILLAR_NAME = Object.freeze({ E: 'Environmental', S: 'Social', G: 'Governance' });

const INTENTS = Object.freeze({
  explain_requirement: {
    label: 'Explain this requirement',
    subject: 'indicator',
    load: loadIndicator,
    prompt: (s) => `A Malaysian SME is being asked this ESG disclosure question:\n\n`
      + `"${s.question_en}"\n\n`
      + (s.guidance_en ? `The framework's own guidance on it reads:\n"${s.guidance_en}"\n\n` : '')
      + `Explain in plain English what this question is actually asking for and what a complete `
      + `answer looks like. Do not answer it for them and do not invent an example figure.`,
    template: (s) => (s.guidance_en
      ? `The question asks: “${s.question_en}” The framework's own guidance on it reads: `
        + `“${s.guidance_en}” That guidance is the whole of what is configured for this `
        + `disclosure on this platform.`
      : `The question asks: “${s.question_en}” No further guidance is configured for this `
        + `disclosure on this framework, so the question itself is the whole of what is being `
        + `asked — and this platform will not invent an interpretation of it.`),
  },

  evidence_for: {
    label: 'What evidence can I provide?',
    subject: 'indicator',
    load: loadIndicator,
    prompt: (s) => `A Malaysian SME wants to support its answer to this ESG disclosure with a `
      + `document it already holds:\n\n"${s.question_en}"\n\n`
      + (s.guidance_en ? `The framework's guidance reads:\n"${s.guidance_en}"\n\n` : '')
      + `Describe the KINDS of ordinary business document that would support an answer to this. `
      + `Do not promise that any of them will be accepted and do not invent a figure.`,
    template: (s) => (s.guidance_en
      ? `What would support this answer follows from the guidance configured for it: `
        + `“${s.guidance_en}” Attaching a document moves the answer from self-declared to `
        + `documented, and the weighting scheme decides what that is worth.`
      : `No evidence requirement is configured for this disclosure, so this platform cannot tell `
        + `you which document would satisfy it — and it will not offer a list of examples it has `
        + `no basis for. What it can tell you is that attaching any supporting document moves the `
        + `answer from self-declared to documented.`),
  },

  improve_area: {
    label: 'How can I improve this area?',
    subject: 'pillar',
    /* The subject is a LETTER, not a row. Validated against the closed set
       rather than loaded, because E/S/G is a CHECK constraint and not a
       table — and an unrecognised letter must not reach a prompt. */
    load: async (companyId, code) => (PILLAR_NAME[code]
      ? { code, name: PILLAR_NAME[code] } : null),
    prompt: (s) => `A Malaysian SME wants to improve its ${s.name.toLowerCase()} performance for an `
      + `ESG assessment. Describe the kinds of practical step a small business typically takes `
      + `first in this area — the ordinary, low-cost ones, not a corporate programme. Do not `
      + `mention any score, target, percentage or cost.`,
    template: (s) => `This platform has no configured improvement library for the `
      + `${s.name.toLowerCase()} pillar, and the AI that would have written this is unavailable. `
      + `What it does have is your own gap list, which names each outstanding disclosure in this `
      + `pillar and what would resolve it — that is derived from your answers rather than from `
      + `general advice.`,
  },

  summarise_document: {
    label: 'Summarise this document',
    subject: 'document',
    load: loadDocument,
    /* THE DOCUMENT'S OWN WORDS ARE THE ONLY INPUT, and they are truncated. A
       long PDF would otherwise spend the whole budget and return a summary of
       its first section while appearing to summarise the file. The cut is
       stated in the reply's `basis`, so a short summary of a long document is
       never mistaken for a complete one. */
    prompt: (s) => `Summarise what this business document is, in plain English, for someone `
      + `deciding whether it supports an ESG disclosure. Say what kind of document it is and what `
      + `it covers. Do not quote or restate any number from it.\n\n`
      + `--- document text begins ---\n${String(s.extracted_text || '').slice(0, 6000)}\n--- ends ---`,
    template: (s) => `“${s.filename}” is on file and its text ${s.text_status === 'extracted'
      ? 'has been extracted' : `could not be extracted (${s.text_status})`}. The AI that would `
      + `have summarised it is unavailable, so nothing is being described here rather than `
      + `something being guessed. You can open the document itself.`,
  },
});

const INTENT_CODES = Object.freeze(Object.keys(INTENTS));

/* ═══════════════════════════════════════════════════════════════════════════
   ASK
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One contextual answer.
 *
 * @param {object} opts  { companyId, userId, intent, subjectId }
 * @returns {object}     { intent, subject, text, mode, basis }
 *
 * `mode` is 'ai' or 'template' and is ALWAYS reported, because a deterministic
 * answer and a generated one are different things and a reader is entitled to
 * know which they are looking at. That is the same rule the opportunity scan
 * follows: a failure must never be pixel-identical to a success.
 *
 * THROWS on an unknown intent and on a subject this company cannot see.
 * Returning a polite nothing would make an authorisation failure and an empty
 * result look the same.
 */
async function ask({ companyId, userId = null, intent, subjectId }) {
  if (!companyId) throw new Error('copilot: a company is required');
  const def = INTENTS[intent];
  if (!def) {
    throw new Error(`copilot: "${intent}" is not one of the four intents (${INTENT_CODES.join(', ')})`);
  }
  if (!subjectId) throw new Error(`copilot: the ${def.subject} to talk about is required`);

  const subject = await def.load(companyId, subjectId);
  if (!subject) {
    throw new Error(`copilot: no ${def.subject} this company can see matches that reference`);
  }

  if (def.subject === 'document' && subject.text_status !== 'extracted') {
    // Not a failure and not an empty answer: the file genuinely has no text to
    // read, and saying so is more useful than a summary of nothing.
    return Object.freeze({
      intent, mode: 'template', subject: describeSubject(def, subject),
      text: def.template(subject),
      basis: 'The document has no extracted text, so there was nothing for a model to read. '
           + 'Nothing was sent to one.',
    });
  }

  const prompt = def.prompt(subject);
  const model = groqModel();
  const started = Date.now();

  let text;
  let mode = 'ai';
  try {
    const reply = await generateWithGroq(prompt, { system: SYSTEM, temperature: 0.2, maxTokens: 400 });
    // GUARD 3, at its strictest: the allow-list is empty, so every digit run in
    // the reply is replaced. Nothing numeric was supplied and nothing numeric
    // may come out.
    text = stripFigures(reply, ALLOWED_FIGURES).trim();
    if (!text) {
      // An empty reply is a failure, not an answer. Falling through to the
      // template makes the two visibly different rather than rendering a blank
      // panel that reads like "there is nothing to say".
      throw new Error('the model returned nothing usable');
    }
    await logInteraction({
      companyId, userId, feature: `copilot:${intent}`, model,
      promptChars: prompt.length, responseChars: reply.length,
      latencyMs: Date.now() - started, ok: true });
  } catch (err) {
    mode = 'template';
    text = def.template(subject);
    await logInteraction({
      companyId, userId, feature: `copilot:${intent}`, model,
      promptChars: prompt.length, latencyMs: Date.now() - started,
      ok: false, error: err.message });
  }

  return Object.freeze({
    intent,
    mode,
    subject: describeSubject(def, subject),
    text,
    basis: mode === 'ai'
      ? 'Written by the model from the question and its configured guidance. It was given no '
        + 'figures and any number it produced has been removed. It has not verified anything and '
        + 'has not answered on your behalf.'
      : 'The model was unavailable, so this is the platform\'s own deterministic answer, built '
        + 'from what is configured for this item. It is not a generated one.',
  });
}

/** What the answer is ABOUT, in a shape a page can render without knowing
 *  which of the four subjects it got. */
function describeSubject(def, subject) {
  if (def.subject === 'indicator') {
    return Object.freeze({ kind: 'indicator', id: subject.id, code: subject.code,
      name: subject.question_en, mapping_status: subject.mapping_status });
  }
  if (def.subject === 'document') {
    return Object.freeze({ kind: 'document', id: subject.id, name: subject.filename });
  }
  return Object.freeze({ kind: 'pillar', id: subject.code, code: subject.code, name: subject.name });
}

module.exports = { ask, INTENTS, INTENT_CODES, ALLOWED_FIGURES, SYSTEM, describeSubject };

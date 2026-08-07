'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2 — reading an uploaded ESG report.
//
// The brief says the AI should "estimate ESG performance" from the document.
// Done literally that puts a language model in charge of a rating. This is how
// the same outcome is reached without it. Four guards, in order of how much
// they matter:
//
//   1. THE MODEL IS NEVER ASKED ABOUT A NUMBER. Quantitative indicators are
//      filtered out before the prompt is built, so there is no path on which
//      the model is even shown a question whose answer is a figure. A human
//      types those.
//   2. EVERY CLAIM NEEDS A VERBATIM QUOTE, and the quote is looked up in the
//      document's own extracted text. Not found, or too short to be evidence,
//      and the proposal is auto-rejected as a hallucination before any person
//      sees it.
//   3. AN UNKNOWN INDICATOR CODE OR OPTION IS DROPPED, not coerced. A model
//      inventing "E-99" or answering "mostly" gets nothing.
//   4. A VERIFIED PROPOSAL IS STILL A PROPOSAL. It sits in a review queue.
//      Only a person accepting it writes a row in esg_responses. An AI reading
//      a PDF must never silently raise a company's ESG score.
//
// Layer 2 is therefore not a second scoring path — it is a second INPUT path
// into the one scoring engine, which does the arithmetic exactly as it does for
// the questionnaire.
// ═══════════════════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../db');
const { generateWithGroq, groqModel, logInteraction } = require('./groqService');
const { extractText, chunkPages } = require('./pdfService');
const { register } = require('./jobRunner');

const JOB_TYPE = 'document_extraction';

// A quote shorter than this is not evidence — "policy" appears in any report,
// and a model can satisfy a naive substring check with a single common word.
const MIN_QUOTE_CHARS = 25;

// Bounds the cost and the wall-clock of one document. A 300-page report would
// otherwise queue 90 model calls against an 8,000 token-per-minute budget.
const MAX_CHUNKS = 30;
const PAUSE_MS = 2500;

const OPTIONS_BY_TYPE = Object.freeze({
  yes_no:         ['yes', 'no'],
  yes_partial_no: ['yes', 'partial', 'no'],
  maturity_0_4:   ['0', '1', '2', '3', '4'],
});

// Guard 1, at its source. Anything not in this map — today only
// 'quantitative' and 'multi_select' — is never put in front of the model.
function eligible(indicators) {
  return indicators.filter((i) => OPTIONS_BY_TYPE[i.response_type]);
}

/** Collapse whitespace and case so quoting is robust to PDF line wrapping. */
function canon(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Guard 2. Checked against the DOCUMENT, not the chunk, so a correct quote is
 * not rejected merely because chunking split it oddly.
 *
 * Returns { page } on success, or { reason } naming WHICH check failed. The
 * two failures mean different things and an auditor reading the rejection log
 * needs them apart: "too short" is a model being lazy and quoting a common
 * word; "not found" is a model that fabricated the sentence. Collapsing both
 * into one message would report every lazy quote as a fabrication.
 */
function locateQuote(quote, pages) {
  const q = canon(quote);
  if (q.length < MIN_QUOTE_CHARS) {
    return { reason: `Quote is ${q.length} characters; at least ${MIN_QUOTE_CHARS} are needed to be evidence` };
  }
  for (const p of pages) {
    if (canon(p.text).includes(q)) return { page: p.num };
  }
  return { reason: 'Quote does not appear anywhere in the document text' };
}

const SYSTEM = [
  'You identify which ESG disclosures appear in an excerpt of a company report.',
  'For each disclosure you can evidence IN THIS EXCERPT, output exactly one line:',
  'CODE|option|verbatim quote',
  'The quote MUST be copied word-for-word from the excerpt. Never paraphrase it.',
  'Never output a disclosure you cannot quote. Never invent a code.',
  'Never output a number, percentage, score or total of your own.',
  'Output nothing else — no preamble, no explanation, no markdown.',
].join(' ');

function buildPrompt(indicators, chunkText) {
  const list = indicators
    .map((i) => `${i.code} [${OPTIONS_BY_TYPE[i.response_type].join('/')}] ${i.question_en}`)
    .join('\n');
  return `DISCLOSURES:\n${list}\n\nEXCERPT:\n"""\n${chunkText}\n"""\n\nLines only.`;
}

/**
 * Guard 3. Strict parse. Anything that does not match the shape, or names an
 * unknown code or an option that indicator does not accept, is discarded
 * silently rather than coerced into something plausible.
 */
function parseProposals(reply, byCode) {
  const out = [];
  for (const raw of String(reply || '').split('\n')) {
    const m = raw.match(/^\s*([EGS]-\d{1,3})\s*\|\s*([^|]{1,12}?)\s*\|\s*(.+?)\s*$/);
    if (!m) continue;
    const ind = byCode.get(m[1].toUpperCase());
    if (!ind) continue;
    const allowed = OPTIONS_BY_TYPE[ind.response_type];
    const opt = m[2].trim().toLowerCase();
    if (!allowed || !allowed.includes(opt)) continue;
    const quote = m[3].replace(/^["'`]|["'`]$/g, '').trim();
    if (!quote) continue;
    out.push({ indicator: ind, option: opt, quote });
  }
  return out;
}

/**
 * Analyse one uploaded document against an assessment's framework.
 *
 * `generate` is injectable so the guards can be tested against a deliberately
 * hallucinating model — see test/layer2-test.js. That test is the reason to
 * believe guard 2 works, rather than the reason to hope it does.
 */
async function analyseDocument({ documentId, assessmentId, companyId, userId,
                                 generate = generateWithGroq } = {}) {
  const { rows: docs } = await query(
    `SELECT id, company_id, filename, mime_type, content, text_status
       FROM esg_documents WHERE id = $1`, [documentId]);
  const doc = docs[0];
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const { rows: aRows } = await query(
    `SELECT a.id, a.framework_id FROM esg_assessments a WHERE a.id = $1`, [assessmentId]);
  const assessment = aRows[0];
  if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);

  // ── Extract ──────────────────────────────────────────────────────────────
  await query(`UPDATE esg_documents SET text_status='extracting' WHERE id=$1`, [documentId]);
  let parsed;
  try {
    parsed = await extractText(doc.content);
  } catch (err) {
    await query(
      `UPDATE esg_documents SET text_status='failed', extraction_error=$2 WHERE id=$1`,
      [documentId, err.message]);
    return { status: 'failed', error: err.message, proposals: 0 };
  }

  await query(
    `UPDATE esg_documents SET text_status=$2, extracted_text=$3, page_count=$4, extraction_error=NULL
      WHERE id=$1`,
    [documentId, parsed.status, parsed.text, parsed.pageCount]);

  if (parsed.status === 'no_text_layer') {
    // Reported distinctly. "This PDF is a scan" and "this report discloses
    // nothing" are different findings and only one of them is the company's
    // fault.
    return { status: 'no_text_layer', pageCount: parsed.pageCount, proposals: 0 };
  }

  // ── Ask ──────────────────────────────────────────────────────────────────
  const { rows: allIndicators } = await query(
    `SELECT id, code, question_en, response_type
       FROM esg_indicators WHERE framework_id = $1 AND is_active ORDER BY sort_order`,
    [assessment.framework_id]);
  const indicators = eligible(allIndicators);
  const byCode = new Map(indicators.map((i) => [i.code.toUpperCase(), i]));

  const chunks = chunkPages(parsed.pages).slice(0, MAX_CHUNKS);
  const seen = new Map();
  let calls = 0, rejected = 0;

  for (const chunk of chunks) {
    let reply = '';
    const started = Date.now();
    try {
      reply = await generate(buildPrompt(indicators, chunk.text), {
        system: SYSTEM, temperature: 0, maxTokens: 700,
      });
      calls += 1;
      await logInteraction({ companyId, userId, feature: 'document_extraction',
                             model: groqModel(), promptChars: chunk.text.length,
                             responseChars: reply.length, latencyMs: Date.now() - started, ok: true });
    } catch (err) {
      await logInteraction({ companyId, userId, feature: 'document_extraction',
                             model: groqModel(), latencyMs: Date.now() - started,
                             ok: false, error: err.message });
      continue;   // one bad chunk must not abandon the document
    }

    for (const p of parseProposals(reply, byCode)) {
      const found = locateQuote(p.quote, parsed.pages);         // Guard 2
      if (!found.page) {
        rejected += 1;
        // Recorded, not discarded. A rejected claim is evidence about the
        // model's reliability on this document, and the review page shows the
        // count so a reviewer can see when extraction is going badly.
        await query(
          `INSERT INTO esg_document_extractions
             (document_id, assessment_id, indicator_id, proposed_option_code,
              evidence_quote, page_no, quote_verified, status, reject_reason, model)
           VALUES ($1,$2,$3,$4,$5,NULL,false,'auto_rejected',$6,$7)`,
          [documentId, assessmentId, p.indicator.id, p.option, p.quote.slice(0, 2000),
           found.reason, groqModel()]);
        continue;
      }
      const page = found.page;
      // First verified proposal per indicator wins; later duplicates are noise.
      if (seen.has(p.indicator.id)) continue;
      seen.set(p.indicator.id, true);
      await query(
        `INSERT INTO esg_document_extractions
           (document_id, assessment_id, indicator_id, proposed_option_code,
            evidence_quote, page_no, quote_verified, status, model)
         VALUES ($1,$2,$3,$4,$5,$6,true,'pending',$7)
         ON CONFLICT (document_id, indicator_id) WHERE status <> 'auto_rejected'
         DO NOTHING`,
        [documentId, assessmentId, p.indicator.id, p.option,
         p.quote.slice(0, 2000), page, groqModel()]);
    }
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return {
    status: 'extracted',
    pageCount: parsed.pageCount,
    chunks: chunks.length,
    calls,
    proposals: seen.size,
    autoRejected: rejected,
    indicatorsAsked: indicators.length,
    indicatorsSkippedNumeric: allIndicators.length - indicators.length,
  };
}

/**
 * Guard 4. Accepting a proposal is the ONLY way an extraction becomes a
 * response, and it requires a user id. evidence_tier is 'documented', never
 * 'verified' — a person confirming that a report says something is not the
 * same as an assurance provider signing it off.
 */
async function acceptProposal(extractionId, userId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT e.id, e.assessment_id, e.indicator_id, e.proposed_option_code,
              e.document_id, e.quote_verified, e.status
         FROM esg_document_extractions e WHERE e.id = $1 FOR UPDATE`, [extractionId]);
    const e = rows[0];
    if (!e) throw new Error('Proposal not found');
    if (!e.quote_verified) throw new Error('Refusing to accept a proposal whose quote was never verified');
    if (e.status !== 'pending') throw new Error(`Proposal is already ${e.status}`);
    if (!e.assessment_id) throw new Error('Proposal is not attached to an assessment');

    await client.query(
      `INSERT INTO esg_responses
         (assessment_id, indicator_id, option_code, is_na, evidence_tier, document_id, answered_by)
       VALUES ($1,$2,$3,false,'documented',$4,$5)
       ON CONFLICT (assessment_id, indicator_id) DO UPDATE SET
         option_code = EXCLUDED.option_code,
         evidence_tier = EXCLUDED.evidence_tier,
         document_id = EXCLUDED.document_id,
         answered_by = EXCLUDED.answered_by`,
      [e.assessment_id, e.indicator_id, e.proposed_option_code, e.document_id, userId]);

    await client.query(
      `UPDATE esg_document_extractions
          SET status='accepted', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
      [extractionId, userId]);
    return { accepted: true, indicatorId: e.indicator_id };
  });
}

async function rejectProposal(extractionId, userId, reason) {
  const { rows } = await query(
    `UPDATE esg_document_extractions
        SET status='rejected', reject_reason=$3, reviewed_by=$2, reviewed_at=now()
      WHERE id=$1 AND status='pending'
      RETURNING id`, [extractionId, userId, reason || 'Rejected by reviewer']);
  if (!rows[0]) throw new Error('Proposal not found or already reviewed');
  return { rejected: true };
}

/** Coverage, computed from ACCEPTED proposals only. Arithmetic, not a model. */
async function coverage(assessmentId) {
  const { rows } = await query(
    `SELECT i.pillar,
            count(*) FILTER (WHERE e.status = 'accepted')::int AS accepted,
            count(*) FILTER (WHERE e.status = 'pending')::int  AS pending,
            count(*) FILTER (WHERE e.status = 'auto_rejected')::int AS hallucinated,
            count(*) FILTER (WHERE e.status = 'rejected')::int AS rejected
       FROM esg_document_extractions e
       JOIN esg_indicators i ON i.id = e.indicator_id
      WHERE e.assessment_id = $1
      GROUP BY i.pillar ORDER BY i.pillar`, [assessmentId]);
  return rows;
}

register(JOB_TYPE, async (payload) => {
  const r = await analyseDocument(payload);
  if (r.status === 'failed') throw new Error(r.error);
});

module.exports = {
  JOB_TYPE, analyseDocument, acceptProposal, rejectProposal, coverage,
  parseProposals, locateQuote, eligible, canon,
  OPTIONS_BY_TYPE, MIN_QUOTE_CHARS, MAX_CHUNKS,
};

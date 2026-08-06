'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// The AI layer — and the five guards that keep it away from the numbers.
//
// THE MODEL NEVER PRODUCES A FIGURE. It receives figures the scoring engine
// computed and writes sentences around them. Every path where a model-authored
// number could reach a company is closed below. If you extend this file, do not
// open a sixth.
//
//   1. The prompt carries the figures and forbids new ones.
//   2. Recommendation rows written from here carry source = 'ai_phrasing' and
//      copy points_missed from the engine row — the model's text never lands in
//      a numeric column.
//   3. stripFigures() removes any digit sequence the model emitted that is not
//      in the allow-list of figures we handed it.
//   4. Groq being down produces a TEMPLATE, never a blank and never a guess.
//   5. test/no-model-figures-test.js fails the build if any numeric column in
//      esg_scores or esg_recommendations is assigned from a Groq response.
// ═══════════════════════════════════════════════════════════════════════════

const { query } = require('../db');
const { generateWithGroq, groqModel, logInteraction } = require('./groqService');

const SYSTEM = [
  'You are an ESG adviser for Malaysian SMEs.',
  'You will be given figures that have ALREADY been calculated.',
  'Never state a number that is not in the figures given to you.',
  'Never estimate, project, or infer a score, percentage, tonnage or ringgit amount.',
  'Write plain, practical English for an owner-manager. No jargon, no filler.',
  'Two or three sentences per recommendation. Say what to do, not why ESG matters.',
].join(' ');

/** Guard 3. Any digit run the model produced that we did not supply is removed. */
function stripFigures(text, allowed) {
  const ok = new Set(allowed.map((n) => String(n)));
  return String(text || '').replace(/\d+(?:\.\d+)?/g, (m) => (ok.has(m) ? m : '[figure removed]'));
}

/** Guard 4. Deterministic prose when Groq is unavailable or refuses. */
function templateFor(rec) {
  const what = rec.question_en || rec.code;
  if (!rec.answered) {
    return `This has not been answered yet: "${what}". Answering it is the cheapest ` +
           `improvement available to you — it costs nothing but the time to look it up.`;
  }
  if (rec.evidence_tier === 'self_declared') {
    return `You answered "${what}" but nothing is attached to support it. Uploading the ` +
           `document you already hold moves this from self-declared to documented, which ` +
           `raises the score without changing anything about how you operate.`;
  }
  return `Strengthening your position on "${what}" is the next available gain in this area.`;
}

/**
 * Write AI-phrased recommendations for an assessment.
 * Reads engine rows, sends their figures, writes prose back. Numbers are copied
 * across from the engine row; none is read out of the model's reply.
 */
async function generateRecommendations(assessmentId, ctx = {}) {
  const { rows } = await query(
    `SELECT r.id, r.indicator_id, r.pillar, r.points_missed, r.priority,
            i.code, i.question_en, i.guidance_en,
            resp.evidence_tier, (resp.id IS NOT NULL AND NOT resp.is_na) AS answered
       FROM esg_recommendations r
       LEFT JOIN esg_indicators i ON i.id = r.indicator_id
       LEFT JOIN esg_responses resp
              ON resp.assessment_id = r.assessment_id AND resp.indicator_id = r.indicator_id
      WHERE r.assessment_id = $1 AND r.source = 'engine'
      ORDER BY r.points_missed DESC
      LIMIT 8`, [assessmentId]);

  if (rows.length === 0) return { written: 0, mode: 'nothing_to_do' };

  await query(`DELETE FROM esg_recommendations WHERE assessment_id = $1 AND source <> 'engine'`, [assessmentId]);

  // Guard 1. The only figures in play are the ones on this list.
  const allowed = rows.map((r) => r.points_missed).filter((n) => n !== null).map(Number);
  const prompt = [
    'Here are the gaps found in a Malaysian SME ESG assessment.',
    'For each, write one short recommendation. Return one line per gap, prefixed with its code.',
    '',
    ...rows.map((r) => `${r.code} | pillar ${r.pillar} | points missed ${r.points_missed} | ` +
                       `${r.answered ? `answered, evidence: ${r.evidence_tier}` : 'not answered'} | ${r.question_en}`),
  ].join('\n');

  let mode = 'ai_phrasing';
  let byCode = new Map();
  const started = Date.now();
  try {
    const reply = await generateWithGroq(prompt, { system: SYSTEM, temperature: 0.2, maxTokens: 900 });
    const clean = stripFigures(reply, allowed);          // Guard 3
    for (const line of clean.split('\n')) {
      const m = line.match(/^\s*([EGS]-\d+)\s*[|:.\-]\s*(.+)$/);
      if (m) byCode.set(m[1], m[2].trim());
    }
    await logInteraction({ companyId: ctx.companyId, userId: ctx.userId, feature: 'recommendations',
                           model: groqModel(), promptChars: prompt.length, responseChars: reply.length,
                           latencyMs: Date.now() - started, ok: true });
  } catch (err) {
    mode = 'fallback_template';                          // Guard 4
    await logInteraction({ companyId: ctx.companyId, userId: ctx.userId, feature: 'recommendations',
                           model: groqModel(), promptChars: prompt.length,
                           latencyMs: Date.now() - started, ok: false, error: err.message });
  }

  let written = 0;
  for (const r of rows) {
    const narrative = byCode.get(r.code) || templateFor(r);
    const source = byCode.has(r.code) ? 'ai_phrasing' : 'fallback_template';
    // Guard 2. points_missed is COPIED from the engine row. There is no code
    // path on which a numeric column here is assigned from `narrative`.
    await query(
      `INSERT INTO esg_recommendations
         (assessment_id, indicator_id, pillar, points_missed, priority, narrative_en, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [assessmentId, r.indicator_id, r.pillar, r.points_missed, r.priority, narrative, source]);
    written += 1;
  }
  return { written, mode };
}

module.exports = { generateRecommendations, stripFigures, templateFor, SYSTEM };

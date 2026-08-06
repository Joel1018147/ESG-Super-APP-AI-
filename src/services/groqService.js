'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// The ONE Groq client for this repo.
//
// Nothing else may read process.env.GROQ_MODEL. That is not tidiness: model ids
// get decommissioned, and when the name is pinned at fourteen call sites, five
// of them stay on a dead id long after the migration and every AI panel behind
// them goes quiet instead of erroring, because each site swallows failures into
// a null insight.
//
// THE ENV VAR WINS. Editing DEFAULT_MODEL below is NOT sufficient to change the
// model in production — if GROQ_MODEL is set on the Railway service, that value
// is what ships. Check the dashboard as well as the code.
// ═══════════════════════════════════════════════════════════════════════════

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'qwen/qwen3.6-27b';

function groqModel() {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

// reasoning_effort and reasoning_format are supported by qwen/qwen3.6-* ONLY.
// Gated on the model ACTUALLY BEING SENT, not on DEFAULT_MODEL — otherwise an
// operator who overrides GROQ_MODEL to a llama build gets a 400 on every call
// and the only clue is a silent panel.
const REASONING_CAPABLE = /^qwen\/qwen3\.6-/i;

function supportsReasoningControls(model) {
  return REASONING_CAPABLE.test(String(model || ''));
}

/**
 * Call Groq. THROWS on any failure — no silent nulls here. A caller that wants
 * to degrade quietly catches and falls back, so that silence is always a
 * decision made at the call site and visible there.
 */
async function generateWithGroq(prompt, opts = {}) {
  const apiKey = opts.apiKey || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const model = opts.model || groqModel();
  const body = {
    model,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature: opts.temperature ?? 0.3,
    max_tokens:  opts.maxTokens ?? 800,
  };
  if (supportsReasoningControls(model)) {
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
    if (opts.reasoningFormat) body.reasoning_format = opts.reasoningFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Groq ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget usage log. Never let logging break a request. */
async function logInteraction(row) {
  try {
    const { query } = require('../db');
    await query(
      `INSERT INTO esg_ai_interactions
         (company_id, user_id, feature, model, prompt_chars, response_chars, latency_ms, ok, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.companyId || null, row.userId || null, row.feature, row.model,
       row.promptChars || null, row.responseChars || null, row.latencyMs || null,
       row.ok !== false, row.error || null]);
  } catch (e) {
    console.error('ai_interactions log failed:', e.message);
  }
}

module.exports = { groqModel, supportsReasoningControls, generateWithGroq, logInteraction, DEFAULT_MODEL, GROQ_URL };

'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// THE SCORING ENGINE
//
// Every figure this platform shows a company originates here, in ordinary
// arithmetic over rows the company itself entered. No language model writes a
// score, a sub-score, a band or a points figure. The AI layer reads the output
// of this file and phrases it — the same rule the Commerce secretary rests on,
// applied to the one table where breaking it would be fatal, because an ESG
// rating IS the product. A hallucinated inventory count is embarrassing; a
// hallucinated ESG score attached to a grant application is fraud.
//
// computeScores() is PURE: indicators and responses in, numbers out, no
// database, no clock, no randomness. That is what makes it testable against
// hand-computed fixtures in test/scoring-engine-test.js, and it is why the
// database access lives in scoreAssessment() further down.
// ═══════════════════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../db');

// Bumped whenever the arithmetic changes. Stamped onto every esg_scores row so
// a score can always be traced to the code that produced it.
const ENGINE_VERSION = '1.0.0';

// ── How an answer becomes a fraction of the indicator's weight ──────────────
// Used when the indicator has no rows in esg_indicator_options. Options in the
// database override this map, which is how a future framework can define its
// own scale without a code change.
//
// The CHECK constraint on esg_indicators.response_type and the keys of this map
// must agree. test/scoring-engine-test.js asserts that, because a response_type
// that reaches here with no branch would score every such indicator zero and
// nothing would throw.
const STANDARD_OPTIONS = Object.freeze({
  yes_no:         Object.freeze({ yes: 1, no: 0 }),
  yes_partial_no: Object.freeze({ yes: 1, partial: 0.5, no: 0 }),
  maturity_0_4:   Object.freeze({ 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 }),
});

// Response types that carry a number rather than an option.
//
// A quantitative indicator scores on DISCLOSURE, not on the value: full weight
// for a figure supplied, zero for a blank. Deliberately not a performance
// judgement — "is 42,000 kWh good?" is unanswerable without an industry and
// floor-area benchmark, and inventing a threshold would produce a confident
// number with nothing behind it. Benchmarking arrives as a separate module once
// there is a peer population to benchmark against; until then this platform
// scores whether a company KNOWS its numbers, which for an SME baseline is the
// honest thing to measure and the thing SEDG itself asks for.
const QUANTITATIVE_TYPES = Object.freeze(['quantitative']);

const PILLARS = Object.freeze(['E', 'S', 'G']);

function toNum(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Round half away from zero at 2dp. JS's default toFixed rounds 1.005 down
// because of binary representation; scores are compared against band cut-offs
// so a 0.01 drift at 84.995 is the difference between AA and AAA.
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve one response to a ratio of the indicator's weight, in [0,1].
 * Returns null when the indicator cannot be scored at all — which is NOT the
 * same as scoring zero, and the caller must keep them apart.
 */
function ratioFor(indicator, response, optionsByIndicator) {
  if (!response) return 0;                 // unanswered: earns nothing, still counts
  if (response.is_na) return null;         // not applicable: leaves the denominator

  const custom = optionsByIndicator.get(indicator.id);
  if (custom && custom.size > 0) {
    if (response.option_code == null) return 0;
    const r = custom.get(String(response.option_code));
    // An option_code the framework does not define is a data fault, not a zero.
    return r === undefined ? null : r;
  }

  if (QUANTITATIVE_TYPES.includes(indicator.response_type)) {
    const v = response.value_numeric;
    if (v === null || v === undefined || v === '') return 0;
    const n = toNum(v, NaN);
    if (!Number.isFinite(n) || n < 0) return 0;
    return 1;                              // disclosed — see the note above
  }

  const table = STANDARD_OPTIONS[indicator.response_type];
  // multi_select with no option rows lands here: unscorable, not zero.
  if (!table) return null;
  if (response.option_code == null) return 0;
  const r = table[String(response.option_code)];
  return r === undefined ? null : r;
}

/**
 * The conservativeness multiplier, applied to EARNED points only.
 *
 * Consequence, stated plainly because it is a design decision and not a bug:
 * a company whose answers are all self-declared cannot exceed 60.00 overall,
 * and one with documents behind every answer cannot exceed 85.00. Band AAA
 * ("Leading", 85+) is therefore unreachable without third-party verification.
 *
 * That is the point. This platform is a health screening that tells a company
 * where it stands BEFORE it pays for assurance; a screening that awards full
 * marks for unevidenced self-assessment is worth nothing to the buyer or bank
 * reading it, and would make the score actively misleading in exactly the
 * situation it exists for.
 */
function evidenceMultiplier(tier, scheme) {
  switch (tier) {
    case 'verified':   return toNum(scheme.mult_verified, 1);
    case 'documented': return toNum(scheme.mult_documented, 0.85);
    default:           return toNum(scheme.mult_self_declared, 0.6);
  }
}

/**
 * PURE. No I/O.
 *
 * @param {object[]} indicators  {id, code, pillar, response_type, weight}
 * @param {object[]} responses   {indicator_id, option_code, value_numeric, is_na, evidence_tier}
 * @param {object}   scheme      weighting scheme row
 * @param {object[]} bands       rating band rows for that scheme
 * @param {object[]} options     esg_indicator_options rows (may be empty)
 */
function computeScores({ indicators, responses, scheme, bands = [], options = [] }) {
  if (!scheme) throw new Error('computeScores: a weighting scheme is required');

  const byIndicator = new Map();
  for (const r of responses || []) byIndicator.set(r.indicator_id, r);

  const optionsByIndicator = new Map();
  for (const o of options || []) {
    if (!optionsByIndicator.has(o.indicator_id)) optionsByIndicator.set(o.indicator_id, new Map());
    optionsByIndicator.get(o.indicator_id).set(String(o.option_code), toNum(o.points_ratio, 0));
  }

  const perPillar = {};
  for (const p of PILLARS) {
    perPillar[p] = {
      pillar: p, earned: 0, available: 0,
      total: 0, answered: 0, na: 0, unscorable: 0,
      gaps: [],
    };
  }

  for (const ind of indicators || []) {
    const acc = perPillar[ind.pillar];
    if (!acc) continue;                    // pillar outside E/S/G: ignored, never silently folded in
    acc.total += 1;

    const resp   = byIndicator.get(ind.id) || null;
    const weight = toNum(ind.weight, 0);
    const ratio  = ratioFor(ind, resp, optionsByIndicator);

    if (ratio === null) {
      // Not applicable, or unscorable. Out of BOTH numerator and denominator —
      // charging a company zero for an emission source it does not have is the
      // single easiest way to make this score dishonest.
      if (resp && resp.is_na) acc.na += 1; else acc.unscorable += 1;
      continue;
    }

    if (resp && !resp.is_na) acc.answered += 1;

    const mult = resp ? evidenceMultiplier(resp.evidence_tier, scheme) : 0;
    acc.available += weight;
    acc.earned    += weight * ratio * mult;

    const missed = weight - (weight * ratio * mult);
    if (missed > 0.0001) {
      acc.gaps.push({
        indicator_id: ind.id,
        code:         ind.code,
        pillar:       ind.pillar,
        points_missed: round2(missed),
        answered:      Boolean(resp && !resp.is_na),
        evidence_tier: resp ? resp.evidence_tier : null,
      });
    }
  }

  const pillars = {};
  for (const p of PILLARS) {
    const a = perPillar[p];
    // available === 0 means NO SCORABLE INDICATOR, which is not a score of
    // zero. The caller must render these two states differently; `state` is
    // how it tells them apart without inferring from the number.
    const scorable = a.available > 0;
    const score = scorable ? round2(100 * (a.earned / a.available)) : 0;
    pillars[p] = {
      pillar: p,
      state: !scorable ? 'no_scorable_indicators'
           : a.answered === 0 ? 'unanswered'
           : 'scored',
      points_earned:    round2(a.earned),
      points_available: round2(a.available),
      score_0_100:      score,
      indicators_total:    a.total,
      indicators_answered: a.answered,
      indicators_na:       a.na,
      indicators_unscorable: a.unscorable,
      gaps: a.gaps.sort((x, y) => y.points_missed - x.points_missed),
    };
  }

  // Overall. Pillar weights are RENORMALISED over the pillars that are
  // actually scorable. If governance has no scorable indicators, E and S carry
  // 40/30 out of 70, not out of 100 — otherwise a missing pillar would silently
  // cap the overall score at 70 and look like poor performance rather than
  // missing content.
  const w = { E: toNum(scheme.weight_e, 0), S: toNum(scheme.weight_s, 0), G: toNum(scheme.weight_g, 0) };
  let wsum = 0, acc = 0;
  let earnedAll = 0, availAll = 0, totalAll = 0, answeredAll = 0, naAll = 0;
  for (const p of PILLARS) {
    const pp = pillars[p];
    totalAll += pp.indicators_total; answeredAll += pp.indicators_answered; naAll += pp.indicators_na;
    earnedAll += pp.points_earned;  availAll += pp.points_available;
    if (pp.state === 'no_scorable_indicators') continue;
    wsum += w[p];
    acc  += w[p] * pp.score_0_100;
  }
  const overallScore = wsum > 0 ? round2(acc / wsum) : 0;
  const overallState = wsum === 0 ? 'no_scorable_indicators'
                     : answeredAll === 0 ? 'unanswered'
                     : 'scored';

  return Object.freeze({
    engine_version: ENGINE_VERSION,
    pillars,
    overall: {
      scope: 'OVERALL',
      state: overallState,
      score_0_100:      overallScore,
      points_earned:    round2(earnedAll),
      points_available: round2(availAll),
      // A band is a claim about performance. An unanswered assessment gets no
      // band rather than "CCC", because "CCC" reads as "we assessed you and you
      // did badly" when the truth is "you have not filled this in".
      band_code: overallState === 'scored' ? bandFor(overallScore, bands) : null,
      indicators_total:    totalAll,
      indicators_answered: answeredAll,
      indicators_na:       naAll,
    },
  });
}

function bandFor(score, bands) {
  for (const b of bands || []) {
    if (score >= toNum(b.min_score, 0) && score <= toNum(b.max_score, 100)) return b.band_code;
  }
  return null;
}

// ── Database side ──────────────────────────────────────────────────────────

async function loadActiveScheme() {
  const { rows } = await query(
    `SELECT id, version, weight_e, weight_s, weight_g,
            mult_self_declared, mult_documented, mult_verified
       FROM esg_weighting_schemes WHERE is_active LIMIT 1`);
  if (!rows[0]) throw new Error('No active weighting scheme — seed.sql has not run');
  return rows[0];
}

/**
 * Score one assessment and persist the result.
 *
 * Refuses any framework whose kind is not 'entity_disclosure'. Verra's VCS is
 * registered as 'project_crediting' precisely so this guard catches an attempt
 * to score a company against it — see docs/VERRA_BENCHMARK.md.
 */
async function scoreAssessment(assessmentId) {
  const { rows: aRows } = await query(
    `SELECT a.id, a.framework_id, a.framework_version, a.weighting_scheme_id,
            f.framework_kind, f.code AS framework_code
       FROM esg_assessments a
       JOIN esg_frameworks f ON f.id = a.framework_id
      WHERE a.id = $1`, [assessmentId]);
  const assessment = aRows[0];
  if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);
  if (assessment.framework_kind !== 'entity_disclosure') {
    throw new Error(
      `Refusing to score against ${assessment.framework_code}: it is a ` +
      `${assessment.framework_kind} framework, not an entity disclosure framework.`);
  }

  const [{ rows: indicators }, { rows: responses }, { rows: options }] = await Promise.all([
    query(`SELECT id, code, pillar, response_type, weight
             FROM esg_indicators WHERE framework_id = $1 AND is_active ORDER BY sort_order`,
          [assessment.framework_id]),
    query(`SELECT indicator_id, option_code, value_numeric, is_na, evidence_tier
             FROM esg_responses WHERE assessment_id = $1`, [assessmentId]),
    query(`SELECT o.indicator_id, o.option_code, o.points_ratio
             FROM esg_indicator_options o
             JOIN esg_indicators i ON i.id = o.indicator_id
            WHERE i.framework_id = $1`, [assessment.framework_id]),
  ]);

  const { rows: schemeRows } = await query(
    `SELECT id, version, weight_e, weight_s, weight_g,
            mult_self_declared, mult_documented, mult_verified
       FROM esg_weighting_schemes WHERE id = $1`, [assessment.weighting_scheme_id]);
  const scheme = schemeRows[0] || await loadActiveScheme();

  const { rows: bands } = await query(
    `SELECT band_code, min_score, max_score FROM esg_rating_bands
      WHERE scheme_id = $1 ORDER BY sort_order`, [scheme.id]);

  const result = computeScores({ indicators, responses, scheme, bands, options });

  await withTransaction(async (client) => {
    const write = (scope, s, band) => client.query(
      `INSERT INTO esg_scores
         (assessment_id, scope, points_earned, points_available, score_0_100,
          band_code, indicators_total, indicators_answered, indicators_na,
          weighting_version, framework_version, engine_version, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (assessment_id, scope) DO UPDATE SET
         points_earned = EXCLUDED.points_earned,
         points_available = EXCLUDED.points_available,
         score_0_100 = EXCLUDED.score_0_100,
         band_code = EXCLUDED.band_code,
         indicators_total = EXCLUDED.indicators_total,
         indicators_answered = EXCLUDED.indicators_answered,
         indicators_na = EXCLUDED.indicators_na,
         weighting_version = EXCLUDED.weighting_version,
         framework_version = EXCLUDED.framework_version,
         engine_version = EXCLUDED.engine_version,
         computed_at = now()`,
      [assessmentId, scope, s.points_earned, s.points_available, s.score_0_100,
       band || null, s.indicators_total, s.indicators_answered, s.indicators_na,
       scheme.version, assessment.framework_version, ENGINE_VERSION]);

    for (const p of PILLARS) await write(p, result.pillars[p], null);
    await write('OVERALL', result.overall, result.overall.band_code);

    // Engine-authored recommendations. source = 'engine': the points are
    // arithmetic. The AI layer later ADDS rows with source = 'ai_phrasing'
    // that carry prose, and those rows never carry a points figure the model
    // produced — they copy points_missed from here.
    await client.query(`DELETE FROM esg_recommendations WHERE assessment_id = $1 AND source = 'engine'`, [assessmentId]);
    const gaps = PILLARS.flatMap((p) => result.pillars[p].gaps);
    const maxMissed = gaps.reduce((m, g) => Math.max(m, g.points_missed), 0);
    for (const g of gaps.slice(0, 40)) {
      const priority = maxMissed === 0 ? 'low'
                     : g.points_missed >= maxMissed * 0.66 ? 'high'
                     : g.points_missed >= maxMissed * 0.33 ? 'medium' : 'low';
      await client.query(
        `INSERT INTO esg_recommendations
           (assessment_id, indicator_id, pillar, points_missed, priority, source)
         VALUES ($1,$2,$3,$4,$5,'engine')`,
        [assessmentId, g.indicator_id, g.pillar, g.points_missed, priority]);
    }

    await client.query(
      `UPDATE esg_assessments SET status = CASE WHEN status = 'draft' THEN 'draft' ELSE 'scored' END,
              scored_at = now() WHERE id = $1`, [assessmentId]);
  });

  return result;
}

module.exports = {
  ENGINE_VERSION,
  STANDARD_OPTIONS,
  PILLARS,
  computeScores,
  scoreAssessment,
  loadActiveScheme,
  bandFor,
  round2,
};

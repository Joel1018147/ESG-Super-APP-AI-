'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN FINANCE READINESS — the engine                          (Run 62/P6.5)
   ───────────────────────────────────────────────────────────────────────────
   THE ONE RULE THIS FILE EXISTS TO ENFORCE:

       MISSING IS NOT ZERO.

   A company that has not told us its repayment history has not FAILED a
   repayment-history check. Scoring it 0/6 and dividing by 100 produces a number
   that looks like a judgement and is actually an absence — and that number
   would be put in front of a bank. So every criterion reports THREE figures:

       earned      points the company demonstrably holds
       assessable  points the platform could actually evaluate at all
       weight      the ceiling in the model

   `earned / assessable` is a real ratio about things that were checked.
   `earned / weight` would be a lie whenever anything is missing. The service
   returns all three and refuses to publish a single headline percentage unless
   every criterion was assessable.

   WHAT THIS IS NOT. Not a bank's score, not an eligibility decision, not a
   prediction. financeCopy.DISCLAIMER carries that wording and every surface
   renders it.

   NOTHING HERE WRITES. The engine reads; a readiness result is derived on
   demand and stamped with MODEL_VERSION, so a weight change cannot silently
   reinterpret a figure a company already wrote down.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const model = require('./readinessModel');

const { READINESS_STATES: S } = model;

/** One input's verdict.
 *
 *  `assessable:false` is the load-bearing case: the platform had nothing to
 *  look at, so this input contributes to NEITHER side of the ratio. It is not
 *  a zero score, and `earned` must stay 0 alongside it. */
function verdict(def, { earned = 0, assessable, state, detail }) {
  return Object.freeze({
    code: def.code,
    label: def.label,
    points: def.points,
    earned: assessable ? earned : 0,
    assessable: Boolean(assessable),
    state,                 // one of model.INPUT_STATES
    detail: detail || null,
  });
}

/** An input the platform cannot see at all. */
const notAvailable = (def, detail) =>
  verdict(def, { assessable: false, state: 'missing', detail });

/** A yes/no input the platform CAN see. `has` decides the points. */
const measured = (def, has, state, detail) =>
  verdict(def, { earned: has ? def.points : 0, assessable: true, state, detail });

/** A proportional input — earns its share, and is only assessable when there
 *  is a denominator to take a share OF. */
function proportional(def, done, total, state, detail) {
  if (!total) return notAvailable(def, detail || 'Nothing to measure against yet');
  const ratio = Math.max(0, Math.min(1, done / total));
  return verdict(def, {
    earned: Math.round(def.points * ratio * 10) / 10,
    assessable: true, state, detail,
  });
}

const defOf = (criterion, code) => criterion.inputs.find((i) => i.code === code);

/* ── The facts, in one pass ───────────────────────────────────────────────
   Every statement carries the company predicate. esg_responses, esg_scores and
   esg_green_project_baselines have no company_id of their own and are scoped
   through the parent that does. */
async function gather(companyId) {
  const [company, fin, projects, baselines, carbon, scores, docs, responses] = await Promise.all([
    query(`SELECT id, annual_revenue_myr, employee_count, ssm_number, msic_code
             FROM esg_companies WHERE id = $1`, [companyId]),
    query(`SELECT input_code, value_numeric, value_text, value_bool, value_date, state, source
             FROM esg_finance_inputs WHERE company_id = $1`, [companyId]),
    query(`SELECT id, project_type_id, estimated_cost_myr, ccpt_category_code, status
             FROM esg_green_projects WHERE company_id = $1`, [companyId]),
    query(`SELECT count(*)::int AS n
             FROM esg_green_project_baselines b
             JOIN esg_green_projects p ON p.id = b.project_id
            WHERE p.company_id = $1`, [companyId]),
    query(`SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE is_provisional)::int AS provisional
             FROM esg_carbon_entries WHERE company_id = $1`, [companyId]),
    query(`SELECT s.scope, s.score_0_100
             FROM esg_scores s
             JOIN esg_assessments a ON a.id = s.assessment_id
            WHERE a.company_id = $1 AND a.status <> 'archived'
            ORDER BY s.computed_at DESC`, [companyId]),
    query(`SELECT count(*)::int AS n FROM esg_documents WHERE company_id = $1`, [companyId]),
    query(`SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE r.document_id IS NOT NULL)::int AS documented
             FROM esg_responses r
             JOIN esg_assessments a ON a.id = r.assessment_id
            WHERE a.company_id = $1 AND a.status <> 'archived'`, [companyId]),
  ]);

  const byScope = {};
  for (const row of scores.rows) if (!byScope[row.scope]) byScope[row.scope] = row;

  return {
    company: company.rows[0] || null,
    finance: Object.fromEntries(fin.rows.map((r) => [r.input_code, r])),
    projects: projects.rows,
    baselines: baselines.rows[0].n,
    carbon: carbon.rows[0],
    scores: byScope,
    documents: docs.rows[0].n,
    responses: responses.rows[0],
  };
}

/* ── The criteria ─────────────────────────────────────────────────────────
   One evaluator per criterion code. Each returns the verdict for every input
   the MODEL declares, so a model change cannot leave an input silently
   unevaluated — evaluate() asserts the two lists match. */
const EVALUATORS = {
  financial_bankability(c, f) {
    const stored = (code) => f.finance[code];
    const boolInput = (code) => {
      const def = defOf(c, code);
      const row = stored(code);
      if (!row) return notAvailable(def, 'Not supplied yet');
      if (row.state === 'not_applicable') return verdict(def, { assessable: false, state: 'not_applicable', detail: 'Marked not applicable' });
      if (row.state === 'declined') return verdict(def, { assessable: false, state: 'missing', detail: 'The company chose not to say' });
      return measured(def, row.value_bool === true, row.state === 'verified' ? 'verified' : 'provided',
        row.value_bool === true ? 'Confirmed' : 'Recorded as not held');
    };
    return [
      // The ONE financial figure this schema already holds.
      (() => {
        const def = defOf(c, 'annual_revenue');
        const v = f.company && f.company.annual_revenue_myr;
        return (v === null || v === undefined)
          ? notAvailable(def, 'No revenue recorded on the company profile')
          : measured(def, Number(v) > 0, 'provided', 'From the company profile');
      })(),
      (() => {
        const def = defOf(c, 'incorporation_date');
        const row = stored('incorporation_date');
        return row && row.value_date
          ? measured(def, true, row.state === 'verified' ? 'verified' : 'provided', 'Supplied')
          : notAvailable(def, 'Not supplied yet');
      })(),
      boolInput('audited_statements'),
      boolInput('management_accounts'),
      boolInput('profitable_last_year'),
      boolInput('existing_borrowings'),
      boolInput('repayment_history'),
    ];
  },

  green_project(c, f) {
    const p = f.projects[0] || null;
    return [
      measured(defOf(c, 'project_defined'), f.projects.length > 0, f.projects.length ? 'provided' : 'missing',
        f.projects.length ? `${f.projects.length} project(s) defined` : 'No project defined yet'),
      p ? measured(defOf(c, 'project_type'), Boolean(p.project_type_id), 'provided',
        p.project_type_id ? 'A type is set' : 'No type set')
        : notAvailable(defOf(c, 'project_type'), 'No project to type'),
      p ? measured(defOf(c, 'project_cost'), p.estimated_cost_myr !== null && p.estimated_cost_myr !== undefined, 'provided',
        p.estimated_cost_myr ? 'An estimated cost is recorded' : 'No cost estimated')
        : notAvailable(defOf(c, 'project_cost'), 'No project to cost'),
      p ? measured(defOf(c, 'project_classified'), Boolean(p.ccpt_category_code), 'provided',
        p.ccpt_category_code ? 'Classified against a published taxonomy' : 'Not classified yet')
        : notAvailable(defOf(c, 'project_classified'), 'No project to classify'),
    ];
  },

  carbon_esg_data(c, f) {
    const n = f.carbon.n;
    return [
      measured(defOf(c, 'carbon_entries'), n > 0, n ? 'provided' : 'missing',
        n ? `${n} entries recorded` : 'No carbon data recorded'),
      n ? proportional(defOf(c, 'carbon_not_provisional'), n - f.carbon.provisional, n, 'provided',
        f.carbon.provisional ? `${f.carbon.provisional} of ${n} use a placeholder factor` : 'All entries use sourced factors')
        : notAvailable(defOf(c, 'carbon_not_provisional'), 'No carbon entries to assess'),
      measured(defOf(c, 'project_baseline'), f.baselines > 0, f.baselines ? 'provided' : 'missing',
        f.baselines ? `${f.baselines} baseline(s) computed` : 'No project baseline computed'),
      f.scores.E
        ? measured(defOf(c, 'environmental_score'), true, 'verified', `Environmental score ${Math.round(f.scores.E.score_0_100)}`)
        : notAvailable(defOf(c, 'environmental_score'), 'The assessment has not been scored'),
    ];
  },

  governance(c, f) {
    const g = f.scores.G;
    return [
      // The SCORE ITSELF earns the points, proportionally — a governance score
      // of 76 is not the same fact as "a governance score exists".
      g ? proportional(defOf(c, 'governance_score'), Number(g.score_0_100), 100, 'verified',
        `Governance score ${Math.round(g.score_0_100)} of 100, from the scoring engine`)
        : notAvailable(defOf(c, 'governance_score'), 'The assessment has not been scored'),
      f.responses.n
        ? proportional(defOf(c, 'governance_evidenced'), f.responses.documented, f.responses.n, 'provided',
          `${f.responses.documented} of ${f.responses.n} answers carry a document`)
        : notAvailable(defOf(c, 'governance_evidenced'), 'No answers recorded'),
    ];
  },

  business_sustainability(c, f) {
    // THE PLATFORM CANNOT DERIVE EITHER OF THESE — it stores one revenue figure
    // and no incorporation date, so there is no trading history to compute from.
    // A COMPANY CAN STILL STATE THEM, and then they are assessable: the first
    // draft returned "not available" unconditionally, which meant a company that
    // had supplied its trading history was told the platform had no idea. The
    // gap is in what the platform can DERIVE, not in what it can be TOLD.
    const years = f.finance.trading_years;
    const trend = f.finance.revenue_trend;
    const yearsDef = defOf(c, 'trading_years');
    const trendDef = defOf(c, 'revenue_trend');
    return [
      years && years.value_numeric !== null && years.value_numeric !== undefined
        ? proportional(yearsDef, Math.min(Number(years.value_numeric), 3), 3,
          years.state === 'verified' ? 'verified' : 'provided',
          `${Number(years.value_numeric)} year(s) of trading stated; three or more earns the full points`)
        : notAvailable(yearsDef, 'Not supplied, and the platform holds no incorporation date to derive it from'),
      trend && trend.value_text
        ? measured(trendDef, String(trend.value_text).toLowerCase() === 'up',
          trend.state === 'verified' ? 'verified' : 'provided',
          `Revenue reported as ${String(trend.value_text)}`)
        : notAvailable(trendDef, 'Not supplied, and the platform stores only one year of revenue'),
    ];
  },

  reporting_readiness(c, f) {
    return [
      measured(defOf(c, 'assessment_scored'), Boolean(f.scores.OVERALL), f.scores.OVERALL ? 'verified' : 'missing',
        f.scores.OVERALL ? 'An assessment has been scored' : 'No scored assessment'),
      measured(defOf(c, 'documents_uploaded'), f.documents > 0, f.documents ? 'provided' : 'missing',
        f.documents ? `${f.documents} document(s) on file` : 'No documents uploaded'),
      f.responses.n
        ? proportional(defOf(c, 'answers_documented'), f.responses.documented, f.responses.n, 'provided',
          `${f.responses.documented} of ${f.responses.n} answers carry a document`)
        : notAvailable(defOf(c, 'answers_documented'), 'No answers recorded'),
    ];
  },
};

function evaluate(facts) {
  return model.CRITERIA.map((c) => {
    const fn = EVALUATORS[c.code];
    if (!fn) throw new Error(`readiness model declares criterion "${c.code}" with no evaluator`);
    const inputs = fn(c, facts);

    // A model change that adds an input must not leave it silently unscored.
    const declared = c.inputs.map((i) => i.code).sort();
    const evaluated = inputs.map((i) => i.code).sort();
    if (declared.join('|') !== evaluated.join('|')) {
      throw new Error(`criterion "${c.code}" evaluated [${evaluated}] but the model declares [${declared}]`);
    }

    const assessable = inputs.filter((i) => i.assessable).reduce((n, i) => n + i.points, 0);
    const earned = inputs.reduce((n, i) => n + i.earned, 0);
    const missing = inputs.filter((i) => !i.assessable);

    return Object.freeze({
      code: c.code,
      name: c.name,
      weight: c.weight,
      explanation: c.explanation,
      earned: Math.round(earned * 10) / 10,
      assessable,
      // DATA_REQUIRED means nothing here could be looked at. It is not a score.
      status: assessable === 0 ? 'data_required'
        : (missing.length ? 'partially_assessed' : 'assessed'),
      inputs: Object.freeze(inputs),
      missingData: Object.freeze(missing.map((i) => ({ code: i.code, label: i.label, points: i.points, why: i.detail }))),
    });
  });
}

/** The readiness of one company, as far as the platform can honestly tell.
 *
 *  Returns null for no company rather than a zeroed result — "we do not know
 *  which company" and "this company scores nothing" are different answers. */
async function calculate(companyId) {
  if (!companyId) return null;
  const facts = await gather(companyId);
  if (!facts.company) return null;

  const criteria = evaluate(facts);
  const maximum = model.CRITERIA.reduce((n, c) => n + c.weight, 0);
  const assessable = criteria.reduce((n, c) => n + c.assessable, 0);
  const earned = Math.round(criteria.reduce((n, c) => n + c.earned, 0) * 10) / 10;

  // THE HEADLINE IS ONLY A HEADLINE WHEN EVERYTHING WAS ASSESSABLE. Below that
  // the UI is handed earned/assessable and the size of the gap, and must say
  // so rather than dividing by 100.
  let status;
  if (assessable === 0) status = S.NOT_CONFIGURED;
  else if (assessable < maximum * 0.5) status = S.INSUFFICIENT_DATA;
  else if (assessable < maximum) status = S.PARTIALLY_ASSESSED;
  else status = S.CALCULATED;

  const missingData = criteria.flatMap((c) =>
    c.missingData.map((m) => ({ criterion: c.code, criterionName: c.name, ...m })));

  return Object.freeze({
    modelVersion: model.MODEL_VERSION,
    status,
    earned,
    assessable,
    maximum,
    // Present ONLY when every criterion could be evaluated. Null is not zero.
    score: status === S.CALCULATED ? earned : null,
    criteria: Object.freeze(criteria),
    missingData: Object.freeze(missingData),
    recommendations: Object.freeze(recommend(criteria, missingData)),
  });
}

/** What would move readiness, ordered by the points it would unlock.
 *
 *  Derived from the model's own point values — no model writes this text and
 *  no number here is invented. */
function recommend(criteria, missingData) {
  const byPoints = [...missingData].sort((a, b) => b.points - a.points).slice(0, 4);
  const out = byPoints.map((m) => ({
    points: m.points,
    criterion: m.criterionName,
    action: `Supply ${m.label.toLowerCase()}`,
    why: m.why || 'The platform has nothing recorded for this yet',
  }));
  // Points that are assessable and simply not earned are a different kind of
  // advice: the data is there and the answer is no.
  for (const c of criteria) {
    const shortfall = c.assessable - c.earned;
    if (c.assessable > 0 && shortfall >= 3) {
      out.push({
        points: Math.round(shortfall * 10) / 10,
        criterion: c.name,
        action: `Strengthen ${c.name.toLowerCase()}`,
        why: `${Math.round(c.earned * 10) / 10} of ${c.assessable} assessable points earned`,
      });
    }
  }
  return out.slice(0, 6);
}

module.exports = { calculate, evaluate, gather, MODEL_VERSION: model.MODEL_VERSION };

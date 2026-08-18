'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   REPORTING READINESS — WHAT A REPORT COULD BE MADE OF            (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   THERE IS NO REPORT GENERATOR ON THIS PLATFORM, AND P9 DID NOT BUILD ONE.

   That is the first sentence of this file because it is the first sentence of
   the page it drives. The directive is explicit — do not build a fake report
   generator — and a "Download PDF" button that produces a stub is worse than
   no button, for the reason §4.3c of the UI contract gives: the user believes
   the capability exists and stops looking for it.

   What P9 built is the OTHER half of the question, which is genuinely useful
   and genuinely answerable: if a report were assembled today, what would be in
   it, what would be missing, and what could not be in it at all?

   ── THREE STATES PER SECTION, AND THEY ARE NOT DEGREES OF THE SAME THING ──
     available        rows exist. The count is real and names its table.
     missing          the platform CAN hold this and this company has none.
                      An empty account, and the company can change it.
     not_configured   the PLATFORM cannot produce this for anyone. Not a gap in
                      the company's data and never a zero.

   CLAUDE.md #8 is the same rule one level up: uninstrumented, instrumented-
   but-empty and genuinely zero must never render the same way.

   NOTHING HERE WRITES, AND NOTHING HERE CALLS A MODEL.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const readinessService = require('./readinessService');

const STATES = Object.freeze(['available', 'missing', 'not_configured']);

const STATE_WORD = Object.freeze({
  available:      'Available',
  missing:        'Nothing recorded',
  not_configured: 'Not configured',
});

function section({ code, name, state, what, count = null, unit = null, source = [], why = null }) {
  if (!STATES.includes(state)) throw new Error(`reportReadiness: "${state}" is not a section state`);
  if (!what || !String(what).trim()) {
    throw new Error(`reportReadiness: section "${code}" does not say what it holds`);
  }
  return Object.freeze({ code, name, state, what, count, unit, why, source: Object.freeze([...source]) });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE READ — one wave, every statement company-scoped
   ═══════════════════════════════════════════════════════════════════════════ */
async function gather(companyId, assessmentId) {
  const [
    { rows: company }, { rows: score }, { rows: responses }, { rows: carbon },
    { rows: docs }, { rows: projects }, { rows: measurements },
  ] = await Promise.all([
    query(
      `SELECT (CASE WHEN name IS NOT NULL AND btrim(name) <> '' THEN 1 ELSE 0 END
             + CASE WHEN ssm_number     IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN msic_code      IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN employee_count IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN grid_region    IS NOT NULL THEN 1 ELSE 0 END)::int AS profile_filled
         FROM esg_companies WHERE id = $1`, [companyId]),

    query(
      `SELECT s.scope, s.score_0_100, s.band_code, s.weighting_version, s.framework_version,
              s.computed_at
         FROM esg_scores s
         JOIN esg_assessments a ON a.id = s.assessment_id
        WHERE a.company_id = $1 AND s.assessment_id = $2 AND s.scope = 'OVERALL'`,
      [companyId, assessmentId || null]),

    query(
      `SELECT count(*)::int AS answers_total,
              count(*) FILTER (WHERE r.is_na)::int AS answers_na,
              count(*) FILTER (WHERE r.evidence_tier = 'documented')::int AS answers_documented,
              count(*) FILTER (WHERE r.evidence_tier = 'verified')::int   AS answers_verified,
              count(*) FILTER (WHERE r.evidence_tier = 'self_declared' AND NOT r.is_na)::int AS answers_declared
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
        WHERE a.company_id = $1 AND r.assessment_id = $2`, [companyId, assessmentId || null]),

    query(
      `SELECT count(*)::int AS carbon_entries,
              count(*) FILTER (WHERE is_provisional)::int AS carbon_provisional
         FROM esg_carbon_entries WHERE company_id = $1`, [companyId]),

    query(
      `SELECT count(*)::int AS report_docs_total,
              count(*) FILTER (WHERE text_status = 'extracted')::int AS report_docs_read
         FROM esg_documents WHERE company_id = $1`, [companyId]),

    query(
      `SELECT count(*)::int AS report_projects_total,
              count(*) FILTER (WHERE expected_benefit_value IS NOT NULL)::int AS report_projects_forecast
         FROM esg_green_projects WHERE company_id = $1`, [companyId]),

    query(
      `SELECT count(*) FILTER (WHERE b.kind = 'baseline')::int AS report_baselines,
              count(*) FILTER (WHERE b.kind = 'actual')::int   AS report_actuals,
              count(*) FILTER (WHERE b.kind = 'actual' AND b.verified_at IS NOT NULL)::int AS report_verified
         FROM esg_green_project_baselines b
         JOIN esg_green_projects p ON p.id = b.project_id
        WHERE p.company_id = $1`, [companyId]),
  ]);

  /* EVERY ALIAS ABOVE IS UNIQUE ACROSS THIS REPO'S QUERIES. dashboard-test.js
     answers a query by matching its SQL against an ordered fixture table, so
     two aggregates that both select `AS total` are two queries the harness
     cannot tell apart — it hands one of them the other's row and the page
     renders a confident figure from the wrong table. The mapping back to
     short names happens here, once. */
  const c = company[0];
  const r = responses[0];
  const cb = carbon[0];
  const d = docs[0];
  const p = projects[0];
  const m = measurements[0];
  return {
    // A company row that does not exist is not a company with nothing filled
    // in, so this is the one place a missing row is tolerated — assess() is
    // only ever called with a company id that authenticated.
    company: { filled: c ? c.profile_filled : 0 },
    score: score[0] || null,
    responses: { total: r.answers_total, na: r.answers_na, documented: r.answers_documented,
      verified: r.answers_verified, declared: r.answers_declared },
    carbon: { entries: cb.carbon_entries, provisional: cb.carbon_provisional },
    docs: { total: d.report_docs_total, read_ok: d.report_docs_read },
    projects: { total: p.report_projects_total, forecast: p.report_projects_forecast },
    measurements: { baselines: m.report_baselines, actuals: m.report_actuals,
      verified: m.report_verified },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSESS
   ═══════════════════════════════════════════════════════════════════════════ */

const PROFILE_FIELDS = 5;   // the same five journeyEngine counts. One number.

/**
 * What a report could draw on, section by section.
 *
 * Returns null for no company. The `generator` block is the point of the whole
 * object and is deliberately not derived from anything: nothing in this
 * codebase writes a report file, so it is a stated constant rather than a
 * computed state that could one day flip on by accident.
 */
async function assess(companyId, assessmentId) {
  if (!companyId) return null;

  const [f, ready] = await Promise.all([
    gather(companyId, assessmentId),
    readinessService.calculate(companyId),
  ]);

  const sections = [
    section({
      code: 'PROFILE',
      name: 'Company information',
      state: f.company.filled > 0 ? 'available' : 'missing',
      count: f.company.filled,
      unit: `of ${PROFILE_FIELDS} recordable fields`,
      what: f.company.filled >= PROFILE_FIELDS
        ? 'Every profile field this platform can record is filled in.'
        : `${f.company.filled} of ${PROFILE_FIELDS} profile fields are recorded. Industry, state `
          + 'and ESG maturity are read by the AI scan and nothing on this platform writes them.',
      source: ['esg_companies'],
    }),

    section({
      code: 'SCORE',
      name: 'ESG assessment and score',
      state: f.score ? 'available' : 'missing',
      what: f.score
        ? `An overall score of ${Math.round(Number(f.score.score_0_100))} in band `
          + `${f.score.band_code}, computed at weighting version ${f.score.weighting_version} `
          + `against framework version ${f.score.framework_version}.`
        : 'No score exists. A report cannot state a position the platform has not computed, and '
          + 'nothing here will estimate one.',
      source: ['esg_scores'],
    }),

    section({
      code: 'ANSWERS',
      name: 'Answers and their evidence',
      state: f.responses.total > 0 ? 'available' : 'missing',
      count: f.responses.total,
      unit: 'answers on file',
      what: f.responses.total > 0
        ? `${f.responses.verified} verified, ${f.responses.documented} documented, `
          + `${f.responses.declared} self-declared, ${f.responses.na} not applicable. A report `
          + 'that flattened those four into "answered" would be a weaker document than the data '
          + 'behind it.'
        : 'No answer has been recorded, so there is nothing to disclose and nothing to evidence.',
      source: ['esg_responses'],
    }),

    section({
      code: 'EVIDENCE',
      name: 'Supporting documents',
      state: f.docs.total > 0 ? 'available' : 'missing',
      count: f.docs.total,
      unit: 'documents',
      what: f.docs.total > 0
        ? `${f.docs.read_ok} of ${f.docs.total} have had their text extracted. The files `
          + 'themselves are held in the database, so a report could reference them by name.'
        : 'No document has been uploaded. Every answer would therefore be self-declared.',
      source: ['esg_documents'],
    }),

    section({
      code: 'CARBON',
      name: 'Carbon inventory',
      state: f.carbon.entries > 0 ? 'available' : 'missing',
      count: f.carbon.entries,
      unit: 'entries',
      what: f.carbon.entries > 0
        ? `${f.carbon.entries} entries${f.carbon.provisional
          ? `, ${f.carbon.provisional} of them resting on an unverified emission factor and marked provisional`
          : ', every one on a stamped emission factor'}. Each entry stamps the factor it used, `
          + 'so a figure in a report stays the figure it was.'
        : 'No electricity, diesel or petrol entry has been recorded, so there is no inventory to '
          + 'report.',
      source: ['esg_carbon_entries'],
    }),

    section({
      code: 'PROJECTS',
      name: 'Green projects',
      state: f.projects.total > 0 ? 'available' : 'missing',
      count: f.projects.total,
      unit: 'projects',
      what: f.projects.total > 0
        ? `${f.projects.total} defined, ${f.projects.forecast} of them stating an expected `
          + 'benefit. An expected benefit is a forecast and a report would have to label it one.'
        : 'No project is defined.',
      source: ['esg_green_projects'],
    }),

    section({
      code: 'IMPACT',
      name: 'Impact measurements',
      state: f.measurements.actuals > 0 || f.measurements.baselines > 0 ? 'available' : 'missing',
      count: f.measurements.actuals,
      unit: 'actual readings',
      what: (f.measurements.baselines || f.measurements.actuals)
        ? `${f.measurements.baselines} baseline${f.measurements.baselines === 1 ? '' : 's'} and `
          + `${f.measurements.actuals} actual reading${f.measurements.actuals === 1 ? '' : 's'}, of `
          + `which ${f.measurements.verified} ${f.measurements.verified === 1 ? 'has' : 'have'} been `
          + 'confirmed by a person. Measured and verified would appear as different claims.'
        : 'Nothing has been measured. A report could state an expectation and could not state an '
          + 'impact.',
      source: ['esg_green_project_baselines'],
    }),

    section({
      code: 'READINESS',
      name: 'Green finance readiness',
      state: !ready || ready.status === 'not_configured' ? 'not_configured' : 'available',
      what: !ready
        ? 'The readiness model is defined and nothing could be read for this company.'
        : ready.status === 'not_configured'
          ? 'Not one criterion in the readiness model had anything to look at.'
          : ready.status === 'calculated'
            ? `A calculated readiness figure of ${Math.round(ready.score)} out of ${ready.maximum}, `
              + 'which is a readiness assessment and never a financing approval.'
            : `${ready.earned} of ${ready.assessable} assessable points earned, with `
              + `${ready.maximum - ready.assessable} of ${ready.maximum} not assessable. A report `
              + 'would have to carry both figures, not the first divided by the maximum.',
      source: ['esg_finance_inputs'],
    }),

    /* ── The three that cannot be in a report at all ──────────────────────
       These are NOT_CONFIGURED at the platform level and always will be until
       someone publishes the missing methodology. They are listed rather than
       omitted, because a report section a company expects and does not find is
       a question they will ask, and the answer belongs here. */
    section({
      code: 'SUSTNET',
      name: 'Contribution to SustNET\'s mission pillars',
      state: 'not_configured',
      what: 'This platform cannot state a contribution level for any company.',
      why: 'SustNET publishes no methodology mapping company activity to its four mission '
         + 'pillars. Until one exists in writing, a contribution figure would be this product '
         + 'attributing a mapping to an organisation that has authored none.',
      source: [],
    }),

    section({
      code: 'CERTIFICATION',
      name: 'Certification status',
      state: 'not_configured',
      what: 'This platform assesses; it does not certify, and it will not render a certificate.',
      why: 'No SustNET ESG certification scheme is published. An ESG score is not a certification '
         + 'and a report that implied otherwise would be the most damaging sentence in it.',
      source: [],
    }),

    section({
      code: 'ASSURANCE',
      name: 'Independent assurance statement',
      state: 'not_configured',
      what: 'Nothing on this platform is independently assured.',
      why: 'An assurance statement is signed by a third party this platform has no relationship '
         + 'with. What it can show is the evidence tier behind each answer, which is a weaker and '
         + 'true claim rather than a stronger and false one.',
      source: [],
    }),
  ];

  const counts = STATES.reduce((acc, s) => {
    acc[s] = sections.filter((x) => x.state === s).length;
    return acc;
  }, {});

  return Object.freeze({
    sections: Object.freeze(sections),
    counts: Object.freeze(counts),
    /* THE GENERATOR. A stated constant, not a computed state — see the header.
       The day something in this codebase writes a report file, this changes
       HERE and the page follows, and test/report-readiness-test.js asserts
       that no such writer exists while it says false. */
    generator: Object.freeze({
      built: false,
      formats: Object.freeze([]),
      detail: 'No route, service or template in this codebase produces a report file in any '
            + 'format. Everything above is what one would be assembled from; assembling it is '
            + 'not built, and this page will not offer a button that produces a stub.',
    }),
  });
}

module.exports = { assess, gather, section, STATES, STATE_WORD, PROFILE_FIELDS };

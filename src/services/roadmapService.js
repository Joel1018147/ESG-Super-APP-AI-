'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPROVEMENT ROADMAP                                         (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   The product's whole thesis, as ONE object a company can read top to bottom:

       ESG POSITION → PRIORITY GAP → ACTION → POTENTIAL OPPORTUNITY
                    → GREEN PROJECT → FINANCE READINESS
                    → EXPECTED IMPACT → BASELINE → MEASURED → VERIFIED

   ── THE RULE THAT SHAPES THIS ENTIRE FILE ────────────────────────────────
   THE UI MAY CONNECT. IT MAY NOT INVENT.

   Every step below carries `link`, which says WHAT KIND of connection joins it
   to the step before:

     'derived'    the platform computed this FROM the previous step. The
                  strongest claim available, and it is only made where one
                  service genuinely reads the other's rows.
     'recorded'   a column joins the two rows. source_opportunity_id is the
                  only one of these, and P9 added it because the link already
                  existed in fact and nothing was writing it down.
     'sequence'   these two steps are ADJACENT IN THE PRODUCT and nothing joins
                  them. This is the honest label for gap → opportunity, and it
                  is the label most of this roadmap carries.
     'none'       nothing establishes this connection at all.

   A step never claims 'derived' because it would read well. The suite asserts
   the link kind of every step against what the schema can actually support, so
   upgrading one requires a column, not an edit here.

   ── WHAT IS DELIBERATELY NOT CLAIMED ─────────────────────────────────────
   · An ESG gap does not cause a green project. The AI scan is given the
     company profile, the carbon categories on file and whether each indicator
     is answered — it is NOT given the gaps, is not told which one matters, and
     is never asked to name one. So the roadmap says the suggestion is for the
     COMPANY, and never that it answers the gap above it.
   · A project does not make a company eligible for anything. Readiness is a
     readiness assessment; financeCopy.DISCLAIMER carries the wording.
   · An expected benefit is not an impact, and a measurement is not a
     verification. impactService owns both distinctions and this file reads
     them rather than re-deriving them.

   NOTHING HERE WRITES, AND NOTHING HERE CALLS A MODEL.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');
const gapAnalysis = require('./gapAnalysis');
const readinessService = require('./readinessService');
const impactService = require('./impactService');

/** The seven states a roadmap step can be in.
 *
 *  NO PERCENTAGES. The directive is explicit and it is the right call: a
 *  percentage implies a continuous measure of progress, and every step here is
 *  a set of discrete facts that are either true or not. `waiting` and
 *  `blocked` are the two that carry the most information and they are the two
 *  a percentage would erase — 40% cannot say "waiting on a figure only you
 *  have" or "no methodology exists". */
const STEP_STATES = Object.freeze([
  'not_started', 'in_progress', 'waiting', 'ready_for_review',
  'completed', 'blocked', 'not_configured',
]);

const STEP_WORD = Object.freeze({
  not_started:      'Not started',
  in_progress:      'In progress',
  waiting:          'Waiting for information',
  ready_for_review: 'Ready for review',
  completed:        'Completed',
  blocked:          'Blocked',
  not_configured:   'Not configured',
});

const LINK_WORD = Object.freeze({
  derived:  'Computed from the step above',
  recorded: 'Joined to the step above by a column in the database',
  sequence: 'The next step in the product. Nothing joins these two rows',
  none:     'Nothing connects these',
});

function step({ code, name, state, what, link, detail, cta = null, href = null, figures = null }) {
  if (!STEP_STATES.includes(state)) throw new Error(`roadmapService: "${state}" is not a step state`);
  if (!LINK_WORD[link]) throw new Error(`roadmapService: "${link}" is not a link kind`);
  if (!what || !String(what).trim()) {
    throw new Error(`roadmapService: step "${code}" says nothing about its own state`);
  }
  return Object.freeze({
    code, name, state, what, link, detail: detail || null,
    cta, href, figures: figures ? Object.freeze({ ...figures }) : null,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE READ — the rows this file needs that no service already owns
   ═══════════════════════════════════════════════════════════════════════════ */
async function gather(companyId) {
  const [{ rows: opportunities }, { rows: projects }] = await Promise.all([
    query(
      `SELECT o.id, o.proposed_project_type_code, o.rationale_en, o.status,
              o.derived_from_kind, o.created_at,
              t.label_en AS type_label
         FROM esg_green_opportunities o
         LEFT JOIN esg_project_types t ON t.code = o.proposed_project_type_code
        WHERE o.company_id = $1 AND o.status <> 'auto_rejected'
        ORDER BY o.created_at DESC, o.id`, [companyId]),

    query(
      `SELECT p.id, p.title, p.status, p.estimated_cost_myr, p.financing_required_myr,
              p.expected_benefit_metric, p.expected_benefit_value, p.expected_benefit_basis,
              p.ccpt_category_code, p.classification_basis, p.source_opportunity_id,
              p.created_at,
              -- Aliased roadmap_* because dashboard-test.js answers a query by
              -- matching its SQL against an ordered fixture table, and a
              -- correlated subquery naming esg_green_project_baselines would
              -- otherwise be answered by the fixture for that TABLE rather than
              -- for this statement. A unique alias is what makes the key
              -- unambiguous.
              (SELECT count(*)::int FROM esg_green_project_baselines b
                WHERE b.project_id = p.id AND b.kind = 'baseline')       AS roadmap_baselines,
              (SELECT count(*)::int FROM esg_green_project_baselines b
                WHERE b.project_id = p.id AND b.kind = 'actual')         AS roadmap_actuals,
              (SELECT count(*)::int FROM esg_green_project_baselines b
                WHERE b.project_id = p.id AND b.kind = 'actual'
                  AND b.verified_at IS NOT NULL)                         AS roadmap_verified
         FROM esg_green_projects p
        WHERE p.company_id = $1
        ORDER BY p.created_at DESC, p.id`, [companyId]),
  ]);
  // Mapped back to short names here, once, so the rest of the file reads as
  // though the aliases were short.
  return {
    opportunities,
    projects: projects.map((r) => ({
      ...r,
      baselines: r.roadmap_baselines,
      actuals: r.roadmap_actuals,
      verified: r.roadmap_verified,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The roadmap for one company.
 *
 * Returns null for no company. Otherwise always returns the full nine-step
 * ladder — a step that has not happened is a step in a NAMED state, never an
 * absent row, because "you have not got here yet" is information and a missing
 * step is not.
 */
async function build(companyId, assessmentId, precomputed = {}) {
  if (!companyId) return null;

  /* THE GAP ANALYSIS IS ACCEPTED, NOT ALWAYS RE-RUN.
     /improvement renders both the gap list and this roadmap, and it was
     calling gapAnalysis.analyse() itself AND letting this function call it
     again. MEASURED: six statements issued twice on one render — the whole of
     gapAnalysis.gather(), including the scores, the bands, the recommendation
     rows and the responses.

     It is not only the round trips. Two independent analyses on one page are
     two chances to disagree, and the page renders figures from both. Passing
     the first one in makes them the SAME object by construction.

     The parameter is optional and the fallback is the old behaviour, so every
     other caller — and this function's own tests — are unaffected. */
  const [gaps, ready, { opportunities, projects }] = await Promise.all([
    precomputed.gaps || gapAnalysis.analyse(companyId, assessmentId),
    precomputed.readiness || readinessService.calculate(companyId),
    gather(companyId),
  ]);

  const steps = [];

  /* ── 01 · ESG POSITION ─────────────────────────────────────────────── */
  const scored = gaps && gaps.state === 'ok' && gaps.overall;
  steps.push(step({
    code: 'POSITION',
    name: 'Your ESG position',
    state: scored ? 'completed' : (gaps && gaps.state === 'not_scored' ? 'in_progress' : 'not_started'),
    link: 'none',
    what: scored
      ? `${Math.round(gaps.overall.score)} out of 100, band ${gaps.overall.band_code}${
        gaps.overall.band_label ? ` · ${gaps.overall.band_label}` : ''}. Computed by the scoring `
        + `engine at weighting version ${gaps.overall.weighting_version}.`
      : (gaps && gaps.state === 'not_scored'
        ? 'An assessment exists and has not been scored. Nothing is estimated in the meantime, so '
          + 'there is no provisional figure.'
        : 'No assessment has been started, so there is no position to state.'),
    detail: scored
      ? `${gaps.overall.answered} of ${gaps.overall.applicable} applicable indicators answered${
        gaps.overall.na ? `, ${gaps.overall.na} marked not applicable` : ''}.`
      : null,
    cta: scored ? 'Open the assessment' : 'Continue the assessment',
    href: assessmentId ? `/assessment/${assessmentId}` : '/assessment',
    figures: scored ? { score: Math.round(gaps.overall.score), band: gaps.overall.band_code } : null,
  }));

  /* ── 02 · PRIORITY GAP ─────────────────────────────────────────────────
     DERIVED. gapAnalysis reads the score's own recommendation rows, so this
     step genuinely is computed from the one above it. */
  const priority = scored && gaps.pillars.priority.length ? gaps.pillars.priority[0] : null;
  steps.push(step({
    code: 'GAP',
    name: 'Your priority gap',
    state: !scored ? 'not_started' : (priority ? 'in_progress' : 'completed'),
    link: 'derived',
    what: !scored
      ? 'Gaps are the scoring engine\'s own output. Until an assessment is scored there is nothing '
        + 'to enumerate, and this platform will not guess a provisional set.'
      : priority
        ? `${priority.name} carries the most unearned points: ${priority.points_missed} across `
          + `${priority.gaps} disclosure${priority.gaps === 1 ? '' : 's'}.`
        : 'Every scorable point on this assessment is earned. There is no priority gap, which is a '
          + 'measured result rather than an empty list.',
    detail: priority
      ? `${priority.unanswered} not answered · ${priority.unevidenced} answered with nothing `
        + `attached · ${priority.partial} partly met. Each figure is the engine's, not this page's.`
      : null,
    cta: priority ? `Work through ${priority.gaps} gap${priority.gaps === 1 ? '' : 's'}` : null,
    href: priority ? '/improvement' : null,
    figures: priority ? { pillar: priority.pillar, points_missed: priority.points_missed } : null,
  }));

  /* ── 03 · THE ACTION ──────────────────────────────────────────────────
     DERIVED: the action is a property of the gap kind, decided in
     gapAnalysis.KIND_COPY and read here. */
  const topGap = scored && gaps.gaps.length ? gaps.gaps[0] : null;
  steps.push(step({
    code: 'ACTION',
    name: 'What to do about it',
    state: !topGap ? (scored ? 'completed' : 'not_started') : 'in_progress',
    link: 'derived',
    what: topGap
      ? `${topGap.action} — ${topGap.code || 'this disclosure'}: ${topGap.kind_label.toLowerCase()}.`
      : (scored
        ? 'Nothing is outstanding on the assessment.'
        : 'The action follows from the gap, and there is no gap until there is a score.'),
    detail: topGap ? topGap.evidence.text : null,
    cta: topGap ? topGap.action : null,
    href: topGap ? topGap.href : null,
  }));

  /* ── 04 · POTENTIAL OPPORTUNITY ────────────────────────────────────────
     SEQUENCE, AND THIS IS THE IMPORTANT ONE.

     It would read beautifully as 'derived'. It is not. The AI scan is given
     the company profile, which carbon CATEGORIES exist, and whether each
     indicator is answered — it is never given the gaps, never told which one
     matters, and never asked to name one. So a suggestion is a suggestion FOR
     THIS COMPANY and is not an answer to the gap above it, and this step says
     exactly that in `detail` rather than letting the layout imply otherwise. */
  const pendingOpps = opportunities.filter((o) => o.status === 'pending');
  const acceptedOpps = opportunities.filter((o) => o.status === 'accepted');
  steps.push(step({
    code: 'OPPORTUNITY',
    name: 'Potential green opportunity',
    state: pendingOpps.length ? 'ready_for_review'
      : acceptedOpps.length ? 'completed'
        : opportunities.length ? 'in_progress' : 'not_started',
    link: 'sequence',
    what: pendingOpps.length
      ? `${pendingOpps.length} project type${pendingOpps.length === 1 ? '' : 's'} proposed and `
        + 'waiting for your decision.'
      : acceptedOpps.length
        ? `${acceptedOpps.length} suggestion${acceptedOpps.length === 1 ? '' : 's'} accepted.`
        : opportunities.length
          ? 'Every suggestion has been reviewed and none was accepted.'
          : 'No scan has been run, so nothing has been suggested.',
    detail: 'The scan is told your MSIC code, employee band, state, grid region, which carbon '
      + 'categories you have on file, and whether each indicator is answered. It is NOT told your '
      + 'gaps, is not asked which one to address, and proposes only from a fixed list of project '
      + 'types. A suggestion is therefore for your company — it is not an answer to the gap above.',
    cta: pendingOpps.length
      ? `Review ${pendingOpps.length} suggestion${pendingOpps.length === 1 ? '' : 's'}`
      : 'Run a scan',
    href: '/green-finance/opportunities',
  }));

  /* ── 05 · GREEN PROJECT ────────────────────────────────────────────────
     RECORDED, when the project came from a proposal. P9 added
     source_opportunity_id precisely so this step can say which — and a project
     a person defined by hand carries no source, which is a different fact and
     not a missing one. */
  const fromProposal = projects.filter((p) => p.source_opportunity_id);
  steps.push(step({
    code: 'PROJECT',
    name: 'Green project',
    state: projects.length ? 'completed' : (acceptedOpps.length ? 'in_progress' : 'not_started'),
    link: fromProposal.length ? 'recorded' : 'sequence',
    what: projects.length
      ? `${projects.length} project${projects.length === 1 ? '' : 's'} defined.`
      : 'No project is defined. A lender is told about a project, not about a score.',
    detail: projects.length
      ? (fromProposal.length
        ? `${fromProposal.length} of ${projects.length} came from an accepted suggestion and the `
          + 'row records which one. The rest were defined by your company.'
        : 'Every project here was defined by your company. None came from a suggestion, so none '
          + 'carries a source proposal.')
      : null,
    cta: projects.length ? `Open ${projects.length === 1 ? 'the project' : 'the projects'}` : 'Define a project',
    href: '/green-finance/projects',
    figures: { projects: projects.length, from_proposal: fromProposal.length },
  }));

  /* ── 06 · FINANCE READINESS ─────────────────────────────────────────── */
  steps.push(step({
    code: 'READINESS',
    name: 'Green finance readiness',
    state: !ready ? 'not_configured'
      : ready.status === 'not_configured' ? 'not_configured'
        : ready.status === 'calculated' ? 'completed'
          : ready.status === 'insufficient_data' ? 'waiting' : 'in_progress',
    link: 'derived',
    what: !ready
      ? 'The readiness model is defined and nothing could be read for this company.'
      : ready.status === 'calculated'
        ? `${Math.round(ready.score)} out of ${ready.maximum}. Every criterion in the model could `
          + 'be assessed.'
        : `${ready.earned} of ${ready.assessable} assessable points earned. `
          + `${ready.maximum - ready.assessable} of ${ready.maximum} cannot be assessed yet.`,
    detail: 'A readiness assessment, never a financing approval. Missing is not zero: a criterion '
      + 'the platform could not look at contributes to neither side of the ratio.',
    cta: 'Open finance readiness',
    href: '/green-finance/readiness',
    figures: ready ? { earned: ready.earned, assessable: ready.assessable, maximum: ready.maximum } : null,
  }));

  /* ── 07 · EXPECTED IMPACT ─────────────────────────────────────────────
     A FORECAST. It lives on the project row and never in the measurement
     table, which is the separation impactService exists to protect. */
  const withForecast = projects.filter((p) => p.expected_benefit_value !== null);
  steps.push(step({
    code: 'EXPECTED',
    name: 'Expected impact',
    state: !projects.length ? 'not_started'
      : withForecast.length ? 'completed' : 'waiting',
    link: 'sequence',
    what: !projects.length
      ? 'A forecast belongs to a project, and there is no project yet.'
      : withForecast.length
        ? `${withForecast.length} of ${projects.length} project${projects.length === 1 ? '' : 's'} `
          + 'state an expected benefit, each with where the forecast came from.'
        : `No project states an expected benefit. This is a figure only you have — a supplier `
          + 'quotation, an engineering study or your own estimate — and the platform will not '
          + 'produce one on your behalf.',
    detail: 'Expected is not baseline and expected is not actual. A forecast never becomes a '
      + 'measurement by being right.',
    cta: projects.length ? 'Open the projects' : null,
    href: projects.length ? '/green-finance/projects' : null,
    figures: { with_forecast: withForecast.length, projects: projects.length },
  }));

  /* ── 08 · BASELINE AND MEASUREMENT ─────────────────────────────────── */
  const baselined = projects.filter((p) => p.baselines > 0);
  const measured = projects.filter((p) => p.actuals > 0);
  steps.push(step({
    code: 'MEASURED',
    name: 'Baseline and actual measurement',
    state: !projects.length ? 'not_started'
      : measured.length ? 'completed'
        : baselined.length ? 'waiting' : 'not_started',
    link: 'derived',
    what: !projects.length
      ? 'There is nothing to measure until a project exists.'
      : measured.length
        ? `${measured.length} project${measured.length === 1 ? '' : 's'} ${
          measured.length === 1 ? 'has' : 'have'} an actual reading; ${baselined.length} `
          + `${baselined.length === 1 ? 'has' : 'have'} a baseline.`
        : baselined.length
          ? `${baselined.length} baseline${baselined.length === 1 ? '' : 's'} computed and no actual `
            + 'reading yet. The baseline is what an actual will be compared against.'
          : 'No baseline has been computed. It is derived from your own carbon entries for a '
            + 'period, so the entries have to be in first.',
    detail: 'Both are derived from your carbon entries by the same code path, so a baseline and an '
      + 'actual are the same kind of figure and can honestly be subtracted.',
    cta: projects.length ? 'Open the impact view' : null,
    href: projects.length ? '/impact' : null,
    figures: { baselined: baselined.length, measured: measured.length },
  }));

  /* ── 09 · VERIFICATION ─────────────────────────────────────────────── */
  const verified = projects.filter((p) => p.verified > 0);
  steps.push(step({
    code: 'VERIFIED',
    name: 'Verification',
    state: !measured.length ? 'not_started'
      : verified.length ? 'completed' : 'ready_for_review',
    link: 'recorded',
    what: !measured.length
      ? 'A measurement has to exist before anybody can confirm it.'
      : verified.length
        ? `${verified.length} project${verified.length === 1 ? '' : 's'} ${
          verified.length === 1 ? 'has' : 'have'} a confirmed reading.`
        : 'Readings exist and nobody has confirmed one. Measured and verified are different '
          + 'claims and this platform keeps them apart.',
    detail: 'Confirming a reading records who confirmed it and when. The database refuses a '
      + 'verification with no person attached.',
    cta: measured.length ? 'Open the impact view' : null,
    href: measured.length ? '/impact' : null,
    figures: { verified: verified.length, measured: measured.length },
  }));

  /* ── 10 · REPORTING ────────────────────────────────────────────────────
     NOT CONFIGURED, at the platform level. impactService already reports the
     `reported` stage as permanently unreachable for exactly this reason, so
     this step agrees with it rather than restating it differently. */
  steps.push(step({
    code: 'REPORTED',
    name: 'ESG reporting',
    state: 'not_configured',
    link: 'sequence',
    what: 'There is no report generator on this platform, so nothing can claim to have been '
      + 'reported.',
    detail: 'The reporting page shows what a report could be assembled FROM — the score, the '
      + 'answers, the evidence, the carbon entries, the projects and the measurements — and is '
      + 'explicit that assembling it is not built.',
    cta: 'See reporting readiness',
    href: '/reports',
  }));

  const counts = STEP_STATES.reduce((acc, s) => {
    acc[s] = steps.filter((x) => x.state === s).length;
    return acc;
  }, {});

  return Object.freeze({
    steps: Object.freeze(steps),
    counts: Object.freeze(counts),
    // Where the company actually is: the last step that is completed, plus the
    // first that is not. Both, because "you have got this far" and "this is
    // next" are different sentences and a single index conflates them.
    completedThrough: steps.reduce((last, s, i) => (s.state === 'completed' ? i : last), -1),
    current: steps.find((s) => ['in_progress', 'waiting', 'ready_for_review', 'not_started'].includes(s.state)) || null,
    gaps,
    readiness: ready,
  });
}

/** The impact picture per project, for the roadmap's detail view. A thin pass
 *  through to impactService so the roadmap and /impact cannot disagree. */
async function impact(companyId) {
  return impactService.forCompany(companyId);
}

module.exports = { build, gather, step, impact, STEP_STATES, STEP_WORD, LINK_WORD };

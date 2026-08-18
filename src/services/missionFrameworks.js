'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SUSTNET MISSION AND CERTIFICATION — the architecture, deliberately empty
                                                                 (Run 62/P7)
   ───────────────────────────────────────────────────────────────────────────
   THIS FILE DEFINES THE SHAPE OF TWO METHODOLOGIES THAT DO NOT EXIST YET.

   The pillars below are real and public: SustNET states its four mission
   pillars, and naming them is honest. What does NOT exist is the methodology
   that maps a company's activity to them — no publisher has stated how a solar
   array on a factory roof contributes to "Sustainable education for all", and
   no amount of plausibility makes that mapping true.

   So the criteria arrays are EMPTY, and `status` is METHODOLOGY_REQUIRED. That
   is not a gap waiting to be filled with something reasonable; it is the
   correct value until a published source supplies one.

   WHAT A FUTURE METHODOLOGY WOULD SUPPLY, and this shape already accepts:

     criteria: [{ code, label, weight, evidence: [...], mapping: {...} }]

   When one arrives, it is loaded here, `status` becomes CONFIGURED, and the UI
   and the tests follow with no structural change. Until then every consumer
   gets the same answer: the concept is supported, the methodology is not.

   WHY THE CRITERIA ARE EMPTY RATHER THAN COMMENTED-OUT EXAMPLES. An example
   criterion in this file is a criterion someone will eventually render, and a
   plausible-looking placeholder is the exact failure this whole platform is
   built to avoid. test/impact-test.js asserts the arrays are empty.
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS = Object.freeze({
  METHODOLOGY_REQUIRED: 'methodology_required',
  FRAMEWORK_REQUIRED:   'framework_required',
  CONFIGURED:           'configured',
});

/* ── SustNET's four mission pillars ───────────────────────────────────────
   NAMED, NEVER SCORED. The names are SustNET's own; the contribution
   methodology is not published, so nothing here carries a weight, a threshold
   or a criterion. */
const SUSTNET = Object.freeze({
  code: 'SUSTNET_MISSION',
  name: 'SustNET mission pillars',
  status: STATUS.METHODOLOGY_REQUIRED,
  statusLabel: 'Methodology required',
  // The precondition, stated so the reader knows what would change this.
  precondition: 'A published methodology mapping company activity to the four pillars',
  explanation:
    'Your company will be able to explore its contribution to SustNET’s four mission pillars '
    + 'once the applicable impact methodology is configured. Until one is published, this platform '
    + 'will not claim a contribution level — a project sounding related to a pillar is not a '
    + 'measured contribution to it.',
  pillars: Object.freeze([
    Object.freeze({ code: 'BIODIVERSITY_FOOD', label: 'Biodiversity and food security', criteria: Object.freeze([]) }),
    Object.freeze({ code: 'SHARED_PROSPERITY', label: 'Shared prosperity and economic balance', criteria: Object.freeze([]) }),
    Object.freeze({ code: 'SUSTAINABLE_EDUCATION', label: 'Sustainable education for all', criteria: Object.freeze([]) }),
    Object.freeze({ code: 'SOCIAL_VALUES', label: 'Social values and value creation', criteria: Object.freeze([]) }),
  ]),
});

/* ── SustNET ESG certification ────────────────────────────────────────────
   The same shape, and the same emptiness. A certification framework defines
   levels, requirements, evidence, validity and renewal; none is published, so
   none is stated. */
const CERTIFICATION = Object.freeze({
  code: 'SUSTNET_ESG_CERT',
  name: 'SustNET ESG certification',
  status: STATUS.FRAMEWORK_REQUIRED,
  statusLabel: 'Certification framework required',
  precondition: 'Published SustNET certification criteria',
  explanation:
    'Certification pathways will become available when the applicable SustNET certification '
    + 'criteria are configured. This platform assesses; it does not certify, and it will not render '
    + 'a certificate, a level or a percentage toward one.',
  levels: Object.freeze([]),
  requirements: Object.freeze([]),
  validity: null,
  renewal: null,
});

/** What a company can be told today about either framework.
 *
 *  Takes the company's real ESG position ONLY so the copy can say what the
 *  company has already built — it never converts any of it into a contribution
 *  or a progress figure, and the returned object carries no number at all. */
function statusFor(framework, { scored = false, projects = 0, verifiedImpacts = 0 } = {}) {
  const configured = framework.status === STATUS.CONFIGURED;
  return Object.freeze({
    code: framework.code,
    name: framework.name,
    status: framework.status,
    statusLabel: framework.statusLabel,
    precondition: framework.precondition,
    explanation: framework.explanation,
    // WHAT THE COMPANY HAS BUILT, as plain facts about its own data. Not
    // progress toward the framework — there is no framework to progress
    // toward, and calling these "progress" would be the fabrication.
    foundation: Object.freeze([
      { label: 'A scored ESG assessment', present: Boolean(scored) },
      { label: 'A defined green project', present: projects > 0 },
      { label: 'A verified impact measurement', present: verifiedImpacts > 0 },
    ]),
    // Explicitly null, and asserted null by the tests. No caller can render a
    // figure it was never given.
    score: null,
    progressPercent: null,
    level: null,
    configured,
  });
}

module.exports = { STATUS, SUSTNET, CERTIFICATION, statusFor };

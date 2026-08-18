'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE GREEN FINANCE READINESS MODEL                             (Run 62/P6.5)
   ───────────────────────────────────────────────────────────────────────────
   THIS FILE IS CONFIGURATION, NOT LOGIC. It says what the criteria are, what
   each is worth, and what inputs each one needs. readinessService.js decides
   how to read those inputs; nothing here touches the database and nothing here
   computes a score.

   WHAT THIS MODEL IS. It is THE PLATFORM'S OWN readiness framework: a view of
   how prepared a company looks for a financing conversation. It is NOT a bank's
   scoring formula, not an eligibility determination, and not a prediction of
   any institution's decision. financeCopy.DISCLAIMER is the one place that
   wording lives and every readiness surface renders it.

   MODEL_VERSION IS STAMPED ON EVERY RESULT. Same rule as the emission factors
   and the weighting scheme (CLAUDE.md #6): a result carries the version of the
   model that produced it, so changing a weight here cannot silently reinterpret
   a figure someone already wrote down.

   THE 100 POINTS ARE A CEILING, NOT A PROMISE. A criterion the platform cannot
   assess contributes NOTHING to either side of the ratio — not zero earned out
   of forty, which would read as a company that failed. See readinessService.js
   for why `assessable` exists as a separate number.
   ═══════════════════════════════════════════════════════════════════════════ */

const MODEL_VERSION = '0.1-draft';

/** Where a value came from. Mirrors the ESG evidence chain deliberately:
 *  a financial figure a person typed and a figure taken from a bank statement
 *  are not the same fact, and the model must never flatten them. */
const SOURCES = Object.freeze(['user_input', 'document', 'esg_data', 'derived']);

/** What the platform knows about one input. MISSING is the absence of a row —
 *  it is never stored, and it is never the same as a recorded zero. */
const INPUT_STATES = Object.freeze([
  'verified',      // a person confirmed it, or it came from scored ESG data
  'provided',      // the company entered it; nobody has checked it
  'document',      // read from a document, quote-verified, accepted by a person
  'not_applicable',// the company says this does not apply to it
  'missing',       // no row. NOT zero, NOT a failure
]);

/** The overall result states. INSUFFICIENT_DATA and a low score are different
 *  facts and the UI must never render them the same way. */
const READINESS_STATES = Object.freeze({
  NOT_CONFIGURED:     'not_configured',      // no criterion in the model can run at all
  INSUFFICIENT_DATA:  'insufficient_data',   // too little is assessable to mean anything
  PARTIALLY_ASSESSED: 'partially_assessed',  // some criteria assessed, some awaiting data
  CALCULATED:         'calculated',          // every criterion had the data it needs
});

/* ── The criteria ─────────────────────────────────────────────────────────
   `weight` is the ceiling in points. `inputs` names what the criterion needs;
   an input the platform cannot supply today is still LISTED, because "what is
   missing" is half of what this engine exists to tell a company.

   Weights are configuration: change them here and the engine, the tests and
   the UI all follow. test/readiness-test.js asserts they still total 100. */
const CRITERIA = Object.freeze([
  {
    code: 'financial_bankability',
    name: 'Financial bankability',
    weight: 40,
    // NOTHING IN THIS SCHEMA HOLDS ANY OF THESE TODAY. esg_companies carries
    // annual_revenue_myr and a headcount and nothing else financial, so this
    // criterion reports DATA_REQUIRED rather than scoring a company on one
    // number. esg_finance_inputs is where these will live.
    explanation:
      'What a lender looks at before any green consideration: whether the business itself '
      + 'is financeable. Green eligibility never replaces a credit assessment.',
    inputs: [
      { code: 'annual_revenue',        label: 'Annual revenue',                  points: 8,  from: 'esg_companies.annual_revenue_myr' },
      { code: 'incorporation_date',    label: 'Date of incorporation',           points: 4,  from: 'esg_finance_inputs' },
      { code: 'audited_statements',    label: 'Audited financial statements',    points: 8,  from: 'esg_finance_inputs' },
      { code: 'management_accounts',   label: 'Recent management accounts',      points: 4,  from: 'esg_finance_inputs' },
      { code: 'profitable_last_year',  label: 'Profitable in the last financial year', points: 6, from: 'esg_finance_inputs' },
      { code: 'existing_borrowings',   label: 'Existing borrowings declared',    points: 4,  from: 'esg_finance_inputs' },
      { code: 'repayment_history',     label: 'Repayment history',               points: 6,  from: 'esg_finance_inputs' },
    ],
  },
  {
    code: 'green_project',
    name: 'Green project eligibility',
    weight: 20,
    explanation:
      'A lender lends against a project, not against a score. This is whether a project '
      + 'exists, what it is, what it costs, and whether it has been classified against a '
      + 'published taxonomy.',
    inputs: [
      { code: 'project_defined',       label: 'A green project is defined',      points: 6,  from: 'esg_green_projects' },
      { code: 'project_type',          label: 'The project has a type',          points: 4,  from: 'esg_green_projects.project_type_id' },
      { code: 'project_cost',          label: 'An estimated cost',               points: 4,  from: 'esg_green_projects.estimated_cost_myr' },
      { code: 'project_classified',    label: 'Classified against a taxonomy',   points: 6,  from: 'esg_green_projects.ccpt_category_code' },
    ],
  },
  {
    code: 'carbon_esg_data',
    name: 'Carbon and ESG data',
    weight: 15,
    explanation:
      'Whether the company can put numbers behind its claims, and whether those numbers '
      + 'rest on sourced emission factors rather than placeholders.',
    inputs: [
      { code: 'carbon_entries',        label: 'Carbon entries recorded',         points: 5,  from: 'esg_carbon_entries' },
      { code: 'carbon_not_provisional', label: 'Entries use sourced factors',    points: 4,  from: 'esg_carbon_entries.is_provisional' },
      { code: 'project_baseline',      label: 'A project baseline is computed',  points: 3,  from: 'esg_green_project_baselines' },
      { code: 'environmental_score',   label: 'An Environmental score exists',   points: 3,  from: 'esg_scores' },
    ],
  },
  {
    code: 'governance',
    name: 'Governance',
    weight: 10,
    explanation:
      'The governance half of the ESG assessment, which is what a credit committee reads '
      + 'when it asks who is accountable.',
    inputs: [
      { code: 'governance_score',      label: 'A Governance score exists',       points: 6,  from: 'esg_scores' },
      { code: 'governance_evidenced',  label: 'Governance answers carry evidence', points: 4, from: 'esg_responses.evidence_tier' },
    ],
  },
  {
    code: 'business_sustainability',
    name: 'Business sustainability',
    weight: 10,
    // DELIBERATELY UNSATISFIABLE TODAY, and listed anyway. Trading history and
    // revenue trend need more than one year of figures; this platform stores a
    // single annual_revenue_myr and no incorporation date, so there is no
    // honest way to compute either. Naming the gap is the point.
    explanation:
      'Whether the business itself looks durable — trading history and the direction of '
      + 'revenue. The platform holds one revenue figure and no trading history, so this '
      + 'cannot be assessed yet.',
    inputs: [
      { code: 'trading_years',         label: 'Years of trading',                points: 5,  from: 'esg_finance_inputs' },
      { code: 'revenue_trend',         label: 'Revenue direction over time',     points: 5,  from: 'esg_finance_inputs' },
    ],
  },
  {
    code: 'reporting_readiness',
    name: 'ESG reporting readiness',
    weight: 5,
    explanation:
      'Whether the company could produce a report a counterparty would accept: answers '
      + 'given, and documents behind them.',
    inputs: [
      { code: 'assessment_scored',     label: 'An assessment has been scored',   points: 2,  from: 'esg_scores' },
      { code: 'documents_uploaded',    label: 'Evidence documents on file',      points: 2,  from: 'esg_documents' },
      { code: 'answers_documented',    label: 'Answers backed by documents',     points: 1,  from: 'esg_responses.document_id' },
    ],
  },
]);

/** Every input code the model knows, for validating stored rows against it. */
const INPUT_CODES = Object.freeze(
  CRITERIA.flatMap((c) => c.inputs.map((i) => i.code)));

/** The inputs a person supplies rather than the platform deriving. These are
 *  the only codes esg_finance_inputs should ever hold. */
const USER_SUPPLIED_CODES = Object.freeze(
  CRITERIA.flatMap((c) => c.inputs.filter((i) => i.from === 'esg_finance_inputs').map((i) => i.code)));

module.exports = {
  MODEL_VERSION, CRITERIA, SOURCES, INPUT_STATES, READINESS_STATES,
  INPUT_CODES, USER_SUPPLIED_CODES,
};

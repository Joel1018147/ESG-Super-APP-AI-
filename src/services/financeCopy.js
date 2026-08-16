'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   GREEN FINANCE — the copy and the vocabulary, in ONE place      (Run 47)
   ───────────────────────────────────────────────────────────────────────────
   The register is a REFERENCE, not a decision. Two things follow from that and
   both live here rather than in a route file:

   1. THE DISCLAIMER HAS EXACTLY ONE DEFINITION. The readiness run and the
      routing run render it too. Two near-identical legal sentences hardcoded in
      two route files is how they drift into meaning different things — and the
      one that drifts is always the one nobody re-read.

   2. THE BANNED PHRASES ARE DATA, NOT A CONVENTION. "approved", "you qualify",
      "you are eligible", "guaranteed" — every one of them turns a reference
      into a promise about someone else's credit decision. They are exported so
      the suite can assert against rendered HTML rather than against a habit.

   The label maps are here for the same reason the disclaimer is: the register
   page, the detail page, the admin screens and the JSON API all name the same
   enum values, and a fifth spelling of "Sustainability-linked" is a defect
   nobody would ever notice.
   ═══════════════════════════════════════════════════════════════════════════ */

const DISCLAIMER =
  'This is a readiness assessment, not a financing approval, a credit decision, '
  + 'an investment recommendation or a guarantee of financing. Eligibility, rates, '
  + 'terms and approval remain subject to each institution’s own criteria and '
  + 'credit assessment. Green eligibility does not replace normal credit assessment.';

// Lower-cased, matched case-insensitively against rendered output.
const BANNED_PHRASES = ['approved', 'you qualify', 'you are eligible', 'eligible for', 'guaranteed'];

// A row whose source was last read longer ago than this renders visibly stale.
// Not a cliff: the exact age is always shown, in days, on every row.
const STALE_AFTER_DAYS = 180;

/* ── Vocabulary ────────────────────────────────────────────────────────────
   These key sets are asserted against the CHECK constraints in schema.sql by
   test/green-finance-register-test.js. A value the database can hold and this
   file cannot name would render as a bare enum token, which is RULE 6b's
   "never a generic box" — so the test fails the build instead. */
const FINANCING_TYPE_LABELS = {
  use_of_proceeds_green: 'Use-of-proceeds green',
  sustainability_linked: 'Sustainability-linked',
  guarantee: 'Guarantee',
  grant_or_subsidy: 'Grant or subsidy',
  unclear: 'Not stated by the source',
};

const BORROWER_SCOPE_LABELS = {
  sme: 'SME',
  corporate: 'Corporate',
  both: 'SME and corporate',
  retail: 'Retail / personal',
  unstated: 'Not stated by the source',
};

const AVAILABILITY_LABELS = {
  open: 'Open',
  closed: 'Closed',
  superseded: 'Superseded',
  unclear: 'Unclear',
};

const INSTITUTION_KIND_LABELS = {
  bank: 'Bank',
  regulator: 'Regulator',
  agency: 'Government agency',
  development_fi: 'Development financial institution',
  guarantee_corp: 'Guarantee corporation',
};

const SOURCE_PUBLISHER_LABELS = {
  institution_own: 'The institution’s own page',
  regulator: 'The regulator’s own document',
  agency: 'The agency’s own page',
  news: 'A news report — the institution publishes nothing',
};

/** A label, or the raw code when the map does not have one.
 *
 *  Returning the CODE is deliberate and is not a fallback in the RULE 6 sense:
 *  a bare `foo_bar` on screen is unmistakably a defect, where an invented
 *  "Foo bar" would read as a real category. The test is what stops it reaching
 *  a page at all. */
function labelFor(map, code) {
  if (Object.prototype.hasOwnProperty.call(map, code)) return map[code];
  return String(code);
}

/** How old a row's verification is, as a sentence and a staleness flag.
 *
 *  `days` comes from Postgres as `CURRENT_DATE - last_verified`, an integer.
 *  Computed in SQL rather than from a JS Date because a `date` column read into
 *  a JS Date lands at local midnight, and "verified 0 days ago" becoming
 *  "verified 1 day ago" for readers west of the server is the kind of drift
 *  nobody ever traces. */
function verificationAge(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) {
    return { text: 'verification date unreadable', days: null, stale: true };
  }
  return {
    days: n,
    stale: n > STALE_AFTER_DAYS,
    text: `verified ${n} ${n === 1 ? 'day' : 'days'} ago`,
  };
}

module.exports = {
  DISCLAIMER,
  BANNED_PHRASES,
  STALE_AFTER_DAYS,
  FINANCING_TYPE_LABELS,
  BORROWER_SCOPE_LABELS,
  AVAILABILITY_LABELS,
  INSTITUTION_KIND_LABELS,
  SOURCE_PUBLISHER_LABELS,
  labelFor,
  verificationAge,
};

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   POTENTIAL FINANCING ROUTES                                    (Run 62/P6.6)
   ───────────────────────────────────────────────────────────────────────────
   WHAT THIS DOES: narrows the register to the programmes whose OWN PUBLISHED
   TERMS do not rule this project out, and says which term did the ruling.

   WHAT IT DOES NOT DO, AND CANNOT:

   1. IT DOES NOT MATCH ON PROJECT TYPE. esg_finance_products has no column
      saying which project categories a facility covers, and the register page
      says why in its own words: "That mapping is a judgement about what each
      facility covers, and it does not exist yet." Inventing that judgement here
      would be this service deciding that a bank's solar facility does or does
      not cover a chiller replacement. Every result therefore carries
      `projectTypeAssessed: false`.

   2. IT NEVER SAYS ELIGIBLE, APPROVED OR GUARANTEED. A programme that survives
      every filter is one whose published terms do not exclude the project. That
      is the whole claim. financeCopy.DISCLAIMER is rendered with every result.

   3. IT DOES NOT RANK BY QUALITY. Ordering is by how much of a programme's terms
      could actually be checked, so a facility that publishes nothing does not
      float to the top by virtue of being unfalsifiable.

   THE RULES ARE CONFIGURATION. Each entry in RULES is a named, independent
   check with its own reason string. Adding a rule is a row here, not a branch
   inside a route, and test/green-project-test.js asserts that every rule which
   excludes a product supplies a reason.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

/** How a rule can answer. `unknown` is the important one: a programme that
 *  publishes no minimum has not passed a minimum check — it has no minimum to
 *  check, and the difference is the same one the readiness engine draws
 *  between missing and zero. */
const VERDICTS = Object.freeze(['pass', 'exclude', 'unknown']);

const RULES = Object.freeze([
  {
    code: 'borrower_scope',
    label: 'Borrower type',
    check(product, ctx) {
      if (!product.borrower_scope) return { verdict: 'unknown', why: 'The institution publishes no borrower scope' };
      // The real vocabulary, read from the CHECK constraint rather than guessed:
      // sme | corporate | both | retail | unstated. An earlier draft tested for
      // 'sme_and_corporate' and 'not_stated', neither of which exists — every
      // product would have fallen through to a pass it had not earned.
      const SCOPE = {
        sme:       { verdict: 'pass',    why: 'Published for SME borrowers' },
        both:      { verdict: 'pass',    why: 'Published for SMEs and corporates' },
        corporate: { verdict: 'exclude', why: 'Published for corporate borrowers, not SMEs' },
        retail:    { verdict: 'exclude', why: 'Published for retail customers, not businesses' },
        unstated:  { verdict: 'unknown', why: 'The institution does not state who may borrow' },
      };
      return SCOPE[product.borrower_scope]
        || { verdict: 'unknown', why: `Unrecognised borrower scope "${product.borrower_scope}"` };
    },
  },
  {
    code: 'amount_floor',
    label: 'Minimum financing',
    check(product, ctx) {
      if (ctx.financingRequired === null) return { verdict: 'unknown', why: 'You have not stated a financing requirement' };
      if (product.min_financing_myr === null || product.min_financing_myr === undefined) {
        return { verdict: 'unknown', why: 'The institution publishes no minimum' };
      }
      return Number(ctx.financingRequired) < Number(product.min_financing_myr)
        ? { verdict: 'exclude', why: `Below the published minimum of RM${Number(product.min_financing_myr).toLocaleString('en-MY')}` }
        : { verdict: 'pass', why: 'At or above the published minimum' };
    },
  },
  {
    code: 'amount_ceiling',
    label: 'Maximum financing',
    check(product, ctx) {
      if (ctx.financingRequired === null) return { verdict: 'unknown', why: 'You have not stated a financing requirement' };
      if (product.max_financing_myr === null || product.max_financing_myr === undefined) {
        return { verdict: 'unknown', why: 'The institution publishes no maximum' };
      }
      return Number(ctx.financingRequired) > Number(product.max_financing_myr)
        ? { verdict: 'exclude', why: `Above the published maximum of RM${Number(product.max_financing_myr).toLocaleString('en-MY')}` }
        : { verdict: 'pass', why: 'Within the published maximum' };
    },
  },
  {
    code: 'financing_type',
    label: 'Financing type',
    check(product, ctx) {
      // A use-of-proceeds facility lends against a specific project; a
      // sustainability-linked one lends generally and prices on targets. A
      // company with a defined project can approach either, so this rule only
      // EXPLAINS — it never excludes.
      if (product.financing_type === 'use_of_proceeds_green') {
        return { verdict: 'pass', why: 'Lends against a specific green project, which is what you have defined' };
      }
      if (product.financing_type === 'sustainability_linked') {
        return { verdict: 'pass', why: 'Lends for general purposes and prices on sustainability targets' };
      }
      if (product.financing_type === 'guarantee') {
        return { verdict: 'pass', why: 'A guarantee rather than the financing itself — it sits alongside a facility' };
      }
      if (product.financing_type === 'grant_or_subsidy') {
        return { verdict: 'pass', why: 'A grant or subsidy — it does not have to be repaid, and is not financing' };
      }
      return { verdict: 'unknown', why: 'The institution does not state a financing type' };
    },
  },
  {
    code: 'availability',
    label: 'Availability',
    check(product) {
      if (product.availability_status === 'closed') {
        return { verdict: 'exclude', why: 'The institution records this programme as closed' };
      }
      if (product.availability_status === 'superseded') {
        return { verdict: 'exclude', why: 'Superseded by a later programme' };
      }
      if (product.availability_status === 'unclear') {
        return { verdict: 'unknown', why: 'The institution publishes nothing about whether it is open' };
      }
      return { verdict: 'pass', why: 'Recorded as open' };
    },
  },
]);

/** The facts a match is decided on. Read from the project and the company —
 *  nothing here is inferred and nothing is defaulted. */
async function context(companyId, projectId) {
  const { rows } = await query(
    `SELECT p.id, p.title, p.estimated_cost_myr, p.financing_required_myr,
            p.own_contribution_myr, p.financing_purpose, p.ccpt_category_code,
            p.project_type_id, t.label_en AS project_type_label
       FROM esg_green_projects p
       LEFT JOIN esg_project_types t ON t.id = p.project_type_id
      WHERE p.id = $1 AND p.company_id = $2`, [projectId, companyId]);
  const p = rows[0];
  if (!p) return null;
  return Object.freeze({
    projectId: p.id,
    projectTitle: p.title,
    projectTypeLabel: p.project_type_label || null,
    classified: Boolean(p.ccpt_category_code),
    financingRequired: p.financing_required_myr === null || p.financing_required_myr === undefined
      ? null : Number(p.financing_required_myr),
    financingPurpose: p.financing_purpose || null,
  });
}

/** Programmes whose published terms do not rule this project out.
 *
 *  Returns null when the project does not exist — not an empty list, which
 *  would read as "nothing matches". */
async function potentialRoutes(companyId, projectId) {
  const ctx = await context(companyId, projectId);
  if (!ctx) return null;

  const { rows: products } = await query(
    `SELECT id, institution_name, institution_kind, product_name, financing_type,
            borrower_scope, min_financing_myr, max_financing_myr, eligibility_note,
            availability_status, source_url, source_publisher, last_verified
       FROM esg_finance_products WHERE is_active
      ORDER BY institution_name, product_name`);

  const assessed = products.map((product) => {
    const checks = RULES.map((rule) => {
      const out = rule.check(product, ctx);
      if (!VERDICTS.includes(out.verdict)) {
        throw new Error(`rule "${rule.code}" returned an unknown verdict: ${out.verdict}`);
      }
      if (out.verdict === 'exclude' && !out.why) {
        throw new Error(`rule "${rule.code}" excluded a product without a reason`);
      }
      return { code: rule.code, label: rule.label, ...out };
    });
    const excluded = checks.filter((c) => c.verdict === 'exclude');
    const known = checks.filter((c) => c.verdict !== 'unknown').length;
    return Object.freeze({
      product: Object.freeze(product),
      checks: Object.freeze(checks),
      excluded: excluded.length > 0,
      exclusions: Object.freeze(excluded.map((c) => c.why)),
      knownChecks: known,
      unknownChecks: checks.length - known,
    });
  });

  const candidates = assessed.filter((a) => !a.excluded)
    // Most-checkable first: a programme that publishes nothing is not a better
    // match for having published nothing.
    .sort((a, b) => b.knownChecks - a.knownChecks);

  return Object.freeze({
    context: ctx,
    // STATED ON EVERY RESULT. The register carries no project-category mapping,
    // so nothing here has been assessed for whether the facility covers THIS
    // KIND of project.
    projectTypeAssessed: false,
    totalProducts: products.length,
    candidates: Object.freeze(candidates),
    excluded: Object.freeze(assessed.filter((a) => a.excluded)),
  });
}

module.exports = { potentialRoutes, context, RULES, VERDICTS };

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SHELL CONTEXT — what the chrome is allowed to say                (Run 62/P3)
   ───────────────────────────────────────────────────────────────────────────
   The top bar shows three things on every page: WHICH COMPANY this is, WHAT
   NEEDS A PERSON, and WHAT THE AI HAS PRODUCED. All three are read from the
   same tables the pages read; none is invented, and none is a placeholder.

   WHY THERE IS NO NOTIFICATION TABLE. A bell that opens a list nobody writes
   to is the "button that opens nothing" this product already refuses to ship.
   Everything below is DERIVED from work that actually exists and is actually
   outstanding, so the count cannot drift from the thing it counts, and there is
   no state to keep in sync.

   ONE QUERY. Four scalar subselects against tables that already carry an index
   on company_id. This runs on every authenticated page render, so it must stay
   one round trip — if it ever needs a fifth fact, add a subselect, not a query.

   COLUMN NAMES WERE READ FROM src/routes/pages.js AND src/db/schema.sql BEFORE
   BEING WRITTEN HERE, not assumed:
     esg_document_extractions.status   'pending' | 'auto_rejected' | …
     esg_green_opportunities.status    'pending' | …
     esg_carbon_entries.is_provisional boolean
   `auto_rejected` proposals never reach a human, so they are outside the count
   for the same reason journeyEngine leaves them out of its denominator.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

/** Everything the shell may render, for one company.
 *
 *  Returns null when the user has no company — a state the auth layer allows —
 *  rather than a zeroed object, so the shell renders NO context instead of
 *  rendering "0 items need review" about a company that does not exist. */
async function load(companyId) {
  if (!companyId) return null;

  const { rows } = await query(
    `SELECT
       c.name                                                   AS company_name,
       (SELECT count(*)::int
          FROM esg_document_extractions e
          JOIN esg_documents d ON d.id = e.document_id
         WHERE d.company_id = c.id AND e.status = 'pending')     AS extractions_pending,
       (SELECT count(*)::int
          FROM esg_green_opportunities o
         WHERE o.company_id = c.id AND o.status = 'pending')     AS suggestions_pending,
       (SELECT count(*)::int
          FROM esg_carbon_entries ce
         WHERE ce.company_id = c.id AND ce.is_provisional)       AS carbon_provisional,
       (SELECT a.reporting_year
          FROM esg_assessments a
         WHERE a.company_id = c.id AND a.status <> 'archived'
         ORDER BY a.reporting_year DESC, a.created_at DESC
         LIMIT 1)                                                AS reporting_year
     FROM esg_companies c
    WHERE c.id = $1`, [companyId]);

  const r = rows[0];
  if (!r) return null;

  // The two that are WORK: a person has to look at each one and decide.
  const review = r.extractions_pending + r.suggestions_pending;

  return Object.freeze({
    companyName: r.company_name,
    reportingYear: r.reporting_year,
    review: Object.freeze({
      total: review,
      extractions: r.extractions_pending,
      suggestions: r.suggestions_pending,
    }),
    // NOT counted as review work. A provisional factor is a caveat on a figure,
    // not a task with a decision at the end of it, and folding the two together
    // would produce a number that means nothing in particular.
    provisionalCarbon: r.carbon_provisional,
  });
}

module.exports = { load };

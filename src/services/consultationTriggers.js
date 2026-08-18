'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   WHEN EXPERT SUPPORT IS WORTH RECOMMENDING                       (Run 63/P9)
   ───────────────────────────────────────────────────────────────────────────
   ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
   It is not a booking system, an availability calendar, a consultation record
   or a lead form. None of those exists on this platform and P9 did not build
   one. `/consultation` says so in those words.

   It is not "score below X, show the expert card" either. The directive rules
   that out explicitly, and it is right to: a score is a summary, and a summary
   is the worst possible trigger for advice — a company at 72 with every
   disclosure unreconciled needs more help than one at 55 with a clean, fully
   evidenced assessment.

   ── WHAT IT IS ───────────────────────────────────────────────────────────
   Six triggers, each testing a SITUATION rather than a number, each firing on
   rows this platform actually holds, and each carrying the sentence naming
   those rows. A trigger that cannot say what it fired on does not fire.

   ── ABOUT THE THRESHOLDS ─────────────────────────────────────────────────
   Every threshold is a product choice — there is no published standard for
   "how many unevidenced answers means get help". So they are CONFIGURED here,
   in one exported object, with the reasoning beside each; the consultation
   page RENDERS the threshold next to the trigger that fired, so a company can
   see the rule rather than being told a conclusion. That is the difference
   between a configured rule and a hidden one, and it is the whole of what the
   directive asks for.

   Nothing here writes, and nothing here calls a model.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

/** The configured thresholds. Exported so the suite can assert them and the
 *  page can print them — a threshold nobody can see is a hidden rule. */
const THRESHOLDS = Object.freeze({
  // Two of three pillars, because a gap confined to one pillar is a
  // to-do list and a gap spanning pillars is a programme.
  gapPillars: 2,

  // Five answers resting on nothing. Below that it is a morning's filing;
  // above it, the question is usually which documents a company is entitled to
  // treat as evidence at all, which is a judgement.
  unevidenced: 5,

  // One unreadable document is enough. A scan with no text layer cannot be
  // analysed by anything on this platform, and the alternatives — re-scanning
  // with OCR, or answering from it by hand — are a decision, not a click.
  unreadable: 1,

  // Half the readiness model unassessable. At that point the figure the
  // platform can publish says more about what it has not been told than about
  // the company.
  readinessUnassessableRatio: 0.5,

  // One unclassified project. No project type on this platform carries a
  // default taxonomy classification — nobody publishes one — so classifying a
  // project against CCPT or the ASEAN taxonomy is a judgement every time.
  unclassifiedProjects: 1,

  // Three gaps against draft mappings. A draft mapping is Modus's reading of
  // the framework and nobody has reconciled it line by line against the
  // publisher's document, so what the question is ASKING is itself open.
  draftMappingGaps: 3,
});

/** One trigger definition. `fires` and `because` are separate on purpose: a
 *  trigger that fires must always be able to say what it fired on, and keeping
 *  them apart is what makes that testable rather than hoped for. */
const TRIGGERS = Object.freeze([
  {
    code: 'GAPS_ACROSS_PILLARS',
    label: 'Improvement work spans more than one pillar',
    area: 'ESG improvement plan',
    support: 'Sequencing the work, and deciding what is worth doing first when environmental, '
           + 'social and governance gaps compete for the same month.',
    fires: (s) => s.gapPillars >= THRESHOLDS.gapPillars,
    because: (s) => `${s.gapCount} outstanding disclosure${s.gapCount === 1 ? '' : 's'} across `
                  + `${s.gapPillars} of the three pillars (the configured threshold is `
                  + `${THRESHOLDS.gapPillars}).`,
  },
  {
    code: 'UNEVIDENCED_ANSWERS',
    label: 'Several answers rest on nothing attached',
    area: 'Evidence and documentation',
    support: 'What counts as evidence for a given disclosure, and which of the documents a company '
           + 'already holds can properly be offered as one.',
    fires: (s) => s.unevidenced >= THRESHOLDS.unevidenced,
    because: (s) => `${s.unevidenced} answer${s.unevidenced === 1 ? '' : 's'} carry `
                  + `evidence_tier=self_declared (threshold ${THRESHOLDS.unevidenced}).`,
  },
  {
    code: 'UNREADABLE_DOCUMENTS',
    label: 'A document could not be read at all',
    area: 'Evidence and documentation',
    support: 'What to do with a scanned document the platform cannot extract text from — it cannot '
           + 'be analysed here, and answering from it by hand is a different piece of work.',
    fires: (s) => s.unreadable >= THRESHOLDS.unreadable,
    because: (s) => `${s.unreadable} document${s.unreadable === 1 ? '' : 's'} have text_status of `
                  + 'no_text_layer or failed.',
  },
  {
    code: 'READINESS_MOSTLY_UNASSESSABLE',
    label: 'Most of the finance readiness model cannot be assessed',
    area: 'Green finance readiness',
    support: 'Which of the missing inputs are worth assembling first, and what a Malaysian lender '
           + 'actually asks for at each stage.',
    fires: (s) => s.readinessMaximum > 0
      && (s.readinessMaximum - s.readinessAssessable) / s.readinessMaximum >= THRESHOLDS.readinessUnassessableRatio,
    because: (s) => `${s.readinessMaximum - s.readinessAssessable} of ${s.readinessMaximum} `
                  + 'readiness points cannot be assessed, which is at or over the configured '
                  + `${Math.round(THRESHOLDS.readinessUnassessableRatio * 100)}%.`,
  },
  {
    code: 'UNCLASSIFIED_PROJECT',
    label: 'A green project is not classified against any taxonomy',
    area: 'Green project definition',
    support: 'Placing the project under the Climate Change Mitigation or ASEAN taxonomy in the '
           + 'terms a credit paper uses. No project type on this platform carries a default, '
           + 'because no source publishes one.',
    fires: (s) => s.unclassifiedProjects >= THRESHOLDS.unclassifiedProjects,
    because: (s) => `${s.unclassifiedProjects} project${s.unclassifiedProjects === 1 ? '' : 's'} `
                  + 'have ccpt_category_code IS NULL.',
  },
  {
    code: 'DRAFT_MAPPING_GAPS',
    label: 'Outstanding disclosures rest on draft mappings',
    area: 'Assessment interpretation',
    support: 'What the underlying framework is actually asking for, where this platform\'s '
           + 'reading of it has not been reconciled line by line against the published document.',
    fires: (s) => s.draftMappingGaps >= THRESHOLDS.draftMappingGaps,
    because: (s) => `${s.draftMappingGaps} outstanding disclosure${s.draftMappingGaps === 1 ? '' : 's'} `
                  + `are against indicators with mapping_status='draft' (threshold `
                  + `${THRESHOLDS.draftMappingGaps}).`,
  },
]);

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIGNALS

   Every count comes from a row this database holds. Nothing is estimated and
   nothing is a score — the score is deliberately absent from this file, and
   the suite asserts that esg_scores is never read here.
   ═══════════════════════════════════════════════════════════════════════════ */
async function signals(companyId, assessmentId, readiness) {
  const [{ rows: gapRows }, { rows: evidence }, { rows: docs }, { rows: projects }] = await Promise.all([
    /* Outstanding disclosures, from the ENGINE's own recommendation rows.
       source='engine' only: the ai_phrasing sibling is the same gap said twice
       and counting both would double every figure on this page. */
    query(
      `SELECT count(DISTINCT r.indicator_id)::int AS trigger_gaps,
              count(DISTINCT r.pillar)::int       AS trigger_pillars,
              count(DISTINCT r.indicator_id) FILTER (WHERE i.mapping_status = 'draft')::int AS trigger_draft
         FROM esg_recommendations r
         JOIN esg_assessments a ON a.id = r.assessment_id
         LEFT JOIN esg_indicators i ON i.id = r.indicator_id
        WHERE a.company_id = $1 AND r.assessment_id = $2 AND r.source = 'engine'`,
      [companyId, assessmentId || null]),

    query(
      `SELECT count(*) FILTER (WHERE r.evidence_tier = 'self_declared' AND NOT r.is_na)::int AS trigger_unevidenced
         FROM esg_responses r
         JOIN esg_assessments a ON a.id = r.assessment_id
        WHERE a.company_id = $1 AND r.assessment_id = $2`, [companyId, assessmentId || null]),

    query(
      `SELECT count(*) FILTER (WHERE text_status IN ('no_text_layer','failed'))::int AS trigger_unreadable
         FROM esg_documents WHERE company_id = $1`, [companyId]),

    query(
      `SELECT count(*) FILTER (WHERE ccpt_category_code IS NULL)::int AS trigger_unclassified
         FROM esg_green_projects WHERE company_id = $1`, [companyId]),
  ]);

  return Object.freeze({
    // Unique `trigger_*` aliases, for the reason gatherDetail states: the
    // dashboard harness answers a query by matching its SQL, and two
    // aggregates sharing an alias are two queries it cannot tell apart.
    gapCount: gapRows[0].trigger_gaps,
    gapPillars: gapRows[0].trigger_pillars,
    draftMappingGaps: gapRows[0].trigger_draft,
    unevidenced: evidence[0].trigger_unevidenced,
    unreadable: docs[0].trigger_unreadable,
    unclassifiedProjects: projects[0].trigger_unclassified,
    readinessAssessable: readiness ? readiness.assessable : 0,
    readinessMaximum: readiness ? readiness.maximum : 0,
  });
}

/**
 * Whether expert support is worth recommending to this company, and why.
 *
 * `recommended` is true when ANY trigger fires. There is no "score" of
 * urgency: a threshold that has been crossed has been crossed, and ranking
 * them against each other would be a second invented model on top of six
 * configured rules.
 *
 * Returns null for no company. A company with an assessment that has never
 * been scored still gets a result — three of the six triggers do not need a
 * score, and reporting nothing at all would hide that.
 */
async function evaluate(companyId, assessmentId, readiness) {
  if (!companyId) return null;
  const s = await signals(companyId, assessmentId, readiness);

  const fired = TRIGGERS.filter((t) => t.fires(s)).map((t) => Object.freeze({
    code: t.code,
    label: t.label,
    area: t.area,
    support: t.support,
    because: t.because(s),
  }));

  // The areas, deduplicated and in trigger order — this is the "KEY AREAS"
  // list, and it is derived from what fired rather than being a fixed menu.
  const areas = [...new Set(fired.map((f) => f.area))];

  return Object.freeze({
    recommended: fired.length > 0,
    triggers: Object.freeze(fired),
    areas: Object.freeze(areas),
    considered: TRIGGERS.length,
    signals: s,
    thresholds: THRESHOLDS,
    /* THE HONEST STATE OF THE CAPABILITY ITSELF. Rendered on every surface
       that shows this, so a recommendation can never read as an offer. */
    booking: Object.freeze({
      built: false,
      detail: 'There is no consultation module on this platform: no availability, no booking, no '
            + 'record of a session and no fee. Nothing here schedules anything, and the journey '
            + 'stage for expert consultation stays blocked for exactly this reason.',
    }),
  });
}

module.exports = { evaluate, signals, TRIGGERS, THRESHOLDS };

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   ESG IMPACT — expected, baseline, actual                         (Run 62/P7)
   ───────────────────────────────────────────────────────────────────────────
   THE ONE RULE THIS FILE ENFORCES:

       EXPECTED IS NEVER ACTUAL.

   The three figures live in three places and this service never moves a value
   between them:

     EXPECTED   esg_green_projects.expected_benefit_*   a forecast, made before
                                                        the project exists
     BASELINE   esg_green_project_baselines kind=baseline   what was measured
                                                            BEFORE
     ACTUAL     esg_green_project_baselines kind=actual     what was measured
                                                            AFTER

   A variance is only computed between two things of the same kind. Comparing
   an actual against an expectation is reported as a FORECAST ACCURACY, never as
   an impact, because the expectation was never a measurement.

   MEASURED IS NOT VERIFIED either. A row exists as soon as the platform derives
   it from carbon entries; `verified_at` is set only when a person confirms it,
   and this service reports the two states separately.

   NOTHING HERE WRITES. Recording a measurement is baselineService's job.
   ═══════════════════════════════════════════════════════════════════════════ */

const { query } = require('../db');

/** The stages a project's impact can be at. Ordered: each implies the ones
 *  before it, and the UI renders the whole ladder with the current rung marked
 *  rather than a bare percentage. */
const STAGES = Object.freeze([
  { code: 'defined',     label: 'Project defined',   why: 'The project exists and has a title' },
  { code: 'expected',    label: 'Expected impact',   why: 'A forecast has been stated, with where it came from' },
  { code: 'baselined',   label: 'Baseline measured', why: 'What the project will be measured against' },
  { code: 'implementing', label: 'Implementing',     why: 'The company has started building it' },
  { code: 'measuring',   label: 'Measuring',         why: 'Implemented, and awaiting a reading' },
  { code: 'measured',    label: 'Actual measured',   why: 'A reading exists for a defined period' },
  { code: 'verified',    label: 'Verified',          why: 'A person has confirmed the reading' },
  { code: 'reported',    label: 'Reported',          why: 'Included in an ESG report' },
]);

/** Human labels for the metric vocabulary. The SAME vocabulary the baselines
 *  table and the project forecast both use — this only decides how it reads. */
const METRIC_LABEL = Object.freeze({
  electricity_kwh: { name: 'Electricity', unit: 'kWh' },
  fuel_litres:     { name: 'Fuel', unit: 'litres' },
  water_m3:        { name: 'Water', unit: 'm³' },
  waste_kg:        { name: 'Waste', unit: 'kg' },
  kg_co2e:         { name: 'Emissions', unit: 'kg CO2e' },
});

/** Where a figure came from, in the P6 vocabulary. */
const SOURCE_LABEL = Object.freeze({
  carbon_entries: 'Derived from your carbon entries',
  manual_entry:   'Entered by a person',
  document:       'Read from a document',
});
const BASIS_LABEL = Object.freeze({
  user_estimate:      'Your own estimate',
  supplier_quotation: 'A supplier quotation',
  engineering_study:  'An engineering study',
});

/** A DATE column, as a date.
 *
 *  node-postgres returns DATE as a JS Date, and String(aDate) is
 *  "Wed Jan 01 2025 00:00:00 GMT+0800 (Malaysia Time)" — so slicing ten
 *  characters off it yields "Wed Jan 01". That is the exact defect the original
 *  audit found on the carbon table, reintroduced here by this service until the
 *  rendered page showed it. Handles both shapes because a stubbed query returns
 *  the string form. */
function isoDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // LOCAL COMPONENTS, NOT toISOString(). A DATE column carries no timezone,
    // and node-postgres materialises it at LOCAL midnight — so in GMT+0800
    // toISOString() rolls 2025-01-01 back to "2024-12-31". The first fix here
    // used toISOString and shifted every period a day earlier; the rendered
    // page is where that showed, not the fixtures.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

/** The impact picture for one project.
 *
 *  Returns null when the project does not exist — not an empty picture, which
 *  would read as a project with no impact. */
async function forProject(companyId, projectId) {
  const { rows } = await query(
    `SELECT p.id, p.title, p.status, p.expected_benefit_metric, p.expected_benefit_value,
            p.expected_benefit_basis, p.ccpt_category_code
       FROM esg_green_projects p
      WHERE p.id = $1 AND p.company_id = $2`, [projectId, companyId]);
  const p = rows[0];
  if (!p) return null;

  const { rows: measurements } = await query(
    `SELECT b.id, b.kind, b.metric, b.value, b.unit, b.period_start, b.period_end,
            b.derived_from, b.source_entry_count, b.is_provisional,
            b.verified_at, b.verification_note, u.name AS verified_by_name
       FROM esg_green_project_baselines b
       LEFT JOIN esg_users u ON u.id = b.verified_by
      WHERE b.project_id = $1
      ORDER BY b.kind, b.metric, b.period_start`, [projectId]);

  const baselines = measurements.filter((m) => m.kind === 'baseline');
  const actuals = measurements.filter((m) => m.kind === 'actual');

  const expected = p.expected_benefit_metric ? Object.freeze({
    metric: p.expected_benefit_metric,
    label: (METRIC_LABEL[p.expected_benefit_metric] || {}).name || p.expected_benefit_metric,
    unit: (METRIC_LABEL[p.expected_benefit_metric] || {}).unit || '',
    value: p.expected_benefit_value === null || p.expected_benefit_value === undefined
      ? null : Number(p.expected_benefit_value),
    basis: p.expected_benefit_basis,
    basisLabel: BASIS_LABEL[p.expected_benefit_basis] || null,
    // STATED ON THE OBJECT ITSELF so no caller can render it without it.
    status: 'expected',
  }) : null;

  /* ── The comparison ───────────────────────────────────────────────────
     ONLY BETWEEN TWO MEASUREMENTS. baseline and actual are both readings of
     the same metric over different periods, so their difference is a real
     impact. The expectation is compared separately and labelled as forecast
     accuracy, never folded into the same number. */
  const byMetric = new Map();
  for (const m of [...baselines, ...actuals]) {
    if (!byMetric.has(m.metric)) byMetric.set(m.metric, { metric: m.metric, baseline: null, actual: null });
    const slot = byMetric.get(m.metric);
    if (m.kind === 'baseline') slot.baseline = m;
    else if (!slot.actual || m.period_end > slot.actual.period_end) slot.actual = m;
  }

  const comparisons = [...byMetric.values()].map((c) => {
    const meta = METRIC_LABEL[c.metric] || { name: c.metric, unit: '' };
    const hasBoth = c.baseline && c.actual;
    const change = hasBoth ? Number(c.actual.value) - Number(c.baseline.value) : null;
    return Object.freeze({
      metric: c.metric,
      label: meta.name,
      unit: meta.unit,
      baseline: c.baseline ? Object.freeze({
        value: Number(c.baseline.value),
        period: `${isoDate(c.baseline.period_start)} to ${isoDate(c.baseline.period_end)}`,
        source: SOURCE_LABEL[c.baseline.derived_from] || c.baseline.derived_from,
        provisional: c.baseline.is_provisional,
      }) : null,
      actual: c.actual ? Object.freeze({
        id: c.actual.id,
        value: Number(c.actual.value),
        period: `${isoDate(c.actual.period_start)} to ${isoDate(c.actual.period_end)}`,
        source: SOURCE_LABEL[c.actual.derived_from] || c.actual.derived_from,
        provisional: c.actual.is_provisional,
        // MEASURED vs VERIFIED, kept apart.
        status: c.actual.verified_at ? 'verified' : 'measured',
        verifiedAt: isoDate(c.actual.verified_at),
        verifiedBy: c.actual.verified_by_name || null,
        note: c.actual.verification_note || null,
      }) : null,
      // Impact: measurement minus measurement. Null unless BOTH exist.
      change,
      changeDirection: change === null ? null : (change < 0 ? 'down' : (change > 0 ? 'up' : 'flat')),
      // Forecast accuracy is a SEPARATE question and is only answerable when the
      // forecast is about this same metric.
      forecast: (expected && expected.metric === c.metric && expected.value !== null && c.actual)
        ? Object.freeze({ expected: expected.value, actual: Number(c.actual.value),
          difference: Number(c.actual.value) - expected.value })
        : null,
    });
  }).sort((a, b) => a.label.localeCompare(b.label));

  /* ── Where the project is ─────────────────────────────────────────────
     Derived from what exists, never stored. `reported` is unreachable today
     and says so: there is no reporting engine, so nothing can claim a project
     has been reported. */
  const has = {
    defined: true,
    expected: Boolean(expected && expected.value !== null),
    baselined: baselines.length > 0,
    implementing: ['implementing', 'implemented'].includes(p.status),
    measuring: p.status === 'implemented',
    measured: actuals.length > 0,
    verified: actuals.some((a) => a.verified_at),
    reported: false,
  };
  const reachedIndex = STAGES.reduce((last, s, i) => (has[s.code] ? i : last), 0);

  return Object.freeze({
    project: Object.freeze({ id: p.id, title: p.title, status: p.status, classified: Boolean(p.ccpt_category_code) }),
    expected,
    comparisons: Object.freeze(comparisons),
    stages: Object.freeze(STAGES.map((s, i) => Object.freeze({
      ...s,
      reached: Boolean(has[s.code]),
      current: i === reachedIndex,
      // The one stage that is blocked on a capability rather than on the company.
      blocked: s.code === 'reported',
    }))),
    currentStage: STAGES[reachedIndex].code,
    counts: Object.freeze({ baselines: baselines.length, actuals: actuals.length,
      verified: actuals.filter((a) => a.verified_at).length }),
  });
}

/** Every project's impact picture, for the company-level view. */
async function forCompany(companyId) {
  const { rows } = await query(
    `SELECT id FROM esg_green_projects WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
  const out = [];
  for (const r of rows) {
    const one = await forProject(companyId, r.id);
    if (one) out.push(one);
  }
  return out;
}

module.exports = { forProject, forCompany, STAGES, METRIC_LABEL, SOURCE_LABEL, BASIS_LABEL };

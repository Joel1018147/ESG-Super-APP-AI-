'use strict';
// ── SEDG v2 — the official disclosure set, as reference data ────────────────
//
// Simplified ESG Disclosure Guide, Version 2, Capital Markets Malaysia (an
// affiliate of the Securities Commission Malaysia), July 2025. 38 disclosures:
// 17 Environmental, 11 Social, 10 Governance.
//
// WHY THIS IS A STATIC MODULE AND NOT SEED DATA.
// Inserting these into `esg_indicators` is a Phase 2 decision, not an import:
//
//   1. `test/schema-idempotency-test.js:40` asserts `count(*) = 40` GLOBALLY,
//      not per framework. 40 + 38 = 78 goes red, and the right fix is to
//      re-scope that assertion per framework rather than bump the number —
//      bumping it re-arms the same trap at the next import.
//   2. Activating the SEDG framework row is a silent no-op. Both assessment
//      paths pick `ORDER BY effective_from DESC NULLS LAST`, and the SEDG row
//      has `effective_from = NULL`, so `is_active = true` alone changes
//      nothing and throws no error.
//   3. Roughly half of SEDG has no home in the current schema: 8 disclosures
//      are multi-line-item numerics, 8 are open lists, 3 are number+narrative.
//      `quantitative` stores one number; `multi_select` needs a fixed option
//      set. Seeding them anyway would make them silently unscorable —
//      `scoringEngine.js:92` returns null and drops them from BOTH numerator
//      and denominator, with no trace in the database.
//
// So this module is what the platform can honestly show today: the official
// set, verbatim, with its provenance, presented as the target to reconcile
// against — NOT as an implemented capability.
//
// Text is quoted from the publisher's PDF. Bullet sub-items appear as `•` in
// the source. Only E5.1 and E5.2 carry terminal full stops — the source's own
// inconsistency, reproduced rather than normalised.

const PROVENANCE = {
  document: 'Simplified ESG Disclosure Guide (SEDG), Version 2',
  publisher: 'Capital Markets Malaysia',
  publisherNote: 'an affiliate of the Securities Commission Malaysia',
  published: 'July 2025',
  count: 38,
  landing: 'https://sedg.capitalmarketsmalaysia.com/',
  pdf: 'https://sedg.capitalmarketsmalaysia.com/wp-content/uploads/2025/07/SEDG-v2.pdf',
  // The PDF's own OVERVIEW says "35 disclosures" three times — stale v1 wording
  // the publisher left in. The authoritative statement is in A SUMMARY OF
  // VERSION 2 UPDATE: three new disclosures "bring the total number of
  // disclosures to 38". Do not parse the count out of the document.
  countNote: 'The v2 PDF still says "35" in its overview — stale v1 wording. '
           + 'Three disclosures were added in v2 (E1.7, E3.1, S2.3), bringing the total to 38.',
};

const PILLARS = { E: 'Environmental', S: 'Social', G: 'Governance' };

// tier: Basic | Intermediate | Advanced   ·   newInV2: added in Version 2
const DISCLOSURES = [
  // ── Environmental — 17 ───────────────────────────────────────────────────
  { code: 'SEDG-E1.1', pillar: 'E', topic: 'Emissions', tier: 'Basic',
    text: 'Report total Scope 1 (direct) GHG emissions in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.2', pillar: 'E', topic: 'Emissions', tier: 'Basic',
    text: 'Report total Scope 2 (indirect) GHG emissions in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.3', pillar: 'E', topic: 'Emissions', tier: 'Intermediate',
    text: 'Report total Scope 1 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.4', pillar: 'E', topic: 'Emissions', tier: 'Intermediate',
    text: 'Report total Scope 2 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.5', pillar: 'E', topic: 'Emissions', tier: 'Advanced',
    text: 'Report total Scope 3 (other indirect) GHG emissions in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.6', pillar: 'E', topic: 'Emissions', tier: 'Advanced',
    text: 'Report total Scope 3 GHG emissions reduced as a direct result of reduction initiatives, in metric tonnes of CO2 equivalent',
    unit: 'tCO2e' },
  { code: 'SEDG-E1.7', pillar: 'E', topic: 'Emissions', tier: 'Advanced', newInV2: true,
    text: 'Report total Scope 1 and 2 GHG intensity in metric tonnes CO2 equivalent per unit of organisation-specific metrics',
    unit: 'tCO2e per unit (ratio)' },
  { code: 'SEDG-E2.1', pillar: 'E', topic: 'Energy', tier: 'Basic',
    text: 'Report the consumption of the following in joules or watthours: • Renewable fuel sources • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable)',
    unit: 'J / Wh × 6' },
  { code: 'SEDG-E2.2', pillar: 'E', topic: 'Energy', tier: 'Intermediate',
    text: 'Report the reduction in consumption of the following (achieved as a direct result of conservation and efficiency initiatives) in joules or watthours: • Non-renewable fuel sources • Electricity • Heating (if applicable) • Cooling (if applicable) • Steam (if applicable)',
    unit: 'J / Wh × 5' },
  { code: 'SEDG-E3.1', pillar: 'E', topic: 'Water', tier: 'Basic', newInV2: true,
    text: 'Report the total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable)',
    unit: 'litres × 5' },
  { code: 'SEDG-E3.2', pillar: 'E', topic: 'Water', tier: 'Intermediate',
    text: 'Report the reduction in total water withdrawn from all areas, and a breakdown of this total by type in litres: • Purchased water • Surface water (if applicable) • Groundwater (if applicable) • Seawater (if applicable) • Produced water (if applicable)',
    unit: 'litres × 5' },
  { code: 'SEDG-E4.1', pillar: 'E', topic: 'Waste', tier: 'Basic',
    text: 'Report total waste in metric tonnes: • Generated • Diverted from disposal • Directed to disposal',
    unit: 'tonnes × 3' },
  { code: 'SEDG-E4.2', pillar: 'E', topic: 'Waste', tier: 'Intermediate',
    text: 'Report total waste generated, diverted from disposal, and directed to disposal, each broken down into metric tonnes of: • Hazardous and non-hazardous waste • Sector specific waste streams • Material composition',
    unit: 'tonnes × 3×3' },
  { code: 'SEDG-E4.3', pillar: 'E', topic: 'Waste', tier: 'Advanced',
    text: 'Report total hazardous and non-hazardous waste diverted from disposal broken down into the following recovery streams in metric tonnes: • Preparation for reuse • Recycling • Other recovery options',
    unit: 'tonnes × 3' },
  { code: 'SEDG-E4.4', pillar: 'E', topic: 'Waste', tier: 'Advanced',
    text: 'Report total hazardous and non-hazardous waste directed to disposal broken down into the following disposal streams in metric tonnes: • Incineration (with energy recovery) • Incineration (without energy recovery) • Landfilling • Other disposal options',
    unit: 'tonnes × 4' },
  { code: 'SEDG-E5.1', pillar: 'E', topic: 'Materials', tier: 'Basic',
    text: "List the materials and total weights used to produce and package the company's primary products and services in metric tonnes, if any.",
    unit: 'list + tonnes' },
  { code: 'SEDG-E5.2', pillar: 'E', topic: 'Materials', tier: 'Advanced',
    text: "Report the percentage of recycled input materials used to manufacture the company's primary products and services.",
    unit: '%' },

  // ── Social — 11 ──────────────────────────────────────────────────────────
  { code: 'SEDG-S1.1', pillar: 'S', topic: 'Human Rights and Labour Practices', tier: 'Basic',
    text: 'Report the number and nature of child labour and forced labour incidents, if any',
    unit: 'number + narrative, ×2' },
  { code: 'SEDG-S1.2', pillar: 'S', topic: 'Human Rights and Labour Practices', tier: 'Intermediate',
    text: 'List the operations and suppliers considered to have significant risk for incidents of child labour and forced labour, including: • Type of operation or supplier • Locations at risk',
    unit: 'list ×2' },
  { code: 'SEDG-S2.1', pillar: 'S', topic: 'Employee Management', tier: 'Basic',
    text: 'Report the average hours of training per employee',
    unit: 'hours' },
  { code: 'SEDG-S2.2', pillar: 'S', topic: 'Employee Management', tier: 'Intermediate',
    text: 'Report the total number of employees and the turnover rate',
    unit: 'number + %' },
  { code: 'SEDG-S2.3', pillar: 'S', topic: 'Employee Management', tier: 'Basic', newInV2: true,
    text: 'Report the percentage of employees meeting or above applicable minimum wage laws, if any',
    unit: '%' },
  { code: 'SEDG-S3.1', pillar: 'S', topic: 'Diversity, Equity and Inclusion', tier: 'Basic',
    text: "Report the percentage of the company's employees by: • Gender • Age",
    unit: '% ×2' },
  { code: 'SEDG-S3.2', pillar: 'S', topic: 'Diversity, Equity and Inclusion', tier: 'Intermediate',
    text: "Report the percentage of the company's directors by: • Gender • Age",
    unit: '% ×2' },
  { code: 'SEDG-S4.1', pillar: 'S', topic: 'Occupational Health and Safety', tier: 'Basic',
    text: 'Report the number of fatalities and injuries in the company, if any',
    unit: 'number ×2' },
  { code: 'SEDG-S4.2', pillar: 'S', topic: 'Occupational Health and Safety', tier: 'Intermediate',
    text: 'Report the total number and percentage of employees trained on health and safety standards',
    unit: 'number + %' },
  { code: 'SEDG-S5.1', pillar: 'S', topic: 'Community Engagement', tier: 'Basic',
    text: 'Report the total amount of community investments and donations',
    unit: 'MYR' },
  { code: 'SEDG-S5.2', pillar: 'S', topic: 'Community Engagement', tier: 'Advanced',
    text: "List the company's operations with negative impact on local communities",
    unit: 'list' },

  // ── Governance — 10 ──────────────────────────────────────────────────────
  { code: 'SEDG-G1.1', pillar: 'G', topic: 'Governance Structure', tier: 'Basic',
    text: 'Report the number of directors in the company',
    unit: 'number' },
  { code: 'SEDG-G1.2', pillar: 'G', topic: 'Governance Structure', tier: 'Intermediate',
    text: 'List the governance structure of the board, including committees of the board and management, if applicable',
    unit: 'structure / list' },
  { code: 'SEDG-G2.1', pillar: 'G', topic: 'Policy Commitments', tier: 'Basic',
    text: "List the company's policies, including but not limited to: • Code of Conduct • Anti-Corruption Policy • Whistleblowing Policy • Health and Safety Policy",
    unit: 'list' },
  { code: 'SEDG-G3.1', pillar: 'G', topic: 'Risk Management and Reporting', tier: 'Basic',
    text: 'Report the year of the last submitted audited financial report',
    unit: 'year' },
  { code: 'SEDG-G3.2', pillar: 'G', topic: 'Risk Management and Reporting', tier: 'Intermediate',
    text: 'List the risks of company operations and activities, including but not limited to: • Regulatory compliance risk • Business continuity risk',
    unit: 'list' },
  { code: 'SEDG-G3.3', pillar: 'G', topic: 'Risk Management and Reporting', tier: 'Advanced',
    text: 'List the sustainability risks of company if applicable, including but not limited to: • Climate-related physical risk • Climate-related transition risk',
    unit: 'list' },
  { code: 'SEDG-G4.1', pillar: 'G', topic: 'Anti-Corruption', tier: 'Basic',
    text: 'Report the total number and nature of confirmed incidents of corruption, if any',
    unit: 'number + narrative' },
  { code: 'SEDG-G4.2', pillar: 'G', topic: 'Anti-Corruption', tier: 'Intermediate',
    text: "Report the total number and percentage of employees who have received training on the company's anti-bribery and anti-corruption policy",
    unit: 'number + %' },
  { code: 'SEDG-G4.3', pillar: 'G', topic: 'Anti-Corruption', tier: 'Advanced',
    text: 'List the significant risks related to corruption',
    unit: 'list' },
  { code: 'SEDG-G5.1', pillar: 'G', topic: 'Customer Privacy', tier: 'Intermediate',
    text: 'Report the total number and nature of substantiated complaints received concerning breaches of customer privacy and loss of customer data, if any',
    unit: 'number + narrative' },
];

// Other frameworks a Malaysian SME's customer may ask for. NAMED, NOT FAKED —
// none of these is loaded, mapped or scored, and saying so is the point.
const OTHER_FRAMEWORKS = [
  { name: 'ASEAN SEDG', note: 'SEDG v2 is fully aligned with it (ASEAN Capital Markets Forum, April 2025)' },
  { name: 'ISSB IFRS S1 / S2', note: 'Referenced per topic by SEDG, never per disclosure' },
  { name: 'NSRF', note: 'National Sustainability Reporting Framework' },
  { name: 'GRI', note: 'Referenced per topic by SEDG' },
  { name: 'SASB', note: 'Not referenced by SEDG' },
  { name: 'TCFD', note: 'Not referenced against any SEDG topic — IFRS S1/S2 are themselves TCFD-aligned' },
  { name: 'UN SDGs', note: 'Not referenced per disclosure' },
  { name: 'Bursa Malaysia', note: 'Referenced per topic by SEDG' },
];

// Counts are DERIVED, never written down twice. A hand-maintained "38" beside a
// list that can be edited is a claim waiting to go stale.
const byPillar = (p) => DISCLOSURES.filter((d) => d.pillar === p);
const byTier   = (t) => DISCLOSURES.filter((d) => d.tier === t);

const COUNTS = {
  total: DISCLOSURES.length,
  pillars: { E: byPillar('E').length, S: byPillar('S').length, G: byPillar('G').length },
  tiers: {
    Basic: byTier('Basic').length,
    Intermediate: byTier('Intermediate').length,
    Advanced: byTier('Advanced').length,
  },
};

/** Grouped pillar → topic → disclosures, in source order. */
function grouped() {
  return ['E', 'S', 'G'].map((p) => {
    const topics = [];
    for (const d of byPillar(p)) {
      let t = topics.find((x) => x.topic === d.topic);
      if (!t) { t = { topic: d.topic, disclosures: [] }; topics.push(t); }
      t.disclosures.push(d);
    }
    return { pillar: p, pillarName: PILLARS[p], topics };
  });
}

module.exports = { PROVENANCE, PILLARS, DISCLOSURES, OTHER_FRAMEWORKS, COUNTS, grouped };

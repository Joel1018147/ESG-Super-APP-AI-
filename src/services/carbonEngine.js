'use strict';
// Scope 1 and Scope 2 calculation.
//
// One rule governs this file: THE FACTOR IS STAMPED ONTO THE ENTRY, never
// joined at read time. This is the same decision as storing SST on a Commerce
// transaction. Malaysia's Grid Emission Factor is republished by the Energy
// Commission; the day a new one lands, a join-at-read design would silently
// restate every tonne this platform has ever reported — including figures
// already inside submitted reports and grant applications.

const { query } = require('../db');

/** Pick the open factor for a code. Throws rather than defaulting: a missing
 *  factor must stop the calculation, not quietly produce a plausible number. */
async function currentFactor(code) {
  const { rows } = await query(
    `SELECT id, code, factor_value, unit_from, unit_to, version,
            source_name, verification_status
       FROM esg_emission_factors
      WHERE code = $1 AND valid_to IS NULL`, [code]);
  if (!rows[0]) throw new Error(`No current emission factor for '${code}'`);
  return rows[0];
}

const GRID_FACTOR_BY_REGION = Object.freeze({
  peninsular: 'GEF_PENINSULAR',
  sabah:      'GEF_SABAH',
  sarawak:    'GEF_SARAWAK',
});

/**
 * Scope 2 from grid electricity.
 * gridRegion is REQUIRED. Peninsular and Sarawak differ by 3.7x, so a default
 * would not be a convenience — it would be a wrong answer with no warning.
 */
async function electricityToCo2e(kwh, gridRegion) {
  const code = GRID_FACTOR_BY_REGION[gridRegion];
  if (!code) {
    throw new Error(
      `Grid region required for Scope 2. Got '${gridRegion}'. ` +
      `Malaysia has three grids and their factors differ by up to 3.7x.`);
  }
  const n = Number(kwh);
  if (!Number.isFinite(n) || n < 0) throw new Error('Electricity consumption must be a number >= 0');
  const f = await currentFactor(code);
  return buildEntry(n, 'kWh', f);
}

/** Scope 1 from litres of fuel. */
async function fuelToCo2e(litres, fuelCode) {
  const n = Number(litres);
  if (!Number.isFinite(n) || n < 0) throw new Error('Fuel volume must be a number >= 0');
  const f = await currentFactor(fuelCode);
  return buildEntry(n, 'litre', f);
}

function buildEntry(amount, unit, f) {
  if (f.unit_from !== unit) {
    throw new Error(`Factor ${f.code} converts from ${f.unit_from}, not ${unit}`);
  }
  if (f.verification_status === 'superseded') {
    throw new Error(`Factor ${f.code} v${f.version} is superseded and must not be used`);
  }
  const value = Number(f.factor_value);
  return {
    activity_amount: amount,
    activity_unit:   unit,
    factor_id:               f.id,
    factor_value_used:       value,
    factor_version_used:     f.version,
    factor_source_used:      f.source_name,
    factor_verification_used: f.verification_status,
    // A number computed from an unverified factor is still useful internally,
    // but it must never leave this system looking verified. Every renderer
    // reads THIS flag; none of them re-derives it.
    is_provisional: f.verification_status !== 'verified',
    kg_co2e: Math.round(amount * value * 10000) / 10000,
  };
}

module.exports = { currentFactor, electricityToCo2e, fuelToCo2e, buildEntry, GRID_FACTOR_BY_REGION };

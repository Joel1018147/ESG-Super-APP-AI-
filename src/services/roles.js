'use strict';
// One place that decides what a role string means.

const CANON = {
  super_admin:  'super_admin',
  admin:        'super_admin',
  owner:        'company_admin',
  company_admin:'company_admin',
  esg_manager:  'esg_manager',
  manager:      'esg_manager',
  contributor:  'contributor',
  staff:        'contributor',
  auditor:      'auditor',
  consultant:   'consultant',
  gov_officer:  'gov_officer',
};

const ALL_ROLES = Object.freeze([...new Set(Object.values(CANON))]);

// An unrecognised role normalises to null, which no allow-list contains — a
// typo reaches nothing rather than inheriting whatever the weakest granted set
// happens to be.
function normaliseRole(r) {
  if (!r) return null;
  return CANON[String(r).trim().toLowerCase()] || null;
}

// Where a role lands after login. Deliberately explicit: an auditor sent to a
// page they cannot open reads the refusal as an outage.
function homePathForRole(role) {
  switch (normaliseRole(role)) {
    case 'super_admin': return '/admin';
    case 'auditor':
    case 'gov_officer': return '/dashboard';
    default:            return '/dashboard';
  }
}

module.exports = { CANON, ALL_ROLES, normaliseRole, homePathForRole };

'use strict';

const { normaliseRole, homePathForRole } = require('../services/roles');

const wantsJson = (req) =>
  req.xhr ||
  req.path.startsWith('/api/') ||
  req.originalUrl.startsWith('/api/') ||
  (req.headers.accept || '').includes('application/json');

const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/auth/login');
};

// A 403 that RENDERS IN PLACE. Never a redirect: sending a denied user to
// /dashboard is safe only while /dashboard admits everybody, and the moment it
// does not, two denials become a loop that logs someone out of a page they
// never asked for.
function forbidden(req, res) {
  const home = homePathForRole(req.user && req.user.role);
  if (wantsJson(req)) {
    return res.status(403).json({ error: 'Forbidden', home });
  }
  const { layout, esc } = require('../utils/layout');
  const role = normaliseRole(req.user && req.user.role) || 'unassigned';
  return res.status(403).send(layout('No Access', `
    <div class="empty-state">
      <div class="es-icon">🔒</div>
      <h3>You do not have access to this page</h3>
      <p>Your account is set to <strong>${esc(role)}</strong>, and this area is not
         part of that role's work. This is deliberate, not a fault.</p>
      <a href="${esc(home)}" class="btn btn-primary" style="margin-top:16px">← Back to your home page</a>
    </div>`, req.user, ''));
}

const requireRoles = (...roles) => {
  const allowed = new Set(roles.map(normaliseRole).filter(Boolean));
  const mw = (req, res, next) => {
    if (!(req.isAuthenticated && req.isAuthenticated())) return requireAuth(req, res, next);
    const r = normaliseRole(req.user && req.user.role);
    if (r && allowed.has(r)) return next();
    return forbidden(req, res);
  };
  mw.allowedRoles = [...allowed];
  return mw;
};

// Named rather than requireAuth so that "reviewed, open to every signed-in
// user" is visible in server.js instead of being indistinguishable from a mount
// nobody thought about.
const requireAnyRole = (req, res, next) => requireAuth(req, res, next);

// Read-only roles must not be able to POST. Checked on the METHOD, so adding a
// new write route under an existing mount cannot quietly grant them writes.
const denyWritesForReadOnly = (req, res, next) => {
  const r = normaliseRole(req.user && req.user.role);
  const readOnly = r === 'auditor' || r === 'gov_officer';
  if (readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return forbidden(req, res);
  return next();
};

module.exports = { requireAuth, requireRoles, requireAnyRole, denyWritesForReadOnly, wantsJson, forbidden };

'use strict';

const { normaliseRole, homePathForRole } = require('../services/roles');
const previewLock = require('../utils/previewLock');

/* THE HOME PATHS THAT ACTUALLY RESOLVE.
   homePathForRole() is a product statement about where a role belongs; this is
   the check that the statement points at a route this app serves. '/admin' is
   deliberately absent — it is what homePathForRole returns for a super_admin
   and there is no such route, which is the defect this set exists to absorb
   until either the route is built or the mapping is changed. Asserted in
   test/roles-test.js against the real router stack, so this cannot rot. */
const ROUTED_HOMES = new Set(['/dashboard']);

const wantsJson = (req) =>
  req.xhr ||
  req.path.startsWith('/api/') ||
  req.originalUrl.startsWith('/api/') ||
  (req.headers.accept || '').includes('application/json');

// PRIVATE PREVIEW, LAYER 3. Every authenticated path goes through requireAuth,
// so this is the one place that can promise a session belonging to a refused
// address cannot be used — including sessions that predate the lock and any
// credential path added later that forgets layers 1 and 2. It destroys the
// session rather than only refusing, so a signed-in visitor is not left
// bouncing off every page. See previewLock.js.
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return previewLock.guardSession(req, res, next);
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
  /* P10 · off the 🔒 emoji and onto the product's own empty state, for the
     reason P8 gave when it removed every other emoji: fifteen multi-coloured
     glyphs in a monochrome interface were the strongest "generated template"
     signal the audit found. This surface was not in P8's list.

     The destination is checked too. homePathForRole() returns '/admin' for a
     super_admin and NO SUCH ROUTE EXISTS — measured: a signed-in GET /admin
     answers 404 — so this button sent the one role that can reach the most
     pages to a dead end. It now falls back to a path that resolves. */
  const { layout, esc, emptyState } = require('../utils/layout');
  const role = normaliseRole(req.user && req.user.role) || 'unassigned';
  const dest = ROUTED_HOMES.has(home) ? home : '/dashboard';
  return res.status(403).send(layout('No Access', `
    <div class="esg-page">
      ${emptyState('zero', {
    title: 'This area is not part of your role',
    body: `Your account is set to ${role}, and this page belongs to a different part of the `
        + 'work. That is deliberate, not a fault — nothing is broken and nothing was lost.' })}
      <div class="esg-row">
        <a href="${esc(dest)}" class="btn btn-primary">Back to your home page</a>
      </div>
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

/* Read-only roles must not be able to POST. Checked on the METHOD, so adding a
   new write route under an existing mount cannot quietly grant them writes.

   P10 CLOSED A FAIL-OPEN HERE, and the interesting part is that the module it
   depends on already claimed the opposite. roles.js says of normaliseRole:
   "An unrecognised role normalises to null, which no allow-list contains — a
   typo reaches nothing rather than inheriting whatever the weakest granted set
   happens to be." That is true of requireRoles, which is an ALLOW-list. This
   is a DENY-list, and null fell straight through it: a user whose role string
   was not recognised could write.

   NOT REACHABLE TODAY, and the audit checked rather than assumed: the only two
   writers of esg_users.role are registration and the Google callback, and both
   hardcode 'company_admin'. But esg_users.role is plain `text` with no CHECK
   constraint, so an off-list value is storable, and the first admin screen that
   sets a role would make this live.

   WRITES NOW REQUIRE A ROLE THIS APP RECOGNISES. An unrecognised role is
   treated as read-only — the same answer requireRoles already gives it —
   rather than as "not one of the two read-only roles, therefore allowed". */
const WRITE_METHODS_ALLOWED_FOR = new Set([
  'super_admin', 'company_admin', 'esg_manager', 'contributor', 'consultant',
]);

const denyWritesForReadOnly = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const r = normaliseRole(req.user && req.user.role);
  if (!r || !WRITE_METHODS_ALLOWED_FOR.has(r)) return forbidden(req, res);
  return next();
};

module.exports = { requireAuth, requireRoles, requireAnyRole, denyWritesForReadOnly, wantsJson, forbidden };

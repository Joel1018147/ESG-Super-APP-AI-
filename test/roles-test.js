'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   ROLES AND THE AUTHORISATION BOUNDARY                          (Run 64/P10)
   ───────────────────────────────────────────────────────────────────────────
   services/roles.js and middleware/auth.js decide who may do what, and until
   P10 neither had a single test. The P10 audit found two things in them that a
   test would have caught the day they were written:

     1. denyWritesForReadOnly WAS FAIL-OPEN. roles.js documents normaliseRole
        as failing closed — "a typo reaches nothing" — and that is true of
        requireRoles, which is an ALLOW-list. denyWritesForReadOnly is a
        DENY-list, and an unrecognised role fell straight through it.

     2. homePathForRole('super_admin') RETURNS A PATH THAT DOES NOT EXIST.
        Measured: a signed-in GET /admin answers 404. The 403 page's only
        button sent the one role that can reach the most pages nowhere.

   Both are guarded below, against the REAL router stack rather than a list of
   paths written here — a hand-kept list is what let /admin rot in the first
   place.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

const roles = require('../src/services/roles');
const auth = require('../src/middleware/auth');

console.log('roles-test');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · NORMALISATION FAILS CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */

test('an unrecognised role normalises to null, never to a real one', () => {
  for (const bad of ['typo_role', 'ADMINISTRATOR', 'root', '', '   ', null, undefined, 0, {}, []]) {
    assert.strictEqual(roles.normaliseRole(bad), null,
      `${JSON.stringify(bad)} normalised to ${JSON.stringify(roles.normaliseRole(bad))} — an `
      + 'unrecognised role must reach nothing, not inherit a granted set');
  }
});

test('every alias resolves to a canonical role, and canonical roles are stable', () => {
  for (const [alias, canon] of Object.entries(roles.CANON)) {
    assert.strictEqual(roles.normaliseRole(alias), canon, `${alias} -> ${canon}`);
    assert.ok(roles.ALL_ROLES.includes(canon), `${canon} is not in ALL_ROLES`);
    // Idempotent: normalising a canonical role returns itself.
    assert.strictEqual(roles.normaliseRole(canon), canon, `${canon} is not stable under normalisation`);
  }
  assert.strictEqual(roles.ALL_ROLES.length, 7,
    `${roles.ALL_ROLES.length} canonical roles — adding one is a deliberate act, and every '
    + 'allow-list in the app has to be revisited when it happens`);
});

test('normalisation is case- and whitespace-insensitive, which the login path relies on', () => {
  assert.strictEqual(roles.normaliseRole('  AUDITOR  '), 'auditor');
  assert.strictEqual(roles.normaliseRole('Company_Admin'), 'company_admin');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE WRITE BOUNDARY FAILS CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */

/** Run denyWritesForReadOnly and report which way it went, without a server. */
function writeAttempt(role, method = 'POST') {
  let outcome = 'no decision';
  const req = { user: { role }, method, path: '/carbon', originalUrl: '/carbon', headers: {} };
  const res = {
    status() { return res; },
    json() { outcome = 'refused'; return res; },
    send() { outcome = 'refused'; return res; },
  };
  auth.denyWritesForReadOnly(req, res, () => { outcome = 'allowed'; });
  return outcome;
}

test('a READ-ONLY role cannot write', () => {
  for (const r of ['auditor', 'gov_officer']) {
    assert.strictEqual(writeAttempt(r), 'refused', `${r} was allowed to POST`);
  }
});

test('a WRITING role still can — the boundary did not become a wall', () => {
  for (const r of ['super_admin', 'company_admin', 'esg_manager', 'contributor', 'consultant']) {
    assert.strictEqual(writeAttempt(r), 'allowed', `${r} was refused a POST it should be allowed`);
  }
});

test('AN UNRECOGNISED ROLE CANNOT WRITE — the fail-open P10 closed', () => {
  for (const bad of ['typo_role', '', null, undefined, 'AUDITORR', 'superadmin']) {
    assert.strictEqual(writeAttempt(bad), 'refused',
      `a user whose role is ${JSON.stringify(bad)} was allowed to POST. roles.js documents an `
      + 'unrecognised role as reaching nothing; a deny-list that only names the two read-only '
      + 'roles grants writes to everything it does not recognise');
  }
});

test('every canonical role is decided, one way or the other', () => {
  // A role that is neither on the write list nor on the read-only list would be
  // silently refused for a reason nobody wrote down. Assert the partition is
  // total, so adding a role to roles.js forces a decision here.
  for (const r of roles.ALL_ROLES) {
    const out = writeAttempt(r);
    assert.ok(out === 'allowed' || out === 'refused',
      `${r} produced "${out}" — the write boundary reached no decision for a real role`);
  }
});

test('a GET is never refused by the write boundary, whatever the role', () => {
  for (const r of [...roles.ALL_ROLES, 'typo_role', null]) {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      assert.strictEqual(writeAttempt(r, m), 'allowed',
        `${m} was refused for ${r} — this middleware guards writes, and a read-only role must `
        + 'still be able to read');
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · EVERY HOME PATH RESOLVES TO A ROUTE THIS APP SERVES

   Derived from the REAL routers. /admin rotted precisely because nothing
   compared the mapping against the router stack.
   ═══════════════════════════════════════════════════════════════════════════ */

function servedGetPaths() {
  const served = new Set();
  const dir = path.join(__dirname, '..', 'src', 'routes');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'api.js' || f === 'auth.js') continue;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const router = require(path.join(dir, f));
    for (const layer of router.stack) {
      if (layer.route && layer.route.methods.get) served.add(layer.route.path);
    }
  }
  return served;
}

test('EVERY home path a role can be sent to is a route this app actually serves', () => {
  const served = servedGetPaths();
  assert.ok(served.size > 20, `only ${served.size} GET routes discovered — the scan found nothing`);
  const broken = [];
  for (const r of [...roles.ALL_ROLES, 'typo_role', null]) {
    const home = roles.homePathForRole(r);
    if (!served.has(home)) broken.push(`${r || 'unrecognised'} -> ${home}`);
  }
  assert.deepStrictEqual(broken, [],
    `a role's home page has no route: ${broken.join(', ')}. homePathForRole is a product `
    + 'statement about where a role belongs, and a statement pointing at a 404 is worse than no '
    + 'statement — it is the destination of the only button on the 403 page');
});

test('the 403 page never offers a destination that has no route', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'auth.js'), 'utf8');
  const set = src.match(/ROUTED_HOMES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(set, 'ROUTED_HOMES is gone — the 403 destination is unguarded again');
  const listed = [...set[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const served = servedGetPaths();
  for (const p of listed) {
    assert.ok(served.has(p), `ROUTED_HOMES contains ${p}, which no router serves`);
  }
  assert.ok(!listed.includes('/admin'),
    'ROUTED_HOMES contains /admin. If the admin route has genuinely been built, delete this '
    + 'assertion deliberately; if not, the 403 is pointing at a 404 again');
});

console.log(`\nroles: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

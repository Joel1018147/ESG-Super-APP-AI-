#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   RUN A COMMAND AGAINST THE STAGING DATABASE, WITHOUT EVER PRINTING A SECRET
   ───────────────────────────────────────────────────────────────────────────
   Invoked as:

       railway run -- node scripts/with-staging.js npm test

   `railway run` injects the linked service's variables into this process. This
   script builds DATABASE_URL from them and spawns the command with it. The URL
   is assembled IN MEMORY and never written to a file, an argument or stdout —
   which is the whole point: `railway variables` (without --kv) prints real
   secret values, and anything that captures them puts them in a transcript.

   WHY IT BUILDS THE URL RATHER THAN READING ONE. CLAUDE.md documents this and
   it is easy to get wrong: the Railway Postgres template never publishes
   DATABASE_PUBLIC_URL, not even with the TCP proxy on. The signal that the
   database is reachable from outside is RAILWAY_TCP_PROXY_DOMAIN /
   RAILWAY_TCP_PROXY_PORT. Production has neither, deliberately; staging has
   both. So this script REFUSES to run when they are absent, rather than
   falling back to DATABASE_URL — which on a Railway host is the *.internal
   address and would fail with a DNS error that reads like a network blip.

   IT ALSO REFUSES TO RUN AGAINST PRODUCTION. `test/smoke-test.js` registers
   companies and never cleans up. The guard is on PGDATABASE's own host: if the
   proxy vars are missing we are not looking at staging, full stop.
   ═══════════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(
      `\n✖ ${name} is not set in this process.\n\n` +
      '  This script must be run through Railway, linked to the Postgres service\n' +
      '  of the ESG AI+ Staging project:\n\n' +
      '      railway link            # choose "ESG AI+ Staging", then Postgres\n' +
      '      railway run -- node scripts/with-staging.js npm test\n\n' +
      '  If RAILWAY_TCP_PROXY_DOMAIN is the missing one, the database you are\n' +
      '  linked to has no public networking — production is like this on\n' +
      '  purpose. Do not work around it; link to staging instead.\n');
    process.exit(2);
  }
  return v;
};

const user = need('PGUSER');
const pass = need('PGPASSWORD');
const host = need('RAILWAY_TCP_PROXY_DOMAIN');
const port = need('RAILWAY_TCP_PROXY_PORT');
const db   = need('PGDATABASE');

const cmd = process.argv.slice(2);
if (!cmd.length) {
  console.error('usage: node scripts/with-staging.js <command> [args...]');
  process.exit(2);
}

// Reported so a reader can see WHICH database this ran against without the
// credentials being anywhere near the output.
console.log(`▸ staging: ${db} @ ${host}:${port} (user ${user.slice(0, 2)}…)`);

const child = spawn(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`,
  },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code === null ? 1 : code)));

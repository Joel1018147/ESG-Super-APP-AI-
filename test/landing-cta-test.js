'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE LANDING IS THE FRONT DOOR, SIGNED IN OR NOT            (Run 148 ruling)
   ───────────────────────────────────────────────────────────────────────────
   `/` used to 302 an authenticated visitor to /dashboard. Joel's ruling of
   2026-09-04 is that the platform URL always answers with the platform's front
   page — the link someone was sent must not be silently replaced by a
   different page depending on who clicks it.

   Removing that redirect on its own would have shipped a defect, and it is the
   defect the old code comment predicted: a page telling a signed-in user to
   "Sign in" reads as being logged out. So the page asks /session-state and
   relabels. This file guards BOTH halves — the redirect staying gone, and the
   labels being honest — because either alone is wrong.

   TWO SECTIONS, AND THE FIRST ALWAYS RUNS.
   §1 is static and needs nothing installed. It is the half that catches the
   regression that actually matters: somebody re-adding the redirect.
   §2 drives a real browser and needs Playwright, which THIS REPO DOES NOT
   HAVE — it borrows the sibling M-EasyDo install. When that is missing the
   section says SKIPPED in as many words and the suite still passes, the same
   way green-finance-register-test.js reports its skipped DB checks. A skip
   that announces itself is honest; a skip that reports "0 failed" and looks
   like coverage is not.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── §1  static: the route, the endpoint, and the markup that drives them ────
console.log('\n── §1  the front door is unconditional ─────────────────────');

const rootRoute = SERVER.match(/app\.get\('\/',[\s\S]*?\n\}\);/);
ok('the `/` route exists', !!rootRoute);
ok('`/` NEVER redirects — it only sends the landing file',
  rootRoute && !/redirect/.test(rootRoute[0]),
  rootRoute ? rootRoute[0].split('\n').find((l) => /redirect/.test(l)) : 'route missing');
ok('`/` sends public/index.html',
  rootRoute && /sendFile[\s\S]*public['"/\\ ,)]*index\.html/.test(rootRoute[0]));

ok('/session-state exists', /app\.get\('\/session-state'/.test(SERVER));
ok('/session-state answers a bare boolean and nothing else',
  /res\.json\(\{\s*signedIn:/.test(SERVER) && !/req\.user\.(email|name)/.test(SERVER.slice(SERVER.indexOf("'/session-state'"))));
ok('/session-state is uncacheable — a cached answer outlives the session',
  /'\/session-state'[\s\S]{0,220}Cache-Control['"],\s*['"]no-store/.test(SERVER));

// Ordering is the whole correctness of the endpoint: mounted above the session
// middleware, req.isAuthenticated does not exist and it would answer `false`
// for everyone, forever, without erroring.
const iSession = SERVER.indexOf('passport.session()');
const iState = SERVER.indexOf("app.get('/session-state'");
ok('/session-state is mounted AFTER passport.session()',
  iSession > -1 && iState > iSession, `passport.session()@${iSession} vs endpoint@${iState}`);

console.log('\n── §1b  the page is wired to relabel itself ────────────────');
ok('the page asks /session-state', /fetch\('\/session-state'/.test(INDEX));
ok('it acts only on an explicit `signedIn === true`',
  /state\.signedIn\s*!==\s*true/.test(INDEX));
ok('a failed lookup leaves the CTAs as authored',
  /session-state unreachable/.test(INDEX));
ok('CTAs carry relabel hooks', (INDEX.match(/data-authed-label/g) || []).length >= 5,
  `${(INDEX.match(/data-authed-label/g) || []).length} found`);
ok('redundant sign-in controls carry hide hooks',
  (INDEX.match(/data-authed-hide/g) || []).length >= 3,
  `${(INDEX.match(/data-authed-hide/g) || []).length} found`);
// [hidden]{display:none} is UA-origin and .lp-btn's author-origin
// display:inline-flex beats it, so the attribute alone leaves a "hidden"
// button rendering. The inline style is the part that actually hides it.
ok('hiding sets an inline display, not just the hidden attribute',
  /\.style\.display\s*=\s*'none'/.test(INDEX));

// ── §2  live: the same page, relabelled, in a real browser ──────────────────
console.log('\n── §2  rendered behaviour ──────────────────────────────────');

let chromium = null;
for (const p of [
  path.join(ROOT, 'node_modules', 'playwright'),
  path.join(ROOT, '..', 'M-EasyDo-AI', 'node_modules', 'playwright'),
]) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next one */ }
}

if (!chromium) {
  console.log('  ⚠ SKIPPED — Playwright is not installed in this repo and the');
  console.log('    sibling M-EasyDo-AI copy was not found. §1 still ran and');
  console.log('    still guards the redirect. THIS IS NOT A PASS for §2.');
  console.log(`\nlanding-cta-test: ${pass} passed, ${fail} failed, §2 SKIPPED`);
  process.exit(fail ? 1 : 0);
}

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4',
};
const PUBLIC = path.join(ROOT, 'public');
let signedIn = false;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/session-state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ signedIn }));
  }
  if (url === '/preview-state') {                  // the lock is off in prod
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ locked: false }));
  }
  const file = path.join(PUBLIC, url === '/' ? '/index.html' : url);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const read = (page) => page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      text: (el.textContent || '').trim().slice(0, 40),
      href: el.getAttribute('href'),
      display: getComputedStyle(el).display,
    };
  };
  return {
    utilSignIn: pick('.lp-util a[data-authed-hide]'),
    navCta: pick('.lp-nav-cta a.lp-btn'),
    heroCta: pick('.lp-hero-cta a.lp-btn-light'),
    startNow: pick('a.lp-more[data-authed-label]'),
    startNowSvg: !!document.querySelector('a.lp-more[data-authed-label] svg'),
    footerSignIn: pick('.lp-footer-actions a.lp-btn-ghost'),
    reachableAuth: [...document.querySelectorAll('a[href^="/auth/"]')]
      .filter((a) => getComputedStyle(a).display !== 'none' && a.offsetParent !== null)
      .map((a) => (a.textContent || '').trim().slice(0, 22) + ' -> ' + a.getAttribute('href')),
  };
});

(async () => {
  const PORT = 4501 + (process.pid % 200);
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const url = `http://127.0.0.1:${PORT}/`;

  // anonymous — nothing may change
  signedIn = false;
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  let s = await read(page);
  ok('anonymous: the landing renders', !!s.navCta);
  ok('anonymous: the nav CTA still offers registration',
    s.navCta && s.navCta.href === '/auth/register', s.navCta && s.navCta.href);
  ok('anonymous: sign-in stays visible', s.utilSignIn && s.utilSignIn.display !== 'none');
  await ctx.close();

  // signed in — same page, honest labels
  signedIn = true;
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  const statuses = [];
  page.on('response', (r) => { if (r.url() === url) statuses.push(r.status()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  s = await read(page);
  ok('signed in: `/` still answers 200 with the landing, never a redirect',
    statuses[0] === 200, 'status=' + statuses[0]);
  ok('signed in: the nav CTA points at the dashboard',
    s.navCta && s.navCta.href === '/dashboard' && /dashboard/i.test(s.navCta.text),
    s.navCta && `${s.navCta.text} -> ${s.navCta.href}`);
  ok('signed in: the hero CTA points at the dashboard',
    s.heroCta && s.heroCta.href === '/dashboard', s.heroCta && `${s.heroCta.text} -> ${s.heroCta.href}`);
  ok('signed in: relabelling keeps the arrow icon',
    s.startNow && s.startNow.href === '/dashboard' && s.startNowSvg);
  ok('signed in: redundant sign-in is COMPUTED display:none',
    s.utilSignIn && s.utilSignIn.display === 'none' && s.footerSignIn && s.footerSignIn.display === 'none',
    s.utilSignIn && `util=${s.utilSignIn.display} footer=${s.footerSignIn.display}`);
  ok('signed in: no REACHABLE sign-in link remains',
    s.reachableAuth.length === 0, s.reachableAuth.join(' | '));
  await ctx.close();

  await browser.close();
  server.close();
  console.log(`\nlanding-cta-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('landing-cta-test HARNESS FAILURE:', e.message);
  try { server.close(); } catch { /* already down */ }
  process.exit(1);
});

'use strict';
// Server-rendered shell. Design system only — no inline colour, spacing or
// typography anywhere in this app. Every colour resolves through a CSS variable
// that EXISTS: a custom property that merely looks like a token fails silently,
// nothing throws, and the element renders transparent. The [data-platform="esg"]
// block was added to modus-design-system.css for exactly that reason.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CSS_PATH = path.join(__dirname, '../../public/css/modus-design-system.css');
const MODUS_CSS = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf8') : '';

// ── How the design system is delivered ──────────────────────────────────────
//
// LINKED, with the token block inlined as a floor.
//
// It used to be inlined whole — all 2,450 lines, ~97 KB, on EVERY response.
// The comment justifying that (inherited from Commerce) claimed it "serves the
// same bytes as a cached static file". That is false: an inline <style> is
// re-sent on every navigation, a linked stylesheet is fetched once. Seven page
// views cost ~700 KB instead of ~120 KB, and these users are Malaysian SMEs
// often on mobile data.
//
// But inlining did buy one real thing: the shell could never render unstyled,
// because the styles arrived in the same response as the markup. Simply
// switching to <link> would trade a bandwidth problem for a silent-failure
// problem — a broken static mount renders every page transparent, with no
// warning and nothing thrown, which is the exact class of fault the token
// guards in test/no-model-figures-test.js exist to catch.
//
// So: link the full sheet, and inline ONLY the custom-property blocks (~2 KB).
// If the stylesheet fails to load the page is unstyled but the COLOURS still
// resolve, so nothing renders invisible. Best of both, and the floor is small
// enough that per-response cost stops mattering.
function extractBlocks(css, selectors) {
  const out = [];
  for (const sel of selectors) {
    // Selectors arrive RAW and are escaped here, once. Escaping them at the
    // call site as well produced a floor that silently contained only :root —
    // the accent and dark-mode blocks matched nothing, and the page still
    // looked fine in dev because the linked stylesheet supplied them. The
    // fallback would only have failed on the day the fallback was needed.
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchored at line start, so `[data-theme="dark"]` cannot also swallow
    // `[data-theme="dark"][data-platform="esg"]`.
    const re = new RegExp('^' + escaped + '\\s*\\{[^}]*\\}', 'gm');
    const found = css.match(re);
    if (found) out.push(...found);
  }
  return out.join('\n');
}

// Order matters: later blocks must win the cascade, exactly as in the file.
const TOKENS_CSS = extractBlocks(MODUS_CSS, [
  ':root',
  '[data-platform="esg"]',
  '[data-theme="dark"]',
  '[data-theme="dark"][data-platform="esg"]',
]);

// A floor that is missing its blocks is worse than no floor, because it fails
// only in the situation it exists for. Assert at boot rather than discover it
// during an outage.
for (const [what, present] of [
  ['tokens',        /--accent:/.test(TOKENS_CSS)],
  ['esg accent',    /#4D7C0F/i.test(TOKENS_CSS)],
  ['dark mode',     /\[data-theme="dark"\]/.test(TOKENS_CSS)],
]) {
  if (MODUS_CSS && !present) {
    console.warn(`⚠️  Inlined CSS floor is missing its ${what} block — if the ` +
                 `stylesheet fails to load, pages will render without it.`);
  }
}

// Cache-buster. express.static serves this with maxAge 7d in production, and
// the stylesheet is SYNCED FROM MASTER by a separate ecosystem process (see
// commit 08dac9b). Without a content-derived query, a sync would land and
// every returning user would keep the old sheet for up to a week — an
// ecosystem-wide accent change that appears to have silently not worked.
const CSS_VERSION = crypto.createHash('sha256').update(MODUS_CSS).digest('hex').slice(0, 8);
const CSS_HREF = `/css/modus-design-system.css?v=${CSS_VERSION}`;

// Boot-time assertion. If the accent block is missing, every page renders in
// Commerce blue and nobody notices for a month.
if (MODUS_CSS && !MODUS_CSS.includes('[data-platform="esg"]')) {
  console.warn('⚠️  modus-design-system.css has no [data-platform="esg"] block — ' +
               'the ESG accent will silently fall back to the :root default.');
}

// One entry per requirement section, grouped. `group` drives the sidebar
// headings, and GROUPS decides the order the headings appear in.
//
// CONTIGUITY IS NOT LOAD-BEARING, and this comment said it was until Run 47.
// The renderer below is `GROUPS.map(g => MODULES.filter(m => m.group === g))` —
// it FILTERS, so an entry sitting anywhere in this array renders under its own
// heading regardless of what surrounds it. Keeping the groups contiguous is
// still worth doing because it makes the array readable, but a future edit that
// breaks contiguity breaks nothing, and a comment that overstates a constraint
// is the kind of thing someone later designs around. The artefact wins.
const GROUPS = ['ASSESS', 'FINANCE', 'EVIDENCE', 'INTELLIGENCE', 'ADMINISTRATION'];

const MODULES = [
  { key: 'dashboard',    group: 'ASSESS',         icon: '⊞',  label: 'Dashboard',       path: '/dashboard' },
  // ONE entry, not two. Missions live on the journey page because a mission is
  // a stage's predicate with an XP price on it — the same fact, from the same
  // function — and two pages rendering one set of facts is how the two
  // renderings end up disagreeing. Nothing was removed to make room, and
  // BOTTOM_NAV_KEYS is untouched (see the comment below it for why that must
  // never happen as a side effect).
  { key: 'journey',      group: 'ASSESS',         icon: '🧭', label: 'ESG Journey',     path: '/journey' },
  { key: 'company',      group: 'ASSESS',         icon: '🏢', label: 'Company Profile', path: '/company' },
  { key: 'assessment',   group: 'ASSESS',         icon: '📋', label: 'ESG Assessment',  path: '/assessment' },
  { key: 'carbon',       group: 'ASSESS',         icon: '🌱', label: 'Carbon',          path: '/carbon' },
  { key: 'greenFinance', group: 'FINANCE',        icon: '💰', label: 'Green Finance',   path: '/green-finance' },
  { key: 'documents',    group: 'EVIDENCE',       icon: '📁', label: 'Evidence',        path: '/documents' },
  { key: 'frameworks',   group: 'EVIDENCE',       icon: '📚', label: 'Frameworks',      path: '/frameworks' },
  { key: 'reports',      group: 'EVIDENCE',       icon: '📄', label: 'Reports',         path: '/reports' },
  { key: 'analytics',    group: 'INTELLIGENCE',   icon: '📈', label: 'Analytics',       path: '/analytics' },
  { key: 'kpis',         group: 'INTELLIGENCE',   icon: '🎯', label: 'KPIs',            path: '/kpis' },
  { key: 'assistant',    group: 'INTELLIGENCE',   icon: '🤖', label: 'AI Assistant',    path: '/assistant' },
  { key: 'workflow',     group: 'ADMINISTRATION', icon: '🔀', label: 'Workflow',        path: '/workflow' },
  { key: 'users',        group: 'ADMINISTRATION', icon: '👥', label: 'Users & Roles',   path: '/users' },
  { key: 'integrations', group: 'ADMINISTRATION', icon: '🔌', label: 'Integrations',    path: '/integrations' },
  { key: 'governance',   group: 'ADMINISTRATION', icon: '🔎', label: 'Governance & Recognition', path: '/governance' },
];

// The bottom nav is FIVE, named explicitly. It used to be `MODULES.slice(0, 5)`,
// which was correct only while MODULES happened to start with the five that
// belong on a phone. Adding Carbon at position four would have silently pushed
// Reports out and pulled Carbon in — a nav change nobody made, caused by an
// edit somewhere else entirely.
const BOTTOM_NAV_KEYS = ['dashboard', 'company', 'assessment', 'documents', 'reports'];

// ── Framework display names ────────────────────────────────────────────────
// The seed data is TRUE: the working framework really was authored by Modus AI
// Associates, and seed.sql keeps saying so. It just never reaches a screen.
// Render through this map, never `framework.name` / `.publisher` / `.code` raw.
const FRAMEWORK_DISPLAY = {
  'MODUS_SEDG_ALIGNED@0.9-draft': 'SME ESG Assessment (SEDG-aligned, draft)',
  'MODUS_SEDG_ALIGNED': 'SME ESG Assessment (SEDG-aligned, draft)',
  'SEDG@2.0': 'Simplified ESG Disclosure Guide v2',
  'SEDG': 'Simplified ESG Disclosure Guide',
  'VERRA_VCS@4.x': 'Carbon crediting registry standard (public reference)',
  'VERRA_VCS': 'Carbon crediting registry standard (public reference)',
};

/** Display name for a framework. Falls back to a neutral label rather than to
 *  the raw name — a missing map entry must not leak the publisher string. */
function frameworkLabel(code, version) {
  if (!code) return 'Assessment framework';
  return FRAMEWORK_DISPLAY[`${code}@${version || ''}`]
      || FRAMEWORK_DISPLAY[code]
      || 'Assessment framework';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Chrome-free shell for signed-out pages: login, register, 404 and the error
 *  page. Same tokens, same theme toggle, no navigation. */
function bareLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en" data-platform="esg" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Malaysia SMEs ESG e-Reporting System</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${TOKENS_CSS}</style>
<link rel="stylesheet" href="${CSS_HREF}">
<style>
body{background:var(--bg)}
.bare-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.bare-brand{display:flex;align-items:center;gap:10px;font-weight:700;margin-bottom:20px;color:var(--text);text-align:center;justify-content:center;font-size:15px}
.bare-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.bare-content{width:100%;max-width:460px}
</style>
</head>
<body>
<div class="bare-wrap">
  <div class="bare-brand"><span class="bare-dot"></span> Malaysia SMEs ESG e-Reporting System</div>
  <div class="bare-content">${content}</div>
</div>
<script>
(function(){
  var KEY='modus-theme', saved=null;
  try{saved=localStorage.getItem(KEY);}catch(e){console.warn('theme preference unreadable:',e&&e.message);}
  if(saved)document.documentElement.setAttribute('data-theme',saved);
})();
</script>
</body></html>`;
}

function layout(title, content, user, activePath = '') {
  // SIGNED OUT MEANS NO CHROME.
  //
  // This used to render the sidebar and a "Sign out" button unconditionally,
  // so the login page offered an anonymous visitor seven links to pages that
  // immediately bounce them, and invited them to sign out of a session they do
  // not have. Every one of those links reads as broken, and a first-time SME
  // owner meets the product by clicking one and being refused.
  //
  // Keyed on `user` being absent, which is exactly the condition the auth
  // pages already pass in — no new flag to keep in sync.
  if (!user) return bareLayout(title, content);

  const initials = (user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase();

  // ── THE SHELL IS THE DESIGN SYSTEM'S, NOT THIS REPO'S ────────────────────
  //
  // This function used to hand-roll the entire app shell — .app, .sidebar,
  // .nav-item, .main, .topbar, .content, .bottom-nav — in an inline <style>
  // block of about forty lines, while the design system shipped .app-layout /
  // .app-sidebar / .app-topbar / .app-main / .app-bottom-nav and a full
  // .sidebar-* component set that MODUS_UI_CONTRACT §4.3 already specifies as
  // the contract. Two shells, one of them local, is the divergence the whole
  // contract exists to remove, and it is why three classes (.nav-icon,
  // .nav-label, .bn-label) existed here that nothing anywhere defined.
  //
  // Using the master's components buys three things beyond conformance: the
  // responsive behaviour at ≤768px comes with them, both themes are already
  // authored (the sidebar reads --brand, which is dark in BOTH themes — that
  // is the command-centre surface, deliberately), and this file no longer has
  // an opinion about colour or spacing at all.
  const nav = GROUPS.map((g) => {
    const items = MODULES.filter((m) => m.group === g);
    if (!items.length) return '';
    const links = items.map((m) => {
      const active = activePath === m.path ? ' active' : '';
      return `<a class="sidebar-item${active}" href="${esc(m.path)}"${activePath === m.path ? ' aria-current="page"' : ''}>
        <span class="sidebar-item-icon" aria-hidden="true">${m.icon}</span>${esc(m.label)}</a>`;
    }).join('');
    return `<div class="sidebar-section-label">${esc(g)}</div>${links}`;
  }).join('');

  const bottomNav = BOTTOM_NAV_KEYS.map((k) => MODULES.find((m) => m.key === k)).filter(Boolean).map((m) => {
    const active = activePath === m.path ? ' active' : '';
    return `<a class="bottom-nav-item${active}" href="${esc(m.path)}"${activePath === m.path ? ' aria-current="page"' : ''}>
      <span class="bottom-nav-item-icon" aria-hidden="true">${m.icon}</span>${esc(m.label)}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en" data-platform="esg" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Malaysia SMEs ESG e-Reporting System</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
<style>${TOKENS_CSS}</style>
<link rel="stylesheet" href="${CSS_HREF}">
<style>
/* Two layout utilities and one state border. Nothing themeable: every value
   below is geometry or a token, and there is no colour literal in this file. */
.grid{display:grid;gap:16px}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.provisional{border-left:3px solid var(--amber)}
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-layout">
  <aside class="app-sidebar">
    <a class="sidebar-logo" href="/dashboard">
      <span class="sidebar-brand-dot" aria-hidden="true">ESG</span>
      <span class="sidebar-brand">Malaysia SMEs ESG e-Reporting System<em>Governance &amp; Recognition</em></span>
    </a>
    <nav class="sidebar-nav" aria-label="Sections">${nav}</nav>
    <div class="sidebar-footer">
      <a class="sidebar-user" href="/company">
        <span class="sidebar-user-avatar" aria-hidden="true">${esc(initials)}</span>
        <span class="sidebar-user-info">
          <span class="sidebar-user-name">${esc(user?.name || user?.email || 'Your company')}</span>
          <span class="sidebar-user-plan">${esc(user?.email || '')}</span>
        </span>
      </a>
      <a class="sidebar-logout" href="/auth/logout">Sign out</a>
    </div>
  </aside>
  <header class="app-topbar">
    <h1 class="topbar-title">${esc(title)}</h1>
    <div class="topbar-right">
      <button class="btn btn-outline btn-sm" id="themeBtn" type="button" aria-label="Switch between light and dark">◐</button>
    </div>
  </header>
  <main class="app-main" id="main-content">${content}</main>
</div>
<nav class="app-bottom-nav" aria-label="Sections"><div class="bottom-nav-inner">${bottomNav}</div></nav>
<script>
(function(){
  var KEY='modus-theme';
  var saved=null;
  try{saved=localStorage.getItem(KEY);}catch(e){console.warn('theme preference unreadable:',e&&e.message);}
  if(saved)document.documentElement.setAttribute('data-theme',saved);
  var b=document.getElementById('themeBtn');
  if(b)b.addEventListener('click',function(){
    var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem(KEY,next);}catch(e){console.warn('theme preference not saved:',e&&e.message);}
  });
})();
(function(){
  /* §50's .reveal RESTS VISIBLE and is hidden only under [data-reveal="on"],
     which is set here AFTER confirming there is an IntersectionObserver to turn
     it back on again. If this script never runs, never loads, or throws, the
     content is simply visible — the opposite arrangement makes the page depend
     on a script it cannot check and fails silently to exactly the users least
     able to report it. ONE definition, in the shell, so no page carries a
     second copy of it. */
  if(!('IntersectionObserver' in window))return;
  var nodes=document.querySelectorAll('.reveal');
  if(!nodes.length)return;
  document.documentElement.setAttribute('data-reveal','on');
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting)return;
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    });
  },{rootMargin:'0px 0px -40px 0px'});
  nodes.forEach(function(n){io.observe(n);});
})();
</script>
</body></html>`;
}

/** Empty state renderer that keeps the three cases apart. Telling an owner a
 *  capability they HAVE does not exist is the most expensive error this system
 *  can make: they never look for it again. */
function emptyState(state, opts = {}) {
  const map = {
    uninstrumented: {
      icon: '🧩',
      title: opts.title || 'Not connected yet',
      body: opts.body || 'Nothing writes to this yet. It is not switched on, rather than empty.',
    },
    instrumented_but_empty: {
      icon: '⏳',
      title: opts.title || 'Ready, but nothing recorded',
      body: opts.body || 'This is switched on and working — nobody has entered anything yet.',
    },
    zero: {
      icon: '✓',
      title: opts.title || 'Genuinely zero',
      body: opts.body || 'This has been measured and the answer is zero.',
    },
  };
  const s = map[state] || map.instrumented_but_empty;
  return `<div class="empty-state"><div class="es-icon">${s.icon}</div>
    <h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`;
}

module.exports = {
  layout, bareLayout, esc, emptyState, MODULES, GROUPS, BOTTOM_NAV_KEYS,
  frameworkLabel, TOKENS_CSS, CSS_HREF, CSS_VERSION,
};

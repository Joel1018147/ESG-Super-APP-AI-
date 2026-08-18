'use strict';
// Server-rendered shell. Design system only — no inline colour, spacing or
// typography anywhere in this app. Every colour resolves through a CSS variable
// that EXISTS: a custom property that merely looks like a token fails silently,
// nothing throws, and the element renders transparent. The [data-platform="esg"]
// block was added to modus-design-system.css for exactly that reason.

// ── ESG DEFAULTS TO DARK ────────────────────────────────────────────────────
// Ruled by Joel, 2026-08-17, Run 54. Both shells emit data-theme="dark" on
// <html>; the boot script still reads localStorage['modus-theme'] and overrides
// before first paint, so a user who has chosen light keeps light and §4.4's
// shared key is untouched. Only the DEFAULT moved.
//
// The reason, recorded because a default with no reason gets flipped back: this
// platform's composition is built on deep surfaces and luminous rails, and
// those do not carry on a white background. A platform whose design direction
// is dark should not open light and wait to be corrected.
//
// MODUS_UI_CONTRACT's ONE RULE is amended in the same change: the permitted
// difference between two platforms is now the accent colour AND the default
// theme. Both are per-platform values in a shared file; neither changes layout,
// component set, spacing or behaviour. A third axis needs its own ruling.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CSS_PATH = path.join(__dirname, '../../public/css/modus-design-system.css');
const MODUS_CSS = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf8') : '';

// ── The ESG layer ───────────────────────────────────────────────────────────
//
// A SECOND, ADDITIVE sheet — never an edit to the one above. MODUS_UI_CONTRACT
// §1 makes a per-repo edit to the master a defect and §1b makes any addition a
// thirteen-path fan-out; test/dashboard-test.js pins the master's md5 and fails
// the moment either happens. That pin is untouched and must stay untouched.
//
// Linked rather than inlined for the same reason the master is: an inline
// <style> is re-sent on every navigation. It loads AFTER the master so that,
// for the few places both could match, the local layer is the more specific
// one by document order — but nothing in it overrides a master component. Every
// class it defines is `esg-` prefixed.
const ESG_CSS_PATH = path.join(__dirname, '../../public/css/esg-system.css');
const ESG_CSS = fs.existsSync(ESG_CSS_PATH) ? fs.readFileSync(ESG_CSS_PATH, 'utf8') : '';

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

// Its own cache-buster, derived from its own bytes. The ESG layer changes on a
// different cadence from the master sync, so sharing one version would either
// re-fetch both on any change or serve a stale layer after a local edit.
const ESG_CSS_VERSION = crypto.createHash('sha256').update(ESG_CSS).digest('hex').slice(0, 8);
const ESG_CSS_HREF = `/css/esg-system.css?v=${ESG_CSS_VERSION}`;

// Boot-time assertion, matching the one below it. A missing layer is silent:
// every esg- class stops applying and pages render as unstyled blocks inside
// styled chrome, which reads as a broken page rather than a missing file.
if (!ESG_CSS) {
  console.warn('⚠️  public/css/esg-system.css is missing or empty — every esg- component ' +
               'will render unstyled. The master sheet cannot substitute for it.');
}

// Boot-time assertion. If the accent block is missing, every page renders in
// Commerce blue and nobody notices for a month.
if (MODUS_CSS && !MODUS_CSS.includes('[data-platform="esg"]')) {
  console.warn('⚠️  modus-design-system.css has no [data-platform="esg"] block — ' +
               'the ESG accent will silently fall back to the :root default.');
}

// ═══════════════════════════════════════════════════════════════════════════
// THE NAVIGATION MODEL                                              (Run 62/P3)
// ───────────────────────────────────────────────────────────────────────────
// TIER IS PRIORITY. BUILT IS STATE. They are two axes and were previously one.
//
// The old model grouped by subject matter — ASSESS / FINANCE / EVIDENCE /
// INTELLIGENCE / ADMINISTRATION — which described the route list rather than
// the product. It put seven unbuilt pages at the same level as working ones,
// gave the whole INTELLIGENCE heading to three placeholders, and promoted
// Reports (unbuilt) into the five-item phone bar while Green Finance and the
// Journey fell off it entirely.
//
//   tier   what this destination is FOR, and therefore how prominent it is
//   built  whether it does anything yet
//
// An unbuilt destination renders in ONE collapsed group at the bottom, whatever
// its tier — it is not hidden (the product's honesty rule says an absent
// capability is stated, not concealed) and it is not promoted. When it ships,
// flip `built` and it appears under its own tier with no other edit.
//
// EXTENSIBILITY IS THE POINT. P7's Impact / SustNET / Certification
// destinations are new rows with a tier, and the sidebar, the phone bar and the
// overflow sheet all follow from that. No structural rewrite.
const TIERS = [
  { key: 'primary',        label: 'ESG programme' },
  { key: 'secondary',      label: 'What it unlocks' },
  { key: 'impact',         label: 'Impact' },
  { key: 'contextual',     label: 'Reference' },
  { key: 'administrative', label: 'Administration' },
];

// A 16px stroke glyph set, replacing the emoji the audit identified as the
// strongest "generated template" signal in the interface: fifteen multi-coloured
// emoji in a monochrome dark UI, at fifteen different optical weights, fighting
// the status colours that actually carry meaning. These are one weight, one
// size, and inherit currentColor, so an active item's icon changes with it.
const ICONS = {
  dashboard:  '<path d="M2.5 2.5h5v5h-5zM8.5 2.5h5v5h-5zM2.5 8.5h5v5h-5zM8.5 8.5h5v5h-5"/>',
  journey:    '<path d="M4 13.5c0-3 8-3 8-6a2.5 2.5 0 0 0-5 0"/><circle cx="4" cy="13.5" r="1.4"/><circle cx="12" cy="4" r="1.4"/>',
  assessment: '<path d="M4 2.5h8v11H4zM6.2 6h3.6M6.2 9h3.6"/>',
  evidence:   '<path d="M3 4.5h4l1.2 1.5H13v7H3zM3 4.5v-1h3"/>',
  carbon:     '<path d="M8 14V7M8 7c0-2.5 2-4.5 5-4.5 0 3-2 4.5-5 4.5M8 9.5C8 8 6.5 6.5 4 6.5c0 2 1.5 3 4 3"/>',
  finance:    '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v6M6.3 6.4h3.4M6.3 9.6h3.4"/>',
  projects:   '<path d="M8 2.5 14 6l-6 3.5L2 6zM2 10l6 3.5L14 10"/>',
  ai:         '<path d="M8 2.5v11M2.5 8h11M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/>',
  company:    '<path d="M3 13.5v-9l5-2v11M8 13.5h5v-7H8M5 6.5h1M5 9h1M10.4 9h1"/>',
  frameworks: '<path d="M2.5 3.5h4v9h-4zM7 3.5h3v9H7zM11 4l2.5.6-1.8 8.2L11 12"/>',
  governance: '<path d="M8 2.2 13 4v4.2c0 3-2.2 4.7-5 5.6-2.8-.9-5-2.6-5-5.6V4z"/><path d="M6 8l1.5 1.6L10.3 6.6"/>',
  future:     '<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2.2"/>',
  more:       '<path d="M2.5 5h11M2.5 8h11M2.5 11h11"/>',
  // The three empty states, drawn so they cannot be mistaken for each other:
  // nothing is wired, wired but waiting, and measured.
  unplugged:  '<path d="M5.5 2.5v4M10.5 2.5v4M3.5 6.5h9v2a4.5 4.5 0 0 1-9 0zM8 13v.5"/>',
  waiting:    '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8V8l2.2 1.6"/>',
  measured:   '<circle cx="8" cy="8" r="5.5"/><path d="M5.4 8.2l1.8 1.8 3.4-3.8"/>',
};

function icon(name) {
  const d = ICONS[name] || ICONS.future;
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
}

const MODULES = [
  // ── PRIMARY · the loop ────────────────────────────────────────────────────
  { key: 'dashboard',   tier: 'primary', built: true, bottom: true, icon: 'dashboard',  label: 'Dashboard',      short: 'Home',     path: '/dashboard' },
  { key: 'journey',     tier: 'primary', built: true, bottom: true, icon: 'journey',    label: 'ESG Journey',    short: 'Journey',  path: '/journey' },
  { key: 'assessment',  tier: 'primary', built: true, bottom: true, icon: 'assessment', label: 'ESG Assessment', short: 'Assess',   path: '/assessment' },
  { key: 'documents',   tier: 'primary', built: true, bottom: true, icon: 'evidence',   label: 'Evidence',       short: 'Evidence', path: '/documents' },
  { key: 'carbon',      tier: 'primary', built: true,               icon: 'carbon',     label: 'Carbon',         short: 'Carbon',   path: '/carbon' },

  // ── SECONDARY · what running the loop unlocks ─────────────────────────────
  // The last two were REACHABLE ONLY BY TYPING THE URL. Nothing linked them,
  // yet journey stages 9 and 10 require them, so two required stages had no
  // route from the interface. Giving them a home is a navigation fix, not a
  // new feature.
  //
  // P9 PUT IMPROVEMENT FIRST IN THIS TIER, and that is the ordering decision
  // the whole run rests on: improvement is what the assessment is FOR, and
  // before P9 it had no destination at all — the roadmap lived as three
  // recommendations on the dashboard with no account of the other thirty.
  // Everything below it in this tier is downstream of it.
  { key: 'improvement',   tier: 'secondary', built: true, icon: 'ai',       label: 'Improvement',    path: '/improvement' },
  { key: 'greenFinance',  tier: 'secondary', built: true, icon: 'finance',  label: 'Green Finance',  path: '/green-finance' },
  { key: 'greenProjects', tier: 'secondary', built: true, icon: 'projects', label: 'Green projects', path: '/green-finance/projects' },
  { key: 'readiness',     tier: 'secondary', built: true, icon: 'finance',  label: 'Finance readiness', path: '/green-finance/readiness' },
  { key: 'opportunities', tier: 'secondary', built: true, icon: 'ai',       label: 'AI suggestions', path: '/green-finance/opportunities' },

  // ── CONTEXTUAL · consulted while doing the work, not a destination ────────
  { key: 'impact',     tier: 'impact',     built: true, icon: 'carbon',     label: 'ESG Impact',      path: '/impact' },
  { key: 'company',    tier: 'contextual', built: true, icon: 'company',    label: 'Company Profile', path: '/company' },
  { key: 'frameworks', tier: 'contextual', built: true, icon: 'frameworks', label: 'Frameworks',      path: '/frameworks' },
  { key: 'governance', tier: 'contextual', built: true, icon: 'governance', label: 'Governance & Recognition', path: '/governance' },

  /* P9 · TWO DESTINATIONS THAT ARE BUILT AND ARE NOT WHAT THEY SOUND LIKE.
     Both are in the Reference tier deliberately.

     `reports` moved from NOT BUILT to built, and it is the one entry in this
     list where that flag needs explaining: THE REPORT GENERATOR IS STILL NOT
     BUILT AND P9 DID NOT BUILD ONE. What is built is the readiness view — what
     a report could be assembled from, what is missing, and the three sections
     that cannot be in one at all. `built` here means "this destination now does
     something", which is the only thing the sidebar can honestly promise; the
     page itself is unambiguous about the generator, and reportReadiness.js
     carries `generator.built = false` as a stated constant so the two cannot
     drift apart.

     `consultation` is the same shape: the page is real, the booking module
     does not exist, and the journey stage for expert consultation stays
     blocked. It is here rather than under "what it unlocks" because it unlocks
     nothing on this platform. */
  { key: 'reports',      tier: 'contextual', built: true, icon: 'frameworks', label: 'Reporting readiness', path: '/reports' },
  { key: 'consultation', tier: 'contextual', built: true, icon: 'governance', label: 'Expert support',      path: '/consultation' },

  // ── NOT BUILT · stated, never promoted ────────────────────────────────────
  { key: 'analytics',    tier: 'secondary',      built: false, icon: 'future', label: 'Analytics',     path: '/analytics' },
  { key: 'kpis',         tier: 'secondary',      built: false, icon: 'future', label: 'KPIs',          path: '/kpis' },
  { key: 'assistant',    tier: 'secondary',      built: false, icon: 'future', label: 'AI Assistant',  path: '/assistant' },
  { key: 'workflow',     tier: 'administrative', built: false, icon: 'future', label: 'Workflow',      path: '/workflow' },
  { key: 'users',        tier: 'administrative', built: false, icon: 'future', label: 'Users & Roles', path: '/users' },
  { key: 'integrations', tier: 'administrative', built: false, icon: 'future', label: 'Integrations',  path: '/integrations' },
];

// DERIVED, NOT LISTED. The old array was five hand-written keys with a comment
// explaining that an earlier `slice(0, 5)` had silently swapped Carbon in and
// Reports out. Deriving from an explicit per-module `bottom: true` keeps that
// safety — a module cannot enter the bar by accident of ordering — without the
// list drifting from the modules it names. The fifth slot is always the
// overflow, so the bar holds four destinations and a way to everything else.
const BOTTOM_NAV = MODULES.filter((m) => m.bottom && m.built);

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

/** A CALENDAR DAY, WRITTEN AS ONE.
 *
 *  node-postgres hands a `date` column back as a JavaScript Date, and
 *  `esc(row.period_start)` therefore ran Date.prototype.toString: the carbon
 *  table was printing "Wed Oct 01 2025 00:00:00 GMT+0800 (Malaysia Time)" in a
 *  cell meant to hold "2025-10-01". Two of those per row made the table
 *  1468px wide at every viewport and pushed the kg CO2e column — the value the
 *  page exists to show — into a horizontal scroll it did not need. P8 measured
 *  it; it had been there since the page was written.
 *
 *  ISO rather than a localised long form, deliberately: this is a reporting
 *  period on a compliance record, the rest of the product writes periods this
 *  way, and an unambiguous date beats a pretty one on a document a bank reads.
 *
 *  A string that is already a plain date passes through untouched, so a column
 *  that a future driver hands back as text does not start being reformatted. */
function dayOf(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  // The column is a DATE, not a timestamp: it has no zone, and converting to
  // UTC first would move 2025-01-01 in Kuala Lumpur back to 2024-12-31.
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Chrome-free shell for signed-out pages: login, register, 404 and the error
 *  page. Same tokens, same theme toggle, no navigation. */
function bareLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en" data-platform="esg" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Malaysia SMEs ESG e-Reporting System</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${TOKENS_CSS}</style>
<link rel="stylesheet" href="${CSS_HREF}">
<link rel="stylesheet" href="${ESG_CSS_HREF}">
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
  var KEY='modus-theme', saved=null, el=document.documentElement;
  try{saved=localStorage.getItem(KEY);}catch(e){console.warn('theme preference unreadable:',e&&e.message);}
  if(saved)el.setAttribute('data-theme',saved);
  /* THE USER AGENT DRAWS THINGS THIS STYLESHEET CANNOT REACH (P8): the select
     popup list, the date picker panel, the number spinners and the scrollbars.
     Those follow color-scheme, and the design system ships none — so on a dark
     app they were all rendering light. It is set HERE rather than in CSS
     because the ESG layer may not author a [data-theme] block (it reads master
     tokens instead of re-declaring theme), and because this is the one place
     that already knows which theme won. */
  el.style.colorScheme=el.getAttribute('data-theme')==='light'?'light':'dark';
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
  const isActive = (m) => activePath === m.path;
  const navLink = (m, cls) => `<a class="${cls}${isActive(m) ? ' active' : ''}" href="${esc(m.path)}"${isActive(m) ? ' aria-current="page"' : ''}>
        <span class="sidebar-item-icon">${icon(m.icon)}</span>${esc(m.label)}</a>`;

  // Built destinations, by tier. A tier with nothing in it renders nothing at
  // all rather than an empty heading — which is what the old INTELLIGENCE
  // heading did once its three placeholders moved out.
  const nav = TIERS.map((t) => {
    const items = MODULES.filter((m) => m.tier === t.key && m.built);
    if (!items.length) return '';
    return `<div class="sidebar-section-label">${esc(t.label)}</div>${items.map((m) => navLink(m, 'sidebar-item')).join('')}`;
  }).join('');

  // Everything not built, in ONE collapsed disclosure. Stated, never promoted —
  // the product's own rule is that an absent capability is said out loud, and
  // its own copy says a button that opens nothing is worse than no button.
  const unbuilt = MODULES.filter((m) => !m.built);
  const unbuiltNav = unbuilt.length ? `
    <details class="esg-sidebar-future">
      <summary>
        <span class="esg-sidebar-future__label">Not built yet</span>
        <span class="esg-sidebar-future__count">${unbuilt.length}</span>
      </summary>
      <div class="esg-sidebar-future__list">
        ${unbuilt.map((m) => `<a class="esg-sidebar-future__link${isActive(m) ? ' active' : ''}" href="${esc(m.path)}"${isActive(m) ? ' aria-current="page"' : ''}>${esc(m.label)}</a>`).join('')}
      </div>
    </details>` : '';

  // ── The phone bar ─────────────────────────────────────────────────────────
  // Four destinations and an overflow that reaches EVERY remaining one. The
  // audit found eleven of sixteen unreachable below 768px with no hamburger,
  // no drawer and no "More" — including Green Finance, Carbon and the Journey,
  // while one of the five that survived was an unbuilt placeholder.
  //
  // <details> and nothing else: this app ships no client-side JavaScript, and a
  // disclosure that needs none cannot break when it does.
  const bottomNav = BOTTOM_NAV.map((m) => `<a class="bottom-nav-item${isActive(m) ? ' active' : ''}" href="${esc(m.path)}"${isActive(m) ? ' aria-current="page"' : ''}>
      <span class="bottom-nav-item-icon">${icon(m.icon)}</span>${esc(m.short || m.label)}</a>`).join('');

  const overflow = MODULES.filter((m) => !m.bottom);
  const sheet = TIERS.map((t) => {
    const items = overflow.filter((m) => m.tier === t.key && m.built);
    if (!items.length) return '';
    return `<div class="esg-nav-sheet__group">${esc(t.label)}</div>${items.map((m) => `
        <a class="esg-nav-sheet__link${isActive(m) ? ' active' : ''}" href="${esc(m.path)}"${isActive(m) ? ' aria-current="page"' : ''}>
          <span class="sidebar-item-icon">${icon(m.icon)}</span>${esc(m.label)}</a>`).join('')}`;
  }).join('') + (unbuilt.length ? `
      <div class="esg-nav-sheet__group">Not built yet</div>
      ${unbuilt.map((m) => `<a class="esg-nav-sheet__link esg-nav-sheet__link--unbuilt" href="${esc(m.path)}">${esc(m.label)}</a>`).join('')}` : '');

  /* THE SHEET NEVER SHIPS OPEN.
   *
   * It used to carry `open` whenever the current page lived inside it, meaning
   * to answer "where am I". What it actually did on a phone was cover the page
   * the user had just navigated to: measured at 390px, the sheet occupied
   * roughly 60% of the viewport on arrival at /company and /governance, and
   * the first thing a reader had to do on every one of those pages was dismiss
   * a menu they had not opened. A disclosure that opens itself is not a
   * disclosure.
   *
   * The signal it was carrying is real and is kept — just carried the way the
   * OTHER FOUR items in this bar already carry it, which is the point: the bar
   * had two conventions for "you are here" and only one of them was the
   * master's. `.bottom-nav-item.active` is colour plus aria-current, so the
   * overflow item is now colour plus aria-current too.
   *
   * §6 — state is never colour alone. For the four links the word IS the
   * label, so the label carries it. "More" cannot, so the accessible name
   * names the section instead: a screen reader gets "you are in Governance &
   * Recognition" where a sighted user gets the accent. */
  const overflowCurrent = overflow.find(isActive) || null;
  const bottomMore = `
    <details class="esg-nav-more${overflowCurrent ? ' esg-nav-more--current' : ''}">
      <summary${overflowCurrent ? ' aria-current="true"' : ''} aria-label="${overflowCurrent
    ? `More sections — you are in ${esc(overflowCurrent.label)}` : 'More sections'}">
        <span class="bottom-nav-item-icon">${icon('more')}</span>More
      </summary>
      <nav class="esg-nav-sheet" aria-label="More sections">${sheet}</nav>
    </details>`;

  // ── Top bar context ───────────────────────────────────────────────────────
  // Rendered only from what shellContext actually loaded. No context, no chips:
  // an empty chip rail is a truthful "not known", a zeroed one is a claim.
  const shell = user && user.shell;
  const companyChip = shell ? `
      <span class="esg-topbar__company" title="${esc(shell.companyName)}">
        <span class="esg-topbar__company-name">${esc(shell.companyName)}</span>
        ${shell.reportingYear ? `<span class="esg-topbar__company-year">${esc(shell.reportingYear)}</span>` : ''}
      </span>` : '';

  // The review chip is WORK, and it links to the queue rather than to a bell
  // that opens a list nothing writes to. At zero it still renders, saying so —
  // "nothing waiting" is a result the user asked for, not an absence.
  const reviewChip = shell ? (shell.review.total > 0
    ? `<a class="esg-topbar__chip esg-topbar__chip--attention" href="/dashboard">
         <span class="esg-topbar__chip-count">${esc(shell.review.total)}</span> need review
       </a>`
    : `<span class="esg-topbar__chip esg-topbar__chip--quiet">Nothing waiting</span>`) : '';

  // Global AI access, pointing at the one surface where the AI's own output is
  // reviewed. It was previously reachable only by typing the URL.
  const aiChip = shell ? `
      <a class="esg-topbar__chip esg-topbar__chip--ai" href="/green-finance/opportunities">
        ${icon('ai')} AI${shell.review.suggestions > 0 ? ` <span class="esg-topbar__chip-count">${esc(shell.review.suggestions)}</span>` : ''}
      </a>` : '';

  return `<!DOCTYPE html>
<html lang="en" data-platform="esg" data-theme="dark">
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
<link rel="stylesheet" href="${ESG_CSS_HREF}">
<style>
/* Three layout utilities and one state border. Nothing themeable: every value
   below is geometry or a token, and there is no colour literal in this file.

   THE CONTENT CAP IS HERE BECAUSE THE MASTER HAS NO CONTAINER (Run 56). Checked
   before writing it, which is the lesson of Run 53 finding a whole app shell
   this repo had been hand-rolling past: modus-design-system.css declares no
   .container, no max-width utility and no width token beyond --sidebar-w /
   --topbar-h, and .app-main is padding-only and uncapped. So a twelve-column
   dashboard stretches to whatever the monitor is, and a .col-4 panel on a
   2560px screen is 700px wide — which is what makes a dense grid read as
   amateur rather than as infrastructure.

   The right home for this is a --content-max beside --sidebar-w in the master's
   "Layout dimensions" block, which is a thirteen-path fan-out and its own run.
   Until then it reads that token and carries the fallback, so the DAY the token
   ships the master wins with no edit here — and test/dashboard-test.js fails
   the moment it does, telling whoever lands it to delete this rule. The 1320px
   is the ONE length literal in Run 56's diff and it is deliberate: there is no
   spacing or width token in the master that could stand in for it.

   Applied to the CHILDREN, not to .app-main itself: .app-main is the scroll
   container and the grid cell that paints --bg, so capping it would leave the
   page background ending mid-monitor. Capping and centring each block instead
   keeps the surface full-bleed and the reading column fixed. */
.grid{display:grid;gap:16px}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.app-main > *{max-width:var(--content-max,1320px);margin-inline:auto}
.provisional{border-left:3px solid var(--amber)}
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="app-layout">
  <aside class="app-sidebar">
    <a class="sidebar-logo" href="/dashboard">
      <span class="sidebar-brand-dot" aria-hidden="true">ESG</span>
      <!-- "Malaysia SMEs ESG e-Reporting System" wrapped to three lines in a
           240px rail and pushed the first nav item below the fold. The full
           name is the <title> of every page and the login screen's heading;
           the rail carries the short form and keeps the full one for a
           tooltip and for screen readers. -->
      <span class="sidebar-brand" title="Malaysia SMEs ESG e-Reporting System">
        <span class="esg-brand-name">ESG Reporting</span>
        <em>Malaysia SME programme</em>
      </span>
    </a>
    <nav class="sidebar-nav esg-sidebar-nav" aria-label="Sections">${nav}${unbuiltNav}</nav>
    <div class="sidebar-footer esg-sidebar-footer">
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
    <!-- The title and the company are ONE unit: "which page" is meaningless
         without "whose data". The audit found a top bar carrying a page name
         and a theme toggle and nothing else, on a multi-tenant product. -->
    <div class="esg-topbar__identity">
      <h1 class="topbar-title esg-topbar__title">${esc(title)}</h1>
      ${companyChip}
    </div>
    <div class="topbar-right">
      ${reviewChip}
      ${aiChip}
      <!-- .btn rather than .btn-sm: at 8px padding on a 13px line it is the
           largest touch target the design system offers. It measured ~29px
           against §6's 44px until RUN 54 added a 44px minimum inside the
           master's existing ≤768px block — so it clears §6 on a phone, where
           the rule is about a finger, and stays compact on a desktop, where it
           is about a pointer. test/dashboard-test.js asserts both halves. -->
      <button class="btn btn-outline" id="themeBtn" type="button" aria-label="Switch between light and dark">◐</button>
    </div>
  </header>
  <main class="app-main esg-canvas" id="main-content">${content}</main>
</div>
<nav class="app-bottom-nav" aria-label="Sections"><div class="bottom-nav-inner">${bottomNav}${bottomMore}</div></nav>
<script>
(function(){
  var KEY='modus-theme';
  var saved=null, el=document.documentElement;
  try{saved=localStorage.getItem(KEY);}catch(e){console.warn('theme preference unreadable:',e&&e.message);}
  if(saved)el.setAttribute('data-theme',saved);
  /* THE USER AGENT DRAWS THINGS THE STYLESHEET CANNOT REACH (P8): the select
     popup list, the date picker panel, the number spinners and the scrollbars.
     All of those follow color-scheme, and the design system ships none — so on
     a dark app they were rendering light, which is most of why the assessment
     and readiness forms read as unfinished even after §17 styled the boxes
     themselves. Set here rather than in CSS because the ESG layer may not
     author a [data-theme] block, and because this is the one place that
     already knows which theme won. ONE function, used on boot and on toggle,
     so the two cannot disagree. */
  function applyScheme(){ el.style.colorScheme=el.getAttribute('data-theme')==='light'?'light':'dark'; }
  applyScheme();
  var b=document.getElementById('themeBtn');
  if(b)b.addEventListener('click',function(){
    var next=el.getAttribute('data-theme')==='dark'?'light':'dark';
    el.setAttribute('data-theme',next);
    applyScheme();
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
      icon: icon('unplugged'),
      title: opts.title || 'Not connected yet',
      body: opts.body || 'Nothing writes to this yet. It is not switched on, rather than empty.',
    },
    instrumented_but_empty: {
      icon: icon('waiting'),
      title: opts.title || 'Ready, but nothing recorded',
      body: opts.body || 'This is switched on and working — nobody has entered anything yet.',
    },
    zero: {
      icon: icon('measured'),
      title: opts.title || 'Genuinely zero',
      body: opts.body || 'This has been measured and the answer is zero.',
    },
  };
  const s = map[state] || map.instrumented_but_empty;
  // THE MARK IS DRAWN, NOT TYPED. These were three emoji, at three different
  // optical weights and in full colour, inside a monochrome interface — the
  // strongest "generated template" signal the audit found. Each state keeps a
  // DISTINCT mark, because telling the three apart at a glance is the whole
  // point of having three.
  return `<div class="empty-state"><div class="es-icon">${s.icon}</div>
    <h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`;
}

module.exports = {
  layout, bareLayout, esc, dayOf, emptyState, MODULES, TIERS, BOTTOM_NAV, icon,
  frameworkLabel, TOKENS_CSS, CSS_HREF, CSS_VERSION,
};

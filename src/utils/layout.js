'use strict';
// Server-rendered shell. Design system only — no inline colour, spacing or
// typography anywhere in this app. Every colour resolves through a CSS variable
// that EXISTS: a custom property that merely looks like a token fails silently,
// nothing throws, and the element renders transparent. The [data-platform="esg"]
// block was added to modus-design-system.css for exactly that reason.

const fs   = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '../../public/css/modus-design-system.css');
const MODUS_CSS = fs.existsSync(CSS_PATH) ? fs.readFileSync(CSS_PATH, 'utf8') : '';

// Boot-time assertion. If the accent block is missing, every page renders in
// Commerce blue and nobody notices for a month.
if (MODUS_CSS && !MODUS_CSS.includes('[data-platform="esg"]')) {
  console.warn('⚠️  modus-design-system.css has no [data-platform="esg"] block — ' +
               'the ESG accent will silently fall back to the :root default.');
}

const MODULES = [
  { key: 'dashboard',  icon: '⊞',  label: 'Dashboard',      path: '/dashboard' },
  { key: 'company',    icon: '🏢', label: 'Company Profile', path: '/company' },
  { key: 'assessment', icon: '📋', label: 'ESG Assessment',  path: '/assessment' },
  { key: 'carbon',     icon: '🌱', label: 'Carbon',          path: '/carbon' },
  { key: 'documents',  icon: '📁', label: 'Evidence',        path: '/documents' },
  { key: 'governance', icon: '🔎', label: 'Governance & Recognition', path: '/governance' },
  { key: 'reports',    icon: '📄', label: 'Reports',         path: '/reports' },
];

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
<style>${MODUS_CSS}</style>
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
  try{saved=localStorage.getItem(KEY);}catch(e){}
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

  const nav = MODULES.map((m) => {
    const active = activePath === m.path ? ' active' : '';
    return `<a class="nav-item${active}" href="${esc(m.path)}">
      <span class="nav-icon">${m.icon}</span><span class="nav-label">${esc(m.label)}</span></a>`;
  }).join('');

  const bottomNav = MODULES.slice(0, 5).map((m) => {
    const active = activePath === m.path ? ' active' : '';
    return `<a class="bn-item${active}" href="${esc(m.path)}">
      <span class="bn-icon">${m.icon}</span><span class="bn-label">${esc(m.label)}</span></a>`;
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
<style>${MODUS_CSS}</style>
<style>
/* Shell geometry only. No colours, no fonts — those come from the tokens. */
.app{display:flex;min-height:100vh}
.sidebar{width:var(--sidebar-w);background:var(--brand);color:#fff;display:flex;flex-direction:column;position:fixed;inset:0 auto 0 0;overflow-y:auto}
.sb-brand{padding:18px 20px;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:10px}
.sb-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 20px;color:#cbd5e1;text-decoration:none;font-size:14px}
.nav-item:hover{background:var(--brand-3);color:#fff}
.nav-item.active{background:var(--accent-bg);color:#fff;box-shadow:inset 3px 0 0 var(--accent)}
.main{flex:1;margin-left:var(--sidebar-w);display:flex;flex-direction:column;min-width:0}
.topbar{height:var(--topbar-h);display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
.avatar{width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--accent-contrast);display:grid;place-items:center;font-weight:600;font-size:13px}
.content{padding:24px;max-width:1200px;width:100%}
.topbar-system{font-size:11px;color:var(--muted);line-height:1.2;margin-top:1px}
@media (max-width:768px){.topbar-system{display:none}}
.bottom-nav{display:none}
@media (max-width:768px){
  .sidebar{display:none}
  .main{margin-left:0}
  .content{padding:16px 14px 84px}
  .bottom-nav{display:flex;position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--border);z-index:20}
  .bn-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;color:var(--text-2);text-decoration:none;font-size:10px}
  .bn-item.active{color:var(--accent)}
  .bn-icon{font-size:18px}
}
.grid{display:grid;gap:16px}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.provisional{border-left:3px solid var(--amber)}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="sb-brand"><span class="sb-dot"></span> Modus ESG</div>
    <nav>${nav}</nav>
  </aside>
  <div class="main">
    <header class="topbar">
      <div>
        <strong>${esc(title)}</strong>
        <div class="topbar-system">Malaysia SMEs ESG e-Reporting System</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost" id="themeBtn" type="button" aria-label="Toggle theme">◐</button>
        <div class="avatar" title="${esc(user?.email || '')}">${esc(initials)}</div>
        <a class="btn btn-ghost" href="/auth/logout">Sign out</a>
      </div>
    </header>
    <main class="content">${content}</main>
  </div>
</div>
<nav class="bottom-nav">${bottomNav}</nav>
<script>
(function(){
  var KEY='modus-theme';
  var saved=null;
  try{saved=localStorage.getItem(KEY);}catch(e){}
  if(saved)document.documentElement.setAttribute('data-theme',saved);
  var b=document.getElementById('themeBtn');
  if(b)b.addEventListener('click',function(){
    var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem(KEY,next);}catch(e){}
  });
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

module.exports = { layout, bareLayout, esc, emptyState, MODULES };

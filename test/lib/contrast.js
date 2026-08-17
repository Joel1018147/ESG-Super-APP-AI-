'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   WCAG CONTRAST, COMPUTED FROM THE REAL TOKENS                     (Run 53)
   ───────────────────────────────────────────────────────────────────────────
   MODUS_UI_CONTRACT §6: "Text contrast ≥ 4.5:1 in both themes." Until now that
   line was checked by nobody, in either theme, which is the same as not being
   in the document.

   This resolves a token the way the browser does — `:root`, then
   `[data-platform="esg"]`, then `[data-theme="dark"]`, then
   `[data-theme="dark"][data-platform="esg"]`, later winning — follows `var()`
   chains, and composites `rgba()` over the backdrop it is actually painted on.
   A tint like `rgba(77,124,15,0.08)` is not a colour until you know what is
   behind it, and every badge in this design system is a tint.

   It is not a renderer. It cannot see a colour that arrives from anywhere
   other than these four blocks, and it takes the (foreground, background)
   pairing from a caller rather than from the cascade — so the pairs it is
   given are an assertion about the markup, and a wrong pair is a wrong test.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'modus-design-system.css');

/** The declarations of one top-level selector block, exactly as written. */
function blockOf(css, selector) {
  const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  if (!m) return {};
  const out = {};
  // Comments stripped FIRST. Written without this, a declaration preceded by a
  // `/* … */` on its own line came out with the comment glued to the property
  // name, `startsWith('--')` was false, and the whole :root block parsed to
  // zero tokens — a checker reporting "token not defined" about a token that is
  // defined thirty lines up. Checklist #16, in a file about a different rule.
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of body.split(';')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    if (!name.startsWith('--')) continue;
    out[name] = line.slice(i + 1).trim();
  }
  return out;
}

/** The token table for one theme, in cascade order. */
function tokens(theme, platform = 'esg', css = fs.readFileSync(CSS_PATH, 'utf8')) {
  const t = Object.assign(
    {},
    blockOf(css, ':root'),
    blockOf(css, `[data-platform="${platform}"]`),
  );
  if (theme === 'dark') {
    Object.assign(t, blockOf(css, '[data-theme="dark"]'));
    Object.assign(t, blockOf(css, `[data-theme="dark"][data-platform="${platform}"]`));
  }
  return t;
}

/** Follow var() chains. Throws on a token that does not exist — §3's whole
 *  point is that CSS does NOT, so the checker must. */
function resolve(value, table, depth = 0) {
  if (depth > 8) throw new Error(`var() chain too deep at ${value}`);
  const m = /^var\((--[\w-]+)\)$/.exec(String(value).trim());
  if (!m) return String(value).trim();
  const next = table[m[1]];
  if (next === undefined) throw new Error(`token ${m[1]} is not defined — CSS would render this transparent and say nothing`);
  return resolve(next, table, depth + 1);
}

function parseColour(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  throw new Error(`cannot parse colour: ${v}`);
}

/** Paint `over` on top of `under`. Both opaque afterwards. */
function composite(over, under) {
  const a = over.a;
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/**
 * Contrast ratio of one foreground token against a STACK of backgrounds, given
 * outermost-last: ['var(--accent-bg)', 'var(--surface)', 'var(--bg)'] is a
 * tinted badge on a card on the page.
 */
function ratio(fg, backdrops, table) {
  let painted = null;
  for (const layer of [...backdrops].reverse()) {
    const c = parseColour(resolve(layer, table));
    painted = painted === null ? composite(c, { r: 255, g: 255, b: 255, a: 1 }) : composite(c, painted);
  }
  if (painted === null) throw new Error('ratio(): no backdrop given — a colour is not a contrast');
  const front = composite(parseColour(resolve(fg, table)), painted);
  const l1 = luminance(front);
  const l2 = luminance(painted);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

module.exports = { tokens, resolve, parseColour, composite, luminance, ratio, blockOf, CSS_PATH };

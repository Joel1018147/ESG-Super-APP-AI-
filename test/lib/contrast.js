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

/** Blank comment bodies, preserving offsets and newlines, walking strings so a
 *  `/*` inside one is not read as a comment.
 *
 *  THIS IS NOT OPTIONAL AND IT WAS MISSING UNTIL RUN 54. `[data-platform="migs"]`
 *  opens with a comment quoting the school's own CSS — `a, .page-title { color:
 *  #344889 }` — and the `\{([^}]*)\}` capture below stops at the brace INSIDE
 *  that comment. The block parsed to zero tokens, and every ratio computed for
 *  MIGS then threw "token --accent is not defined" about a token defined four
 *  lines further down. `Modus-Agent-OS/design/verify-design-system.js` names
 *  this exact trap in its own header; this file did not have the scanner.
 *
 *  It is a copy rather than a require: a cross-repo absolute require is banned
 *  (test-harness-integrity-audit.md), and the RULE 6 scanner is duplicated
 *  across twelve repos for the same reason. If you change it here, change it
 *  there. */
function stripComments(css) {
  const out = css.split('');
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
      i = stop; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === c || css[j] === '\n') { j++; break; }
        j++;
      }
      i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/** The declarations of one selector, merged across EVERY block that declares
 *  it, in document order — which is what the cascade does.
 *
 *  Written to take the first match only, and that was wrong for two platforms:
 *  `[data-theme="dark"][data-platform="commerce"]` and `…="school"` each appear
 *  TWICE in the master, and `--accent-light` is in the second one. The first
 *  block carries Commerce's deprecated gray aliases, so the reader found a
 *  block, found tokens in it, and returned a table with the one token it was
 *  asked about missing — a confident wrong answer rather than an error. */
function blockOf(rawCss, selector) {
  const css = stripComments(rawCss);
  const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (!bodies.length) return {};
  const m = [bodies.join(';')];
  const out = {};
  // Comments are already blanked by stripComments above, which is what makes
  // the capture safe: without it a declaration preceded by a `/* … */` on its
  // own line arrived with the comment glued to the property name,
  // `startsWith('--')` was false, and the whole :root block parsed to zero
  // tokens. Checklist #16, twice in one function.
  for (const line of m[0].split(';')) {
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

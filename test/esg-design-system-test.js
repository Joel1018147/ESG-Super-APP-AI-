'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   THE ESG DESIGN SYSTEM LAYER                                     (Run 62/P2)
   ───────────────────────────────────────────────────────────────────────────
   This suite guards the ARCHITECTURE of public/css/esg-system.css, not its
   appearance. Three things it is here to stop:

   1. THE LAYER QUIETLY BECOMING A FORK. It exists only because
      MODUS_UI_CONTRACT §1 forbids editing the master and §1b makes any
      addition a thirteen-path fan-out. If it starts overriding master
      components or shipping colour literals, it has become the divergence the
      contract exists to prevent. §1 and §2 below assert it has not.

   2. THE DEPENDENCIES BEING FORGOTTEN. D1–D5 are real defects in the MASTER
      that this layer works around locally. Each is asserted STILL OUTSTANDING.
      The day the master fixes one, the matching test fails and names the local
      rule to delete — the same trick layout.js uses for --content-max. A
      failure here is good news, not a regression.

   3. THE TABLE SILENTLY GOING BACK TO CLIPPING. That defect cost the carbon
      page its kg CO2e column at 390px with no gesture that could reveal it.
      §4 pins the three properties that make it reachable, including the
      keyboard one that is easy to drop.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const ESG_CSS_PATH = path.join(ROOT, 'public', 'css', 'esg-system.css');
const MASTER_PATH  = path.join(ROOT, 'public', 'css', 'modus-design-system.css');
const LAYOUT_PATH  = path.join(ROOT, 'src', 'utils', 'layout.js');

const ESG    = fs.readFileSync(ESG_CSS_PATH, 'utf8');
const MASTER = fs.readFileSync(MASTER_PATH, 'utf8');
const LAYOUT = fs.readFileSync(LAYOUT_PATH, 'utf8');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

/** Strip comments before any structural check. Every rule this file asserts is
 *  about DECLARATIONS, and the header is full of prose naming the very things
 *  being banned — "overflow: hidden", "#4D7C0F" — so a check run against the
 *  raw text passes or fails on documentation rather than on CSS. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
const ESG_CODE = stripComments(ESG);

console.log('\nesg-design-system\n');

/* ═══ 1 · IT IS A LAYER, NOT A FORK ═══════════════════════════════════════ */

test('every rule the layer defines has an esg- SUBJECT', () => {
  // The subject is the last compound in a selector — the element the rule
  // actually styles. Referencing a master class as an ANCESTOR is legitimate
  // and necessary (.app-bottom-nav .esg-nav-more places our component inside
  // their bar); defining one is the fork this guard exists to stop. The first
  // version of this test compared every class token in the file and flagged
  // the ancestor, which would have pushed the fix toward duplicating the
  // master's bar instead.
  // P8 STRENGTHENED THE SPLIT, and it is worth recording why.
  //
  // §17 introduced the first selectors in this file that use :where(), and the
  // naive `split(',')` below tore them into fragments — `.app-main :where(input`
  // / ` select` / ` textarea)` — every one of which happens to have no class in
  // it and was therefore waved through. It caught P8's real offender,
  // `:where(.input-error)`, only because that fragment kept its class token.
  //
  // That is luck, not a guard. `.app-main :where(.card, .badge)` is a fork by
  // any reading of this rule and the old split would have passed it silently,
  // which is the failure mode this whole suite exists to prevent. Commas are
  // now split only at NESTING DEPTH ZERO, and the class tokens inside a
  // functional pseudo on the subject compound count as subject classes —
  // because `:where(.card)` styles .card exactly as `.card` would.
  const splitTop = (s, seps) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };

  const offenders = [];
  for (const m of ESG_CODE.matchAll(/(^|\})\s*([^{}@][^{}]*?)\s*\{/g)) {
    const selectorList = m[2].trim();
    if (!selectorList || selectorList.startsWith('@') || selectorList.includes(':root')) continue;
    for (const sel of splitTop(selectorList, ',')) {
      // Combinators split at depth zero as well: the space inside
      // :where(a, b) is not a combinator of the outer selector.
      const compounds = splitTop(sel, ' \t\n>+~');
      const subject = compounds[compounds.length - 1];
      if (!subject) continue;
      // Every class token in the subject compound, INCLUDING the ones inside a
      // :where() / :is() / :not() on it.
      const classes = subject.match(/\.[A-Za-z_][\w-]*/g);
      if (!classes) continue;                       // element/pseudo subject
      if (classes.some((c) => c.startsWith('.esg-'))) continue;
      offenders.push(sel.trim());
    }
  }
  assert.deepStrictEqual([...new Set(offenders)], [],
    `the layer defines rules whose SUBJECT is a master class — that is a fork: ${[...new Set(offenders)].join(' | ')}`);

  // MUTATION TEST OF THE GUARD ITSELF. The strengthening above is only worth
  // having if it fails on the shape it was written for, so it is run against a
  // planted selector rather than trusted. Both halves matter: the fork must be
  // caught, and the legitimate element subject beside it must not be.
  const probe = (css) => {
    const found = [];
    for (const mm of css.matchAll(/(^|\})\s*([^{}@][^{}]*?)\s*\{/g)) {
      for (const sel of splitTop(mm[2].trim(), ',')) {
        const cs = splitTop(sel, ' \t\n>+~');
        const sub = cs[cs.length - 1];
        const cls = sub && sub.match(/\.[A-Za-z_][\w-]*/g);
        if (cls && !cls.some((c) => c.startsWith('.esg-'))) found.push(sel);
      }
    }
    return found;
  };
  assert.deepStrictEqual(probe('.app-main :where(input, select) { color: red }'), [],
    'the guard now rejects an ELEMENT subject inside :where() — that is legitimate and must pass');
  assert.ok(probe('.app-main :where(.card, .badge) { color: red }').length > 0,
    'the guard does not catch a master class hidden inside :where() on the subject — '
    + 'which is the exact shape P8 introduced the risk of');
});

test('the layer ships no colour literal, except white-alpha on the brand rail', () => {
  // The layer needs no [data-theme] block precisely because it reads master
  // tokens that are already authored for both themes. One literal and that
  // stops being true, silently, in one theme only.
  //
  // THE ONE EXEMPTION: .app-sidebar paints --brand, which is dark in BOTH
  // themes deliberately, so white-alpha is theme-safe there and is what the
  // master's own .sidebar-item and .sidebar-section-label use. The master
  // records 0.46 as the lowest alpha clearing 4.5:1 against --brand; this
  // asserts the floor rather than trusting it.
  const hex = ESG_CODE.match(/#[0-9a-fA-F]{3,8}/g) || [];
  assert.deepStrictEqual(hex, [], `hex colour literal(s) in the layer: ${hex.join(', ')}`);

  const fns = ESG_CODE.match(/(?:rgb|hsl)a?\s*\([^)]*\)/g) || [];
  const whiteAlpha = /^rgba?\(\s*255[ ,]+255[ ,]+255\s*\/\s*([0-9.]+)\s*\)$/;
  const bad = [];
  for (const fn of fns) {
    const m = whiteAlpha.exec(fn.replace(/\s+/g, ' ').trim());
    if (!m) { bad.push(fn); continue; }
    assert.ok(Number(m[1]) >= 0.46,
      `${fn} is below the master's measured 4.5:1 floor of 0.46 against --brand`);
  }
  assert.deepStrictEqual(bad, [],
    `non-white colour literal(s) in the layer — use a master token: ${bad.join(', ')}`);

  // The exemption is only an exemption if it stays on the brand rail.
  for (const m of ESG_CODE.matchAll(/([^{}]*)\{([^}]*rgb\(\s*255[^}]*)\}/g)) {
    assert.ok(/esg-sidebar-future/.test(m[1]),
      `white-alpha used outside the brand rail, in: ${m[1].trim().slice(0, 60)}`);
  }
});

test('the layer declares no [data-theme] block', () => {
  assert.ok(!/\[data-theme/.test(ESG_CODE),
    'the layer has a [data-theme] block — it must inherit theming from the master tokens it reads, '
    + 'not re-author it, or the two will disagree');
});

test('the layer defines no keyframes the master already ships', () => {
  const mine = [...ESG_CODE.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const theirs = new Set([...MASTER.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const dupes = mine.filter((k) => theirs.has(k));
  assert.deepStrictEqual(dupes, [], `redefined master keyframe(s): ${dupes.join(', ')}`);
  // ZERO local keyframes. P2 shipped one — a sweep for a score dial it had
  // built locally — and P4 found the master already ships .score-ring, so both
  // the dial and its keyframe were deleted. The layer now animates nothing the
  // master does not already define, which is the strongest form of the rule.
  assert.deepStrictEqual(mine, [],
    `the layer defines its own keyframe(s): ${mine.join(', ')} — reuse the master's mds-* set instead`);
});

test('every mds-* animation the layer names actually exists in the master', () => {
  const used = new Set([...ESG_CODE.matchAll(/\b(mds-[\w-]+)\b/g)].map((m) => m[1]));
  const defined = new Set([...MASTER.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !defined.has(k));
  assert.deepStrictEqual(missing, [],
    `the layer animates keyframe(s) nothing defines — they fail silently: ${missing.join(', ')}`);
  assert.ok(used.size >= 3, `only ${used.size} master keyframe(s) reused; the layer should not be inventing motion`);
});

test('the master stylesheet is untouched by this run', () => {
  const crypto = require('crypto');
  const md5 = crypto.createHash('md5').update(fs.readFileSync(MASTER_PATH)).digest('hex').slice(0, 8);
  assert.strictEqual(md5, 'eced11f8',
    `the master is ${md5}, not eced11f8 — the ESG layer exists precisely so this file is never edited`);
});

/* ═══ 2 · IT IS ACTUALLY DELIVERED ════════════════════════════════════════ */

test('both shells link the layer, after the master', () => {
  const links = LAYOUT.match(/<link rel="stylesheet" href="\$\{(?:CSS_HREF|ESG_CSS_HREF)\}">/g) || [];
  assert.strictEqual(links.length, 4, `expected 2 sheets in 2 shells, found ${links.length} link(s)`);
  // Order matters for the cascade: a later sheet wins a specificity tie.
  for (const shell of LAYOUT.split('<!DOCTYPE html>').slice(1)) {
    const master = shell.indexOf('${CSS_HREF}');
    const esg    = shell.indexOf('${ESG_CSS_HREF}');
    assert.ok(master > -1 && esg > -1, 'a shell is missing one of the two stylesheets');
    assert.ok(esg > master, 'the ESG layer is linked BEFORE the master, so a tie resolves the wrong way');
  }
});

test('the layer is cache-busted by its own bytes, not the master\'s', () => {
  assert.ok(/ESG_CSS_VERSION\s*=\s*crypto[\s\S]{0,120}update\(ESG_CSS\)/.test(LAYOUT),
    'ESG_CSS_VERSION is not derived from ESG_CSS — an edit to the layer would serve stale for up to a week');
});

/* ═══ 3 · CARD COMPOSITION CANNOT COLLAPSE (D5) ═══════════════════════════ */

test('a bare .esg-card is padded — the card fails CLOSED', () => {
  const rule = ESG_CODE.match(/\.esg-card\s*\{[^}]*\}/);
  assert.ok(rule, '.esg-card has no base rule');
  assert.ok(/padding:\s*var\(--esg-space/.test(rule[0]),
    'a bare .esg-card has no padding — this is the exact master defect (D5) the layer exists to avoid');
});

test('a composed .esg-card yields its padding to its parts', () => {
  assert.ok(/\.esg-card:has\(/.test(ESG_CODE),
    'nothing detects the composed form, so a card with a __body would double-pad');
  assert.ok(/@supports not selector\(:has\(\*\)\)/.test(ESG_CODE),
    'no fallback for browsers without :has() — the composed card would double-pad there');
});

test('two adjacent cards cannot touch', () => {
  // The measured defect was gaps of 0, 23, 0, 0, 0 px between six cards.
  assert.ok(/\.esg-card \+ \.esg-card\s*\{[^}]*margin-top:\s*var\(--esg-space/.test(ESG_CODE),
    'no adjacent-sibling margin — cards outside a stack can render edge to edge again');
});

test('the card title is never smaller than the body it heads', () => {
  // The audit found an 11px title above 14px body: the label smaller than the
  // thing it labels. Compare the two by their token step.
  const title = ESG_CODE.match(/\.esg-card__title\s*\{[^}]*font-size:\s*var\(--(esg-text-[\w-]+)\)/);
  assert.ok(title, '.esg-card__title declares no font-size token');
  const SCALE = ['esg-text-2xs', 'esg-text-xs', 'esg-text-sm', 'esg-text-md',
    'esg-text-lg', 'esg-text-xl', 'esg-text-2xl', 'esg-text-3xl', 'esg-text-4xl'];
  assert.ok(SCALE.indexOf(title[1]) >= SCALE.indexOf('esg-text-md'),
    `.esg-card__title is ${title[1]}, below body (esg-text-md) — the inverted-hierarchy defect`);
});

/* ═══ 4 · THE TABLE CANNOT CLIP (D1) ══════════════════════════════════════ */

test('.esg-table-scroll scrolls horizontally', () => {
  const rule = ESG_CODE.match(/\.esg-table-scroll\s*\{[^}]*\}/);
  assert.ok(rule, '.esg-table-scroll has no rule');
  assert.ok(/overflow-x:\s*auto/.test(rule[0]),
    'the ESG table container does not scroll — this is D1, the defect that hid the kg CO2e column');
  assert.ok(!/overflow:\s*hidden/.test(rule[0]),
    'the container sets overflow:hidden, which is the master defect being worked around');
});

test('the scroll container is reachable by keyboard', () => {
  // A bare overflow container is unreachable without a pointer. The markup must
  // carry tabindex, and the stylesheet must show where focus landed.
  assert.ok(/\.esg-table-scroll:focus-visible\s*\{[^}]*outline/.test(ESG_CODE),
    'no focus-visible outline on the scroll region — a keyboard user cannot see what they are scrolling');
});

test('a narrow viewport gets a stacked table that has nothing off-screen', () => {
  assert.ok(/\.esg-table--stack/.test(ESG_CODE), 'no stacked variant for narrow screens');
  assert.ok(/\.esg-table--stack td::before\s*\{[\s\S]{0,200}content:\s*attr\(data-label\)/.test(ESG_CODE),
    'the stacked variant does not label its cells, so a value loses its column name');
});

/* ═══ 5 · TYPE, MEASURE AND SPACING EXIST AS SCALES ═══════════════════════ */

test('the type scale has no step below 11px, and 11px is reserved', () => {
  const steps = [...ESG_CODE.matchAll(/--esg-text-[\w-]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(steps.length >= 8, `only ${steps.length} type steps found`);
  const tooSmall = steps.filter((n) => n < 11);
  assert.deepStrictEqual(tooSmall, [], `type step(s) below 11px: ${tooSmall.join(', ')}`);
});

test('a reading measure exists and prose is capped by it', () => {
  assert.ok(/--esg-measure:\s*\d+ch/.test(ESG_CODE), 'no --esg-measure token (D4)');
  assert.ok(/\.esg-prose\s*\{[^}]*max-width:\s*var\(--esg-measure\)/.test(ESG_CODE),
    '.esg-prose does not use the measure — the 138ch and 145ch lines stay uncapped');
});

test('the spacing scale reads a master token first and falls back locally', () => {
  // The --content-max pattern: the master wins the day it ships one.
  const reads = ESG_CODE.match(/--esg-space-\d:\s*var\(--space-\d,/g) || [];
  assert.ok(reads.length >= 8,
    `only ${reads.length} spacing steps defer to a master --space-* token; the layer should not hard-own the scale`);
});

/* ═══ 6 · THE DEPENDENCIES ARE STILL OUTSTANDING ══════════════════════════
   Each assertion below describes a MASTER defect. A failure means the master
   fixed it and the local workaround should now be deleted. */

test('D1 — the master .table-wrap still clips (delete §5 of the layer when this fails)', () => {
  const rule = MASTER.match(/\.table-wrap\s*\{[^}]*\}/);
  assert.ok(rule, '.table-wrap is gone from the master — re-check D1 entirely');
  assert.ok(/overflow:\s*hidden/.test(rule[0]),
    'THE MASTER FIXED D1. .table-wrap no longer clips. Delete the local .esg-table-scroll '
    + 'overflow workaround, move ESG tables back to .table-wrap, and drop this test.');
});

test('D2/D3/D4 — the master still ships no spacing scale, type scale or measure', () => {
  const outstanding = [];
  if (/--space-1:/.test(MASTER)) outstanding.push('D2 spacing scale');
  if (/--text-sm:|--text-md:|--text-lg:/.test(MASTER)) outstanding.push('D3 type scale');
  if (/--measure:/.test(MASTER)) outstanding.push('D4 measure');
  assert.deepStrictEqual(outstanding, [],
    `THE MASTER NOW SHIPS: ${outstanding.join(', ')}. The layer's fallbacks are now dead weight — `
    + 'switch to the master tokens and delete the local values.');
});

test('D5 — the master .card still has no padding (the fail-open card)', () => {
  const rule = MASTER.match(/^\.card\s*\{[^}]*\}/m);
  assert.ok(rule, '.card is gone from the master — re-check D5');
  assert.ok(!/padding:/.test(rule[0]),
    'THE MASTER FIXED D5. .card now carries padding. Re-evaluate whether .esg-card is still needed.');
});

test('D6 — the master still styles controls ONLY inside .form-group', () => {
  // The whole justification for §17 existing is that a control outside a
  // .form-group is unstyled. If the master ever styles the element itself,
  // §17 becomes a duplicate and must go.
  const groupRule = /\.form-group\s+input,?\s*[\s\S]{0,80}?\{/.test(MASTER);
  assert.ok(groupRule, 'the master no longer styles .form-group input — re-check D6 entirely');

  // A bare element rule that gives a control a background is the fix. The
  // master's one existing element rule sets font-family only, which is why the
  // controls still rendered white.
  const bare = MASTER.match(/^\s*(input|select|textarea)[^{]*\{[^}]*\}/gm) || [];
  const styled = bare.filter((r) => /background|border:|padding/.test(r));
  assert.deepStrictEqual(styled, [],
    'THE MASTER FIXED D6. It now styles a bare control. Delete §17 of the layer and let the '
    + 'master own every control on every page.');
});

test('D7 — the master app shell still lets the top bar size the whole column', () => {
  // .app-layout's grid items need `min-width: 0` for the 1fr track to stop
  // resolving to the widest item's min-content. Until it is there, §13.2b has
  // to keep the top bar's own content wrappable.
  const mobile = MASTER.match(/@media \(max-width: 768px\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mobile, 'the master\'s ≤768px block is gone — re-check D7 entirely');
  const topbarMin = /\.app-topbar[^{]*\{[^}]*min-width:\s*0/.test(MASTER);
  const mainMin = /\.app-main[^{]*\{[^}]*min-width:\s*0/.test(MASTER);
  assert.ok(!topbarMin && !mainMin,
    'THE MASTER FIXED D7. A shell grid item now carries min-width: 0, so the top bar can no '
    + 'longer inflate the application column. Re-evaluate §13.2b and the 100vw cap in §14.1.');
});

test('D8 — the master score ring still cannot animate its value', () => {
  // A sweep needs BOTH: --score registered with @property so it interpolates,
  // and a transition on the property rather than on `background`.
  const registered = /@property\s+--score/.test(MASTER);
  const transitions = /\.score-ring\s*\{[^}]*transition:[^}]*--score/.test(MASTER);
  assert.ok(!(registered && transitions),
    'THE MASTER FIXED D8. .score-ring can now sweep to its value. Delete the note in §19.4 and '
    + 'let the ring animate instead of only revealing.');
});

/* ═══ 7 · P8 · THE MOTION LAYER SAYS SOMETHING ════════════════════════════
   The risk P8 introduces is decoration: animation that exists because it looks
   expensive rather than because a state changed. These assert the two rules
   that keep it honest, and they are about the CSS rather than about taste. */

test('every animation in the layer is transform/opacity only — nothing triggers layout', () => {
  // A keyframe animating width, height, top or left costs a layout pass on
  // every frame. Every mds-* the layer names is checked at its DEFINITION in
  // the master, so this cannot be satisfied by a comment.
  const named = [...new Set([...ESG_CODE.matchAll(/animation:\s*(mds-[\w-]+)/g)].map((m) => m[1]))];
  assert.ok(named.length >= 3, `only ${named.length} animations in the layer — expected the P8 set`);
  const LAYOUT_PROPS = /(^|[;{\s])(width|height|top|left|right|bottom|margin|padding|font-size)\s*:/;
  for (const k of named) {
    const body = MASTER.match(new RegExp(`@keyframes\\s+${k}\\s*\\{([\\s\\S]*?)\\n\\}`));
    assert.ok(body, `${k} is animated by the layer but not defined in the master`);
    assert.ok(!LAYOUT_PROPS.test(body[1]),
      `${k} animates a layout property — every animation in this product must composite`);
  }
});

test('the ONLY infinite animations are live-work indicators, and one is server-gated', () => {
  // §50's rule: nothing loops except a live progress indicator. An interface
  // that goes on saying "working" after the work stopped is the failure.
  const infinite = [...ESG_CODE.matchAll(/([^{}]*)\{([^}]*animation:[^;}]*infinite[^;}]*)[;}]/g)]
    .map((m) => m[1].trim().split('\n').pop().trim());
  // Three, and each one means "work is happening right now": the analysis
  // spinner, the shimmer on a placeholder for content genuinely being fetched,
  // and the track's current step. A fourth entry here is a decoration until it
  // proves otherwise, which is why this is an equality and not a subset.
  assert.deepStrictEqual(infinite.sort(), [
    '.esg-ai__spinner',
    '.esg-skeleton',
    '.esg-track[data-live="true"] .esg-track__step--current::after',
  ], `unexpected looping animation(s) in the layer: ${infinite.join(' | ')}`);

  // The track's loop must be reachable ONLY through the attribute, so a
  // finished track cannot pulse. A rule that pulsed .esg-track__step--current
  // on its own would be the defect.
  assert.ok(!/^\s*\.esg-track__step--current::after\s*\{[^}]*infinite/m.test(ESG_CODE),
    'the track pulses without data-live — a completed track would go on saying "working"');
});

test('every P8 entrance collapses under prefers-reduced-motion', () => {
  const reduced = ESG_CODE.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g) || [];
  const joined = reduced.join('\n');
  assert.ok(reduced.length >= 3, `only ${reduced.length} reduced-motion blocks; P8 added two`);
  for (const cls of ['.esg-enter', '.esg-settled', '.esg-found', '.esg-follows', '.esg-track__step']) {
    assert.ok(joined.includes(cls),
      `${cls} animates but is not named in any prefers-reduced-motion block`);
  }
  // The delay is the part that has to go. The master's own §41 block already
  // collapses DURATION to 0.01ms, so an entrance with a 140ms delay would
  // still sit invisible for 140ms under reduced motion — which is exactly the
  // "permanently missing content" failure §41's comment warns about.
  assert.ok(/animation-delay:\s*0m?s/.test(joined),
    'reduced motion removes the durations but not the DELAYS — a delayed entrance still waits');
});

test('§21 gives a progress bar its own space, so it cannot strike through the text above it', () => {
  // MEASURED on finance readiness before P8: the bar sat 2.4px under the last
  // line of .esg-q__guide and read as a strikethrough. Both carry margin: 0,
  // and neither owned the gap.
  assert.ok(/\+\s*\.esg-progress\s*\{[^}]*margin-top:/.test(ESG_CODE),
    'nothing gives .esg-progress a top margin after a paragraph — the collapse is reachable again');
  assert.ok(/\.esg-progress\s*\+\s*\.esg-meta\s*\{[^}]*margin-top:/.test(ESG_CODE),
    'the caption under a progress bar has no gap above it');
});

console.log(`\nesg-design-system: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);

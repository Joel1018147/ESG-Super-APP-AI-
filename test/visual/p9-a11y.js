async (page) => {
  /* P9 ACCESSIBILITY — the components a11y.js does not know about.
   *
   * a11y.js covers P8's set. This covers §26 (.esg-action), §27 (.esg-gap),
   * §28 (.esg-roadmap) and §29 (.esg-copilot), plus the two structural claims
   * P9's markup makes: that a gap's five answers are a definition list so a
   * screen reader announces each answer WITH the question it answers, and that
   * every state is carried by a WORD and not by colour alone.
   *
   * An empty report is the pass. Every line names what it measured.
   *
   * The contrast pass composites alpha, for the reason a11y.js records: every
   * -bg token in this system is an 8%-alpha tint, and reading its first three
   * channels measures text against the solid colour and fabricates a defect.
   */
  const BASE = 'http://127.0.0.1:3000';
  const out = [];

  await page.goto(BASE + '/auth/login');
  await page.locator('input[name=email]').fill('demo@example.com');
  await page.locator('input[name=password]').fill('esg-demo-2026-seritimur');
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {}),
    page.locator('button[type=submit]').click(),
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });

  const PAGES = ['/dashboard', '/improvement', '/consultation', '/reports'];

  /* ── 1 · STATE IS NEVER COLOUR ALONE ────────────────────────────────────
     §6 of the layer, and the rule every state component in this product
     follows. For each of the four new components: the state must be present
     as TEXT, and two different states must not render the same text. */
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    const r = await page.evaluate(() => {
      const bad = [];
      // §26 — every action card states its state in words.
      document.querySelectorAll('.esg-action').forEach((el) => {
        const word = el.querySelector('.esg-action__state');
        if (!word || !word.textContent.trim()) bad.push('an .esg-action carries no state word');
        const mod = [...el.classList].find((c) => c.startsWith('esg-action--'));
        if (!mod) bad.push('an .esg-action carries no state modifier');
      });
      // §28 — every rung states its state in words AND how it is joined.
      document.querySelectorAll('.esg-roadmap__step').forEach((el, i) => {
        const chip = el.querySelector('.esg-chip');
        if (!chip || !chip.textContent.trim()) bad.push(`roadmap rung ${i} carries no state word`);
        if (i > 0 && !el.querySelector('.esg-roadmap__link')) {
          bad.push(`roadmap rung ${i} does not say how it is joined to the one above`);
        }
      });
      // §27 — every gap states its kind in words.
      document.querySelectorAll('.esg-gap').forEach((el, i) => {
        const state = el.querySelector('.esg-astate');
        if (!state || !state.textContent.trim()) bad.push(`gap ${i} carries no kind word`);
      });
      return [...new Set(bad)].slice(0, 6);
    });
    out.push(`state-in-words ${path}: ${r.length ? 'FAIL — ' + r.join(' | ') : 'every state carries a word'}`);
  }

  /* ── 2 · THE GAP'S FIVE ANSWERS ARE ANNOUNCED WITH THEIR QUESTIONS ──────
     The whole reason §27 uses a <dl>. A screen reader must read "What would
     resolve this: …" and not five unlabelled paragraphs. Checked
     structurally: every <dd> has a <dt> before it inside the same <dl>. */
  await page.goto(BASE + '/improvement', { waitUntil: 'load' });
  const dl = await page.evaluate(() => {
    const bad = [];
    let terms = 0;
    let defs = 0;
    document.querySelectorAll('.esg-gap__answers').forEach((list, gi) => {
      if (list.tagName !== 'DL') { bad.push(`gap ${gi} answers are a ${list.tagName}, not a DL`); return; }
      list.querySelectorAll('dd').forEach((dd) => {
        defs += 1;
        const prev = dd.previousElementSibling;
        if (!prev || prev.tagName !== 'DT') bad.push(`gap ${gi} has a dd with no dt before it`);
      });
      terms += list.querySelectorAll('dt').length;
    });
    // The legend is a <dl> too, for the same reason.
    document.querySelectorAll('.esg-legend').forEach((l) => {
      if (l.tagName !== 'DL') bad.push('the state legend is not a definition list');
    });
    return { bad: [...new Set(bad)].slice(0, 5), terms, defs };
  });
  out.push(`gap answers: ${dl.bad.length ? 'FAIL — ' + dl.bad.join(' | ')
    : `${dl.terms} terms / ${dl.defs} definitions, every answer paired with its question`}`);

  /* ── 3 · HEADING ORDER ─────────────────────────────────────────────────
     A page whose headings skip a level is a page a screen-reader user cannot
     navigate by structure. P9 added three pages and a dashboard section; each
     must go h1 → h2 → h3 without a jump. */
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    const h = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const levels = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .filter((e) => getComputedStyle(e).display !== 'none')
        .map((e) => ({ n: Number(e.tagName[1]), t: e.textContent.trim().slice(0, 30) }));
      const jumps = [];
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i].n > levels[i - 1].n + 1) {
          jumps.push(`h${levels[i - 1].n} "${levels[i - 1].t}" -> h${levels[i].n} "${levels[i].t}"`);
        }
      }
      return { count: levels.length, first: levels[0] && levels[0].n, jumps: jumps.slice(0, 4) };
    });
    out.push(`headings ${path}: ${h.jumps.length ? 'SKIP — ' + h.jumps.join(' | ')
      : `${h.count} headings, no level skipped`}`);
  }

  /* ── 4 · KEYBOARD: EVERY CTA IS REACHABLE AND SHOWS A RING ─────────────
     §4.3c bans a dead control; this checks the other half — a live control
     nobody can reach without a mouse. */
  await page.goto(BASE + '/improvement', { waitUntil: 'load' });
  const kb = await page.evaluate(() => {
    const bad = [];
    const targets = [...document.querySelectorAll(
      '.esg-action__cta a, .esg-gap__foot a, .esg-copilot__asks a')];
    for (const el of targets.slice(0, 12)) {
      if (el.tabIndex < 0) { bad.push('a CTA is removed from the tab order'); continue; }
      el.focus();
      if (document.activeElement !== el) { bad.push('a CTA cannot take focus'); continue; }
      const c = getComputedStyle(el);
      const ring = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0)
        || (c.boxShadow && c.boxShadow !== 'none');
      if (!ring) bad.push(`no focus ring on "${el.textContent.trim().slice(0, 24)}"`);
    }
    return { n: targets.length, bad: [...new Set(bad)].slice(0, 4) };
  });
  out.push(`keyboard: ${kb.bad.length ? 'FAIL — ' + kb.bad.join(' | ')
    : `${kb.n} CTAs, all focusable with a visible ring`}`);

  /* ── 5 · CONTRAST, BOTH THEMES, ALL FOUR NEW COMPONENTS ───────────────── */
  const contrast = async (theme) => {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    }, theme);
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const bgOf = (el) => {
        const stack = [];
        for (let e = el; e; e = e.parentElement) {
          const p = parse(getComputedStyle(e).backgroundColor);
          const a = p.length > 3 ? p[3] : 1;
          if (a === 0) continue;
          stack.push({ rgb: p.slice(0, 3), a });
          if (a === 1) break;
        }
        if (!stack.length) return [255, 255, 255];
        let base = stack[stack.length - 1].rgb;
        for (let i = stack.length - 2; i >= 0; i -= 1) {
          const { rgb, a } = stack[i];
          base = base.map((v, k) => Math.round(rgb[k] * a + v * (1 - a)));
        }
        return base;
      };
      const ratio = (a, b) => {
        const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
        return (hi + 0.05) / (lo + 0.05);
      };
      const SELECTORS = [
        // §26
        '.esg-action__state', '.esg-action__what', '.esg-action__why',
        '.esg-action__need', '.esg-action__gain', '.esg-action__basis',
        '.esg-legend__term', '.esg-legend__def',
        // §27
        '.esg-gap__code', '.esg-gap__points', '.esg-gap__question',
        '.esg-gap__q', '.esg-gap__a',
        // §28
        '.esg-roadmap__n', '.esg-roadmap__name', '.esg-roadmap__what',
        '.esg-roadmap__caveat', '.esg-roadmap__link',
        // §29
        '.esg-copilot__label', '.esg-copilot__text', '.esg-copilot__basis',
      ];
      const bad = [];
      for (const sel of SELECTORS) {
        document.querySelectorAll(sel).forEach((el) => {
          const c = getComputedStyle(el);
          if (c.display === 'none' || c.visibility === 'hidden') return;
          const size = parseFloat(c.fontSize);
          const weight = Number(c.fontWeight) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          const r = ratio(parse(c.color).slice(0, 3), bgOf(el));
          if (r < need) bad.push(`${sel} ${r.toFixed(2)}:1 (needs ${need}, ${size}px/${weight})`);
        });
      }
      return [...new Set(bad)].slice(0, 8);
    });
  };
  for (const path of ['/dashboard', '/improvement',
    '/explain?intent=explain_requirement&subject=0543013c-e90a-4e65-8154-66a338b4ede2']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    for (const theme of ['dark', 'light']) {
      const bad = await contrast(theme);
      out.push(`contrast ${theme} ${path.split('?')[0]}: ${bad.length ? 'FAIL — ' + bad.join(' | ') : 'pass'}`);
    }
  }

  /* ── 6 · REDUCED MOTION: THE NEW COMPONENTS REST VISIBLE ───────────────
     §26 and §28 both animate in with a staggered delay. Under reduced motion
     every one must be at its final opacity and transform — measured AFTER a
     frame, because the master collapses reduced motion to a 0.01ms duration
     rather than removing the animation, and an element read inside the load
     task is still on its `from` frame. */
  await page.emulateMedia({ reducedMotion: 'reduce' });

  /* A CLOSED <details> IS NOT A HIDDEN ELEMENT, and the first draft of this
     check treated it as one.

     It reported five FAILs on /dashboard, all of them action cards inside the
     "what is done, what is blocked" disclosure. They read opacity 0 because a
     display:none element never STARTS its animation, so animation-fill-mode:
     both leaves it on its opening keyframe — which is what the browser is
     supposed to do and says nothing about whether a user can read the card.

     Excluding them outright would be the weaker fix, so the check is SPLIT:
     the resting pass skips closed disclosures (the same filter audit.js uses
     for its own leaf scan), and a second pass OPENS every disclosure and
     asserts the cards inside are then visible. That is the thing actually
     worth knowing, and it was not being tested at all before. */
  const restingProbe = () => {
    const fails = [];
    document.querySelectorAll('.esg-action, .esg-roadmap__step').forEach((e) => {
      if (e.closest('details:not([open])')) return;
      const c = getComputedStyle(e);
      if (parseFloat(c.opacity) < 0.99) fails.push(e.className + ' opacity=' + c.opacity);
      if (c.transform && c.transform !== 'none' && c.transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
        fails.push(e.className + ' transform=' + c.transform);
      }
      if (c.animationDelay !== '0s') fails.push(e.className + ' delay=' + c.animationDelay);
    });
    return [...new Set(fails)].slice(0, 5);
  };

  for (const path of ['/dashboard', '/improvement']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const bad = await page.evaluate(restingProbe);
    out.push(`reduced-motion ${path}: ${bad.length ? 'FAIL — ' + bad.join(' | ') : 'all resting visible, no delay'}`);
  }

  /* ── 6b · A DISCLOSURE THAT OPENS MUST REVEAL SOMETHING READABLE ──────── */
  await page.goto(BASE + '/dashboard', { waitUntil: 'load' });
  const opened = await page.evaluate(() => {
    const d = [...document.querySelectorAll('details')].filter((x) => x.querySelector('.esg-action'));
    d.forEach((x) => { x.open = true; });
    return d.length;
  });
  await page.waitForTimeout(300);
  const afterOpen = await page.evaluate(restingProbe);
  out.push(`disclosure reveal (reduced motion): ${opened} disclosure(s) opened, `
    + (afterOpen.length ? 'STILL HIDDEN — ' + afterOpen.join(' | ') : 'every card inside is visible'));

  await page.emulateMedia({ reducedMotion: 'no-preference' });

  return out.join('\n');
}

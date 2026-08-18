async (page) => {
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

  const DOC = '/documents/3d0b128f-fb42-4cbf-aa0e-fde18b52209d';

  // ── 1 · REDUCED MOTION: every animated element must REST VISIBLE ─────────
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['/dashboard', '/journey', DOC, '/green-finance/projects']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    // MEASURE AFTER A FRAME, NOT INSIDE THE LOAD TASK. The master collapses
    // reduced motion to animation-duration: 0.01ms rather than removing the
    // animation, so an element read synchronously on load is still on its FROM
    // frame and reports opacity 0. The first version of this probe called that
    // a failure on whichever page happened to be measured first, which is a
    // false alarm about the one thing this check exists to rule out.
    await page.waitForTimeout(250);
    const bad = await page.evaluate(() => {
      const sel = '.esg-enter, .esg-settled, .esg-found, .esg-follows, .esg-track__step';
      const fails = [];
      document.querySelectorAll(sel).forEach((e) => {
        const c = getComputedStyle(e);
        const op = parseFloat(c.opacity);
        const tf = c.transform;
        if (op < 0.99) fails.push(e.className + ' opacity=' + op);
        if (tf && tf !== 'none' && tf !== 'matrix(1, 0, 0, 1, 0, 0)') fails.push(e.className + ' transform=' + tf);
      });
      return fails.slice(0, 5);
    });
    out.push('reduced-motion ' + path + ': ' + (bad.length ? 'FAIL ' + bad.join(' | ') : 'all resting visible'));
  }

  // Nothing may still be waiting on a delay under reduced motion.
  await page.goto(BASE + '/journey', { waitUntil: 'load' });
  const delays = await page.evaluate(() => {
    const d = new Set();
    document.querySelectorAll('.esg-enter, .esg-track__step').forEach((e) => d.add(getComputedStyle(e).animationDelay));
    return [...d];
  });
  out.push('reduced-motion animation-delay values: ' + delays.join(', '));

  // ── 2 · MOTION ON: the same elements still end visible after their run ───
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(BASE + DOC, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(() => {
    const fails = [];
    document.querySelectorAll('.esg-enter, .esg-found, .esg-follows, .esg-track__step').forEach((e) => {
      if (parseFloat(getComputedStyle(e).opacity) < 0.99) fails.push(e.className);
    });
    return fails;
  });
  out.push('motion-on, after 1.5s: ' + (settled.length ? 'STILL HIDDEN ' + settled.join(' | ') : 'everything settled visible'));

  // ── 3 · THE PULSE IS SERVER-GATED ───────────────────────────────────────
  const live = await page.evaluate(() => {
    const t = document.querySelector('.esg-track');
    if (!t) return 'no track on this page';
    const cur = t.querySelector('.esg-track__step--current');
    const anim = cur ? getComputedStyle(cur, '::after').animationName : 'no current step';
    return 'data-live=' + (t.getAttribute('data-live') || 'absent') + ' current-step-animation=' + anim;
  });
  out.push('track pulse: ' + live);

  // ── 4 · KEYBOARD FOCUS IS VISIBLE ON THE NEW CONTROLS ───────────────────
  await page.goto(BASE + '/assessment/6b83d64e-872f-4d7d-96d3-c7b3d981368a', { waitUntil: 'load' });
  const focus = await page.evaluate(() => {
    const results = [];
    for (const sel of ['.esg-q__control input', '.esg-q__control select', '.esg-q__na input']) {
      const el = document.querySelector(sel);
      if (!el) { results.push(sel + ': absent'); continue; }
      el.focus();
      const c = getComputedStyle(el);
      const visible = (c.boxShadow && c.boxShadow !== 'none') || (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0);
      results.push(sel + ': ' + (visible ? 'focus ring present' : 'NO FOCUS RING'));
    }
    return results;
  });
  out.push(...focus);

  // ── 5 · CONTRAST OF THE NEW COMPONENTS, BOTH THEMES ─────────────────────
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
      // ALPHA MUST BE COMPOSITED, NOT DISCARDED. Every -bg token in this design
      // system is an 8%-alpha tint — --red-bg is rgba(239, 68, 68, 0.08) — so
      // taking its first three channels measures the text against SOLID RED and
      // reports 2.58:1 on a chip that actually renders near 12:1. The first
      // version of this probe did exactly that and produced four fabricated
      // contrast defects on the impact page, which is a worse failure than
      // missing a real one: it sends the next run to repaint a correct chip.
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
        let base = stack[stack.length - 1].rgb;          // the opaque layer
        for (let i = stack.length - 2; i >= 0; i -= 1) { // then each tint over it
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
        '.esg-track__name', '.esg-track__state', '.esg-fact__label', '.esg-fact__value',
        '.esg-fact__from', '.esg-q__map', '.esg-q__guide', '.esg-astate', '.esg-cell-link',
        '.esg-page-header__intro', '.esg-section__note',
      ];
      const bad = [];
      for (const sel of SELECTORS) {
        document.querySelectorAll(sel).forEach((el) => {
          const c = getComputedStyle(el);
          const size = parseFloat(c.fontSize);
          const weight = Number(c.fontWeight) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          const r = ratio(parse(c.color).slice(0, 3), bgOf(el));
          if (r < need) bad.push(`${sel} ${r.toFixed(2)}:1 (needs ${need})`);
        });
      }
      return [...new Set(bad)];
    });
  };
  for (const theme of ['dark', 'light']) {
    const bad = await contrast(theme);
    out.push(`contrast ${theme}: ${bad.length ? 'FAIL — ' + bad.join(' | ') : 'all new components pass WCAG AA'}`);
  }

  // Same sweep on the two pages that carry the other new components.
  for (const path of [DOC, '/impact']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    for (const theme of ['dark', 'light']) {
      const bad = await contrast(theme);
      out.push(`contrast ${theme} ${path}: ${bad.length ? 'FAIL — ' + bad.join(' | ') : 'pass'}`);
    }
  }

  return out.join('\n');
}

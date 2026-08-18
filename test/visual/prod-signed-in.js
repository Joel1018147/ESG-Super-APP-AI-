async (page) => {
  /* PRODUCTION, SIGNED IN — STILL WRITES NOTHING.
   *
   * The only mutation this performs is the sign-in itself, which touches
   * last_login_at. After that it is GET requests and DOM reads: no form is
   * submitted, no button of type=submit is clicked, nothing is created and
   * nothing is edited. That is the whole difference between this and
   * test/visual/smoke.js, which round-trips a save and is therefore pointed at
   * staging only.
   *
   * It reads the REAL production tenant, so what renders depends on what that
   * company actually has. Every check below is therefore about the SHELL and
   * the LAYOUT — things that must hold whatever the data is — rather than
   * about a particular figure. A check that expected a score would fail on an
   * empty tenant and tell you nothing about the deploy.
   */
  const BASE = 'https://esgsuperappai-production.up.railway.app';
  const PAGES = [
    '/dashboard', '/journey', '/assessment', '/documents', '/carbon',
    '/green-finance', '/green-finance/projects', '/green-finance/readiness',
    '/green-finance/opportunities', '/impact', '/company', '/governance',
    '/frameworks', '/reports',
  ];

  const out = [];
  let failed = 0;
  let note = '';
  const say = (s) => { note = s; };
  const step = async (name, fn) => {
    note = '';
    try { await fn(); out.push(`  PASS  ${name}${note ? ' — ' + note : ''}`); }
    catch (e) { failed += 1; out.push(`  FAIL  ${name}\n          ${(e.message || String(e)).split('\n')[0].slice(0, 240)}`); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 140)));

  await page.setViewportSize({ width: 1440, height: 900 });

  await step('sign in to production', async () => {
    await page.goto(BASE + '/auth/login', { waitUntil: 'load' });
    await page.locator('input[name=email]').fill('demo@example.com');
    await page.locator('input[name=password]').fill('esg-demo-2026-seritimur');
    await Promise.all([
      page.waitForURL(/dashboard/, { timeout: 30000 }),
      page.locator('button[type=submit]').click(),
    ]);
    const who = await page.evaluate(() => {
      const n = document.querySelector('.sidebar-user-name');
      const c = document.querySelector('.esg-topbar__company-name');
      return { user: n && n.textContent.trim(), company: c && c.textContent.trim() };
    });
    assert(who.user, 'signed in but the shell shows no user');
    say(`${who.user}${who.company ? ' · ' + who.company : ''}`);
  });

  await step('every signed-in page renders real content, not just the shell', async () => {
    const bad = [];
    const seen = [];
    for (const p of PAGES) {
      const r = await page.goto(BASE + p, { waitUntil: 'load' });
      if (!r || r.status() !== 200) { bad.push(`${p}=${r && r.status()}`); continue; }
      const v = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          blocks: main ? main.querySelectorAll(
            '.esg-card, .esg-section, .esg-page-header, .esg-hero, .esg-facts, .esg-track, '
            + '.esg-table-scroll, .esg-ai, .esg-reserved, .empty-state, .card, .alert').length : 0,
          text: main ? main.innerText.trim().length : 0,
        };
      });
      if (v.blocks === 0) bad.push(`${p} rendered no content block`);
      if (v.text < 40) bad.push(`${p} rendered ${v.text} chars of text`);
      seen.push(`${p.split('/').pop() || 'dash'}:${v.blocks}`);
    }
    assert(bad.length === 0, bad.join(' | '));
    say(`${PAGES.length} pages, content blocks — ${seen.join(' ')}`);
  });

  await step('NO PAGE OVERFLOWS, at 1440 / 1024 / 768 / 390', async () => {
    const bad = [];
    for (const w of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const p of PAGES) {
        await page.goto(BASE + p, { waitUntil: 'load' });
        const v = await page.evaluate(() => {
          const de = document.documentElement;
          const main = document.querySelector('.app-main');
          const off = [];
          if (main) {
            main.querySelectorAll('*').forEach((e) => {
              const r = e.getBoundingClientRect();
              if (r.width < 2) return;
              if (r.right > de.clientWidth + 1) {
                for (let a = e.parentElement; a; a = a.parentElement) {
                  const ox = getComputedStyle(a).overflowX;
                  if (ox === 'auto' || ox === 'scroll') return;   // reachable by design
                }
                off.push((e.className || e.tagName).toString().slice(0, 30));
              }
            });
          }
          return { scrollW: de.scrollWidth, clientW: de.clientWidth, off: [...new Set(off)].slice(0, 3) };
        });
        if (v.scrollW > v.clientW + 1) bad.push(`${p}@${w} scrolls ${v.scrollW}>${v.clientW}`);
        if (v.off.length) bad.push(`${p}@${w} clipped: ${v.off.join(',')}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    assert(bad.length === 0, bad.slice(0, 4).join(' | '));
    say(`${PAGES.length} pages x 4 widths = ${PAGES.length * 4} renders, none overflowing or clipped`);
  });

  await step('no undefined CSS class reaches a production page', async () => {
    // The shell links both sheets; a class in neither renders as nothing at
    // all, silently. This is dashboard-test's guard, run against the real box.
    /* SAME-ORIGIN ONLY, and this is the point rather than an optimisation.
     *
     * The first version fetched every <link rel=stylesheet> href, which
     * includes the Google Fonts one — and the CSP sets connectSrc: ['self'],
     * so the browser refused it, the probe returned null and the step failed.
     * The CSP was RIGHT: styleSrc permits fonts.googleapis.com so the page's
     * own <link> loads, while connect-src correctly refuses a script fetching
     * it. My probe was the thing violating the policy, and it reported that as
     * a product failure.
     *
     * The classes this check is about are all defined in this app's own two
     * sheets anyway; a font sheet defines none of them. */
    const sheets = await page.evaluate(async () => {
      const here = location.origin;
      const hrefs = [...document.querySelectorAll('link[rel=stylesheet]')]
        .map((l) => l.href).filter((h) => h.startsWith(here));
      let css = '';
      for (const h of hrefs) { try { css += await (await fetch(h)).text(); } catch (e) { return null; } }
      document.querySelectorAll('style').forEach((s) => { css += s.textContent; });
      return css;
    });
    assert(sheets && sheets.length > 1000, 'could not read the deployed stylesheets from the page');
    const defined = new Set([...sheets.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const bad = [];
    for (const p of PAGES) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      const used = await page.evaluate(() => {
        const s = new Set();
        document.querySelectorAll('[class]').forEach((e) => e.classList.forEach((c) => s.add(c)));
        return [...s];
      });
      const missing = used.filter((c) => !defined.has(c));
      if (missing.length) bad.push(`${p}: ${missing.slice(0, 4).join(', ')}`);
    }
    assert(bad.length === 0, bad.slice(0, 3).join(' | '));
    say('every rendered class is defined in a sheet the page actually loads');
  });

  await step('CONTRAST holds in both themes on the real tenant', async () => {
    /* THE THEME IS SET BEFORE NAVIGATION, and that is the correction rather
     * than a preference. The first version flipped data-theme inside
     * page.evaluate and read computed styles in the same synchronous task; on
     * /frameworks it reported .stat-value at 1.00:1 — text the same colour as
     * its card — which would have been text invisible in light mode on
     * production. It is not: clicking the real theme button gives
     * --surface #ffffff, a white card and #1e293b text, about 12:1.
     *
     * The probe was reading a half-recalculated tree of its own making. Setting
     * localStorage and letting the shell's boot script apply the theme BEFORE
     * first paint is both reliable and what a returning user actually gets.
     * Recorded because a false FAIL here costs a day chasing a defect that was
     * never in the product — and the same pattern could as easily have
     * produced a false PASS. */
    const check = async (theme) => page.evaluate((t) => {
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
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
        for (let i = stack.length - 2; i >= 0; i -= 1) { const { rgb, a } = stack[i]; base = base.map((v, k) => Math.round(rgb[k] * a + v * (1 - a))); }
        return base;
      };
      const ratio = (a, b) => { const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (hi + 0.05) / (lo + 0.05); };
      const bad = [];
      document.querySelectorAll('main *').forEach((el) => {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        const c = getComputedStyle(el);
        if (c.display === 'none' || c.visibility === 'hidden') return;
        const size = parseFloat(c.fontSize); const weight = Number(c.fontWeight) || 400;
        const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
        const r = ratio(parse(c.color).slice(0, 3), bgOf(el));
        if (r < need) bad.push(`${(el.className || el.tagName).toString().slice(0, 28)} ${r.toFixed(2)}`);
      });
      return { theme: document.documentElement.getAttribute('data-theme'), bad: [...new Set(bad)] };
    }, theme);

    const bad = [];
    let booted = 0;
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => localStorage.setItem('modus-theme', t), theme);
      for (const p of PAGES) {
        await page.goto(BASE + p, { waitUntil: 'load' });
        const r = await check(theme);
        // A page that did not BOOT in the theme was never measured in it, and
        // counting it as a pass is the vacuous-pass shape this suite avoids.
        if (r.theme !== theme) { bad.push(`${p} booted as ${r.theme}, not ${theme}`); continue; }
        booted += 1;
        if (r.bad.length) bad.push(`${p} ${theme}: ${r.bad.slice(0, 2).join(', ')}`);
      }
    }
    await page.evaluate(() => localStorage.setItem('modus-theme', 'dark'));
    assert(bad.length === 0, bad.slice(0, 4).join(' | '));
    say(`${booted} of ${PAGES.length * 2} page/theme renders confirmed booted, every text pair >= WCAG AA`);
  });

  await step('the phone overflow sheet is shut on arrival in production', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const open = [];
    for (const p of ['/dashboard', '/company', '/governance', '/impact', '/carbon']) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      const isOpen = await page.evaluate(() => document.querySelector('.esg-nav-more').hasAttribute('open'));
      if (isOpen) open.push(p);
    }
    assert(open.length === 0, `shipped open on: ${open.join(', ')}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    say('5 pages including three that live inside the sheet');
  });

  await step('no console error across the whole signed-in walk', async () => {
    assert(consoleErrors.length === 0,
      `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(' | ')}`);
    say('zero, across every page and viewport above');
  });

  out.unshift(failed
    ? `PRODUCTION SIGNED-IN: ${failed} FAILED`
    : 'PRODUCTION SIGNED-IN: all steps passed (GET only — nothing was created or edited)');
  return out.join('\n');
}

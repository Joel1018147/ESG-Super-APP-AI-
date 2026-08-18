async (page) => {
  /* PRODUCTION POST-DEPLOY CHECK — READ ONLY.
   *
   * This writes NOTHING. test/smoke-test.js registers companies and never
   * cleans up, which is why CLAUDE.md says it must never be pointed at
   * production; this is the check that can be. That also bounds what it can
   * prove: everything below is a SIGNED-OUT surface plus the served artefacts.
   * The signed-in half was verified against staging, and this file does not
   * pretend otherwise.
   */
  const BASE = 'https://esgsuperappai-production.up.railway.app';
  const out = [];
  let failed = 0;
  /* The first version of this helper collected details into a PARALLEL array
   * and matched them to steps by index. A failing step never reaches its say(),
   * so one failure would have shifted every detail after it onto the wrong
   * line — a reporter that misattributes its own evidence, which is the last
   * thing you want reading a production check. The detail is now returned by
   * the step itself and cannot drift from it. */
  let note = '';
  const say = (s) => { note = s; };
  const step = async (name, fn) => {
    note = '';
    try {
      await fn();
      out.push(`  PASS  ${name}${note ? ' — ' + note : ''}`);
    } catch (e) {
      failed += 1;
      out.push(`  FAIL  ${name}\n          ${(e.message || String(e)).split('\n')[0].slice(0, 200)}`);
    }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await page.setViewportSize({ width: 1440, height: 900 });

  await step('health reports the production database up', async () => {
    const r = await page.request.get(BASE + '/health');
    assert(r.status() === 200, `health returned ${r.status()}`);
    const j = await r.json();
    assert(j.ok === true && j.db === 'up', `health says ${JSON.stringify(j)}`);
    say(JSON.stringify(j));
  });

  await step('the ESG design layer is served, and it is the P8 one', async () => {
    const r = await page.request.get(BASE + '/css/esg-system.css');
    assert(r.status() === 200, `esg-system.css returned ${r.status()}`);
    const css = await r.text();
    // Not "is there a file" — is it the file this deploy was supposed to ship.
    for (const marker of ['.esg-track', '.esg-fact', '.esg-cell-link', 'contain: inline-size', '.esg-nav-more--current']) {
      assert(css.includes(marker), `the deployed layer has no ${marker} — an older build is live`);
    }
    say(`${Math.round(css.length / 1024)} KB, all five P8 markers present`);
  });

  await step('the master stylesheet in production is still the pinned one', async () => {
    const r = await page.request.get(BASE + '/css/modus-design-system.css');
    assert(r.status() === 200, `master css returned ${r.status()}`);
    const css = await r.text();
    // The repo pins md5 5785b26f. Production must be serving that same file —
    // a drift here means something edited the master on the way to the box.
    assert(!css.includes('.esg-'), 'the deployed master contains esg- classes — it has been edited');
    say(`${Math.round(css.length / 1024)} KB, no esg- classes in it`);
  });

  await step('the signed-out shell renders with the platform accent', async () => {
    const r = await page.goto(BASE + '/auth/login', { waitUntil: 'load' });
    assert(r.status() === 200, `/auth/login returned ${r.status()}`);
    const v = await page.evaluate(() => ({
      platform: document.documentElement.getAttribute('data-platform'),
      theme: document.documentElement.getAttribute('data-theme'),
      scheme: document.documentElement.style.colorScheme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      hasForm: !!document.querySelector('input[name=email]') && !!document.querySelector('input[name=password]'),
      // A signed-out page must carry NO app navigation (bareLayout).
      chrome: document.querySelectorAll('.app-sidebar, .app-bottom-nav').length,
    }));
    assert(v.platform === 'esg', `data-platform is "${v.platform}"`);
    assert(v.theme === 'dark', `data-theme is "${v.theme}" — ESG defaults to dark`);
    assert(v.scheme === 'dark', `color-scheme is "${v.scheme}" — the P8 shell script did not run`);
    assert(v.accent.length > 0, 'the accent token resolved to nothing');
    assert(v.hasForm, 'the sign-in form is not on the sign-in page');
    assert(v.chrome === 0, `a signed-out page rendered ${v.chrome} navigation region(s)`);
    say(`accent ${v.accent}, dark, color-scheme applied, no chrome`);
  });

  await step('signed-out routes answer, and protected ones refuse', async () => {
    const rows = [];
    for (const p of ['/', '/auth/login', '/auth/register']) {
      const r = await page.request.get(BASE + p, { maxRedirects: 0 });
      rows.push(`${p}=${r.status()}`);
      assert(r.status() === 200, `${p} returned ${r.status()}`);
    }
    for (const p of ['/dashboard', '/company', '/governance']) {
      const r = await page.request.get(BASE + p, { maxRedirects: 0 });
      rows.push(`${p}=${r.status()}`);
      assert(r.status() === 302, `${p} returned ${r.status()} to an anonymous visitor, not a redirect`);
    }
    const api = await page.request.get(BASE + '/api/company', { maxRedirects: 0 });
    assert(api.status() === 401, `/api/company returned ${api.status()} to an anonymous caller, not 401`);
    rows.push(`/api/company=401`);
    say(rows.join(' '));
  });

  await step('no console error on the signed-out surfaces', async () => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 140)));
    for (const p of ['/', '/auth/login', '/auth/register']) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForTimeout(250);
    }
    assert(errs.length === 0, `${errs.length}: ${errs.slice(0, 2).join(' | ')}`);
    say('3 pages clean');
  });

  await step('the sign-in page has no horizontal overflow at 390px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/auth/login', { waitUntil: 'load' });
    const v = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    assert(v.scrollW <= v.clientW + 1, `scrollWidth ${v.scrollW} > clientWidth ${v.clientW}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    say(`${v.scrollW} = ${v.clientW}`);
  });

  out.unshift(failed
    ? `PRODUCTION CHECK: ${failed} FAILED`
    : 'PRODUCTION CHECK: all steps passed (read-only; signed-in flows were verified on staging)');
  return out.join('\n');
}

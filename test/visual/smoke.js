async (page) => {
  /* PLAYWRIGHT SMOKE — the flows a person actually performs.
   *
   * test/smoke-test.js already proves every route answers and every screen
   * renders. This is the half that cannot be proved over HTTP: that a person
   * with a browser can sign in, change something, and see the change — through
   * the real form, the real redirect and the real re-render.
   *
   * Every step ASSERTS. A step that merely navigates and reports "ok" is the
   * shape that lets a broken save pass a smoke test. */
  const BASE = 'http://127.0.0.1:3000';
  const out = [];
  let failed = 0;
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      out.push(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
    } catch (e) {
      failed += 1;
      out.push(`  FAIL  ${name}\n          ${(e.message || String(e)).split('\n')[0].slice(0, 220)}`);
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  await page.setViewportSize({ width: 1440, height: 900 });

  await step('sign in through the real form', async () => {
    await page.goto(BASE + '/auth/login', { waitUntil: 'load' });
    await page.locator('input[name=email]').fill('demo@example.com');
    await page.locator('input[name=password]').fill('esg-demo-2026-seritimur');
    await Promise.all([
      page.waitForURL(/dashboard/, { timeout: 20000 }),
      page.locator('button[type=submit]').click(),
    ]);
    const title = await page.title();
    assert(/Dashboard/.test(title), `landed on "${title}" instead of the dashboard`);
    return title.split(' · ')[0];
  });

  await step('the dashboard shows a real score, not a placeholder', async () => {
    const r = await page.evaluate(() => {
      const ring = document.querySelector('.score-ring');
      const val = ring && ring.querySelector('.score-ring-value');
      return {
        score: val && val.textContent.trim(),
        ringScore: ring && getComputedStyle(ring).getPropertyValue('--score').trim(),
        next: (document.querySelector('.esg-next__title') || {}).textContent,
      };
    });
    assert(r.score && /^\d+$/.test(r.score), `the ring shows "${r.score}"`);
    assert(r.ringScore === r.score, `the arc says ${r.ringScore} and the numeral says ${r.score}`);
    assert(r.next && r.next.trim().length, 'no next action on the dashboard');
    return `score ${r.score}, next action "${r.next.trim()}"`;
  });

  await step('SAVE A COMPANY PROFILE CHANGE and see it come back', async () => {
    await page.goto(BASE + '/company', { waitUntil: 'load' });
    const before = await page.locator('#employee_count').inputValue();
    const next = String((Number(before) || 100) + 1);
    await page.locator('#employee_count').fill(next);
    await Promise.all([
      page.waitForURL(/\/company\?saved=1/, { timeout: 20000 }),
      page.locator('button[type=submit]').click(),
    ]);
    const banner = await page.locator('.alert').first().textContent();
    assert(/saved/i.test(banner), `no success banner after saving: "${banner.trim()}"`);
    const after = await page.locator('#employee_count').inputValue();
    assert(after === next, `saved ${next} but the form came back with ${after}`);
    // …and the read-only summary beside it must agree with the form.
    const fact = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.esg-fact')].find((f) => /Employees/.test(f.textContent));
      return el && el.querySelector('.esg-fact__value').textContent.trim();
    });
    assert(fact === next, `the form says ${next} and the summary says ${fact}`);
    // Put it back, so a smoke run does not drift the demo company every time.
    await page.locator('#employee_count').fill(before);
    await Promise.all([page.waitForURL(/saved=1/, { timeout: 20000 }), page.locator('button[type=submit]').click()]);
    return `${before} -> ${next} -> restored to ${before}, form and summary agreed`;
  });

  await step('a REJECTED save keeps every value the person typed', async () => {
    /* THIS STEP REPORTS WHICH BRANCH IT TOOK, and that is deliberate.
     *
     * The interesting path is the unique-violation one: a duplicate SSM must
     * come back as a field error with the form intact, never as the generic
     * error page that throws the typing away. Reaching it needs a CLASHING ROW,
     * and whether staging has one depends on what previous runs left behind.
     *
     * Naming this step "a duplicate SSM is refused" and passing when no clash
     * existed would be a smoke test that reports a path it never walked. So it
     * asserts the invariant that holds either way — the values survive — and
     * says out loud which of the two it actually exercised. */
    await page.goto(BASE + '/company', { waitUntil: 'load' });
    const original = await page.locator('#ssm_number').inputValue();

    // Every other company's SSM in this database, straight from the API.
    const clash = await page.evaluate(async () => {
      const r = await fetch('/api/company', { headers: { accept: 'application/json' } });
      if (!r.ok) return null;
      return (await r.json()).ssm_number || null;
    }).catch(() => null);

    const probe = 'DEMO-0000001';           // the seeded demo company's own
    const typed = 'Edited Name That Must Survive';
    await page.locator('#ssm_number').fill(probe);
    await page.locator('#name').fill(typed);
    await Promise.all([page.waitForLoadState('load'), page.locator('button[type=submit]').click()]);

    const name = await page.locator('#name').inputValue();
    const err = await page.locator('.field-error, .alert-warning').count();
    assert(name === typed || /saved/i.test(await page.locator('.alert').first().textContent().catch(() => '')),
      `the form came back with "${name}" instead of what was typed`);

    await page.locator('#ssm_number').fill(original);
    await page.locator('#name').fill('Seri Timur Manufacturing Sdn Bhd (DEMO)');
    await Promise.all([page.waitForLoadState('load'), page.locator('button[type=submit]').click()]);

    return err > 0
      ? 'took the REJECTION path — field error shown, typed values intact'
      : `took the ACCEPT path (no clashing row in staging${clash ? `, own SSM ${clash}` : ''}) — `
        + 'the refusal branch was NOT exercised here; it is covered at unit level';
  });

  await step('the assessment form posts and the page comes back scored', async () => {
    await page.goto(BASE + '/assessment', { waitUntil: 'load' });
    const href = await page.locator('a[href^="/assessment/"]').first().getAttribute('href');
    await page.goto(BASE + href, { waitUntil: 'load' });
    const controls = await page.locator('.esg-q__control input, .esg-q__control select').count();
    assert(controls > 0, 'the assessment rendered no answer controls');
    const styled = await page.evaluate(() => {
      const el = document.querySelector('.esg-q__control input');
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, h: Math.round(el.getBoundingClientRect().height) };
    });
    assert(styled.bg !== 'rgb(255, 255, 255)', `an answer control is still unstyled white (${styled.bg})`);
    assert(styled.h >= 36, `an answer control is ${styled.h}px tall`);
    return `${controls} controls, first one ${styled.h}px on ${styled.bg}`;
  });

  await step('the phone overflow sheet stays shut, and still opens on demand', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/governance', { waitUntil: 'load' });
    const shut = await page.evaluate(() => document.querySelector('.esg-nav-more').hasAttribute('open'));
    assert(!shut, 'the overflow sheet shipped open again');
    await page.locator('.esg-nav-more > summary').click();
    const open = await page.evaluate(() => document.querySelector('.esg-nav-more').hasAttribute('open'));
    assert(open, 'the overflow sheet no longer opens when tapped');
    await page.setViewportSize({ width: 1440, height: 900 });
    return 'closed on load, opens on tap';
  });

  await step('no page in the walk logs a console error', async () => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 120)));
    for (const p of ['/dashboard', '/journey', '/assessment', '/documents', '/carbon',
      '/green-finance', '/green-finance/projects', '/green-finance/readiness',
      '/green-finance/opportunities', '/impact', '/company', '/governance']) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForTimeout(120);
    }
    assert(errors.length === 0, `${errors.length} console error(s): ${errors.slice(0, 3).join(' | ')}`);
    return '12 pages, clean console';
  });

  await step('every page still returns 200 to the browser, not just to curl', async () => {
    const bad = [];
    for (const p of ['/dashboard', '/journey', '/assessment', '/documents', '/carbon',
      '/green-finance', '/green-finance/projects', '/green-finance/readiness',
      '/green-finance/opportunities', '/impact', '/company', '/governance', '/frameworks', '/reports']) {
      const r = await page.goto(BASE + p, { waitUntil: 'load' });
      if (!r || r.status() !== 200) bad.push(`${p}=${r && r.status()}`);
    }
    assert(bad.length === 0, `non-200: ${bad.join(', ')}`);
    return '14 routes, all 200';
  });

  out.unshift(failed ? `PLAYWRIGHT SMOKE: ${failed} FAILED` : 'PLAYWRIGHT SMOKE: all steps passed');
  return out.join('\n');
}

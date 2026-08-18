async (page) => {
  const BASE = 'http://127.0.0.1:3000';
  const DIR = 'ESG-Super-App-AI/docs/design/p8/';

  await page.goto(BASE + '/auth/login');
  await page.locator('input[name=email]').fill('demo@example.com');
  await page.locator('input[name=password]').fill('esg-demo-2026-seritimur');
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {}),
    page.locator('button[type=submit]').click(),
  ]);

  const SHOTS = [
    ['01-dashboard', '/dashboard', 1440, 900],
    ['02-journey', '/journey', 1440, 900],
    ['03-assessment', '/assessment/6b83d64e-872f-4d7d-96d3-c7b3d981368a', 1440, 900],
    ['04-readiness', '/green-finance/readiness', 1440, 900],
    ['05-documents', '/documents', 1440, 900],
    ['06-impact', '/impact', 1440, 900],
    ['07-carbon', '/carbon', 1440, 900],
    ['08-projects', '/green-finance/projects', 1440, 900],
    ['09-opportunities', '/green-finance/opportunities', 1440, 900],
    ['10-dashboard-mobile', '/dashboard', 390, 844],
    ['11-journey-mobile', '/journey', 390, 844],
    ['12-assessment-mobile', '/assessment/6b83d64e-872f-4d7d-96d3-c7b3d981368a', 390, 844],
    ['13-carbon-mobile', '/carbon', 390, 844],
    ['14-dashboard-1024', '/dashboard', 1024, 800],
  ];

  const done = [];
  for (const [name, path, w, h] of SHOTS) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(700);          // let the staggered entrances settle
    await page.screenshot({ path: DIR + 'after-' + name + '.png', scale: 'css' });
    done.push(name);
  }

  // The light theme, on the two surfaces P8 changed most.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '/dashboard');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
    try { localStorage.setItem('modus-theme', 'light'); } catch (e) { /* not fatal for a screenshot */ }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: DIR + 'after-15-dashboard-light.png', scale: 'css' });
  await page.goto(BASE + '/assessment/6b83d64e-872f-4d7d-96d3-c7b3d981368a');
  await page.waitForTimeout(500);
  await page.screenshot({ path: DIR + 'after-16-assessment-light.png', scale: 'css' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';
    try { localStorage.setItem('modus-theme', 'dark'); } catch (e) { /* not fatal for a screenshot */ }
  });
  done.push('15-dashboard-light', '16-assessment-light');

  return done.join(', ');
}

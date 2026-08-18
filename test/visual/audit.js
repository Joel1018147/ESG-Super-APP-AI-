async (page) => {
  const BASE = 'http://127.0.0.1:3000';
  /* THE NAV PART OF THE PAGE LIST IS NO LONGER HAND-KEPT. THE REST STILL IS,
     AND THIS COMMENT SAYS SO RATHER THAN IMPLYING OTHERWISE.

     It was hand-kept entirely, and it drifted twice. P8 reported "zero
     horizontal overflow" while production clipped /assessment and /frameworks,
     because neither was in the list. fc29163 added them and wrote: "A
     hand-kept page list will drift again. layout.MODULES is the nav's own
     source and smoke-test.js already walks it; the honest fix is to derive
     from it."

     It drifted again. The P10 audit found /green-finance/register clipping a
     749px table into a 390px viewport with no scroll container — 371px of
     every one of 31 rows unreachable — and the six "not built yet" pages
     rendering at 0px padding. None of the seven was in the list.

     So the nav is derived now. This probe runs in the Playwright sandbox and
     cannot require() the nav module, so the list is fetched FROM THE RUNNING
     APP: /api/nav-paths publishes exactly what layout.MODULES holds. A
     destination added to the nav is audited from that moment.

     BUT DERIVING FROM THE NAV WOULD NOT HAVE CAUGHT THE REGISTER, and the
     first version of this comment read as though it had. /green-finance/
     register is not a nav destination — it is reached by a button on
     /green-finance — so it is absent from MODULES and was therefore absent
     from the derived list too, right through the review of the change that
     fixed it. Deriving fixes nav drift and nothing else.

     NON_NAV below closes that hole for the pages a signed-in user can open
     with no id and no extra role. What is still outside coverage, and why:

       /green-finance/projects/:id, /green-finance/projects/:id/routes,
       /documents/:id, /carbon/import/:batchId
         need a live id, and /api/nav-paths publishes only three. Add the id
         there and add the route here — do not guess an id, because a bad one
         measures a 404 and reports it clean.

       /green-finance/admin/products, /green-finance/admin/products/:id/edit
         are super-admin only. This probe signs in as a company_admin, so it
         would measure the 403 page and call it clean. Audit them from a
         session that can actually open them.

       /design-system
         is a developer reference, not a product page, and next()s straight
         past in production.

     The detail pages take ids for the same reason named above — check the
     titles in a green run before believing it. */
  const nav = await (await page.request.get(BASE + '/api/nav-paths',
    { headers: { Accept: 'application/json' } })).json();
  // Reachable, in no nav, no id, no extra role. Keep this list honest by hand.
  const NON_NAV = [
    ['green-finance-register', '/green-finance/register'],
    ['green-finance-projects-new', '/green-finance/projects/new'],
    ['carbon-import', '/carbon/import'],
  ];
  const PAGES = [
    ...nav.paths.map((p) => [p.replace(/^\//, '').replace(/\//g, '-') || 'root', p]),
    ...NON_NAV,
    ['assessment-detail', '/assessment/' + nav.sample.assessment],
    ['register-detail', '/green-finance/register/' + nav.sample.financeProduct],
    ['explain', '/explain?intent=explain_requirement&subject=' + nav.sample.indicator],
  ].filter(([, p]) => !/undefined|null/.test(p));
  /* 360 ADDED IN P9. The five above were P8's set; the directive names six and
     360 is the one that was missing — it is the narrowest width this product
     supports and the one where a 16rem grid track minimum has least room. */
  const VIEWPORTS = [[1440, 900], [1280, 800], [1024, 800], [768, 900], [390, 844], [360, 780]];

  const probe = (mobile) => {
    const out = { overflow: null, collisions: [], tiny: [], targets: [], unstyled: 0, offscreen: [] };
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.overflow = { scrollW: de.scrollWidth, clientW: de.clientWidth };

    const main = document.querySelector('main') || document.body;

    // text-bearing leaf elements
    const leaves = [...main.querySelectorAll('*')].filter((e) => {
      if (!e.childNodes.length) return false;
      const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return false;
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden' || c.position === 'fixed') return false;
      if (e.closest('details:not([open])') && !e.closest('summary')) return false;
      // Visually-hidden ancestors. .esg-table--stack hides its <thead> with the
      // clip() pattern, and a clipped 1x1 box still gives its CHILDREN full-size
      // rects — which the collision pass then read as ten header/cell overlaps
      // on a table that renders correctly.
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const ac = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        if (ac.overflow !== 'visible' && (ar.width <= 2 || ar.height <= 2)) return false;
        if (ac.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      }
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    });

    // A horizontal scroll container makes what is past its edge REACHABLE, by
    // design — §5's .esg-table-scroll exists precisely so a wide table is not
    // data loss. Content inside one is not "off-screen"; it is scrollable.
    const inScroller = (e) => {
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };

    for (const e of leaves) {
      const c = getComputedStyle(e);
      const fs = parseFloat(c.fontSize);
      if (fs < 12) out.tiny.push({ tag: e.tagName, cls: e.className, fs, txt: e.textContent.trim().slice(0, 40) });
      const r = e.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 && !inScroller(e)) {
        out.offscreen.push({ cls: e.className, right: Math.round(r.right), txt: e.textContent.trim().slice(0, 40) });
      }
    }

    // pairwise overlap between non-nested text leaves
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i]; const b = leaves[j];
        if (a.contains(b) || b.contains(a)) continue;
        // An INLINE element that wraps across lines reports a UNION box
        // spanning the whole paragraph, which overlaps every sibling on the
        // lines it crosses. Those are the detector's own artefact, not a
        // collision — the P8 before-run reported eleven of them on two pages.
        if (a.getClientRects().length > 1 || b.getClientRects().length > 1) continue;
        const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) {
          out.collisions.push({
            a: (a.className || a.tagName) + ' :: ' + a.textContent.trim().slice(0, 26),
            b: (b.className || b.tagName) + ' :: ' + b.textContent.trim().slice(0, 26),
            ox: Math.round(ox), oy: Math.round(oy),
          });
        }
      }
    }

    /* interactive targets

       WCAG 2.2's Target Size (Minimum) CARRIES AN "IN-LINE" EXCEPTION, and
       this probe did not, so it reported a link inside a sentence as a defect
       at every viewport. The exception is narrow and it is quoted rather than
       paraphrased: "the target is in a sentence, or its size is otherwise
       constrained by the line-height of non-target text". A link set in running
       prose IS that, and enlarging it would break the paragraph it sits in.

       The test below is the exception's own condition, not a convenience: the
       anchor's PARENT must itself carry text outside the anchor. A link that
       is the only content of its block is NOT in a sentence and is still
       measured — which is what keeps a lone 16px link in a card from slipping
       through this. Buttons and form controls are never exempt. */
    const inSentence = (e) => {
      if (e.tagName !== 'A') return false;
      const parent = e.parentElement;
      if (!parent) return false;

      /* THE SURROUNDING TEXT MUST BE NON-TARGET TEXT, which is the half the
         first version of this exception left out — and it made the guard
         weaker than the paragraph above it claims.

         The test was "is there more text in the parent than in this link",
         which is true of TWO ADJACENT LINKS IN A TOOLBAR: each one's text is
         shorter than the pair's combined text, so each exempted the other and
         both skipped the touch-target check entirely. Measured: a row holding
         "Explain this requirement" and "What evidence can I provide?" exempted
         both. Nothing is masked today — every such row in this product uses
         the master's .btn, which the master's own <=768px rule floors at 44px
         — but the next non-.btn link pair anywhere in the app would have
         passed this check at any height.

         WCAG's wording is "constrained by the line-height of NON-TARGET
         text", so the prose is measured with every interactive descendant
         removed. A link with only other links beside it is not in a sentence. */
      /* AND IT MUST BE TEXT A READER CAN SEE.

         The narrowing above was itself too generous on its first run, and the
         skip link caught it: `a.skip-link` is a direct child of <body>, and
         <body> also holds the theme-boot <script>. Its 2,347 characters of
         JavaScript source counted as surrounding prose, so a 36px target that
         the probe had been correctly reporting at 390px silently stopped being
         reported. A guard that quietly stops seeing a real defect is worse
         than the false positive it was fixing.

         Non-rendered nodes contribute nothing: script, style, template and
         anything the browser is not painting. */
      const RENDERS = (n) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(n.tagName)
        && getComputedStyle(n).display !== 'none';
      const TARGET = 'a[href], button, input, select, textarea, summary';

      const own = e.textContent.trim().length;
      let prose = 0;
      for (const n of parent.childNodes) {
        if (n.nodeType === 3) { prose += n.textContent.trim().length; continue; }
        if (n === e || n.nodeType !== 1) continue;
        if (!RENDERS(n)) continue;
        // A non-interactive element (em, strong, span) contributes its text;
        // an interactive one contributes nothing, because it is a target too.
        if (!n.matches(TARGET) && !n.querySelector(TARGET)) prose += n.textContent.trim().length;
      }
      return own > 0 && prose >= 12;
    };
    document.querySelectorAll('a[href], button, input, select, textarea, summary').forEach((e) => {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden') return;
      if (e.type === 'hidden') return;
      const r = e.getBoundingClientRect();
      if (r.height === 0) return;
      if (inSentence(e)) return;
      const min = mobile ? 44 : 28;
      if (r.height < min) out.targets.push({ tag: e.tagName, cls: e.className, h: Math.round(r.height), txt: (e.textContent || e.name || '').trim().slice(0, 26) });
    });

    // unstyled native controls
    document.querySelectorAll('input,select,textarea').forEach((e) => {
      if (e.type === 'hidden') return;
      const bg = getComputedStyle(e).backgroundColor;
      if (bg === 'rgb(255, 255, 255)') out.unstyled++;
    });

    // dedupe
    const key = (o) => JSON.stringify(o);
    out.collisions = [...new Map(out.collisions.map((o) => [key(o), o])).values()].slice(0, 12);
    out.tiny = [...new Map(out.tiny.map((o) => [o.cls + o.fs, o])).values()].slice(0, 10);
    out.targets = [...new Map(out.targets.map((o) => [o.tag + o.cls + o.h, o])).values()].slice(0, 12);
    out.offscreen = [...new Map(out.offscreen.map((o) => [o.cls, o])).values()].slice(0, 8);
    return out;
  };

  const report = {};
  for (const [name, path] of PAGES) {
    report[name] = {};
    for (const [w, h] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(BASE + path, { waitUntil: 'load' });
      const r = await page.evaluate(probe, w <= 768);
      const brief = {};
      if (r.overflow) brief.OVERFLOW = r.overflow;
      if (r.collisions.length) brief.collisions = r.collisions;
      if (r.tiny.length) brief.tiny = r.tiny;
      if (r.targets.length) brief.targets = r.targets;
      if (r.unstyled) brief.unstyledControls = r.unstyled;
      if (r.offscreen.length) brief.offscreen = r.offscreen;
      if (Object.keys(brief).length) report[name][w] = brief;
    }
    if (!Object.keys(report[name]).length) delete report[name];
  }
  const L=[];
  for (const [pg, vps] of Object.entries(report)) {
    for (const [w, b] of Object.entries(vps)) {
      const tag = pg + '@' + w;
      if (b.OVERFLOW) L.push(tag + ' OVERFLOW ' + b.OVERFLOW.scrollW + '>' + b.OVERFLOW.clientW);
      if (b.unstyledControls) L.push(tag + ' UNSTYLED-CONTROLS ' + b.unstyledControls);
      (b.collisions || []).forEach(c => L.push(tag + ' COLLIDE ' + c.ox + 'x' + c.oy + ' [' + c.a + '] [' + c.b + ']'));
      (b.offscreen || []).forEach(c => L.push(tag + ' OFFSCREEN right=' + c.right + ' .' + c.cls + ' ' + c.txt));
      (b.tiny || []).forEach(c => L.push(tag + ' TINY ' + c.fs + 'px .' + c.cls));
      (b.targets || []).forEach(c => L.push(tag + ' TARGET ' + c.h + 'px ' + c.tag + '.' + c.cls + ' ' + c.txt.replace(/\s+/g, ' ')));
    }
  }
  return L.join('\n');

}

async (page) => {
  const BASE = 'http://127.0.0.1:3000';
  const PAGES = [
    ['dashboard', '/dashboard'],
    ['journey', '/journey'],
    ['assessment', '/assessment/6b83d64e-872f-4d7d-96d3-c7b3d981368a'],
    ['green-finance', '/green-finance'],
    ['projects', '/green-finance/projects'],
    ['readiness', '/green-finance/readiness'],
    ['opportunities', '/green-finance/opportunities'],
    ['impact', '/impact'],
    ['carbon', '/carbon'],
    ['documents', '/documents'],
    ['company', '/company'],
    ['governance', '/governance'],
  ];
  const VIEWPORTS = [[1440, 900], [1280, 800], [1024, 800], [768, 900], [390, 844]];

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

    // interactive targets
    document.querySelectorAll('a[href], button, input, select, textarea, summary').forEach((e) => {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden') return;
      if (e.type === 'hidden') return;
      const r = e.getBoundingClientRect();
      if (r.height === 0) return;
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

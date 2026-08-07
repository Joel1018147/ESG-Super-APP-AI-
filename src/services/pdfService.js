'use strict';
// PDF text extraction and chunking for Layer 2.
//
// ── Why pdfjs-dist directly, and not pdf-parse ──────────────────────────────
// pdf-parse@2 declares a HARD dependency on @napi-rs/canvas — eleven prebuilt
// native binaries — because it can also rasterise pages. We never rasterise
// anything; getTextContent() is pure JavaScript.
//
// That dependency made Layer 2 unrunnable on Windows: the win32 binding failed
// to load, extractText() threw, and all twelve guards — the ones that keep a
// language model away from the ESG score — could only be executed by deploying.
// The most safety-critical code in the repo had the worst possible feedback
// loop, on a machine that could never run it.
//
// pdfjs needs three browser globals to exist at module load. It does not USE
// them for text extraction, so stubs are sufficient and no binding is loaded.
// Verified by extracting a two-page fixture with @napi-rs/canvas absent from
// the import graph entirely.

// Stubs, not polyfills. If pdfjs ever genuinely calls one of these, that means
// a code path has started needing real canvas geometry, and it should fail
// loudly here rather than silently return wrong coordinates.
function installDomStubs() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrixStub {
      constructor(init) {
        Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (Array.isArray(init)) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
      multiply()     { return this; }
      translate()    { return this; }
      scale()        { return this; }
      invertSelf()   { return this; }
      transformPoint(p) { return p; }
    };
  }
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageDataStub {
      constructor(w, h) { this.width = w; this.height = h; }
    };
  }
  if (!globalThis.Path2D) globalThis.Path2D = class Path2DStub {};
}

// pdfjs v5 is ESM-only; this file is CommonJS. Imported once, lazily, and
// cached — a top-level await is not available here and a per-call import would
// re-resolve the module on every document.
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) {
    installDomStubs();
    _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return _pdfjs;
}

// Resolved from the installed package rather than hard-coded, so it survives
// a hoisted or pnpm-style node_modules layout.
// A file:// URL, not a filesystem path. pdfjs validates that this ends in "/"
// and rejects anything else — and `path.join(...) + path.sep` ends in "\" on
// Windows, so getDocument() threw `Invalid factory url ... must include
// trailing slash` on every extraction. It passed on Linux, where path.sep is
// already "/", which is exactly the shape of bug that survives CI and fails
// only on the machine someone is developing on. pathToFileURL normalises the
// separators and the drive letter on both.
const STANDARD_FONTS = (() => {
  try {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const dir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
    return pathToFileURL(dir + path.sep).href;
  } catch { return undefined; }
})();

// Groq free tier is 8,000 tokens per minute on the chat model. A 40-page
// sustainability report is far past that in one call, so text is chunked and
// extraction runs as a queued job rather than in-request. ~4 chars/token, so
// 6,000 chars ≈ 1,500 tokens, leaving room for the indicator list and the reply.
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 400;

/**
 * @returns {{status:'extracted'|'no_text_layer', pageCount:number,
 *            pages:{num:number,text:string}[], text:string}}
 * Throws on a malformed or encrypted PDF — recorded by the caller as 'failed',
 * which is a third state again, distinct from a scan with no text.
 */
async function extractText(buffer) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buffer),
    // No fonts are rendered, so none need fetching. Set explicitly to silence
    // a warning that would otherwise appear once per uploaded document.
    disableFontFace: true,
    useSystemFonts: false,
    // Belt and braces on a file a stranger uploaded.
    isEvalSupported: false,
    // Packaged with pdfjs. Without it, every document logs a warning telling
    // us to provide it — noise in a production log is how real warnings stop
    // being read.
    standardFontDataUrl: STANDARD_FONTS,
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // pdfjs emits an item per text run. hasEOL marks a line break; without
      // honouring it, wrapped sentences would be glued together and a quote
      // spanning a line break would never verify.
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push({ num: n, text: normalise(text) });
      page.cleanup();
    }
    const text = pages.map((p) => p.text).join('\n\n');

    // A scanned PDF parses fine and yields almost nothing. Reporting that as
    // "no ESG content found" tells an owner their report is empty when the
    // truth is that nobody has OCR'd it — the most expensive error this feature
    // can make, because they stop looking.
    const status = text.replace(/\s+/g, '').length < 40 ? 'no_text_layer' : 'extracted';
    return { status, pageCount: doc.numPages, pages, text };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

function normalise(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split into chunks that each remember which page they started on, so a quote
 * found in a chunk can be attributed to a page a reviewer can open.
 */
function chunkPages(pages, { chunkChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP } = {}) {
  const chunks = [];
  let buf = '';
  let startPage = pages.length ? pages[0].num : 1;

  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push({ text: t, page: startPage });
    buf = '';
  };

  for (const p of pages) {
    if (!p.text) continue;
    if (buf && buf.length + p.text.length > chunkChars) { flush(); startPage = p.num; }
    if (!buf) startPage = p.num;
    buf += (buf ? '\n\n' : '') + p.text;

    while (buf.length > chunkChars) {
      const cut = buf.lastIndexOf(' ', chunkChars) > 0 ? buf.lastIndexOf(' ', chunkChars) : chunkChars;
      chunks.push({ text: buf.slice(0, cut).trim(), page: startPage });
      buf = buf.slice(Math.max(0, cut - overlap));
      startPage = p.num;
    }
  }
  flush();
  return chunks;
}

module.exports = { extractText, chunkPages, normalise, CHUNK_CHARS, installDomStubs };

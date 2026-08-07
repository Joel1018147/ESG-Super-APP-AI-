'use strict';
// PDF text extraction and chunking for Layer 2.
//
// Page numbers are carried through every stage. A proposal that cannot say
// which page its quote came from is not reviewable — the whole point of the
// review queue is that a person can go and look.

// pdf-parse is loaded LAZILY, inside extractText — never at module scope.
//
// It reaches for DOMMatrix, which Node does not define on any version we run
// (checked: v20 locally, v24 in the container). The polyfill comes from
// @napi-rs/canvas's native binding, and that binding does not load everywhere —
// on this Windows box it reports "Failed to load native binding" despite the
// win32 package being installed, and `require('pdf-parse')` throws
// ReferenceError.
//
// At module scope that error propagates through extractionService.js →
// routes/documents.js → server.js:177, which requires this router at BOOT. The
// whole app would fail to start: no login, no dashboard, no /health — over a
// feature nobody was using at that moment. Required inside the call instead, so
// a binding failure costs exactly the analyse path and leaves the app up.
function loadParser() {
  try {
    return require('pdf-parse').PDFParse;
  } catch (err) {
    const e = new Error(`PDF text extraction is unavailable on this host (${err.message})`);
    e.code = 'PDF_PARSER_UNAVAILABLE';
    throw e;
  }
}

// Groq free tier is 8,000 tokens per minute on the chat model. A 40-page
// sustainability report is far past that in one call, so text is chunked and
// the extraction runs as a queued job rather than in-request. ~4 chars/token,
// so 6,000 chars ≈ 1,500 tokens, leaving room for the indicator list and the
// reply inside a single request.
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 400;   // so a disclosure straddling a boundary is not lost

/**
 * @returns {{status:'extracted'|'no_text_layer', pageCount:number,
 *            pages:{num:number,text:string}[], text:string}}
 * Throws on a malformed or encrypted PDF — the caller records that as 'failed',
 * which is a different state again from a scan with no text.
 */
async function extractText(buffer) {
  const PDFParse = loadParser();
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = (result.pages || []).map((p) => ({
      num: p.num,
      text: normalise(p.text || ''),
    }));
    const text = pages.map((p) => p.text).join('\n\n');

    // A scanned PDF parses fine and returns almost nothing. Reporting that as
    // "no ESG content found" tells an owner their report is empty when the
    // truth is that nobody has OCR'd it — the most expensive error this
    // feature can make, because they stop looking.
    const meaningful = text.replace(/\s+/g, '');
    const status = meaningful.length < 40 ? 'no_text_layer' : 'extracted';

    return { status, pageCount: result.total || pages.length, pages, text };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// pdf-parse interleaves "-- 3 of 40 --" separators into its combined text.
// Stripped here so a page marker can never end up inside an evidence quote.
function normalise(s) {
  return String(s)
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split into chunks that each remember which page they started on, so a quote
 * found in a chunk can be attributed to a page the reviewer can open.
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
    if (buf && buf.length + p.text.length > chunkChars) {
      flush();
      // Carry a tail forward so a sentence split across the boundary still has
      // its context in the next chunk.
      startPage = p.num;
    }
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

module.exports = { extractText, chunkPages, normalise, CHUNK_CHARS };

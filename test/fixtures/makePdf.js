'use strict';
// Builds a minimal, valid, multi-page PDF with a text layer.
//
// Hand-rolled rather than pulled from a library: the Layer 2 tests need a
// fixture whose exact text is known byte-for-byte, so that a quote the model
// claims to have found can be checked against a source we authored. A
// generated-by-library fixture would put a dependency between the test and
// whatever that library decides to emit.
//
// makeScannedPdf() produces a page with NO text layer, which is the case that
// must be reported as "this PDF has no extractable text" rather than as an
// empty report.

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(lines) {
  const body = lines.map((line, i) =>
    `BT /F1 11 Tf 50 ${740 - i * 16} Td (${esc(line)}) Tj ET`).join('\n');
  return body;
}

/** @param {string[][]} pages - one array of text lines per page */
function makePdf(pages) {
  const objects = [];
  const pageCount = pages.length;
  // 1 catalog, 2 pages, then per page: page obj + content obj, then font
  const pageObjIds = [];
  const contentObjIds = [];
  let nextId = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pageObjIds.push(nextId++);
    contentObjIds.push(nextId++);
  }
  const fontId = nextId++;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  pages.forEach((lines, i) => {
    objects[pageObjIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentObjIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    const stream = contentStream(lines);
    objects[contentObjIds[i]] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const maxId = objects.length - 1;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    const off = offsets[id] || 0;
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A page with graphics but no text-drawing operators — a scan, in effect. */
function makeScannedPdf() {
  const stream = '1 0 0 RG 4 w 100 100 m 500 700 l S';
  const objects = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>`;
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 5\n0000000000 65535 f \n`;
  for (let id = 1; id <= 4; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makePdf, makeScannedPdf };

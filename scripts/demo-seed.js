#!/usr/bin/env node
'use strict';
// ── Demo data, created THROUGH THE REAL API ────────────────────────────────
//
// Deliberately NOT seed.sql and NOT schema.sql. Both of those replay on every
// boot, forever, in every future deployment — demo data put there stops being
// demo data and becomes permanent fixture data nobody remembers adding.
// This is a script you run once, on purpose.
//
// THE RULE THIS SCRIPT OBEYS: it supplies INPUTS ONLY. Every derived value —
// the score, the band, the kg CO2e, the stamped emission factors, the AI
// recommendations, the extracted proposals — is computed by the real engine
// through the real endpoint. Nothing here inserts a number that the platform
// is supposed to calculate. A hand-written score would demo a number that no
// code path can reproduce, which is the one thing a stakeholder can catch.
//
// It is idempotent: re-running signs in rather than re-registering, upserts
// responses, skips carbon periods that already exist, and relies on the
// upload route's own sha256 de-duplication.
//
// The company is obviously fictional and prefixed DEMO so it can be found and
// removed later:  DELETE FROM esg_companies WHERE name LIKE '%(DEMO)%';
//
// Usage:
//   node scripts/demo-seed.js https://<host>            # against a deployment
//   node scripts/demo-seed.js                           # defaults to localhost:3999

const BASE = (process.argv[2] || 'http://127.0.0.1:3999').replace(/\/+$/, '');

const DEMO = {
  company: 'Seri Timur Manufacturing Sdn Bhd (DEMO)',
  name: 'Aminah Rahim',
  // example.com is reserved by RFC 2606 and can never be a real mailbox, so
  // this cannot collide with, or mail, a real person.
  email: 'demo@example.com',
  password: 'esg-demo-2026-seritimur',
  reporting_year: 2025,
};

// ── A minimal, real PDF with a genuine text layer ──────────────────────────
// Written by hand rather than pulled from a dependency: the extraction service
// needs a document whose text can actually be read, and adding a PDF-writing
// library for one fixture is a dependency the platform would then carry.
// Uncompressed content stream, Helvetica, one page per 46 lines.
function makePdf(title, lines) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const pageLines = [];
  for (let i = 0; i < lines.length; i += 44) pageLines.push(lines.slice(i, i + 44));

  const objects = [];
  const pageIds = pageLines.map((_, i) => 4 + i * 2);      // page, contents, page, contents…
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pageLines.forEach((chunk, p) => {
    const pageId = pageIds[p];
    const contentId = pageId + 1;
    const body = [
      'BT', '/F1 11 Tf', '14 TL', '56 780 Td',
      ...(p === 0 ? [`(${esc(title)}) Tj`, 'T*', 'T*'] : []),
      ...chunk.flatMap((l) => [`(${esc(l)}) Tj`, 'T*']),
      'ET',
    ].join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] `
                    + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  const size = objects.length;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i += 1) {
    pdf += offsets[i] === undefined
      ? '0000000000 65535 f \n'
      : `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Sentences chosen so the extractor has real, quotable claims to propose
// against specific indicators. Every figure here is invented for a fictional
// company; none of it is presented as anyone's real performance.
const REPORT_TITLE = 'Seri Timur Manufacturing Sdn Bhd (DEMO) - Sustainability Report 2025';
//
// ONE SENTENCE PER LINE, and every line short enough not to wrap. The extractor
// only accepts a proposal whose quote it can find verbatim in the extracted
// page text. A sentence split across two PDF text lines is not contiguous once
// extracted, so every quote spanning the break fails verification and the
// proposal is discarded — which is what happened on the first production run:
// text_status came back `extracted`, and zero proposals survived.
const REPORT_LINES = [
  'This report is a FICTIONAL DEMONSTRATION DOCUMENT. It describes no real company.',
  '',
  '1. GOVERNANCE',
  'The Board approved a written Code of Conduct in March 2025.',
  'The company maintains a documented anti-bribery and anti-corruption policy.',
  'A confidential whistleblowing channel is available to all employees.',
  'The company has a data privacy policy aligned to the PDPA 2010.',
  'A supplier code of conduct was issued to all key suppliers during 2025.',
  'The accounts for the financial year were subject to an external audit.',
  'Ethics and compliance training was delivered to all staff during the year.',
  'A named sustainability committee is accountable for ESG performance.',
  'The board includes two independent non-executive directors.',
  'A risk register is maintained and reviewed by the board twice a year.',
  '',
  '2. ENVIRONMENT',
  'The company has set a documented target to reduce emissions by 2030.',
  'Rooftop solar supplied part of the electricity used at the Shah Alam plant.',
  'Waste is segregated into general, recyclable and scheduled streams.',
  'Monthly electricity consumption is tracked from utility bills.',
  'Water consumption is tracked and recorded monthly.',
  'Fuel used by owned vehicles is recorded from fleet card statements.',
  'There were no reportable environmental incidents during the year.',
  '',
  '3. SOCIAL',
  'The company operates a written health and safety policy.',
  'Workplace injuries and lost time are recorded and reviewed.',
  'The company measures customer satisfaction through an annual survey.',
  'The company contributed to community programmes during the year.',
  'The company declares that it uses no child labour and no forced labour.',
  'A documented human rights and non-discrimination policy is in place.',
  'Employees may raise grievances through a named contact in management.',
];

// ── The 40 answers ─────────────────────────────────────────────────────────
// A realistic spread, not a perfect score: strong governance, weaker supply
// chain and GHG inventory maturity, two genuine N/A. A weak area is what makes
// the AI recommendations worth demonstrating.
const RESPONSES = [
  // Environmental
  { code: 'E-01', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'E-02', value_numeric: 486000,  evidence_tier: 'documented' },
  { code: 'E-03', option_code: 'partial', evidence_tier: 'self_declared' },
  { code: 'E-04', value_numeric: 12400,   evidence_tier: 'documented' },
  { code: 'E-05', is_na: true },                       // no petrol vehicles
  { code: 'E-06', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'E-07', value_numeric: 8600,    evidence_tier: 'documented' },
  { code: 'E-08', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'E-09', value_numeric: 42,      evidence_tier: 'self_declared' },
  { code: 'E-10', option_code: '2',       evidence_tier: 'self_declared' },  // weak on purpose
  { code: 'E-11', option_code: 'partial', evidence_tier: 'documented' },
  { code: 'E-12', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'E-13', option_code: '1',       evidence_tier: 'self_declared' },  // weak on purpose
  { code: 'E-14', option_code: 'no',      evidence_tier: 'self_declared' },
  // Social
  { code: 'S-01', value_numeric: 148,     evidence_tier: 'documented' },
  { code: 'S-02', value_numeric: 38,      evidence_tier: 'documented' },
  { code: 'S-03', value_numeric: 25,      evidence_tier: 'documented' },
  { code: 'S-04', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'S-05', value_numeric: 2,       evidence_tier: 'documented' },
  { code: 'S-06', value_numeric: 18.5,    evidence_tier: 'documented' },
  { code: 'S-07', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'S-08', value_numeric: 14.2,    evidence_tier: 'self_declared' },
  { code: 'S-09', option_code: 'partial', evidence_tier: 'self_declared' },
  { code: 'S-10', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'S-11', option_code: '2',       evidence_tier: 'self_declared' },
  { code: 'S-12', option_code: 'partial', evidence_tier: 'self_declared' },
  { code: 'S-13', option_code: 'yes',     evidence_tier: 'self_declared' },
  // Governance
  { code: 'G-01', value_numeric: 5,       evidence_tier: 'documented' },
  { code: 'G-02', value_numeric: 40,      evidence_tier: 'documented' },
  { code: 'G-03', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-04', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-05', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-06', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-07', option_code: '3',       evidence_tier: 'documented' },
  { code: 'G-08', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-09', option_code: '2',       evidence_tier: 'self_declared' },  // weak on purpose
  { code: 'G-10', option_code: 'partial', evidence_tier: 'documented' },
  { code: 'G-11', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-12', option_code: 'yes',     evidence_tier: 'documented' },
  { code: 'G-13', option_code: 'yes',     evidence_tier: 'documented' },
];

// Monthly-ish activity across the year so the carbon table has shape and the
// stamped factors are visible. kg CO2e is computed by the engine, never here.
const CARBON = [
  { kind: 'electricity', amount: 41200, period_start: '2025-01-01', period_end: '2025-03-31' },
  { kind: 'electricity', amount: 39800, period_start: '2025-04-01', period_end: '2025-06-30' },
  { kind: 'electricity', amount: 44100, period_start: '2025-07-01', period_end: '2025-09-30' },
  { kind: 'electricity', amount: 42600, period_start: '2025-10-01', period_end: '2025-12-31' },
  // `kind` for a fuel is the FACTOR CODE, not a friendly name — POST /api/carbon
  // passes it straight to fuelToCo2e, which looks up esg_emission_factors.code.
  // The diesel factor is seeded `unverified`, so these rows come back
  // is_provisional and render flagged. That is worth showing, not hiding.
  { kind: 'FUEL_DIESEL', amount: 3100,  period_start: '2025-01-01', period_end: '2025-06-30' },
  { kind: 'FUEL_DIESEL', amount: 3350,  period_start: '2025-07-01', period_end: '2025-12-31' },
];

// ── HTTP with a cookie jar ─────────────────────────────────────────────────
let cookie = '';
async function http(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  return res;
}
const json = async (path, method, body) => {
  const r = await http(path, {
    method, headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON body reported below */ }
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return parsed;
};
const form = (o) => new URLSearchParams(o).toString();
const step = (n, msg) => console.log(`  ${n}. ${msg}`);

(async () => {
  console.log(`demo-seed -> ${BASE}\n`);

  // 1 · Account. Register, or sign in if it already exists (idempotent).
  const reg = await http('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ company: DEMO.company, name: DEMO.name, email: DEMO.email, password: DEMO.password }),
  });
  if (reg.status === 302 && !String(reg.headers.get('location') || '').includes('error')) {
    step(1, `registered ${DEMO.email}`);
  } else {
    cookie = '';
    const login = await http('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: DEMO.email, password: DEMO.password }),
    });
    const loc = String(login.headers.get('location') || '');
    if (login.status !== 302 || loc.includes('error')) {
      throw new Error(`cannot register or sign in as ${DEMO.email} (register=${reg.status}, login=${login.status} ${loc})`);
    }
    step(1, `already existed — signed in as ${DEMO.email}`);
  }

  // 2 · Company profile. grid_region drives which Scope 2 factor resolves.
  const co = await json('/api/company', 'PUT', {
    name: DEMO.company,
    ssm_number: 'DEMO-0000001',
    msic_code: '25999',
    employee_count: 148,
    annual_revenue_myr: 24500000,
    grid_region: 'peninsular',
  });
  step(2, `company profile set — grid ${co.grid_region}, ${co.employee_count} employees`);

  /* 3 · Assessment. Idempotent per (company, framework, year) in the route.
   *
   * THE FRAMEWORK IS NAMED, AND IT HAS TO BE (found in P9, broken since
   * Run 25). This call used to send only `reporting_year`, and it worked
   * because the route resolved a framework by ORDER BY when none was given.
   * Run 25 closed that — RULE 6: a caller who names nothing gets a 400 rather
   * than quietly receiving whichever framework happened to sort first — and
   * this script was never updated, so it has 400'd at step 3 on any database
   * where the demo company did not already have an assessment. Nobody saw it
   * because on the databases people actually use, it already did.
   *
   * The 40 answers below are written against MODUS_SEDG_ALIGNED's codes
   * (E-01 … G-13), so the framework is not a free choice here: sending SEDG
   * would have every one of them rejected. It is named explicitly rather than
   * left to a default for exactly the reason Run 25 removed the default. */
  const a = await json('/api/assessments', 'POST', {
    reporting_year: DEMO.reporting_year,
    framework: 'MODUS_SEDG_ALIGNED',
    framework_version: '0.9-draft',
  });
  step(3, `assessment ${DEMO.reporting_year} — ${a.id}`);

  // 4 · The 40 answers. Upsert; rejections are reported, never swallowed.
  const put = await json(`/api/assessments/${a.id}/responses`, 'PUT', { responses: RESPONSES });
  if (put.rejected.length) throw new Error(`indicator codes rejected: ${put.rejected.join(', ')}`);
  step(4, `${put.written} of 40 responses written, 0 rejected`);

  // 5 · Carbon. Skip periods already present so a re-run does not double them.
  //
  // The key is built from LOCAL date parts, not from slicing the ISO string.
  // node-postgres returns a DATE as a Date at LOCAL midnight; in UTC+8 that
  // serialises to the previous day in Z, so `.slice(0,10)` yields 2024-12-31
  // for 2025-01-01, no key ever matches, and every re-run silently doubles the
  // carbon table. The first run of this script did exactly that.
  const ymd = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const existing = await json('/api/carbon', 'GET');
  const seen = new Set((existing.entries || []).map((e) => `${ymd(e.period_start)}|${e.scope}`));
  let added = 0;
  for (const c of CARBON) {
    if (seen.has(`${c.period_start}|${c.kind === 'electricity' ? 2 : 1}`)) continue;
    const r = await json('/api/carbon', 'POST', c);
    added += 1;
    step(5, `${c.kind} ${c.period_start} -> ${r.kg_co2e} kg CO2e`
          + `${r.is_provisional ? ' (provisional factor)' : ''} · factor v${r.factor_version_used}`);
  }
  if (!added) step(5, 'carbon entries already present — nothing added');

  // 6 · Score. COMPUTED by the engine. Nothing here writes a score.
  const scored = await json(`/api/assessments/${a.id}/score`, 'POST', {});
  if (!scored.overall || scored.overall.score_0_100 == null) {
    throw new Error(`scoring returned no overall score: ${JSON.stringify(scored).slice(0, 200)}`);
  }
  step(6, `scored by the engine: ${scored.overall.score_0_100} (${scored.overall.band_code})`
        + ` · E ${scored.pillars.E.score_0_100} / S ${scored.pillars.S.score_0_100} / G ${scored.pillars.G.score_0_100}`
        + ` · AI recommendations: ${scored.recommendations && scored.recommendations.written}`);

  // 7 · Evidence. Uploaded through the real multipart route; the route's own
  //     sha256 check makes a re-run a no-op.
  const pdf = makePdf(REPORT_TITLE, REPORT_LINES);
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'seri-timur-sustainability-report-2025-DEMO.pdf');
  fd.append('doc_type', 'esg_report');
  const up = await http('/documents', { method: 'POST', body: fd });
  const docId = String(up.headers.get('location') || '').split('/').pop();
  if (!docId) throw new Error(`upload did not redirect to a document (status ${up.status})`);
  step(7, `evidence uploaded — ${(pdf.length / 1024).toFixed(1)} KB, document ${docId}`);

  // 8 · Layer 2. Queue the extraction and WAIT — but do not accept anything.
  //     The pending review queue is the point: a human decides each proposal.
  await json(`/api/documents/${docId}/analyse`, 'POST', {});
  step(8, 'extraction queued');

  let ex = { extractions: [] };
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 4000));      // polling a queue, not scheduling work
    ex = await json(`/api/assessments/${a.id}/extractions`, 'GET');
    if (ex.extractions.length) break;
  }
  if (ex.coverage) step(8, `coverage: ${JSON.stringify(ex.coverage)}`);
  const pending = ex.extractions.filter((e) => e.status === 'pending');
  const accepted = ex.extractions.filter((e) => e.status === 'accepted');
  step(8, `${ex.extractions.length} proposals, ${pending.length} PENDING REVIEW, ${accepted.length} accepted`);
  if (accepted.length) throw new Error('something accepted a proposal — the review queue must be left for a human');
  if (!pending.length) {
    console.log('\n  ⚠️  No pending proposals. The queue is the best thing in the demo —');
    console.log('     check GROQ_API_KEY on the target and re-run step 8.');
  }

  console.log(`\n✅ demo ready at ${BASE}`);
  console.log(`   sign in: ${DEMO.email} / ${DEMO.password}`);
  console.log(`   remove later: DELETE FROM esg_companies WHERE name LIKE '%(DEMO)%';`);
})().catch((e) => { console.error(`\n❌ ${e.message}`); process.exit(1); });

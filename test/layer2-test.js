'use strict';
// Layer 2 guards, tested against a model that lies.
//
// The stub below does what a real model does when it is unsure: it invents a
// plausible quote, cites a disclosure it cannot evidence, answers with an
// option that does not exist, names a code that was never offered, and adds a
// confident percentage nobody asked for. If any of that reaches esg_responses
// or esg_scores, this feature is worse than not having it — a wrong ESG score
// attached to a grant application is not an embarrassment, it is fraud.

const assert = require('assert');
const { makePdf, makeScannedPdf } = require('./fixtures/makePdf');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { failed += 1; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

(async () => {
  console.log('layer2-test');
  if (!process.env.DATABASE_URL) {
    console.log('  SKIPPED — no DATABASE_URL. These are the guards that keep a model away');
    console.log('  from the score; they must be run before any Layer 2 deploy.');
    return;
  }

  const { query } = require('../src/db');
  const ex = require('../src/services/extractionService');
  const { computeScores } = require('../src/services/scoringEngine');

  // ── Fixture: a report that genuinely says two things ─────────────────────
  const TRUE_LINE_G = 'The Board adopted a formal anti-bribery and anti-corruption policy in March 2024.';
  const TRUE_LINE_S = 'A written health and safety policy is reviewed annually by the management committee.';
  const pdf = makePdf([
    ['Sustainability Report 2025', 'This report covers our operations in Malaysia.'],
    [TRUE_LINE_G, TRUE_LINE_S],
  ]);

  const stamp = Date.now();
  const { rows: co } = await query(
    `INSERT INTO esg_companies (name, grid_region) VALUES ($1,'peninsular') RETURNING id`,
    [`Layer2 Test ${stamp}`]);
  const companyId = co[0].id;
  const { rows: us } = await query(
    `INSERT INTO esg_users (company_id, email, name, role) VALUES ($1,$2,'L2','company_admin') RETURNING id`,
    [companyId, `l2-${stamp}@example.com`]);
  const userId = us[0].id;
  const { rows: fw } = await query(
    `SELECT id, code, version FROM esg_frameworks
      WHERE framework_kind='entity_disclosure' AND is_active LIMIT 1`);
  const { rows: sc } = await query(
    `SELECT id, version FROM esg_weighting_schemes WHERE is_active LIMIT 1`);
  const { rows: asmt } = await query(
    `INSERT INTO esg_assessments
       (company_id, framework_id, framework_code, framework_version,
        weighting_scheme_id, weighting_version, reporting_year, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,2025,$7) RETURNING id`,
    [companyId, fw[0].id, fw[0].code, fw[0].version, sc[0].id, sc[0].version, userId]);
  const assessmentId = asmt[0].id;
  const { rows: dc } = await query(
    `INSERT INTO esg_documents (company_id, assessment_id, doc_type, filename, mime_type, byte_size, content, uploaded_by)
     VALUES ($1,$2,'esg_report','report.pdf','application/pdf',$3,$4,$5) RETURNING id`,
    [companyId, assessmentId, pdf.length, pdf, userId]);
  const documentId = dc[0].id;

  // ── The liar ─────────────────────────────────────────────────────────────
  const hallucinating = async () => [
    `G-05|yes|${TRUE_LINE_G}`,                                     // true, quotable
    `S-07|yes|${TRUE_LINE_S}`,                                     // true, quotable
    'E-11|yes|The company generated 4.2 GWh from rooftop solar in 2025.',  // INVENTED
    'E-12|yes|We target a 45% reduction in emissions by 2030.',            // INVENTED
    'G-06|yes|policy',                                             // too short to be evidence
    'E-99|yes|A disclosure code that does not exist anywhere.',    // unknown code
    'G-04|mostly|The code of conduct is published on our website.',// invalid option
    'E-02|yes|Total electricity consumed was 1,240,000 kWh.',      // numeric indicator
    'Overall the company scores 78% on ESG maturity.',             // free-form figure
  ].join('\n');

  const result = await ex.analyseDocument({
    documentId, assessmentId, companyId, userId, generate: hallucinating,
  });

  await test('numeric indicators are never put in front of the model', async () => {
    const { rows } = await query(
      `SELECT response_type FROM esg_indicators WHERE framework_id=$1 AND is_active`, [fw[0].id]);
    const numeric = rows.filter((r) => r.response_type === 'quantitative').length;
    assert.ok(numeric > 0, 'fixture framework has no quantitative indicators to exclude');
    assert.strictEqual(result.indicatorsSkippedNumeric, numeric,
      'quantitative indicators reached the prompt');
  });

  await test('invented quotes are auto-rejected before any human sees them', async () => {
    const { rows } = await query(
      `SELECT i.code, e.status, e.quote_verified
         FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1`, [documentId]);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    for (const code of ['E-11', 'E-12']) {
      assert.ok(byCode[code], `${code} was not recorded at all`);
      assert.strictEqual(byCode[code].status, 'auto_rejected', `${code} was not auto-rejected`);
      assert.strictEqual(byCode[code].quote_verified, false);
    }
  });

  await test('quotable disclosures survive and are marked verified', async () => {
    const { rows } = await query(
      `SELECT i.code, e.status, e.quote_verified, e.page_no
         FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1 AND e.status='pending'`, [documentId]);
    const codes = rows.map((r) => r.code).sort();
    assert.deepStrictEqual(codes, ['G-05', 'S-07'], `unexpected pending set: ${codes}`);
    for (const r of rows) {
      assert.strictEqual(r.quote_verified, true);
      assert.ok(r.page_no >= 1, 'a proposal with no page is not reviewable');
    }
  });

  await test('unknown codes, invalid options and numeric indicators never get as far as a row', async () => {
    // These fail at PARSE — before the quote is even looked at — so there is
    // nothing to record. E-99 was never offered, "mostly" is not an option
    // G-04 accepts, and E-02 is quantitative so it was excluded from the
    // prompt entirely.
    const { rows } = await query(
      `SELECT i.code FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1`, [documentId]);
    const seen = new Set(rows.map((r) => r.code));
    for (const code of ['G-04', 'E-02']) {
      assert.ok(!seen.has(code), `${code} should not have been recorded at all`);
    }
  });

  await test('a too-short quote is rejected, and says so rather than crying fabrication', async () => {
    // G-06 was quoted as "policy" — a word in every ESG report. It is recorded
    // rather than dropped, because a rejected claim is evidence about how the
    // model is behaving on this document. But its reason must not read like
    // the E-11/E-12 fabrications, or the rejection log stops discriminating.
    const { rows } = await query(
      `SELECT e.status, e.reject_reason FROM esg_document_extractions e
         JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1 AND i.code='G-06'`, [documentId]);
    assert.strictEqual(rows.length, 1, 'the short quote was not recorded at all');
    assert.strictEqual(rows[0].status, 'auto_rejected');
    assert.match(rows[0].reject_reason, /characters/, `reason was: ${rows[0].reject_reason}`);

    const { rows: fab } = await query(
      `SELECT e.reject_reason FROM esg_document_extractions e
         JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1 AND i.code='E-11'`, [documentId]);
    assert.match(fab[0].reject_reason, /does not appear/, `reason was: ${fab[0].reject_reason}`);
  });

  await test('NOTHING reaches esg_responses without a human accepting it', async () => {
    const { rows } = await query(
      `SELECT count(*)::int n FROM esg_responses WHERE assessment_id=$1`, [assessmentId]);
    assert.strictEqual(rows[0].n, 0,
      'extraction wrote responses directly — an AI just moved a company\'s ESG score');
  });

  await test('a proposal whose quote was never verified cannot be accepted', async () => {
    const { rows } = await query(
      `SELECT id FROM esg_document_extractions WHERE document_id=$1 AND status='auto_rejected' LIMIT 1`,
      [documentId]);
    await assert.rejects(() => ex.acceptProposal(rows[0].id, userId), /never verified|already/);
  });

  await test('accepting writes a response at documented, not verified', async () => {
    const { rows } = await query(
      `SELECT e.id, i.code FROM esg_document_extractions e JOIN esg_indicators i ON i.id=e.indicator_id
        WHERE e.document_id=$1 AND e.status='pending' AND i.code='G-05'`, [documentId]);
    await ex.acceptProposal(rows[0].id, userId);
    const { rows: resp } = await query(
      `SELECT r.evidence_tier, r.option_code, r.document_id
         FROM esg_responses r JOIN esg_indicators i ON i.id=r.indicator_id
        WHERE r.assessment_id=$1 AND i.code='G-05'`, [assessmentId]);
    assert.strictEqual(resp.length, 1, 'accepting did not create the response');
    assert.strictEqual(resp[0].evidence_tier, 'documented',
      'a document-derived answer must not score as third-party verified');
    assert.strictEqual(resp[0].option_code, 'yes');
    assert.ok(resp[0].document_id, 'the response does not point back at its evidence');
  });

  await test('coverage counts accepted work only, and names hallucinations separately', async () => {
    const cov = await ex.coverage(assessmentId);
    const g = cov.find((c) => c.pillar === 'G');
    const e = cov.find((c) => c.pillar === 'E');
    assert.strictEqual(g.accepted, 1);
    assert.strictEqual(e.accepted, 0);
    assert.strictEqual(e.hallucinated, 2, 'the two invented disclosures are not being surfaced');
    assert.strictEqual(g.hallucinated, 1, 'the unquotable G-06 claim is not being surfaced');
  });

  await test('a scan with no text layer is reported as such, not as an empty report', async () => {
    const scan = makeScannedPdf();
    const { rows: d2 } = await query(
      `INSERT INTO esg_documents (company_id, assessment_id, doc_type, filename, mime_type, byte_size, content, uploaded_by)
       VALUES ($1,$2,'esg_report','scan.pdf','application/pdf',$3,$4,$5) RETURNING id`,
      [companyId, assessmentId, scan.length, scan, userId]);
    const r = await ex.analyseDocument({
      documentId: d2[0].id, assessmentId, companyId, userId,
      generate: async () => { throw new Error('the model must never be called for a scan'); },
    });
    assert.strictEqual(r.status, 'no_text_layer');
    assert.strictEqual(r.proposals, 0);
  });

  await test('the extractions table has no column a model-authored figure could occupy', async () => {
    const { rows } = await query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name='esg_document_extractions'`);
    const numeric = rows.filter((r) => /numeric|double|real|integer|bigint/.test(r.data_type))
                        .map((r) => r.column_name);
    assert.deepStrictEqual(numeric, ['page_no'],
      `unexpected numeric columns: ${numeric.join(', ')} — page_no is a page reference, not a figure`);
  });

  await test('the accepted proposal scores through the ordinary engine', async () => {
    const { rows: inds } = await query(
      `SELECT id, code, pillar, response_type, weight FROM esg_indicators
        WHERE framework_id=$1 AND is_active`, [fw[0].id]);
    const { rows: resp } = await query(
      `SELECT indicator_id, option_code, value_numeric, is_na, evidence_tier
         FROM esg_responses WHERE assessment_id=$1`, [assessmentId]);
    const { rows: scheme } = await query(
      `SELECT version, weight_e, weight_s, weight_g, mult_self_declared, mult_documented, mult_verified
         FROM esg_weighting_schemes WHERE is_active LIMIT 1`);
    const out = computeScores({ indicators: inds, responses: resp, scheme: scheme[0], bands: [] });
    // One documented "yes" on G-05 (weight 2.5): 2.5 x 1.00 x 0.85 = 2.125
    assert.strictEqual(out.pillars.G.points_earned, 2.13, `got ${out.pillars.G.points_earned}`);
    assert.strictEqual(out.pillars.E.state, 'unanswered');
  });

  // Clean up after ourselves — this suite is safe to run repeatedly.
  await query(`DELETE FROM esg_companies WHERE id=$1`, [companyId]);

  console.log(failed ? `\n❌ layer2-test: ${failed} failed, ${passed} passed`
                     : `\nlayer2-test: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('layer2-test CRASHED:', e.stack || e.message); process.exit(1); });

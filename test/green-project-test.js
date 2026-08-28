'use strict';
/* NOT A TEST OF THE PRIVATE-PREVIEW LOCK.
   previewLock.js fails closed, so this suite's own fixture users — which are
   not on the allowlist — would be refused at sign-in or by layer 3, and every
   assertion below would measure the lock instead of what it was written for.
   The lock has its own suite in this repo, test/private-preview-test.js,
   which sets this variable itself and asserts all three layers. */
process.env.PREVIEW_LOCK = 'off';
/* ═══════════════════════════════════════════════════════════════════════════
   THE GREEN PROJECT AND FINANCING WORKFLOW                      (Run 62/P6.6)
   ───────────────────────────────────────────────────────────────────────────
   Two things this suite exists to stop.

   1. A FINANCING ROUTE READING AS AN APPROVAL. The register lists programmes;
      this platform narrows them to the ones whose own published terms do not
      rule a project out. That is the entire claim, and the words "eligible",
      "approved" and "guaranteed" must never appear against a product. The
      register test already guards its own page; this guards the MATCHER.

   2. AN UNCHECKABLE TERM PASSING AS A CHECKED ONE. A programme that publishes
      no minimum has not passed a minimum check — the same distinction the
      readiness engine draws between missing and zero. A matcher that scored
      silence as a pass would float the least transparent institutions to the
      top of the list.
   ═══════════════════════════════════════════════════════════════════════════ */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

let pass = 0;
let fail = 0;
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
}

async function withStub(exportsObj, fn) {
  const dbPath = require.resolve('../src/db');
  const realDb = require(dbPath);
  const extra = Object.keys(exportsObj).filter((k) => !Object.keys(realDb).includes(k));
  assert.deepStrictEqual(extra, [], `#18: the stub invents exports the real src/db lacks: ${extra}`);
  const cached = require.cache[dbPath];
  const clear = () => {
    for (const k of Object.keys(require.cache)) {
      if (k.includes(`${path.sep}src${path.sep}`) && k !== dbPath) delete require.cache[k];
    }
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: exportsObj };
  clear();
  try { return await fn(); } finally { require.cache[dbPath] = cached; clear(); }
}

/* ── fixtures ─────────────────────────────────────────────────────────────
   Products modelled on the real register's shapes: one that publishes
   everything, one that publishes nothing, one closed, one corporate-only. */
const PRODUCTS = [
  { id: 'pr1', institution_name: 'Bank A', institution_kind: 'bank', product_name: 'Green Term Financing',
    financing_type: 'use_of_proceeds_green', borrower_scope: 'sme',
    min_financing_myr: 100000, max_financing_myr: 5000000, eligibility_note: 'x',
    availability_status: 'open', source_url: 'https://a', source_publisher: 'Bank A', last_verified: '2026-08-01' },
  { id: 'pr2', institution_name: 'Bank B', institution_kind: 'bank', product_name: 'Sustainability-Linked',
    financing_type: 'sustainability_linked', borrower_scope: 'unstated',
    min_financing_myr: null, max_financing_myr: null, eligibility_note: null,
    availability_status: 'unclear', source_url: 'https://b', source_publisher: 'Bank B', last_verified: '2026-08-01' },
  { id: 'pr3', institution_name: 'Bank C', institution_kind: 'bank', product_name: 'Closed Facility',
    financing_type: 'use_of_proceeds_green', borrower_scope: 'sme',
    min_financing_myr: null, max_financing_myr: null, eligibility_note: null,
    availability_status: 'closed', source_url: 'https://c', source_publisher: 'Bank C', last_verified: '2026-08-01' },
  { id: 'pr4', institution_name: 'Bank D', institution_kind: 'bank', product_name: 'Corporate Only',
    financing_type: 'use_of_proceeds_green', borrower_scope: 'corporate',
    min_financing_myr: null, max_financing_myr: null, eligibility_note: null,
    availability_status: 'open', source_url: 'https://d', source_publisher: 'Bank D', last_verified: '2026-08-01' },
];

function db(project) {
  return {
    query: async (sql) => {
      if (/FROM esg_green_projects p/.test(sql)) return { rows: project ? [project] : [], rowCount: project ? 1 : 0 };
      if (/FROM esg_finance_products/.test(sql)) return { rows: PRODUCTS, rowCount: PRODUCTS.length };
      throw new Error(`no fixture for: ${String(sql).slice(0, 70)}`);
    },
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  };
}

const PROJECT = {
  id: 'p1', title: 'Rooftop solar', estimated_cost_myr: 500000,
  financing_required_myr: 400000, own_contribution_myr: 100000, financing_purpose: 'capex',
  ccpt_category_code: 'C1', project_type_id: 't1', project_type_label: 'Solar / renewable energy',
};

const routes = (project) => withStub(db(project), async () => {
  const svc = require('../src/services/financeMatchService');
  return svc.potentialRoutes('c1', 'p1');
});

(async () => {
  console.log('\ngreen-project\n');

  /* ═══ 1 · THE MATCHER MAKES NO CLAIM IT CANNOT SUPPORT ═════════════════ */

  await atest('NO RESULT IS EVER CALLED ELIGIBLE, APPROVED OR GUARANTEED', async () => {
    const r = await routes(PROJECT);
    const text = JSON.stringify(r).toLowerCase();
    for (const word of ['approved', 'guaranteed', 'pre-approved', 'you qualify']) {
      assert.ok(!text.includes(word), `the matcher output contains "${word}"`);
    }
    // "eligible" may appear only inside an institution's own published note,
    // never in a verdict this platform authored.
    for (const c of r.candidates.concat(r.excluded)) {
      for (const k of c.checks) {
        assert.ok(!/eligib/i.test(k.why), `a platform-authored reason claims eligibility: "${k.why}"`);
      }
    }
  });

  await atest('PROJECT TYPE IS NEVER MATCHED — the register carries no such mapping', async () => {
    const r = await routes(PROJECT);
    assert.strictEqual(r.projectTypeAssessed, false,
      'the matcher claims to have assessed project type, which no product column supports');
    const codes = r.candidates.flatMap((c) => c.checks.map((k) => k.code));
    assert.ok(!codes.includes('project_type') && !codes.includes('project_category'),
      'a rule matches on project type — esg_finance_products has no category column to match against');
  });

  /* ═══ 2 · UNKNOWN IS NOT A PASS ════════════════════════════════════════ */

  await atest('an unpublished term is UNKNOWN, never a pass', async () => {
    const r = await routes(PROJECT);
    const bankB = r.candidates.find((c) => c.product.id === 'pr2');
    assert.ok(bankB, 'Bank B was ruled out; it publishes nothing that excludes anything');
    const min = bankB.checks.find((k) => k.code === 'amount_floor');
    assert.strictEqual(min.verdict, 'unknown',
      'a product publishing no minimum was scored as passing a minimum check');
    assert.ok(bankB.unknownChecks >= 3, `Bank B reports ${bankB.unknownChecks} unknown checks`);
  });

  await atest('the least transparent product does not rank first', async () => {
    const r = await routes(PROJECT);
    const ids = r.candidates.map((c) => c.product.id);
    assert.ok(ids.indexOf('pr1') < ids.indexOf('pr2'),
      'a product that publishes nothing outranks one that publishes everything');
  });

  /* ═══ 3 · EXCLUSIONS ARE EXPLAINED ═════════════════════════════════════ */

  await atest('every excluded product says which published term ruled it out', async () => {
    const r = await routes(PROJECT);
    assert.ok(r.excluded.length >= 2, `only ${r.excluded.length} products were excluded`);
    for (const e of r.excluded) {
      assert.ok(e.exclusions.length > 0 && e.exclusions.every(Boolean),
        `${e.product.product_name} was excluded with no reason`);
    }
    const closed = r.excluded.find((e) => e.product.id === 'pr3');
    assert.ok(/closed/i.test(closed.exclusions.join(' ')), 'the closed facility does not say it is closed');
    const corp = r.excluded.find((e) => e.product.id === 'pr4');
    assert.ok(/corporate/i.test(corp.exclusions.join(' ')), 'the corporate-only facility does not say why');
  });

  await atest('an amount outside the published range excludes, and names the figure', async () => {
    const tooSmall = await routes({ ...PROJECT, financing_required_myr: 5000 });
    const a = tooSmall.excluded.find((e) => e.product.id === 'pr1');
    assert.ok(a, 'a request below the published minimum was not excluded');
    assert.ok(/minimum/i.test(a.exclusions.join(' ')), 'the exclusion does not name the minimum');

    const tooBig = await routes({ ...PROJECT, financing_required_myr: 50000000 });
    const b = tooBig.excluded.find((e) => e.product.id === 'pr1');
    assert.ok(b && /maximum/i.test(b.exclusions.join(' ')), 'a request above the published maximum was not excluded');
  });

  /* ═══ 4 · MISSING PROJECT DATA ═════════════════════════════════════════ */

  await atest('no financing requirement leaves the amount checks UNKNOWN, and excludes nothing', async () => {
    const r = await routes({ ...PROJECT, financing_required_myr: null });
    const a = r.candidates.find((c) => c.product.id === 'pr1');
    assert.ok(a, 'a product was ruled out because the company has not said how much it needs');
    for (const code of ['amount_floor', 'amount_ceiling']) {
      const k = a.checks.find((x) => x.code === code);
      assert.strictEqual(k.verdict, 'unknown', `${code} was decided without a financing requirement`);
      assert.ok(/have not stated/i.test(k.why), `${code} does not say the figure is missing`);
    }
  });

  await atest('an unknown project returns null, not an empty match list', async () => {
    const r = await routes(null);
    assert.strictEqual(r, null,
      'a missing project produced an empty candidate list, which reads as "nothing matches"');
  });

  /* ═══ 5 · THE RULES ARE CONFIGURATION ══════════════════════════════════ */

  await atest('every rule has a code, a label and returns a documented verdict', async () => {
    const svc = require('../src/services/financeMatchService');
    assert.ok(svc.RULES.length >= 4, `only ${svc.RULES.length} rules are configured`);
    const codes = svc.RULES.map((r) => r.code);
    assert.strictEqual(new Set(codes).size, codes.length, 'two rules share a code');
    for (const rule of svc.RULES) {
      assert.ok(rule.label && typeof rule.check === 'function', `rule ${rule.code} is malformed`);
    }
    assert.deepStrictEqual([...svc.VERDICTS].sort(), ['exclude', 'pass', 'unknown']);
  });

  /* ═══ 6 · THE WORKFLOW WRITES WHAT THE READINESS MODEL READS ═══════════ */

  await atest('CLASSIFICATION HAS A WRITER, and it stamps the scheme version', async () => {
    // Before P6.6 nothing in the codebase set ccpt_category_code, so the
    // readiness criterion that reads it could never be earned.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'greenFinance.js'), 'utf8');
    assert.ok(/UPDATE esg_green_projects[\s\S]{0,400}ccpt_category_code\s*=/.test(src),
      'nothing writes ccpt_category_code — a project can never become classified');
    assert.ok(/ccpt_scheme_version\s*=\s*\$3/.test(src),
      'the classification does not stamp the scheme version, so a later revision reinterprets it');
    assert.ok(/classification_basis\s*=\s*'human_assigned'/.test(src),
      'the classification does not record that a person assigned it');
    // And it validates the code against the published scheme.
    assert.ok(/FROM esg_taxonomy_categories[\s\S]{0,260}is_current/.test(src),
      'the classification does not check the code against the current published scheme');
  });

  await atest('the financing writer CLEARS a blank field rather than storing zero', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'greenFinance.js'), 'utf8');
    assert.ok(/if \(t === ''\) return null;/.test(src),
      'a blank financing figure is not converted to null — an unanswered question would be stored '
      + 'as a request for nothing, which is the missing-becomes-zero defect');
  });

  await atest('EXPECTED BENEFIT IS SEPARATE FROM MEASURED IMPACT', async () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
    // The forecast lives on the project; the measurement lives in baselines.
    assert.ok(/expected_benefit_metric/.test(schema), 'no expected-benefit column exists');
    assert.ok(/expected_benefit_basis[\s\S]{0,200}user_estimate/.test(schema),
      'the expected benefit records no provenance — a supplier quotation and a guess would be the same claim');
    const baselineBlock = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS esg_green_project_baselines'));
    assert.ok(!/expected_benefit/.test(baselineBlock.slice(0, 1200)),
      'the expected benefit was written into the baseline table, where a forecast would later read as a measurement');
    // And the route that writes the forecast never touches the baseline table.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'greenFinance.js'), 'utf8');
    const financingRoute = src.slice(src.indexOf("projects/:id/financing"), src.indexOf("projects/:id/routes"));
    assert.ok(!/esg_green_project_baselines/.test(financingRoute),
      'the financing route writes to the baseline table — a forecast must never enter measured impact');
  });

  console.log(`\ngreen-project: ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();

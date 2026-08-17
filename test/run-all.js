'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

// no-new-fallbacks.js and no-fallbacks-tree.js are Run 41's two RULE 6 guards.
// They belong here rather than chained behind an npm script because this runner
// inherits stdio — the tree guard's REPORT-ONLY / NOT A PASS banner has to be
// readable, and the other eleven repos' runners capture output and print it only
// for failing suites, which would swallow it.
const suites = ['scoring-engine-test.js', 'no-model-figures-test.js', 'schema-idempotency-test.js', 'layer2-test.js', 'carbon-import-test.js', 'sedg-import-test.js', 'sedg-ui-test.js', 'green-finance-register-test.js', 'green-projects-test.js', 'no-fallbacks-test.js', 'framework-choice-test.js', 'no-new-fallbacks.js', 'no-fallbacks-tree.js'];
let failed = 0;
for (const s of suites) {
  console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  } catch { failed += 1; }
}
console.log(failed ? `\n❌ ${failed} suite(s) failed` : '\n✅ all suites passed');
process.exit(failed ? 1 : 0);

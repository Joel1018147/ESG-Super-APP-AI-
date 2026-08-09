'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const suites = ['scoring-engine-test.js', 'no-model-figures-test.js', 'schema-idempotency-test.js', 'layer2-test.js', 'carbon-import-test.js', 'sedg-import-test.js'];
let failed = 0;
for (const s of suites) {
  console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  } catch { failed += 1; }
}
console.log(failed ? `\n❌ ${failed} suite(s) failed` : '\n✅ all suites passed');
process.exit(failed ? 1 : 0);

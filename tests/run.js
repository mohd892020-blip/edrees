// Node runner: `node tests/run.js` (Node 18+). The browser runner is tests/index.html.
import { run } from './harness.js';
import './rules.test.js';
import './ai.test.js';
import './variants.test.js';
import './campaign.test.js';

const res = await run({
  report(r) {
    console.log(`${r.ok ? '✔' : '✘'} ${r.name} (${r.ms.toFixed(0)} ms)`);
    if (!r.ok) console.log(`   ${r.error && (r.error.stack || r.error.message)}`);
  },
});
console.log(`\n${res.passed}/${res.total} passed${res.failed ? `, ${res.failed} failed` : ''}`);
console.log(`opening value (starter POV): ${globalThis.__dreesOpeningValue}`);
if (res.failed) process.exitCode = 1;

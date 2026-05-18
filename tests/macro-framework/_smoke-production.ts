// Phase 2 scaffolding artifact — quick smoke test that drives the production
// macro engine with a hand-written macro source string. Kept as a debugging
// aid; `_smoke-runner.ts` is the preferred entrypoint for end-to-end smoke
// testing of the framework outside Vitest.
//
// Run: `cd flashquery && npx tsx tests/macro-framework/_smoke-production.ts`

import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseMacroSource } from '../../src/macro/parser.js';

const macro = `
total = 0
for i in 1..4 do
  total = add $total $i
done
exit { sum: $total }
`;

async function main() {
  const parsed = parseMacroSource(macro);
  if (!parsed.ok) {
    console.error('parse failed:', parsed.error);
    process.exit(1);
  }
  const result = await evaluateProgram(parsed.program);
  console.log('isError:', result.isError);
  console.log('payload:', result.content[0]?.text);
}

main().catch((e) => { console.error(e); process.exit(2); });

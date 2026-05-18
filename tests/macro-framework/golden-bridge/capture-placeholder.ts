// Phase 2 placeholder capture helper.
//
// Produces the embedded `golden_snapshot:` block for the scaffolding gate
// test `cases/control-flow/_placeholder-loop.yml`. Lives in `golden-bridge/`
// (not inside the immutable golden package) because per INV-MTF-04 the
// golden is read-only.
//
// Run: `cd flashquery && npx tsx tests/macro-framework/golden-bridge/capture-placeholder.ts`
//
// Emits a JSON blob to stdout. Re-run after a golden version bump to refresh
// the embedded snapshot in the placeholder YAML.

import { captureForTestgen } from './snapshot.ts';

const macroSource = `
total = 0
for i in 1..4 do
  total = add $total $i
done
exit { sum: $total }
`;

async function main() {
  const env = await captureForTestgen(macroSource, {}, {});
  console.log(JSON.stringify(
    {
      return: env.return,
      state_notes: env.state_notes,
      trace_kinds: env.trace.map((s) => s.kind),
      result_envelope: env.result_envelope,
      golden_version: env.golden_version,
    },
    null,
    2,
  ));
}

main().catch((e) => { console.error(e); process.exit(1); });

// Smoke driver — exercises the Phase 2 gate end-to-end without booting
// Vitest (useful in environments where the Vitest native binding isn't
// available, e.g., during CI infra bring-up). Operates on the same code
// paths as the registered Vitest tests: load YAML, run integrity check,
// drive the production engine, compare via the pure comparator.
//
// Run: `cd flashquery && npx tsx tests/macro-framework/_smoke-runner.ts`

import { loadCases, driveTest, compareToExpect } from './runner.ts';
import { checkExpectStateNotes } from './state-notes/assert.ts';

async function main() {
  let fails = 0;
  const cases = await loadCases();
  console.log(`Discovered ${cases.length} case(s).`);

  for (const tc of cases) {
    console.log(`\n=== ${tc.id} (${tc.__category}) ===`);

    // expect_state_notes integrity (load-time).
    if (tc.expect_state_notes && tc.golden_snapshot?.state_notes) {
      const check = checkExpectStateNotes(
        tc.expect_state_notes,
        tc.golden_snapshot.state_notes,
      );
      console.log('  expect_state_notes integrity:', check.ok ? 'OK' : 'FAIL');
      if (!check.ok) {
        console.log('  errors:', JSON.stringify(check.errors, null, 2));
        fails += 1;
      }
    } else {
      console.log('  expect_state_notes integrity: (no expect_state_notes)');
    }

    // Drive + compare.
    const drive = await driveTest(tc);
    try {
      const cmp = compareToExpect(tc, drive);
      if (cmp.ok) {
        console.log('  comparator: PASS');
        console.log(`  result: ${JSON.stringify(drive.payload.result)}`);
      } else {
        console.log('  comparator: FAIL');
        console.log(`  findings: ${JSON.stringify(cmp.findings, null, 2)}`);
        console.log(`  payload: ${drive.rawText}`);
        fails += 1;
      }
    } finally {
      await drive.cleanup();
    }
  }

  console.log(`\nSummary: ${cases.length - fails}/${cases.length} pass(ed)`);
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });

// Leftover Phase 2 scaffolding — safe to delete. Was used to manually
// verify the expect_state_notes integrity check during agent execution.
// The integrity check itself runs automatically at test load-time via
// `cases.test.ts`. Reproducible via `npx tsx tests/macro-framework/_int_check.ts`
// if you want to keep it as a quick local sanity tool.

import { loadCases } from './runner.ts';
import { checkExpectStateNotes } from './state-notes/assert.ts';

async function main() {
  const cs = await loadCases();
  const tc = cs[0];
  if (!tc.expect_state_notes || !tc.golden_snapshot?.state_notes) {
    console.log('no expect_state_notes / golden_snapshot on first case');
    return;
  }
  const check = checkExpectStateNotes(tc.expect_state_notes, tc.golden_snapshot.state_notes);
  console.log('integrity:', check.ok ? 'OK' : 'FAIL');
  if (!check.ok) console.log(JSON.stringify(check.errors, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

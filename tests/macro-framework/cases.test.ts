// Vitest entrypoint for the macro testing framework.
//
// This file walks `cases/<category>/*.yml`, parses each test per the §5.4
// schema, and registers Vitest `describe`/`it` blocks for each one.
//
// Cases are discovered at module-load time so Vitest sees them as
// concrete test names (useful for `--reporter=verbose` and the
// failure-triage workflow).

import { describe, it, expect } from 'vitest';
import {
  loadCases,
  driveTest,
  compareToExpect,
  type TestCase,
} from './runner.ts';
import { checkExpectStateNotes } from './state-notes/assert.ts';

// Top-level await is supported in Vitest's ESM test modules.
const cases = await loadCases();

// Group by category for readable output.
const grouped = new Map<string, TestCase[]>();
for (const c of cases) {
  const cat = c.__category ?? 'uncategorized';
  if (!grouped.has(cat)) grouped.set(cat, []);
  grouped.get(cat)!.push(c);
}

for (const [cat, cs] of grouped) {
  describe(`macro-framework/${cat}`, () => {
    for (const tc of cs) {
      it(tc.id, async () => {
        // Load-time integrity check (per §5.6.1).
        if (tc.expect_state_notes && tc.golden_snapshot?.state_notes) {
          const check = checkExpectStateNotes(
            tc.expect_state_notes,
            tc.golden_snapshot.state_notes,
          );
          if (!check.ok) {
            throw new Error(
              `expect_state_notes integrity check failed: ${JSON.stringify(check.errors, null, 2)}`,
            );
          }
        }

        const drive = await driveTest(tc);
        try {
          const cmp = compareToExpect(tc, drive);
          expect(
            cmp.findings,
            cmp.ok
              ? 'comparator findings'
              : `comparator findings (${cmp.findings.length}):\n${JSON.stringify(cmp.findings, null, 2)}`,
          ).toEqual([]);
        } finally {
          await drive.cleanup();
        }
      });
    }
  });
}

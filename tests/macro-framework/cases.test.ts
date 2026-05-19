// Vitest entrypoint for the macro testing framework.
//
// This file walks `cases/<category>/*.yml`, parses each test per the §5.4
// schema, and registers Vitest `describe`/`it` blocks for each one.
//
// Cases are discovered at module-load time so Vitest sees them as
// concrete test names (useful for `--reporter=verbose` and the
// failure-triage workflow).
//
// When the structured comparator emits findings, a §9.6 failure-triage
// record is written to `tests/macro-framework/failures/` with first-pass
// §5.8 five-way classification (stale-expectations / engine-bug /
// golden-bug / generator-misread / spec-ambiguity) via the Phase 6
// `triage/` module. The operator confirms or overrides via the
// `flashquery-macro-run` skill's --triage workflow.

import { describe, it, expect } from 'vitest';
import {
  loadCases,
  driveTest,
  compareToExpect,
  type TestCase,
} from './runner.ts';
import { checkExpectStateNotes } from './state-notes/assert.ts';
import { GOLDEN_VERSION } from './golden-bridge/load.ts';
import { classifyFailure } from './triage/classify.ts';
import { writeTriageRecord, findRelatedFailures } from './triage/record.ts';

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
          // Pass/fail is author-declared via `expect.comparison`
          // (match_all | match_some | match_none). `cmp.ok` already
          // reflects the mode-aware verdict; we only write a failure
          // record on a true FAIL — under match_some / match_none the
          // findings are EXPECTED divergences, not regressions.
          if (!cmp.ok) {
            const classification = classifyFailure(tc, cmp.findings, {
              goldenVersionCurrent: GOLDEN_VERSION,
            });
            const related = await findRelatedFailures(tc.id);
            const path = await writeTriageRecord({
              tc,
              findings: cmp.findings,
              drive,
              classification,
              goldenVersionCurrent: GOLDEN_VERSION,
              relatedFailures: related,
            });
            expect.fail(
              `[${cmp.mode}] ${cmp.matchedExpects}/${cmp.totalExpects} expects matched; ` +
                `${cmp.findings.length} finding(s); classification=${classification.classification} ` +
                `(${classification.confidence}); failure record at ${path}:\n` +
                JSON.stringify(cmp.findings, null, 2),
            );
          }
        } finally {
          await drive.cleanup();
        }
      });
    }
  });
}

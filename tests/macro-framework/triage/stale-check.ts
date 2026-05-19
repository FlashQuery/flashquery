// Stale-version detection — pre-run §5.8 first-pass check.
//
// Walks every YAML test under `cases/<category>/` and flags any whose
// `golden_version` is older than the current `GOLDEN_VERSION` from
// `macro-golden-model/src/version.ts`. The flashquery-macro-run skill
// invokes this before running tests so the operator can decide whether to
// refresh stale tests before treating their failures as real regressions
// (per §5.8 "auto-checked first").
//
// This module is a thin re-export-and-extend layer over the
// `findStaleTests()` already exported by the testgen-helper (Phase 5).
// We keep the helper as the source of truth so the testgen --mode=refresh
// path and the run-skill --stale-check path stay in sync.

import { findStaleTests as findStaleTestsRaw } from '../golden-bridge/testgen-helper.ts';
import { GOLDEN_VERSION } from '../golden-bridge/load.ts';

export interface StaleTest {
  /** Absolute path to the YAML test file. */
  testFile: string;
  /** `id:` field of the test. */
  testId: string;
  /** golden_version embedded in the test. */
  recordedVersion: string;
  /** Current GOLDEN_VERSION. */
  currentVersion: string;
  /** Operator-facing remediation hint. */
  suggestedAction: string;
}

/**
 * Returns the set of tests whose `golden_version` is older than current.
 *
 * `currentGoldenVersion` defaults to the live GOLDEN_VERSION from
 * `macro-golden-model/src/version.ts`. Override for testing.
 */
export async function findStaleTests(
  currentGoldenVersion: string = GOLDEN_VERSION,
): Promise<StaleTest[]> {
  const raw = await findStaleTestsRaw(currentGoldenVersion);
  return raw.map((entry) => ({
    testFile: entry.path,
    testId: entry.test_id,
    recordedVersion: entry.golden_version_used,
    currentVersion: currentGoldenVersion,
    suggestedAction:
      `Refresh: \`npm run testgen:macro-framework -- --mode=refresh ` +
      `--filter='${entry.test_id}' --auto-accept-identical\` — accept if the diff is ` +
      `structurally identical, escalate otherwise.`,
  }));
}

/** Pretty-print a stale-tests report to stdout. */
export function renderStaleReport(stale: StaleTest[]): string {
  if (stale.length === 0) {
    return `No stale tests detected (all golden_version fields match current GOLDEN_VERSION).`;
  }
  const lines: string[] = [];
  lines.push(`Detected ${stale.length} stale test(s):`);
  lines.push('');
  for (const s of stale) {
    lines.push(`  - ${s.testId} (${s.recordedVersion} → ${s.currentVersion})`);
    lines.push(`      file: ${s.testFile}`);
    lines.push(`      ${s.suggestedAction}`);
  }
  return lines.join('\n');
}

// Stale-version detection — pre-run §5.8 first-pass check.
//
// Walks every YAML test under `cases/<category>/` and flags any whose
// `golden_version` is older than the current `GOLDEN_VERSION` from
// `macro-golden-model/src/version.ts`. The flashquery-macro-run skill
// invokes this before running tests so the operator can decide whether to
// refresh stale tests before treating their failures as real regressions
// (per §5.8 "auto-checked first").
//
// This module is self-contained: it scans the `cases/` tree directly
// rather than delegating to a helper. The capture/refresh pipeline lives
// in `scripts/` (capture-runner.ts, diff-refresh.ts) and shares the same
// golden-version source of truth (`macro-golden-model/src/version.ts`),
// so the run-skill --stale-check path and the refresh path stay in sync.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

import { GOLDEN_VERSION } from '../golden-bridge/load.ts';
import type { TestCase } from '../src/runner.ts';

/** Absolute path to the `cases/` tree (sibling of `triage/`). */
const CASES_DIR = join(import.meta.dirname, '..', 'cases');

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
  const out: StaleTest[] = [];

  let categories;
  try {
    categories = await readdir(CASES_DIR, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const dir = join(CASES_DIR, cat.name);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      const file = join(dir, entry);
      const text = await readFile(file, 'utf8');
      let tc: TestCase;
      try {
        tc = loadYaml(text) as TestCase;
      } catch {
        continue;
      }
      if (!tc || typeof tc !== 'object' || !tc.golden_version) continue;
      if (tc.golden_version !== currentGoldenVersion) {
        out.push({
          testFile: file,
          testId: tc.id,
          recordedVersion: tc.golden_version,
          currentVersion: currentGoldenVersion,
          suggestedAction:
            `Refresh the embedded golden snapshot for \`${tc.id}\` against the current ` +
            `golden, then reconcile: re-run the capture pipeline ` +
            `(\`npx tsx tests/macro-framework/scripts/capture-runner.ts > /tmp/captures.json\` ` +
            `then \`python3 tests/macro-framework/scripts/apply-captures.py /tmp/captures.json\`). ` +
            `Accept if the resulting diff is structurally identical; escalate to triage otherwise.`,
        });
      }
    }
  }
  return out;
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

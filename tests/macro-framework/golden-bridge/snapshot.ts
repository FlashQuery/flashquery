// Convenience wrapper around `captureSnapshot()` from the migrated golden
// model.
//
// Used by the future `flashquery-macro-testgen` skill (Phase 5) to embed
// expectations into newly-generated test YAMLs. Phase 2 just exposes the
// surface; nothing in the runtime test path calls this.

import {
  captureSnapshot as goldenCapture,
  defaultToolRegistry,
  type SnapshotEnvelope,
  type CaptureOptions,
} from './load.ts';

export type { SnapshotEnvelope, CaptureOptions } from './load.ts';

/**
 * Produce the embedded snapshot shape per §5.4 (the `golden_snapshot:` block).
 *
 * Inputs map 1:1 to the YAML test schema:
 *   - `macroSource` -> `macro:` field
 *   - `inputVars` -> `input_vars:` field
 *   - `vaultState` -> `vault:` field (path -> content)
 *
 * For Phase 2 the framework's tool surface is fixed to the golden's default
 * mock registry. Testgen for tests using fake-broker archetypes will need to
 * synthesize a registry / broker from the test's `tools:` section; that's
 * Phase 5 work.
 */
export async function captureForTestgen(
  macroSource: string,
  inputVars: Record<string, unknown> = {},
  vaultState: Record<string, string> = {},
  options: CaptureOptions = {},
): Promise<SnapshotEnvelope> {
  return goldenCapture(
    macroSource,
    inputVars as Record<string, never>,
    vaultState,
    { registry: defaultToolRegistry },
    options,
  );
}

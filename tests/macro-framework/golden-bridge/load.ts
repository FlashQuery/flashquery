// Loads the migrated `macro-golden-model/` package (Phase 1 artifact) so
// the framework's testgen + refresh workflows can invoke
// `captureSnapshot()`.
//
// Per §5.6 the golden runs ONLY at testgen / refresh time, never at test
// runtime. This module is therefore not consumed by the runner — it's an
// integration surface for the future `flashquery-macro-testgen` skill
// (Phase 5).

export { captureSnapshot } from '../macro-golden-model/src/snapshot.ts';
export { GOLDEN_VERSION } from '../macro-golden-model/src/version.ts';
export type {
  SnapshotEnvelope,
  ToolSurface,
  CaptureOptions,
} from '../macro-golden-model/src/snapshot.ts';
export type { GoldenSnapshot } from '../macro-golden-model/src/envelope.ts';
export { defaultToolRegistry } from '../macro-golden-model/src/mockfq.ts';

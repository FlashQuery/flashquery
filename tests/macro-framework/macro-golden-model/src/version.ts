// Single source of truth for the golden model's semver. Stamped into every
// snapshot envelope so generated tests record which golden produced them
// (per §5.6 of the Macro Testing Framework Requirements). Bumping requires
// the golden's meta-tests to pass (Phase 1 gate).
export const GOLDEN_VERSION = "0.3.0";

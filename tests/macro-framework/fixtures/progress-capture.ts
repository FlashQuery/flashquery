// Progress capture — observer that captures the production engine's
// progress events into an array for assertion.
//
// Not a substitution per INV-MTF-06 — the engine emits progress events
// normally; we install a listener (a real-component pattern, just observed).
// The captured array is fed into the `expect.progress_milestones` assertion
// in the YAML schema.

import type {
  MacroProgressEntry,
} from '../../../src/macro/evaluator.js';

export interface ProgressCapture {
  events: MacroProgressEntry[];
  /** Inject as `progressSink` in `EvaluateProgramOptions`. */
  sink(entry: MacroProgressEntry): void;
}

export function createProgressCapture(): ProgressCapture {
  const events: MacroProgressEntry[] = [];
  return {
    events,
    sink(entry: MacroProgressEntry): void {
      events.push({ ...entry });
    },
  };
}

// assert_golden_state_notes load-time integrity check (per Macro Testing Framework
// Requirements §5.6.1).
//
// At test-load time, every entry in `assert_golden_state_notes` must match at least
// one entry in `golden_snapshot.state_notes`. Matching is partial-match: a
// pattern matches a note when every field in the pattern equals the
// corresponding field of the note. Fields absent from the pattern are
// wildcards. Numeric fields support comparator strings (`">=N"`, `"<=N"`,
// `">N"`, `"<N"`, `"==N"`, range `"[N,M]"`). Object `value` fields support
// deep partial match.
//
// Order-dependent matching is enabled by providing a `step` field in the
// pattern; the corresponding snapshot entry is found by its index in the
// state_notes array (1-based to mirror how the snapshot is rendered in
// failure-triage records per §9.6).

import type { StateNote } from './schema.ts';

export type StateNotePattern = Record<string, unknown> & {
  step?: number; // when present, force position match (1-based index)
};

export interface IntegrityCheckResult {
  ok: boolean;
  errors: IntegrityCheckError[];
}

export interface IntegrityCheckError {
  index: number; // pattern index (0-based) into assert_golden_state_notes array
  pattern: StateNotePattern;
  reason:
    | 'no_match'
    | 'positional_mismatch'
    | 'step_out_of_range';
  details?: string;
}

/**
 * Run the load-time integrity check.
 *
 * @param patterns The `assert_golden_state_notes` array from the test YAML.
 * @param snapshot The `golden_snapshot.state_notes` array from the test YAML.
 */
export function checkGoldenStateNotes(
  patterns: StateNotePattern[],
  snapshot: StateNote[],
): IntegrityCheckResult {
  const errors: IntegrityCheckError[] = [];

  for (let i = 0; i < patterns.length; i += 1) {
    const pattern = patterns[i] as StateNotePattern;
    if (typeof pattern.step === 'number') {
      const idx = pattern.step - 1;
      if (idx < 0 || idx >= snapshot.length) {
        errors.push({
          index: i,
          pattern,
          reason: 'step_out_of_range',
          details: `step ${pattern.step} is out of range (snapshot has ${snapshot.length} entries)`,
        });
        continue;
      }
      const { step: _ignored, ...rest } = pattern;
      void _ignored;
      if (!matches(rest, snapshot[idx] as unknown as Record<string, unknown>)) {
        errors.push({
          index: i,
          pattern,
          reason: 'positional_mismatch',
          details: `snapshot[${idx}] = ${JSON.stringify(snapshot[idx])}`,
        });
      }
    } else {
      const found = snapshot.some((note) =>
        matches(pattern, note as unknown as Record<string, unknown>),
      );
      if (!found) {
        errors.push({
          index: i,
          pattern,
          reason: 'no_match',
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Partial match: every field in `pattern` must equal the corresponding field
 * in `target`. Fields absent in `pattern` are wildcards. Comparator strings
 * on numeric target fields are supported.
 */
export function matches(
  pattern: Record<string, unknown>,
  target: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(pattern)) {
    if (!fieldMatches(expected, target[key])) return false;
  }
  return true;
}

function fieldMatches(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'string' && typeof actual === 'number') {
    const cmp = parseComparator(expected);
    if (cmp) return cmp(actual);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
      if (!fieldMatches(expected[i], actual[i])) return false;
    }
    return true;
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return false;
    return matches(
      expected as Record<string, unknown>,
      actual as Record<string, unknown>,
    );
  }

  return expected === actual;
}

/**
 * Parse a comparator string like ">=100" or "[1,10]". Returns a predicate
 * over the actual numeric value, or null if the string isn't a comparator.
 */
function parseComparator(s: string): ((n: number) => boolean) | null {
  const range = /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/.exec(s);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    return (n) => n >= lo && n <= hi;
  }
  const m = /^(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const op = m[1];
  const v = Number(m[2]);
  switch (op) {
    case '>=': return (n) => n >= v;
    case '<=': return (n) => n <= v;
    case '>': return (n) => n > v;
    case '<': return (n) => n < v;
    case '==': return (n) => n === v;
    default: return null;
  }
}

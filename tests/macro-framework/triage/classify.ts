// First-pass failure-triage classifier for the macro testing framework.
//
// Replaces the Phase 3 draft heuristic (always-engine-bug, low confidence)
// with the §5.8 five-way classification:
//
//   1. stale-expectations  — test's golden_version is older than current
//   2. engine-bug          — hand-authored test failing on a structural
//                            field while golden took a different path
//   3. golden-bug          — golden snapshot looks wrong against the spec
//                            (low confidence — manual review expected)
//   4. generator-misread   — AI-generated test + prose-heavy citations,
//                            failure on a structural field that suggests
//                            the generator misinterpreted the spec
//   5. spec-ambiguity      — residual; nothing else fit, low confidence
//
// Per §11.6 the classifier's output is always a *first-pass* call. Operator
// review confirms or overrides; two operator-controlled gates (golden-
// version bumps; spec-doc edits) ensure the agent never drifts. Confidence
// levels are honest about heuristic uncertainty.
//
// Per INV-MTF-07 inputs come from structured fields only — comparator
// `findings[]`, test YAML metadata, golden_snapshot.state_notes. No raw
// stdout / stderr or text streams enter the classifier.

import type { CompareFinding, TestCase } from '../src/runner.ts';
import type { StateNote } from '../state-notes/schema.ts';

export type Classification =
  | 'stale-expectations'
  | 'engine-bug'
  | 'golden-bug'
  | 'generator-misread'
  | 'spec-ambiguity';

export type Confidence = 'high' | 'medium' | 'low';

export interface ClassificationContext {
  /** Current `GOLDEN_VERSION` from `macro-golden-model/src/version.ts`. */
  goldenVersionCurrent: string;
}

export interface ClassificationResult {
  classification: Classification;
  confidence: Confidence;
  /** One-paragraph human-readable rationale; goes in §9.6 record body. */
  rationale: string;
  /** Classification-specific next step (remediation hint). */
  suggested_action: string;
}

/**
 * Apply the §5.8 five-way heuristic to a failing test.
 *
 * Invariants:
 *
 *   - Stale-expectations is checked FIRST. If the test's golden_version is
 *     older than current, that's the classification regardless of finding
 *     shape — the embedded expectations may simply be out of date.
 *   - Tests carrying a `generator:` block are eligible for
 *     generator-misread; hand-authored tests are eligible for engine-bug.
 *   - golden-bug requires evidence the spec contradicts the embedded
 *     expectation. The classifier doesn't read REQ text live; instead it
 *     uses a coarse signal: "the golden's state_notes show a path that
 *     reached the expected value, but the production engine's finding
 *     suggests the engine took a different (and possibly correct) path."
 *     This is rare and confidence is always low.
 *   - Anything else falls through to spec-ambiguity with low confidence.
 *
 * Per §11.6, low/medium confidence is the honest answer for everything
 * except stale-expectations; the operator confirms or overrides.
 */
export function classifyFailure(
  tc: TestCase,
  findings: CompareFinding[],
  context: ClassificationContext,
): ClassificationResult {
  // Step 1 — Stale-expectations (auto-checked first, §5.8).
  if (
    tc.golden_version !== undefined &&
    tc.golden_version !== context.goldenVersionCurrent
  ) {
    return {
      classification: 'stale-expectations',
      confidence: 'high',
      rationale:
        `Test's \`golden_version: "${tc.golden_version}"\` is older than the current golden ` +
        `(\`${context.goldenVersionCurrent}\`). Per §5.8 this is checked first and is the ` +
        `cheapest classification — the embedded expectations may simply be out of date. ` +
        `No code change anywhere unless refresh confirms a regression.`,
      suggested_action:
        `Refresh the embedded golden snapshot for \`${tc.id}\` against the current golden: ` +
        `re-run the capture pipeline ` +
        `(\`npx tsx tests/macro-framework/scripts/capture-runner.ts > /tmp/captures.json\` ` +
        `then \`python3 tests/macro-framework/scripts/apply-captures.py /tmp/captures.json\`). ` +
        `If the refreshed diff is structurally identical, the failure auto-resolves. ` +
        `If divergent, escalate as a possible engine-bug or golden-bug.`,
    };
  }

  // Step 2 — Engine-bug heuristic.
  //
  // Signals (all positive):
  //   - Test is hand-authored (no `generator:` block).
  //   - golden_version matches current — embedded expectations are recent.
  //   - At least one finding hits a structural field that the engine
  //     evaluates directly: return_result, return_result.<sub>,
  //     error.code, outcome.
  //   - golden_snapshot.state_notes is present and shows the macro
  //     reaching the expected value (i.e., the golden's path matches the
  //     test's expectation, so the divergence is on the production side).
  //
  // Confidence is medium when all three signals are present; degrades to
  // low if the state_notes are missing (can't corroborate).
  const isHandAuthored = !tc.generator;
  const goldenInSync = tc.golden_version === context.goldenVersionCurrent;
  const structuralFields = findings.filter((f) => isStructuralEngineField(f.field));
  const stateNotes = tc.golden_snapshot?.state_notes ?? [];
  const goldenReachedExpected = stateNotesCorroborateExpectation(tc, stateNotes);

  if (isHandAuthored && goldenInSync && structuralFields.length > 0) {
    const confidence: Confidence =
      stateNotes.length > 0 && goldenReachedExpected ? 'medium' : 'low';
    const fieldList = structuralFields.map((f) => f.field).join(', ');
    return {
      classification: 'engine-bug',
      confidence,
      rationale:
        `Hand-authored test (no \`generator:\` provenance) running against the current ` +
        `golden (v${context.goldenVersionCurrent}). Comparator findings hit structural ` +
        `engine fields (${fieldList}) that the production evaluator computes directly. ` +
        (stateNotes.length > 0
          ? goldenReachedExpected
            ? `The embedded \`golden_snapshot.state_notes\` shows the golden reaching the ` +
              `expected value, so the divergence is on the production-engine side. `
            : `The embedded \`golden_snapshot.state_notes\` is present but does not clearly ` +
              `corroborate the expected value; the production-engine signal is still the ` +
              `strongest classification but operator review is recommended. `
          : `No \`golden_snapshot.state_notes\` embedded, so the engine-bug call rests on ` +
            `the structural-field signal alone — low confidence. `) +
        `Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.`,
      suggested_action:
        `Investigate the macro engine code path responsible for the ${fieldList} surface. ` +
        `Start from the production engine in \`flashquery/src/macro/\` and trace what ` +
        `differs from the golden's path shown in \`golden_snapshot.state_notes\`. If a ` +
        `regression is confirmed, fix the engine and re-run.`,
    };
  }

  // Step 3 — Generator-misread heuristic.
  //
  // Signals:
  //   - Test has `generator:` provenance.
  //   - golden_version matches current.
  //   - At least one finding hits a structural field.
  //   - The targeted cell(s)' source citations look prose-heavy or
  //     ambiguity-flagged — long REQ excerpts, "may", "should", "if".
  //
  // Confidence: medium when prose-heavy signal is present, low otherwise
  // (the generator-vs-engine ambiguity isn't fully resolvable without
  // human review).
  if (tc.generator && goldenInSync && structuralFields.length > 0) {
    const groundingRefs = (tc.generator as { grounding_refs?: unknown }).grounding_refs;
    const refsArr: string[] = Array.isArray(groundingRefs)
      ? (groundingRefs as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const proseHeavy = looksProseHeavy(refsArr);
    const confidence: Confidence = proseHeavy ? 'medium' : 'low';
    const fieldList = structuralFields.map((f) => f.field).join(', ');
    return {
      classification: 'generator-misread',
      confidence,
      rationale:
        `Generator-authored test (\`generator.skill = ` +
        `"${String((tc.generator as { skill?: unknown }).skill ?? 'unknown')}"\`) failing ` +
        `on structural fields (${fieldList}) against the current golden (v${context.goldenVersionCurrent}). ` +
        (proseHeavy
          ? `Grounding refs (${refsArr.join('; ')}) cite prose-heavy spec sections; the AI ` +
            `generator may have misinterpreted an acceptance criterion when emitting the ` +
            `embedded expectations. `
          : `Grounding refs are sparse or not obviously prose-heavy; the generator-misread ` +
            `call rests primarily on the \`generator:\` provenance signal. `) +
        `Per §5.8: when the generator translates the spec incorrectly, the embedded expect ` +
        `block can disagree with what the engine actually does.`,
      suggested_action:
        `Re-read the cited grounding refs against the macro source and \`expect:\` block. ` +
        `If the expectations are wrong relative to the spec, regenerate the pilot with the ` +
        `\`flashquery-macro-testgen\` skill (targeting cell ` +
        `${(tc.covers ?? ['UNKNOWN'])[0]}) using refined synthesis, then re-capture and ` +
        `reconcile via the capture pipeline. If the spec section is itself ambiguous, ` +
        `escalate to spec-ambiguity.`,
    };
  }

  // Step 4 — Golden-bug (rare path; low confidence).
  //
  // Signals: golden_snapshot.state_notes shows a path that disagrees with
  // its own embedded expect (e.g. the state_notes summary shows total=10
  // but expect.return_result.sum=999). This is a coarse signal — we can't
  // truly assess golden correctness without re-running it.
  if (stateNotes.length > 0 && stateNotesContradictExpectation(tc, stateNotes)) {
    return {
      classification: 'golden-bug',
      confidence: 'low',
      rationale:
        `The embedded \`golden_snapshot.state_notes\` shows a computational path that ` +
        `appears to disagree with the embedded \`expect:\` block — the value visible in ` +
        `state_notes doesn't match the asserted result. Per §5.8 this suggests the golden ` +
        `produced wrong expectations when the test was generated. Confidence is low because ` +
        `a fully-automatic golden-bug call requires re-running the spec against the golden's ` +
        `output, which this heuristic does not do.`,
      suggested_action:
        `Manually re-run the test's macro through the golden and inspect whether the golden's ` +
        `current output matches the embedded \`expect:\` block. If divergent, the patch list ` +
        `(\`_POC-Audit-Findings.md\` §D) may have a gap; fix the golden, bump version, ` +
        `refresh affected tests. **Golden version bumps require operator approval (§11.6).**`,
    };
  }

  // Step 5 — Spec-ambiguity (residual).
  return {
    classification: 'spec-ambiguity',
    confidence: 'low',
    rationale:
      `None of the four primary heuristics fit cleanly: golden_version is current ` +
      `(${context.goldenVersionCurrent}), findings are not on canonical structural fields, ` +
      `and neither the generator-provenance nor the state-notes-contradiction signals ` +
      `triggered. Per §5.8 the residual classification is spec-ambiguity — the spec may be ` +
      `genuinely unclear about this corner. Operator review per §11.6 confirms or routes ` +
      `elsewhere.`,
    suggested_action:
      `Manually review the failing assertion against the cited REQ(s). If the spec is ` +
      `unclear, file a spec OQ against the Macro Language Requirements or MCP Broker ` +
      `Requirements. **Spec-doc edits require operator action (§11.6).** Populate the ` +
      `"Spec ambiguity proposal" section of this record with the proposed OQ wording.`,
  };
}

// ───── Structural-field detection ─────

/**
 * Returns `true` for finding fields the macro engine evaluates directly.
 * These are the fields whose divergence most clearly points at engine
 * behavior rather than environmental or generator-side issues.
 */
function isStructuralEngineField(field: string): boolean {
  if (field === 'outcome') return true;
  if (field === 'return_result') return true;
  if (field.startsWith('return_result.')) return true;
  if (field === 'error') return true;
  if (field.startsWith('error.')) return true;
  if (field === 'trace_kinds_in_order') return true;
  if (field.startsWith('side_effects.')) return true;
  return false;
}

// ───── State-notes corroboration ─────

/**
 * Heuristically check whether the embedded `golden_snapshot.state_notes`
 * shows the golden reaching the expected return value. Used as positive
 * signal for engine-bug: if the golden's path matches the expectation but
 * production differs, the divergence is on the production-engine side.
 *
 * Implementation: scan state_notes for `binding` entries; if the most
 * recent value matches a field in expect.return_result, count that as
 * corroboration. Coarse — intentionally permissive.
 */
function stateNotesCorroborateExpectation(tc: TestCase, notes: StateNote[]): boolean {
  const expected = tc.expect?.return_result;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    // Without a return_result expectation we can't corroborate.
    // Default to true — the engine-bug call doesn't strictly require it,
    // just gets bumped to medium confidence when corroborated.
    return true;
  }
  // Collect last-seen values per binding name.
  const lastValue = new Map<string, unknown>();
  for (const n of notes) {
    if (n.kind === 'binding') {
      const obj = n as unknown as Record<string, unknown>;
      lastValue.set(String(obj.name), obj.value);
    }
  }
  // For each expected field, see if any binding's last value matches.
  for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
    let found = false;
    for (const val of lastValue.values()) {
      if (jsonEqual(val, v)) {
        found = true;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}

/**
 * Inverse heuristic: state_notes show a value that contradicts the
 * embedded expectation. Used as the golden-bug signal.
 *
 * Intentionally narrow: requires expect.return_result to be a flat
 * key/value object and a binding whose name matches a key but whose
 * value differs from the expectation.
 */
function stateNotesContradictExpectation(tc: TestCase, notes: StateNote[]): boolean {
  const expected = tc.expect?.return_result;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return false;
  }
  const lastValue = new Map<string, unknown>();
  for (const n of notes) {
    if (n.kind === 'binding') {
      const obj = n as unknown as Record<string, unknown>;
      lastValue.set(String(obj.name), obj.value);
    }
  }
  for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
    if (lastValue.has(k)) {
      const seen = lastValue.get(k);
      if (!jsonEqual(seen, v)) return true;
    }
  }
  return false;
}

// ───── Prose-heavy grounding detection ─────

/**
 * Coarse signal: REQ excerpts containing ambiguity markers ("may",
 * "should", "if applicable") or long prose blocks suggest the spec is
 * prose-heavy and the generator could have misread it.
 *
 * v1 implementation operates on grounding_refs strings only, not on the
 * underlying REQ text (which the classifier doesn't have at hand at
 * runtime). Bare "REQ-NNN" cites with no prose around them count as
 * non-prose-heavy; cites that include excerpted prose count as
 * prose-heavy.
 */
function looksProseHeavy(refs: string[]): boolean {
  for (const ref of refs) {
    if (ref.length > 80) return true;
    if (/\b(may|should|might|if applicable|either|or)\b/i.test(ref)) return true;
  }
  return false;
}

// ───── Local JSON equality (no shared dep with runner.ts) ─────

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (
      !jsonEqual(
        (a as Record<string, unknown>)[ka[i]],
        (b as Record<string, unknown>)[kb[i]],
      )
    ) {
      return false;
    }
  }
  return true;
}

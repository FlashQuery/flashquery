// Macro testing framework — YAML loader + Vitest describe/it translator.
//
// Per Macro Testing Framework Requirements §9.3 + §9.1, the runner walks
// YAML test files under `cases/<category>/`, parses each per the §5.4
// canonical schema, drives the production macro engine against the test's
// fixture surface, and asserts on the structured outputs per INV-MTF-07.
//
// Phase 3 scope: in addition to Phase 2's minimal comparator (outcome,
// error code, return_result, side-effect counts), the runner now supports:
//   - `dry_run: true` — dispatches through `runDryRun()` and surfaces the
//     parse_ok + inventory envelope for comparison.
//   - `trace_mode` — passed through to `evaluateProgram()` and verified by
//     the comparator when assertions on trace shape are present.
//   - Tool surface — when `tools:` declares any non-fq archetype, a
//     lightweight ToolRegistry is built via `framework-registry.ts` that
//     proxies brokered handlers to the FakeBroker.
//   - Comparator: trace_kinds_in_order, side_effects.tool_calls (length
//     and per-entry partial match), dry_run_inventory, error.details,
//     error.message_contains, progress_milestones, and outcome
//     `needs_user_input`.
//   - Failure-triage record writer — when comparator emits findings, a
//     draft record per §9.6 is written to `tests/macro-framework/failures/`.
//
// Per INV-MTF-07 the comparison surface is structured fields only; no
// raw text-stream diffing happens here. The runner is also vitest-free
// in its public API (cases.test.ts wires the vitest plumbing) so smoke
// scripts and the future flashquery-macro-run skill consume the same
// `CompareResult` shape.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import {
  evaluateProgram,
  MacroExpectedError,
  type MacroValue,
} from '../../src/macro/evaluator.js';
import { runDryRun } from '../../src/macro/dry-run.js';
import { parseMacroSource } from '../../src/macro/parser.js';
import type { TraceStep } from '../../src/mcp/utils/response-formats.js';

import { FakeBroker, type FakeBrokerConfig, type ToolCallRecord } from './fixtures/fake-broker/index.ts';
import * as Archetypes from './fixtures/fake-broker/archetypes.ts';
import { buildVault } from './fixtures/vault-helper.ts';
import { createProgressCapture } from './fixtures/progress-capture.ts';
import { buildFrameworkRegistry } from './framework-registry.ts';
import { checkExpectStateNotes, type StateNotePattern } from './state-notes/assert.ts';
import type { StateNote } from './state-notes/schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = __dirname;

// ───── Test schema (§5.4) — types ─────

export interface ToolsBlock {
  fq?: 'real' | 'fake' | unknown;
  // brokered servers keyed by name; value is an archetype configuration
  [server: string]: unknown;
}

export interface ArchetypeConfig {
  archetype: string;
  tool_name?: string;
  // archetype-specific kwargs (e.g., responses[] for ScriptedTool)
  [k: string]: unknown;
}

export interface ExpectedToolCall {
  server: string;
  tool: string;
  // Optional structural matchers (each tested against the recorded args).
  args_match?: Record<string, unknown>;
  arg_equals?: unknown;
}

export interface ExpectedErrorBlock {
  code?: string;
  message_contains?: string;
  details?: Record<string, unknown>;
}

export interface ExpectedSideEffects {
  tool_calls?: ExpectedToolCall[] | { length: number };
  tool_call_count?: number;
  vault_writes?: unknown[];
  git_commits?: number;
}

export interface DryRunInventory {
  input_var_contract?: { required?: string[]; optional?: Array<{ key: string; default?: unknown }> };
  tool_references?: string[];
  server_references?: string[];
}

export type ComparisonMode = 'match_all' | 'match_some' | 'match_none';

export interface ExpectBlock {
  outcome?: 'success' | 'fail' | 'needs_user_input' | 'parse_error';
  return?: unknown;
  return_result?: unknown;
  return_result_keys?: string[]; // structural — assert result has these top-level keys
  error?: string | ExpectedErrorBlock;
  side_effects?: ExpectedSideEffects;
  trace_kinds_in_order?: string[];
  trace_kinds_contain?: string[];
  trace_has_no_args?: boolean; // for trace_mode: summary verification
  trace_absent?: boolean; // for trace_mode: none verification
  dry_run_inventory?: DryRunInventory;
  progress_milestones_min?: number; // lower bound on milestone count
  warnings_contain?: string[];
  // Author-declared pass/fail mode. Default match_all = strict convergence
  // (every declared expect must match). match_some = permissive (≥1 match).
  // match_none = author asserts divergence (0 matches; "all findings").
  comparison?: ComparisonMode;
}

export interface GoldenSnapshotBlock {
  state_notes?: StateNote[];
  // other golden snapshot fields tolerated but unused in Phase 2 runtime
  [k: string]: unknown;
}

export interface TestCase {
  id: string;
  name?: string;
  // Natural-language statement of WHAT the macro should do — the
  // English request that drove generation (for AI-generated pilots)
  // or the design intent (for hand-authored pilots). Distinct from
  // `description:` (which describes the test mechanics + REQ citations).
  // Optional but strongly recommended: makes it easy to find related
  // scenarios by wording and to retrace why a particular macro shape
  // emerged from a particular prompt.
  intent?: string;
  description?: string;
  covers?: string[];
  golden_version?: string;
  golden_run_at?: string;
  deps?: string[];
  require_embedding?: boolean;
  require_git?: boolean;
  macro: string;
  input_vars?: Record<string, unknown>;
  vault?: Record<string, string>;
  tools?: ToolsBlock;
  dry_run?: boolean;
  trace_mode?: 'full' | 'summary' | 'none';
  progress_mode?: 'full' | 'milestones' | 'silent';
  expect?: ExpectBlock;
  golden_snapshot?: GoldenSnapshotBlock;
  expect_state_notes?: StateNotePattern[];
  generator?: Record<string, unknown>;
  // Tier 2 (Broker REQ-103): when present, drive the engine with this
  // snapshot bound to `_self`. Required by pilots that exercise the
  // source_ref-loaded macro surface (path/title/frontmatter/tags/fq_id).
  self_binding?: {
    path: string;
    frontmatter?: Record<string, unknown>;
    title: string;
    tags?: unknown[];
    fq_id: string;
  };
  // category derived from directory (e.g. 'control-flow') -- attached at load
  __category?: string;
  __file?: string;
}

// ───── Required-field validation ─────
//
// A pilot YAML must carry every field needed to make its run meaningful:
// the AI prediction (predicted_expect), the golden capture state
// (reconciliation with non-null predicted_matched_captured, captured_at,
// and the captured snapshot), the source-of-truth expect block, and
// provenance metadata (intent). Pilots missing any of these get rejected
// at load time — the runner refuses to dispatch them against production.
// This makes the three-oracle reconciliation gate enforceable at the
// infrastructure layer, not just a periodic check.
//
// The required-field set parallels what `_pilot-validate.py` reports.

function validateRequiredFields(parsed: TestCase, file: string): string[] {
  const errors: string[] = [];
  const p = parsed as unknown as Record<string, unknown>;

  // Skeleton fields
  if (!p.id) errors.push('missing required field: id');
  if (!p.name) errors.push('missing required field: name');
  if (!p.intent) errors.push('missing required field: intent');
  if (!p.macro) errors.push('missing required field: macro');
  if (!p.golden_version) errors.push('missing required field: golden_version');

  // predicted_expect must be present and non-empty
  const pe = p.predicted_expect as Record<string, unknown> | undefined;
  if (!pe || typeof pe !== 'object') {
    errors.push('predicted_expect: missing or empty (AI prediction is required)');
  } else if (!pe.outcome) {
    errors.push('predicted_expect: missing outcome field');
  }

  // reconciliation block — golden capture must have happened
  const rec = p.reconciliation as Record<string, unknown> | undefined;
  if (!rec || typeof rec !== 'object') {
    errors.push('reconciliation: block missing (golden capture never ran)');
  } else {
    if (rec.predicted_matched_captured === null || rec.predicted_matched_captured === undefined) {
      errors.push(
        'reconciliation.predicted_matched_captured: null (golden capture never ran — three-oracle gate is not satisfied)',
      );
    }
    if (rec.captured_at === null || rec.captured_at === undefined) {
      errors.push('reconciliation.captured_at: null (golden capture never ran)');
    }
  }

  // golden_snapshot — required when reconciliation claims success
  if (rec && rec.predicted_matched_captured === true) {
    const gs = p.golden_snapshot as Record<string, unknown> | undefined;
    if (!gs || typeof gs !== 'object') {
      errors.push(
        'golden_snapshot: missing (but reconciliation claims capture succeeded)',
      );
    }
  }

  // expect block — the production-comparison target
  const ex = p.expect as Record<string, unknown> | undefined;
  if (!ex || typeof ex !== 'object') {
    errors.push('expect: missing or empty (production comparison target is required)');
  } else if (!ex.outcome) {
    errors.push('expect: missing outcome field');
  }

  return errors;
}

// ───── Loader ─────

export async function loadCases(category?: string): Promise<TestCase[]> {
  const root = join(FRAMEWORK_ROOT, 'cases');
  const categories = category
    ? [category]
    : (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  const out: TestCase[] = [];
  for (const cat of categories) {
    const dir = join(root, cat);
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
      const parsed = loadYaml(text) as TestCase;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Empty / invalid YAML test: ${file}`);
      }

      // Required-field validation gate (added 2026-05-20).
      // A pilot CANNOT run against production unless it has every field
      // a properly-authored pilot is expected to carry. This enforces the
      // three-oracle reconciliation discipline at the runner layer:
      // the golden capture must have happened, the AI prediction must be
      // recorded, the intent must be documented. AI-only predictions
      // shipping as test gold is exactly what this gate prevents.
      const validationErrors = validateRequiredFields(parsed, file);
      if (validationErrors.length > 0) {
        throw new Error(
          `Pilot ${file} is missing required fields and cannot run:\n` +
            validationErrors.map((e) => `  - ${e}`).join('\n') +
            `\n\nRun \`python3 tests/macro-framework/_pilot-validate.py\` for the full report and fix the offending pilots before re-running the suite.`,
        );
      }

      parsed.__category = cat;
      parsed.__file = relative(FRAMEWORK_ROOT, file);
      out.push(parsed);
    }
  }
  return out;
}

// ───── Tool-surface construction ─────

const ARCHETYPE_FACTORIES: Record<string, (cfg: ArchetypeConfig) => Archetypes.ArchetypeHandler> = {
  ReadOnlyTool: (c) => Archetypes.ReadOnlyTool(c.returns),
  WriteTool: (c) => Archetypes.WriteTool((c.side_effect as string | undefined) ?? 'write'),
  ThrowingTool: (c) =>
    Archetypes.ThrowingTool((c.error_kind as 'transport' | 'timeout' | 'protocol' | 'generic' | undefined) ?? 'generic'),
  IsErrorTool: (c) => Archetypes.IsErrorTool((c.message as string | undefined) ?? 'error'),
  SlowTool: (c) => Archetypes.SlowTool((c.ms as number | undefined) ?? 0, c.returns),
  // Spec-valid route for REQ-105 nested propagation per REQ-060:
  // broker-on-TOFU-drift, not brokered-tool-returns-event. Pilot configs
  // pass a `drift_payload` object; sensible defaults fill the rest.
  NeedsInputViaTofuDrift: (c) => {
    const dp = (c.drift_payload as Record<string, unknown> | undefined) ?? {};
    return Archetypes.NeedsInputViaTofuDrift({
      server: (dp.server as string | undefined) ?? (c.server as string | undefined) ?? 'unknown',
      tool: (dp.tool as string | undefined) ?? (c.tool as string | undefined) ?? 'unknown',
      question: dp.question as string | undefined,
      old_schema: dp.old_schema as
        | { name?: string; description?: string; inputSchema?: unknown }
        | undefined,
      new_schema: dp.new_schema as
        | { name?: string; description?: string; inputSchema?: unknown }
        | undefined,
      diff_summary: dp.diff_summary as string | undefined,
      answer_shape: dp.answer_shape as string | undefined,
    });
  },
  StructuredContentTool: (c) => Archetypes.StructuredContentTool(c.value),
  JSONTextTool: (c) => Archetypes.JSONTextTool(c.value),
  MultimodalTool: (c) =>
    Archetypes.MultimodalTool(
      (c.content as Parameters<typeof Archetypes.MultimodalTool>[0]) ?? [{ type: 'text', text: '' }],
    ),
  ScriptedTool: (c) =>
    Archetypes.ScriptedTool((c.responses as Archetypes.ScriptedResponse[] | undefined) ?? []),
  LyingTool: (c) =>
    Archetypes.LyingTool({
      claims: (c.claims as { readOnly: boolean } | undefined) ?? { readOnly: true },
      behaves:
        (c.behaves as Archetypes.ArchetypeHandler | undefined) ??
        Archetypes.ReadOnlyTool({}),
    }),
};

export function buildFakeBroker(tools: ToolsBlock | undefined): FakeBroker | null {
  if (!tools) return null;
  const servers: FakeBrokerConfig['servers'] = {};
  let anyBrokered = false;
  for (const [server, cfg] of Object.entries(tools)) {
    if (server === 'fq') continue; // native — handled by real handlers
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;
    // Two shapes supported:
    //   1. Single archetype: `{ archetype: ..., tool_name?: ..., ...config }`
    //   2. Multi-tool: `{ tools: { <name>: { archetype: ..., ...config } } }`
    //      — used when a single brokered server exposes multiple tools.
    if (c.tools && typeof c.tools === 'object' && !Array.isArray(c.tools)) {
      const toolEntries: Record<string, ReturnType<typeof ARCHETYPE_FACTORIES[string]>> = {};
      for (const [name, sub] of Object.entries(c.tools as Record<string, unknown>)) {
        if (!sub || typeof sub !== 'object') continue;
        const sc = sub as ArchetypeConfig;
        const factory = ARCHETYPE_FACTORIES[sc.archetype];
        if (!factory) {
          throw new Error(`Unknown archetype "${sc.archetype}" for ${server}.${name}`);
        }
        toolEntries[name] = factory(sc);
      }
      servers[server] = { tools: toolEntries };
      anyBrokered = true;
      continue;
    }
    const single = c as ArchetypeConfig;
    const factory = ARCHETYPE_FACTORIES[single.archetype];
    if (!factory) {
      throw new Error(`Unknown archetype "${single.archetype}" for server "${server}"`);
    }
    const toolName = single.tool_name ?? single.archetype.replace(/Tool$/, '').toLowerCase();
    servers[server] = { tools: { [toolName]: factory(single) } };
    anyBrokered = true;
  }
  return anyBrokered ? new FakeBroker({ servers }) : null;
}

// ───── Driver ─────

export interface DriveResult {
  payload: Record<string, unknown>;
  isError: boolean | undefined;
  rawText: string;
  broker: FakeBroker | null;
  progressEvents: ReturnType<typeof createProgressCapture>['events'];
  vaultRoot: string;
  cleanup: () => Promise<void>;
}

export async function driveTest(tc: TestCase): Promise<DriveResult> {
  // Parse.
  const parsed = parseMacroSource(tc.macro);
  if (!parsed.ok) {
    return {
      payload: parsed.error as unknown as Record<string, unknown>,
      isError: false,
      rawText: JSON.stringify(parsed.error),
      broker: null,
      progressEvents: [],
      vaultRoot: '',
      cleanup: async () => undefined,
    };
  }

  // Build the seed vault.
  const vaultFixture = await buildVault(tc.vault ?? {});

  // Build the fake broker if `tools:` declares any non-fq surface.
  const broker = buildFakeBroker(tc.tools);

  // Build a tool registry from `tools:` for prescan + dispatch.
  const reg = buildFrameworkRegistry(tc.tools, broker);

  // Progress capture.
  const progress = createProgressCapture();

  // Dry-run dispatch — bypasses the evaluator.
  if (tc.dry_run === true) {
    if (!reg) {
      // runDryRun() still requires a registry for the prescan it performs.
      // If a pilot wants dry-run without tools, declare `tools: { fq: real }`
      // so the engine recognizes fq.
      throw new Error(
        `dry-run test "${tc.id}" must declare a tools: surface (even just \`fq: real\`) so prescan has a registry`,
      );
    }
    const warnings: string[] = [];
    try {
      const result = runDryRun({
        program: parsed.program,
        inputVars: (tc.input_vars ?? {}) as Record<string, MacroValue>,
        taskId: 'macro-framework-dry-run',
        registry: reg.registry,
        allowlist: new Set(reg.allowedToolNames),
        warnings,
      });
      const rawText = result.content[0]?.text ?? '{}';
      const payload = JSON.parse(rawText) as Record<string, unknown>;
      return {
        payload,
        isError: result.isError,
        rawText,
        broker,
        progressEvents: progress.events,
        vaultRoot: vaultFixture.root,
        cleanup: vaultFixture.cleanup,
      };
    } catch (e) {
      // Pre-flight or pre-scan errors surface as thrown envelopes from
      // runDryRun (it currently throws for the prescan/forbidden cases;
      // for our pilots we expect a clean dry-run success).
      const message = e instanceof Error ? e.message : String(e);
      return {
        payload: { error: 'dry_run_failed', message } as Record<string, unknown>,
        isError: true,
        rawText: JSON.stringify({ error: 'dry_run_failed', message }),
        broker,
        progressEvents: progress.events,
        vaultRoot: vaultFixture.root,
        cleanup: vaultFixture.cleanup,
      };
    }
  }

  // Drive the production engine.
  const result = await evaluateProgram(parsed.program, {
    inputVars: tc.input_vars as Record<string, never> | undefined,
    vaultRoot: vaultFixture.root,
    ...(broker ? { broker } : {}),
    ...(reg ? { toolRegistry: reg.registry, allowedToolNames: reg.allowedToolNames } : {}),
    ...(tc.trace_mode ? { traceMode: tc.trace_mode } : {}),
    ...(tc.progress_mode ? { progressMode: tc.progress_mode } : {}),
    ...(tc.self_binding
      ? {
          self: {
            path: tc.self_binding.path,
            frontmatter: (tc.self_binding.frontmatter ?? {}) as Record<string, MacroValue>,
            title: tc.self_binding.title,
            tags: (tc.self_binding.tags ?? []) as MacroValue[],
            fq_id: tc.self_binding.fq_id,
          },
        }
      : {}),
    progressSink: progress.sink,
  });

  const rawText = result.content[0]?.text ?? '{}';
  const payload = JSON.parse(rawText) as Record<string, unknown>;

  return {
    payload,
    isError: result.isError,
    rawText,
    broker,
    progressEvents: progress.events,
    vaultRoot: vaultFixture.root,
    cleanup: vaultFixture.cleanup,
  };
}

// ───── Comparison ─────

export interface CompareFinding {
  field: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export interface CompareResult {
  ok: boolean;
  findings: CompareFinding[];
  /**
   * Number of top-level `expect:` fields evaluated against production
   * (`outcome`, `return_result`, `error`, `side_effects`, `trace_kinds_in_order`,
   * etc.). Sub-fields of a parent expect (e.g., `error.code`,
   * `error.message_contains`) are counted independently as one each — keeping
   * the comparator dumb-simple per the §5.4 counting rule.
   */
  totalExpects: number;
  matchedExpects: number;
  mode: ComparisonMode;
}

/**
 * Pure structured comparator. Returns a result object rather than throwing
 * so tests, smoke scripts, and the future failure-triage writer can all
 * consume the same shape. Vitest assertions wrap this in `registerCases()`.
 *
 * Per INV-MTF-07 the comparison surface is structured-fields only: no raw
 * stdout/stderr, no text-stream diffing.
 */
export function compareToExpect(tc: TestCase, drive: DriveResult): CompareResult {
  const findings: CompareFinding[] = [];
  const ex = tc.expect;
  const mode: ComparisonMode = ex?.comparison ?? 'match_all';
  if (!ex) {
    return { ok: true, findings, totalExpects: 0, matchedExpects: 0, mode };
  }

  let totalExpects = 0;
  // Helper: evaluate one expect-field. Increments `totalExpects` and pushes
  // a finding only if `check` returns one. Returns `true` if matched.
  // Per §5.4 each top-level expect field (outcome, return_result, error,
  // side_effects, trace_kinds_in_order, etc.) counts as one expect; sub-
  // fields (error.code, error.message_contains, tool_calls[i].server) each
  // count independently.
  const evalExpect = (check: () => CompareFinding | null): boolean => {
    totalExpects += 1;
    const finding = check();
    if (finding === null) return true;
    findings.push(finding);
    return false;
  };

  // Outcome dispatch.
  if (ex.outcome === 'success') {
    evalExpect(() =>
      drive.payload.error !== undefined
        ? {
            field: 'outcome',
            expected: 'success',
            actual: 'error',
            detail: `payload.error = ${JSON.stringify(drive.payload.error)}; payload = ${JSON.stringify(drive.payload)}`,
          }
        : null,
    );
  } else if (ex.outcome === 'fail') {
    evalExpect(() =>
      drive.payload.error === undefined
        ? {
            field: 'outcome',
            expected: 'fail',
            actual: 'success',
            detail: `payload.result = ${JSON.stringify(drive.payload.result)}`,
          }
        : null,
    );
  } else if (ex.outcome === 'parse_error') {
    evalExpect(() =>
      drive.payload.error !== 'parse_error'
        ? { field: 'outcome', expected: 'parse_error', actual: drive.payload.error }
        : null,
    );
  } else if (ex.outcome === 'needs_user_input') {
    evalExpect(() =>
      drive.payload.reason !== 'needs_user_input'
        ? {
            field: 'outcome',
            expected: 'needs_user_input',
            actual: `reason=${JSON.stringify(drive.payload.reason)} error=${JSON.stringify(drive.payload.error)}`,
          }
        : null,
    );
  }

  // Direct return-value match (structured). The production engine wraps
  // the macro's return value under `payload.result`.
  if (ex.return_result !== undefined) {
    evalExpect(() =>
      !deepEqual(drive.payload.result, ex.return_result)
        ? { field: 'return_result', expected: ex.return_result, actual: drive.payload.result }
        : null,
    );
  }

  // Structural key assertion — useful when the result has fields whose
  // values are non-deterministic (e.g., task_id) but presence matters.
  if (ex.return_result_keys) {
    evalExpect(() => {
      const actual = drive.payload.result;
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
        return {
          field: 'return_result_keys',
          expected: ex.return_result_keys,
          actual,
          detail: 'result is not an object',
        };
      }
      const have = new Set(Object.keys(actual as Record<string, unknown>));
      const missing = ex.return_result_keys!.filter((k) => !have.has(k));
      if (missing.length > 0) {
        return {
          field: 'return_result_keys',
          expected: ex.return_result_keys,
          actual: [...have],
          detail: `missing keys: ${missing.join(', ')}`,
        };
      }
      return null;
    });
  }

  // Error envelope. Accepts either a string (code-only shorthand) or a
  // structured `{code, message_contains, details}`. Sub-fields each count
  // as one expect.
  if (ex.error !== undefined) {
    if (typeof ex.error === 'string') {
      evalExpect(() =>
        drive.payload.error !== ex.error
          ? { field: 'error', expected: ex.error, actual: drive.payload.error }
          : null,
      );
    } else {
      if (ex.error.code !== undefined) {
        evalExpect(() =>
          drive.payload.error !== (ex.error as ExpectedErrorBlock).code
            ? {
                field: 'error.code',
                expected: (ex.error as ExpectedErrorBlock).code,
                actual: drive.payload.error,
              }
            : null,
        );
      }
      if (ex.error.message_contains !== undefined) {
        evalExpect(() => {
          const msg = String(drive.payload.message ?? '');
          const needle = (ex.error as ExpectedErrorBlock).message_contains as string;
          return !msg.includes(needle)
            ? { field: 'error.message_contains', expected: needle, actual: msg }
            : null;
        });
      }
      if (ex.error.details !== undefined) {
        evalExpect(() => {
          const actualDetails = drive.payload.details;
          const wantDetails = (ex.error as ExpectedErrorBlock).details;
          return !partialMatch(wantDetails, actualDetails)
            ? { field: 'error.details', expected: wantDetails, actual: actualDetails }
            : null;
        });
      }
    }
  }

  // Side-effect manifest comparisons.
  if (ex.side_effects?.tool_call_count !== undefined) {
    evalExpect(() => {
      const actualCount = drive.broker?.callLog.length ?? 0;
      return actualCount !== ex.side_effects!.tool_call_count
        ? {
            field: 'side_effects.tool_call_count',
            expected: ex.side_effects!.tool_call_count,
            actual: actualCount,
          }
        : null;
    });
  }
  if (ex.side_effects?.tool_calls && drive.broker) {
    const expected = ex.side_effects.tool_calls;
    if (Array.isArray(expected)) {
      // First: length is one expect.
      const lengthMatched = evalExpect(() =>
        drive.broker!.callLog.length !== expected.length
          ? {
              field: 'side_effects.tool_calls.length',
              expected: expected.length,
              actual: drive.broker!.callLog.length,
              detail: `actual call log: ${JSON.stringify(drive.broker!.callLog.map((c) => `${c.server}.${c.tool}`))}`,
            }
          : null,
      );
      if (lengthMatched) {
        for (let i = 0; i < expected.length; i += 1) {
          const want = expected[i];
          const got = drive.broker.callLog[i];
          const fieldPrefix = `side_effects.tool_calls[${i}]`;
          evalExpect(() =>
            got.server !== want.server
              ? { field: `${fieldPrefix}.server`, expected: want.server, actual: got.server }
              : null,
          );
          evalExpect(() =>
            got.tool !== want.tool
              ? { field: `${fieldPrefix}.tool`, expected: want.tool, actual: got.tool }
              : null,
          );
          if (want.args_match !== undefined) {
            evalExpect(() =>
              !partialMatch(want.args_match, got.args)
                ? { field: `${fieldPrefix}.args_match`, expected: want.args_match, actual: got.args }
                : null,
            );
          }
          if (want.arg_equals !== undefined) {
            evalExpect(() =>
              !deepEqual(want.arg_equals, got.args)
                ? { field: `${fieldPrefix}.arg_equals`, expected: want.arg_equals, actual: got.args }
                : null,
            );
          }
        }
      }
    } else if ('length' in (expected as { length: number })) {
      const want = (expected as { length: number }).length;
      evalExpect(() =>
        drive.broker!.callLog.length !== want
          ? {
              field: 'side_effects.tool_calls.length',
              expected: want,
              actual: drive.broker!.callLog.length,
            }
          : null,
      );
    }
  }

  // Trace shape.
  const trace = (drive.payload.trace ?? []) as TraceStep[];
  if (ex.trace_kinds_in_order) {
    evalExpect(() => {
      const got = trace.map((t) => t.kind);
      return !deepEqual(ex.trace_kinds_in_order, got)
        ? { field: 'trace_kinds_in_order', expected: ex.trace_kinds_in_order, actual: got }
        : null;
    });
  }
  if (ex.trace_kinds_contain) {
    evalExpect(() => {
      const got = trace.map((t) => t.kind as string);
      const missing = ex.trace_kinds_contain!.filter((k) => !got.includes(k));
      return missing.length > 0
        ? {
            field: 'trace_kinds_contain',
            expected: ex.trace_kinds_contain,
            actual: got,
            detail: `missing: ${missing.join(', ')}`,
          }
        : null;
    });
  }
  if (ex.trace_has_no_args === true) {
    evalExpect(() => {
      const violators = trace.filter((t) => t.args !== undefined || t.result !== undefined);
      return violators.length > 0
        ? {
            field: 'trace_has_no_args',
            expected: true,
            actual: false,
            detail: `${violators.length} trace step(s) carry args/result: ${JSON.stringify(violators.map((t) => t.kind))}`,
          }
        : null;
    });
  }
  if (ex.trace_absent === true) {
    evalExpect(() =>
      drive.payload.trace !== undefined && (drive.payload.trace as unknown[]).length > 0
        ? {
            field: 'trace_absent',
            expected: true,
            actual: false,
            detail: `trace has ${(drive.payload.trace as unknown[]).length} step(s)`,
          }
        : null,
    );
  }

  // Dry-run inventory — sub-fields each count as one expect.
  if (ex.dry_run_inventory) {
    const want = ex.dry_run_inventory;
    if (want.input_var_contract) {
      const got = drive.payload.input_var_contract as
        | { required?: string[]; optional?: Array<{ key: string }> }
        | undefined;
      if (want.input_var_contract.required) {
        evalExpect(() => {
          const gotReq = (got?.required ?? []) as string[];
          return !arraysEqualAsSets(want.input_var_contract!.required!, gotReq)
            ? {
                field: 'dry_run_inventory.input_var_contract.required',
                expected: want.input_var_contract!.required,
                actual: gotReq,
              }
            : null;
        });
      }
      if (want.input_var_contract.optional) {
        evalExpect(() => {
          const gotOpt = (got?.optional ?? []) as Array<{ key: string }>;
          const wantKeys = want.input_var_contract!.optional!.map((o) => o.key);
          const gotKeys = gotOpt.map((o) => o.key);
          return !arraysEqualAsSets(wantKeys, gotKeys)
            ? {
                field: 'dry_run_inventory.input_var_contract.optional',
                expected: wantKeys,
                actual: gotKeys,
              }
            : null;
        });
      }
    }
    if (want.tool_references) {
      evalExpect(() => {
        const got = (drive.payload.tool_references ?? []) as string[];
        return !arraysEqualAsSets(want.tool_references!, got)
          ? { field: 'dry_run_inventory.tool_references', expected: want.tool_references, actual: got }
          : null;
      });
    }
    if (want.server_references) {
      evalExpect(() => {
        const got = (drive.payload.server_references ?? []) as string[];
        return !arraysEqualAsSets(want.server_references!, got)
          ? { field: 'dry_run_inventory.server_references', expected: want.server_references, actual: got }
          : null;
      });
    }
  }

  // Progress milestones (lower bound).
  if (ex.progress_milestones_min !== undefined) {
    evalExpect(() =>
      drive.progressEvents.length < ex.progress_milestones_min!
        ? {
            field: 'progress_milestones_min',
            expected: `>= ${ex.progress_milestones_min}`,
            actual: drive.progressEvents.length,
          }
        : null,
    );
  }

  const matchedExpects = totalExpects - findings.length;
  let ok: boolean;
  switch (mode) {
    case 'match_some':
      ok = matchedExpects >= 1;
      break;
    case 'match_none':
      ok = matchedExpects === 0;
      break;
    case 'match_all':
    default:
      ok = matchedExpects === totalExpects;
      break;
  }

  return { ok, findings, totalExpects, matchedExpects, mode };
}

function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function partialMatch(pattern: unknown, actual: unknown): boolean {
  if (pattern === null || typeof pattern !== 'object') {
    return deepEqual(pattern, actual);
  }
  if (Array.isArray(pattern)) {
    if (!Array.isArray(actual)) return false;
    if (pattern.length !== actual.length) return false;
    for (let i = 0; i < pattern.length; i += 1) {
      if (!partialMatch(pattern[i], actual[i])) return false;
    }
    return true;
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    return false;
  }
  for (const [k, v] of Object.entries(pattern as Record<string, unknown>)) {
    if (!partialMatch(v, (actual as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[ka[i]],
        (b as Record<string, unknown>)[kb[i]],
      )
    ) {
      return false;
    }
  }
  return true;
}

// ───── Failure-triage record writer (§9.6 draft format) ─────

export interface FailureRecordInput {
  tc: TestCase;
  findings: CompareFinding[];
  drive: DriveResult;
  goldenVersionCurrent?: string;
}

/**
 * Writes a §9.6-shape failure-triage record to
 * `tests/macro-framework/failures/<YYYY-MM-DD>-<HHMMSS>-<test_id>.md`.
 *
 * @deprecated Phase 6 replaced this draft writer with the full
 * `triage/record.ts` + `triage/classify.ts` modules. New callers should
 * use `writeTriageRecord()` and `classifyFailure()`. This function is
 * retained for backward compatibility with any out-of-tree consumers
 * that imported it from `runner.ts`; it now delegates to the Phase 6
 * classifier and writer so its output matches the new format.
 */
export async function writeFailureRecord(input: FailureRecordInput): Promise<string> {
  // Delegate to the Phase 6 classifier + writer. This keeps any
  // pre-existing imports of `writeFailureRecord` working while routing
  // through the full §5.8 five-way classifier.
  const { classifyFailure } = await import('./triage/classify.ts');
  const { writeTriageRecord, findRelatedFailures } = await import('./triage/record.ts');
  const classification = classifyFailure(input.tc, input.findings, {
    goldenVersionCurrent: input.goldenVersionCurrent ?? '<unknown>',
  });
  const related = await findRelatedFailures(input.tc.id);
  return writeTriageRecord({
    tc: input.tc,
    findings: input.findings,
    drive: input.drive,
    classification,
    goldenVersionCurrent: input.goldenVersionCurrent ?? '<unknown>',
    relatedFailures: related,
  });
}

// Render helpers used by the deprecated writeFailureRecord path now live
// in `triage/record.ts`; the runner is back to being a pure
// load + drive + compare module.

// ───── Vitest plumbing lives in `cases.test.ts` ─────

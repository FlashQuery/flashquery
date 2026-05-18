// Macro testing framework — YAML loader + Vitest describe/it translator.
//
// Per Macro Testing Framework Requirements §9.3 + §9.1, the runner walks
// YAML test files under `cases/<category>/`, parses each per the §5.4
// canonical schema, drives the production macro engine against the test's
// fixture surface, and asserts on the structured outputs per INV-MTF-07.
//
// Phase 2 scope per the §10 phase-2 gate:
//   - Loads `_placeholder-loop.yml` (and any other YAML in cases/).
//   - Performs the load-time `expect_state_notes` integrity check against
//     the embedded `golden_snapshot.state_notes`.
//   - Drives the production engine with the macro source + input_vars +
//     vault + tool surface (FakeBroker when `tools:` declares any).
//   - Compares structured outputs (return envelope, basic side-effects)
//     to the embedded `expect:` block.
//
// Phase 3+ will expand the surface (more `expect_*` assertions, trace
// shape matching, side-effect manifest, dry-run, progress milestones,
// auto-write failure-triage records).

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseMacroSource } from '../../src/macro/parser.js';

import { FakeBroker, type FakeBrokerConfig } from './fixtures/fake-broker/index.ts';
import * as Archetypes from './fixtures/fake-broker/archetypes.ts';
import { buildVault } from './fixtures/vault-helper.ts';
import { createProgressCapture } from './fixtures/progress-capture.ts';
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

export interface ExpectBlock {
  outcome?: 'success' | 'fail' | 'needs_user_input' | 'parse_error';
  return?: unknown;
  return_result?: unknown;
  error?: string;
  side_effects?: {
    vault_writes?: unknown[];
    tool_calls?: unknown[];
    git_commits?: number;
  };
  trace_kinds_in_order?: string[];
}

export interface GoldenSnapshotBlock {
  state_notes?: StateNote[];
  // other golden snapshot fields tolerated but unused in Phase 2 runtime
  [k: string]: unknown;
}

export interface TestCase {
  id: string;
  name?: string;
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
  expect?: ExpectBlock;
  golden_snapshot?: GoldenSnapshotBlock;
  expect_state_notes?: StateNotePattern[];
  generator?: Record<string, unknown>;
  // category derived from directory (e.g. 'control-flow') -- attached at load
  __category?: string;
  __file?: string;
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
  NeedsInputTool: (c) =>
    Archetypes.NeedsInputTool(
      (c.payload as Parameters<typeof Archetypes.NeedsInputTool>[0]) ?? { question: '?' },
    ),
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
    const c = cfg as ArchetypeConfig;
    const factory = ARCHETYPE_FACTORIES[c.archetype];
    if (!factory) {
      throw new Error(`Unknown archetype "${c.archetype}" for server "${server}"`);
    }
    const toolName = c.tool_name ?? c.archetype.replace(/Tool$/, '').toLowerCase();
    servers[server] = { tools: { [toolName]: factory(c) } };
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
    // Surface the parse error as a result object so the comparator can
    // handle outcome: parse_error tests uniformly. We synthesize a
    // production-shaped error envelope wrapper.
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

  // Progress capture.
  const progress = createProgressCapture();

  // Drive the production engine.
  const result = await evaluateProgram(parsed.program, {
    inputVars: tc.input_vars as Record<string, never> | undefined,
    vaultRoot: vaultFixture.root,
    ...(broker ? { broker } : {}),
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

// ───── Comparison (Phase 2: minimal; expand in Phase 3+) ─────

export interface CompareFinding {
  field: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export interface CompareResult {
  ok: boolean;
  findings: CompareFinding[];
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
  if (!ex) return { ok: true, findings };

  // Outcome dispatch.
  if (ex.outcome === 'success') {
    if (drive.payload.error !== undefined) {
      findings.push({
        field: 'outcome',
        expected: 'success',
        actual: 'error',
        detail: `payload.error = ${JSON.stringify(drive.payload.error)}; payload = ${JSON.stringify(drive.payload)}`,
      });
    }
  } else if (ex.outcome === 'fail') {
    if (drive.payload.error === undefined) {
      findings.push({
        field: 'outcome',
        expected: 'fail',
        actual: 'success',
        detail: `payload.result = ${JSON.stringify(drive.payload.result)}`,
      });
    }
  } else if (ex.outcome === 'parse_error') {
    if (drive.payload.error !== 'parse_error') {
      findings.push({
        field: 'outcome',
        expected: 'parse_error',
        actual: drive.payload.error,
      });
    }
  }

  // Direct return-value match (structured). The production engine wraps
  // the macro's return value under `payload.result`.
  if (ex.return_result !== undefined) {
    if (!deepEqual(drive.payload.result, ex.return_result)) {
      findings.push({
        field: 'return_result',
        expected: ex.return_result,
        actual: drive.payload.result,
      });
    }
  }

  // Tool-call count assertion (basic). The full §5.4 side_effects shape
  // is Phase 3+ work; in Phase 2 we only verify call counts when supplied.
  if (ex.side_effects?.tool_calls && drive.broker) {
    if (drive.broker.callLog.length !== ex.side_effects.tool_calls.length) {
      findings.push({
        field: 'side_effects.tool_calls.length',
        expected: ex.side_effects.tool_calls.length,
        actual: drive.broker.callLog.length,
      });
    }
  }

  // Error code match.
  if (ex.error !== undefined) {
    if (drive.payload.error !== ex.error) {
      findings.push({
        field: 'error',
        expected: ex.error,
        actual: drive.payload.error,
      });
    }
  }

  return { ok: findings.length === 0, findings };
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

// ───── Vitest plumbing lives in `cases.test.ts` ─────
// The pure pieces above (loadCases, driveTest, compareToExpect, etc.) are
// vitest-free so they can run under tsx for smoke / triage tooling.

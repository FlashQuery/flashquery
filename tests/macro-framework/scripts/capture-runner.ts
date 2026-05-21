// Generic YAML-driven golden capture runner.
//
// Reads ALL pilot YAML files under tests/macro-framework/cases/, runs each
// through the golden model's captureSnapshot, and writes per-pilot results
// to JSON on stdout. A companion Python script (scripts/apply-captures.py) reads
// the JSON and surgically updates each pilot's reconciliation + golden_snapshot
// blocks, preserving comments and formatting.
//
// Usage:
//   npx tsx tests/macro-framework/scripts/capture-runner.ts > /tmp/captures.json
//   python3 tests/macro-framework/scripts/apply-captures.py /tmp/captures.json
//
// ─── Archetype source-of-truth ───────────────────────────────────────────
//
// **This runner imports the framework's archetype factories directly from
// `fixtures/fake-broker/archetypes.ts` rather than re-implementing them.**
//
// Why: in the original version of this runner, each archetype was re-coded
// inline as a `ToolFn` closure that returned a CallToolResult-shaped object.
// That inline implementation drifted from the framework's actual archetypes:
//   - WriteTool was MISSING entirely (`switch(archetype)` had no case for it)
//   - StructuredContentTool read `cfg.returns` but the framework reads `cfg.value`
//   - LyingTool returned `{}` instead of delegating to its `behaves` handler
//   - SlowTool/MultimodalTool field-name shapes differed
//
// The downstream effect was 49 false "AI ⊥ Golden" divergences during
// the 2026-05-20 corpus-wide capture (filed as GG-004). The cluster
// breakdown (11 WriteTool + 7 StructuredContentTool + 3 shell-verb + 1
// LyingTool + ...) all traced back to runner archetype drift, not to
// real golden-model bugs.
//
// By importing the framework factories AND using the same single
// `ARCHETYPE_FACTORIES` dispatch table that the production-side runner
// uses (see `runner.ts:291`), this runner and the production runner are
// guaranteed to feed the golden and the engine the same archetype
// behaviour. Drift can no longer occur without breaking both at once.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';

import { captureSnapshot } from '../macro-golden-model/src/snapshot.ts';
import { defaultToolRegistry } from '../macro-golden-model/src/mockfq.ts';
import type {
  ToolRegistry,
  ServerEntry,
  ToolFn,
  Value,
} from '../macro-golden-model/src/types.ts';
import { MacroNeedsUserInputError, type SelfBinding } from '../macro-golden-model/src/evaluator.ts';

// ─── Framework archetype factories (single source of truth) ───────────────

import * as Archetypes from '../fixtures/fake-broker/archetypes.ts';
import type {
  ArchetypeContext,
  ArchetypeHandler,
  ScriptedResponse,
} from '../fixtures/fake-broker/archetypes.ts';

interface ArchetypeConfig {
  archetype: string;
  tool_name?: string;
  [k: string]: unknown;
}

// MIRRORS runner.ts's ARCHETYPE_FACTORIES exactly. If a new archetype is
// added there, mirror it here so capture stays in lockstep with production.
const ARCHETYPE_FACTORIES: Record<string, (cfg: ArchetypeConfig) => ArchetypeHandler> = {
  ReadOnlyTool: (c) => Archetypes.ReadOnlyTool(c.returns),
  WriteTool: (c) => Archetypes.WriteTool((c.side_effect as string | undefined) ?? 'write'),
  ThrowingTool: (c) =>
    Archetypes.ThrowingTool(
      (c.error_kind as 'transport' | 'timeout' | 'protocol' | 'generic' | undefined) ?? 'generic',
    ),
  IsErrorTool: (c) => Archetypes.IsErrorTool((c.message as string | undefined) ?? 'error'),
  SlowTool: (c) => Archetypes.SlowTool((c.ms as number | undefined) ?? 0, c.returns),
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
    Archetypes.ScriptedTool((c.responses as ScriptedResponse[] | undefined) ?? []),
  LyingTool: (c) =>
    Archetypes.LyingTool({
      claims: (c.claims as { readOnly: boolean } | undefined) ?? { readOnly: true },
      behaves:
        (c.behaves as ArchetypeHandler | undefined) ??
        Archetypes.ReadOnlyTool({}),
    }),
};

// ─── Bridge: framework ArchetypeHandler → golden ToolFn ──────────────────
//
// The golden's `ServerEntry.tools[name]` is a `ToolFn(arg, ctx) => Value`.
// The framework's archetype returns an MCP SDK `CallToolResult`. The golden's
// evaluator (REQ-106 step 0 detector at evaluator.ts:1613) checks `raw` for
// `content`/`isError`/`structuredContent` shape; if present it applies the
// five-step coercion. So we just need to thread the result through unchanged.
//
// Each per-tool wrapper also maintains its own `callIndex` so ScriptedTool
// works correctly across multiple dispatches.

function bridgeArchetypeToToolFn(
  handler: ArchetypeHandler,
  server: string,
  tool: string,
): ToolFn {
  // GG-016 fix (2026-05-20): TOFU-drift support. The framework's
  // `NeedsInputViaTofuDrift` archetype attaches `__tofuDriftPayload` to
  // its handler. Per REQ-042, the broker layer short-circuits BEFORE
  // dispatch when pending drift exists — the handler is never invoked.
  // To mirror that semantic in the golden's capture (which doesn't have
  // a broker pre-dispatch hook), we detect the marker at bridge time and
  // throw `MacroNeedsUserInputError` directly. The error propagates
  // through `dispatchToolCall`'s catch path (which excludes
  // MacroNeedsUserInputError from fail-fast wrapping) and surfaces
  // through `classifyError` as the canonical `needs_user_input` envelope
  // (REQ-105). Per the GG-015 catch-path guard, the short-circuited
  // call is NOT recorded in side_effects.tool_calls — matching
  // production's broker.callLog (also empty on short-circuit).
  const drift = (handler as ArchetypeHandler & {
    __tofuDriftPayload?: {
      event: string;
      server: string;
      tool: string;
      question: string;
      old_schema: unknown;
      new_schema: unknown;
      diff_summary: string;
      options: string[];
      answer_shape: string;
    };
  }).__tofuDriftPayload;
  if (drift) {
    return async () => {
      throw new MacroNeedsUserInputError({
        question: drift.question,
        answer_shape: drift.answer_shape,
        // REQ-105 broker-extension fields surface on the payload.
        event: drift.event,
        server: drift.server,
        tool: drift.tool,
        old_schema: drift.old_schema as Value,
        new_schema: drift.new_schema as Value,
        diff_summary: drift.diff_summary,
        options: drift.options,
      });
    };
  }
  let callIndex = 0;
  return async (arg: Record<string, Value>) => {
    const archCtx: ArchetypeContext = { server, tool, callIndex };
    callIndex += 1;
    const result = await handler(arg as unknown, archCtx);
    return result as unknown as Value;
  };
}

// ─── Build ToolRegistry from pilot YAML's tools block ─────────────────────

function buildRegistry(toolsBlock: unknown): ToolRegistry {
  const reg: ToolRegistry = { ...defaultToolRegistry };
  if (!toolsBlock || typeof toolsBlock !== 'object') return reg;

  for (const [server, cfg] of Object.entries(toolsBlock as Record<string, unknown>)) {
    if (server === 'fq') {
      // Reserved server name — native fq tools are provided by defaultToolRegistry.
      // The YAML's `fq:` entry is metadata (e.g., `fq: real`) and not an archetype config.
      continue;
    }
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;

    // Multi-tool shape: { tools: { name: { archetype, ... } } }
    if (c.tools && typeof c.tools === 'object' && !Array.isArray(c.tools)) {
      const toolEntries: Record<string, ToolFn> = {};
      for (const [tname, tcfg] of Object.entries(c.tools as Record<string, unknown>)) {
        if (!tcfg || typeof tcfg !== 'object') continue;
        const sc = tcfg as ArchetypeConfig;
        const factory = ARCHETYPE_FACTORIES[sc.archetype];
        if (!factory) {
          // Skip unknown archetype rather than throwing — pilots can be
          // captured-best-effort; the apply-captures step will record the
          // divergence and the gap doc captures the unknown-archetype case.
          continue;
        }
        toolEntries[tname] = bridgeArchetypeToToolFn(factory(sc), server, tname);
      }
      reg[server] = {
        label: `Server "${server}"`,
        tools: toolEntries,
      } satisfies ServerEntry;
      continue;
    }

    // Single-archetype shape: { archetype, tool_name?, ...config }
    const arch = c.archetype as string | undefined;
    if (!arch) continue;
    const factory = ARCHETYPE_FACTORIES[arch];
    if (!factory) continue;
    const toolName =
      (c.tool_name as string | undefined) ?? arch.replace(/Tool$/, '').toLowerCase();
    reg[server] = {
      label: `Server "${server}"`,
      tools: { [toolName]: bridgeArchetypeToToolFn(factory(c as ArchetypeConfig), server, toolName) },
    } satisfies ServerEntry;
  }
  return reg;
}

// ─── Walk cases/ for all pilot YAML files ─────────────────────────────────

function walkYamls(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkYamls(p, acc);
    else if (entry.endsWith('.yml')) acc.push(p);
  }
  return acc;
}

// ─── Run a single pilot through the golden ────────────────────────────────

interface CaptureResult {
  path: string;
  id?: string;
  ok: boolean;
  capture?: {
    return: unknown;
    error: unknown;
    side_effects: { tool_calls: unknown[]; vault_writes: unknown[] };
    trace_kinds: string[];
    captured_tool_calls: { server: string; tool: string }[];
  };
  capture_error?: string;
}

async function runOne(path: string): Promise<CaptureResult> {
  const text = readFileSync(path, 'utf-8');
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(text) as Record<string, unknown>;
  } catch (e) {
    return { path, ok: false, capture_error: `YAML parse: ${(e as Error).message}` };
  }
  if (!doc || !doc.macro) {
    return { path, ok: false, capture_error: 'pilot missing macro field' };
  }

  const macro = doc.macro as string;
  const inputVars = (doc.input_vars ?? {}) as Record<string, Value>;
  const vault = (doc.vault ?? {}) as Record<string, string>;
  const sb = doc.self_binding as Record<string, unknown> | undefined;
  const selfBinding: SelfBinding | undefined = sb
    ? {
        path: sb.path as string,
        frontmatter: (sb.frontmatter ?? {}) as Record<string, Value>,
        title: (sb.title ?? '') as string,
        tags: (sb.tags ?? []) as Value[],
        fq_id: (sb.fq_id ?? '') as string,
      }
    : undefined;
  const registry = buildRegistry(doc.tools);

  // Thread trace_mode / progress_mode / dry_run from the pilot YAML into the
  // golden capture so it honors them exactly as production's evaluateProgram
  // does. Without this the golden always captures a default-mode trace, so a
  // `trace_mode: none` pilot's golden snapshot keeps a trace that production
  // suppresses (surfaced as a P/G envelope divergence).
  const captureOpts: Record<string, unknown> = {};
  if (selfBinding) captureOpts.selfBinding = selfBinding;
  if (doc.trace_mode) captureOpts.traceMode = doc.trace_mode;
  if (doc.progress_mode) captureOpts.progressMode = doc.progress_mode;
  if (doc.dry_run === true) captureOpts.dryRun = true;

  try {
    const env = await captureSnapshot(
      macro,
      inputVars,
      vault,
      { registry },
      captureOpts,
    );

    type TraceStep = { kind: string };
    type ToolCallSidEffect = { server: string; tool: string };

    const trace = (env as { trace?: TraceStep[] }).trace ?? [];
    const traceKinds: string[] = Array.from(new Set(trace.map((s) => s.kind)));
    const sideTC = ((env as { side_effects?: { tool_calls?: ToolCallSidEffect[] } }).side_effects?.tool_calls ?? []) as ToolCallSidEffect[];
    const capturedToolCalls = sideTC.map((tc) => ({ server: tc.server, tool: tc.tool }));

    const e = env as {
      return?: unknown;
      error?: unknown;
      side_effects?: { tool_calls?: unknown[]; vault_writes?: unknown[] };
    };

    return {
      path,
      id: doc.id as string | undefined,
      ok: true,
      capture: {
        return: e.return ?? null,
        error: e.error ?? null,
        side_effects: {
          tool_calls: e.side_effects?.tool_calls ?? [],
          vault_writes: e.side_effects?.vault_writes ?? [],
        },
        trace_kinds: traceKinds,
        captured_tool_calls: capturedToolCalls,
      },
    };
  } catch (e) {
    return { path, ok: false, id: doc.id as string | undefined, capture_error: (e as Error).message };
  }
}

async function main() {
  const dir =
    process.argv[2] ??
    join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'cases');
  const files = walkYamls(dir);
  const results: CaptureResult[] = [];
  for (const f of files) {
    results.push(await runOne(f));
  }
  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

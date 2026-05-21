// Production-vs-Golden envelope diff.
//
// For every pilot under cases/, run BOTH production (via driveTest) and the
// golden model (via captureSnapshot), then compare the two envelopes field
// by field per the comparable-field policy documented in GOLDEN_GAPS.md
// (post-GG-011 retest section).
//
// Policy summary:
//   - ALWAYS compare end-state envelope fields that both sides emit
//     deterministically: outcome, result/return (rename-normalized),
//     error.code / .message (substring) / .details.{reason, line,
//     at_line, near_token, path, server, tool}, trace_kinds_in_order,
//     external_tool_calls, isError, needs_user_input payload (when
//     applicable), dry_run inventory (when applicable).
//   - CONDITIONALLY compare with auto-detect: if a per-trace-step `name`
//     is present on both sides, compare it. Same for args / result on
//     trace steps (when trace_mode != summary). Same for
//     side_effects.tool_calls compared against production's broker.callLog
//     (with shape normalization).
//   - SKIP golden-only state (state_notes, side_effects.vault_writes,
//     permission_decisions) and non-deterministic fields (task_id, all
//     `at` timestamps, elapsed_ms, temp-vault paths).
//
// Output: JSON list of findings to stdout; a short summary table to stderr.
//
// Usage:
//   npx tsx tests/macro-framework/scripts/pg-envelope-diff.ts > /tmp/pg-diff.json

import { loadCases, driveTest, type TestCase } from '../src/runner.ts';
import { captureSnapshot } from '../macro-golden-model/src/snapshot.ts';
import { defaultToolRegistry } from '../macro-golden-model/src/mockfq.ts';
import * as Archetypes from '../fixtures/fake-broker/archetypes.ts';
import type {
  ToolRegistry,
  ServerEntry,
  ToolFn,
  Value,
} from '../macro-golden-model/src/types.ts';
import { MacroNeedsUserInputError, type SelfBinding } from '../macro-golden-model/src/evaluator.ts';

// ─── Archetype bridge (mirrors scripts/capture-runner.ts) ────────────────

interface ArchetypeConfig {
  archetype: string;
  tool_name?: string;
  [k: string]: unknown;
}

const ARCHETYPE_FACTORIES: Record<string, (cfg: ArchetypeConfig) => Archetypes.ArchetypeHandler> = {
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
      old_schema: dp.old_schema as { name?: string; description?: string; inputSchema?: unknown } | undefined,
      new_schema: dp.new_schema as { name?: string; description?: string; inputSchema?: unknown } | undefined,
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
      behaves: (c.behaves as Archetypes.ArchetypeHandler | undefined) ?? Archetypes.ReadOnlyTool({}),
    }),
};

function bridgeArchetype(handler: Archetypes.ArchetypeHandler, server: string, tool: string): ToolFn {
  // GG-016: TOFU-drift adapter (mirrors scripts/capture-runner.ts bridge).
  // Per REQ-042/REQ-105 the broker short-circuits BEFORE dispatch when
  // pending drift exists; we mirror that by throwing
  // MacroNeedsUserInputError directly at bridge time.
  const drift = (handler as Archetypes.ArchetypeHandler & {
    __tofuDriftPayload?: Archetypes.TofuDriftMarkerPayload;
  }).__tofuDriftPayload;
  if (drift) {
    return async () => {
      throw new MacroNeedsUserInputError({
        question: drift.question,
        answer_shape: drift.answer_shape,
        event: drift.event,
        server: drift.server,
        tool: drift.tool,
        old_schema: drift.old_schema as Value,
        new_schema: drift.new_schema as Value,
        diff_summary: drift.diff_summary,
        options: drift.options as Value,
      });
    };
  }
  let callIndex = 0;
  return async (arg: Record<string, Value>) => {
    const ctx: Archetypes.ArchetypeContext = { server, tool, callIndex };
    callIndex += 1;
    const result = await handler(arg as unknown, ctx);
    return result as unknown as Value;
  };
}

function buildGoldenRegistry(toolsBlock: unknown): ToolRegistry {
  const reg: ToolRegistry = { ...defaultToolRegistry };
  if (!toolsBlock || typeof toolsBlock !== 'object') return reg;
  for (const [server, cfg] of Object.entries(toolsBlock as Record<string, unknown>)) {
    if (server === 'fq') continue;
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;
    if (c.tools && typeof c.tools === 'object' && !Array.isArray(c.tools)) {
      const toolEntries: Record<string, ToolFn> = {};
      for (const [tname, tcfg] of Object.entries(c.tools as Record<string, unknown>)) {
        if (!tcfg || typeof tcfg !== 'object') continue;
        const sc = tcfg as ArchetypeConfig;
        const factory = ARCHETYPE_FACTORIES[sc.archetype];
        if (!factory) continue;
        toolEntries[tname] = bridgeArchetype(factory(sc), server, tname);
      }
      reg[server] = { label: `Server "${server}"`, tools: toolEntries } satisfies ServerEntry;
      continue;
    }
    const arch = c.archetype as string | undefined;
    if (!arch) continue;
    const factory = ARCHETYPE_FACTORIES[arch];
    if (!factory) continue;
    const toolName = (c.tool_name as string | undefined) ?? arch.replace(/Tool$/, '').toLowerCase();
    reg[server] = {
      label: `Server "${server}"`,
      tools: { [toolName]: bridgeArchetype(factory(c as ArchetypeConfig), server, toolName) },
    } satisfies ServerEntry;
  }
  return reg;
}

// ─── Envelope normalization + comparison ──────────────────────────────────

type Outcome = 'success' | 'error' | 'parse_error' | 'needs_user_input';

interface Finding {
  pilot: string;
  field: string;
  production: unknown;
  golden: unknown;
  detail?: string;
}

function deriveProdOutcome(payload: Record<string, unknown>): Outcome {
  if (payload.reason === 'needs_user_input') return 'needs_user_input';
  if (payload.error === 'parse_error') return 'parse_error';
  if (payload.error !== undefined) return 'error';
  return 'success';
}

function deriveGoldOutcome(env: Record<string, unknown>): Outcome {
  const err = env.error as { code?: string } | null | undefined;
  if (err && err.code) {
    if (err.code === 'parse_error') return 'parse_error';
    if (err.code === 'needs_user_input') return 'needs_user_input';
    return 'error';
  }
  return 'success';
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEq(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    if (!ka.every((k, i) => k === kb[i])) return false;
    return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function arrEqAsSet(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a.map((x) => JSON.stringify(x)));
  return b.every((x) => sa.has(JSON.stringify(x)));
}

// Substring-tolerant message match: pass if either side's message contains
// the other's first ~40 chars. Production and golden often word the same
// failure differently; we want spec-level equivalence, not byte-identical.
function msgsCompatible(prodMsg: string, goldMsg: string): boolean {
  if (prodMsg === goldMsg) return true;
  if (!prodMsg || !goldMsg) return false;
  const ph = prodMsg.slice(0, 40).toLowerCase();
  const gh = goldMsg.slice(0, 40).toLowerCase();
  return goldMsg.toLowerCase().includes(ph) || prodMsg.toLowerCase().includes(gh);
}

function diffPilot(
  pilotPath: string,
  payload: Record<string, unknown>,
  brokerCallLog: Array<{ server: string; tool: string; args: unknown }>,
  golden: Record<string, unknown>,
  tc: TestCase,
): Finding[] {
  const findings: Finding[] = [];
  const push = (field: string, production: unknown, gold: unknown, detail?: string) =>
    findings.push({ pilot: pilotPath, field, production, golden: gold, ...(detail ? { detail } : {}) });

  // Outcome (always compare).
  const prodOutcome = deriveProdOutcome(payload);
  const goldOutcome = deriveGoldOutcome(golden);
  if (prodOutcome !== goldOutcome) {
    push('outcome', prodOutcome, goldOutcome);
    // When outcomes don't agree, downstream comparisons can produce noise.
    // Return the single finding and let the user re-triage from outcome up.
    return findings;
  }

  // Success-path: result vs return (rename-normalized).
  //
  // Dry-run exception: per REQ-053, the dry-run envelope's "result" is the
  // inventory (input_var_contract / tool_references / server_references),
  // not a macro return value. Production omits the `result` field
  // (undefined); golden sets it to null. Both are valid "no return value"
  // representations. Skip the result compare for dry-run; the inventory
  // fields are compared separately below.
  if (prodOutcome === 'success' && !tc.dry_run) {
    const prodResult = payload.result;
    const goldResult = golden.return;
    if (!deepEq(prodResult, goldResult)) {
      push('result', prodResult, goldResult);
    }
  }

  // Error-path fields.
  if (prodOutcome === 'error' || prodOutcome === 'parse_error') {
    const prodCode = payload.error;
    const goldErr = golden.error as { code?: string; message?: string; details?: Record<string, unknown> } | null | undefined;
    const goldCode = goldErr?.code;
    if (prodCode !== goldCode) {
      push('error.code', prodCode, goldCode);
    }
    // GG-012/013/014/015 retest (2026-05-20): suppressed error.message text
    // wording comparison. REQ-024 ac3 + REQ-018 specify the `message` field
    // as "human-readable" but DO NOT mandate exact wording. Production and
    // golden frequently word the same failure differently — both are
    // spec-compliant. The canonical compare is on `error.code` and
    // `error.details.reason`, which ARE spec-enumerated and both
    // implementations now align on (post GG-013).
    void msgsCompatible; // keep import-side compatibility
    const prodDetails = (payload.details as Record<string, unknown> | undefined) ?? {};
    const goldDetails = (goldErr?.details as Record<string, unknown> | undefined) ?? {};
    // Compare the spec-defined detail sub-fields when present on both sides.
    //
    // GG-013-rev (2026-05-20): `near_token` is intentionally EXCLUDED.
    // Per REQ-018 ac4 "near_token MUST carry the offending token's image
    // OR a short surrounding excerpt WHEN AVAILABLE." The phrase "OR a
    // short surrounding excerpt" gives implementations freedom to choose
    // the surrounding span; production and golden often define "offending
    // token" differently (e.g., for `for = 5`, production points at
    // "for" while the golden points at "=" — both are spec-compliant
    // readings of "offending token"). Comparing this field generates
    // noise without spec basis.
    for (const key of ['reason', 'line', 'at_line', 'path', 'server', 'tool']) {
      const p = prodDetails[key];
      const g = goldDetails[key];
      if (p !== undefined && g !== undefined && !deepEq(p, g)) {
        push(`error.details.${key}`, p, g);
      }
    }
    // Auto-detect: list-typed detail fields (e.g. REQ-007 missing_inputs,
    // REQ-028 unknown_servers / forbidden / allowed).
    for (const key of [
      'required_inputs',
      'optional_inputs',
      'provided_inputs',
      'missing_inputs',
      'unknown_servers',
      'unknown_tools',
      'forbidden',
      'allowed',
    ]) {
      const p = prodDetails[key];
      const g = goldDetails[key];
      if (Array.isArray(p) && Array.isArray(g) && !arrEqAsSet(p, g)) {
        push(`error.details.${key}`, p, g);
      }
    }
  }

  // needs_user_input payload (when both sides agreed on outcome).
  if (prodOutcome === 'needs_user_input') {
    const goldErr = golden.error as { details?: Record<string, unknown> } | null | undefined;
    const goldPayload = (goldErr?.details ?? {}) as Record<string, unknown>;
    for (const key of ['question', 'options', 'answer_shape', 'event', 'server', 'tool', 'diff_summary']) {
      const p = payload[key];
      const g = goldPayload[key];
      if (p !== undefined && g !== undefined && !deepEq(p, g)) {
        push(`needs_user_input.${key}`, p, g);
      }
    }
  }

  // trace_kinds_in_order (always compare when both have a trace).
  // Production's `payload` is the WIRE envelope (its `trace` is gated by
  // trace_mode). The golden's wire-equivalent is `result_envelope` — its
  // top-level `trace` is the un-gated snapshot record, so comparing that
  // against production's gated trace spuriously diverges under
  // `trace_mode: none`. Read the golden trace from `result_envelope` (its
  // absence there means the mode suppressed it); fall back to the
  // top-level `trace` only for envelopes that carry no `result_envelope`.
  const prodTrace = (payload.trace as Array<Record<string, unknown>> | undefined) ?? [];
  const goldResultEnv = golden.result_envelope as Record<string, unknown> | undefined;
  const goldTrace = (
    (goldResultEnv
      ? (goldResultEnv.trace as Array<Record<string, unknown>> | undefined)
      : (golden.trace as Array<Record<string, unknown>> | undefined)) ?? []
  );
  if (prodTrace.length > 0 || goldTrace.length > 0) {
    const prodKinds = prodTrace.map((t) => t.kind as string);
    const goldKinds = goldTrace.map((t) => t.kind as string);
    if (!deepEq(prodKinds, goldKinds)) {
      push('trace_kinds_in_order', prodKinds, goldKinds);
    } else {
      // Per-step name / args (auto-detect: compare only when BOTH sides
      // emit the field on that step).
      for (let i = 0; i < prodTrace.length; i += 1) {
        const ps = prodTrace[i];
        const gs = goldTrace[i];
        if (!gs) break;
        if (ps.name !== undefined && gs.name !== undefined && ps.name !== gs.name) {
          push(`trace[${i}].name`, ps.name, gs.name);
        }
        if (ps.args !== undefined && gs.args !== undefined && !deepEq(ps.args, gs.args)) {
          push(`trace[${i}].args`, ps.args, gs.args);
        }
        if (ps.result !== undefined && gs.result !== undefined && !deepEq(ps.result, gs.result)) {
          push(`trace[${i}].result`, ps.result, gs.result);
        }
      }
    }
  }

  // external_tool_calls count: prod emits directly, golden derives from
  // side_effects.tool_calls.length.
  const prodEtc = payload.external_tool_calls;
  const goldSideEffects = golden.side_effects as { tool_calls?: unknown[] } | undefined;
  const goldEtc = goldSideEffects?.tool_calls?.length;
  if (prodEtc !== undefined && goldEtc !== undefined && prodEtc !== goldEtc) {
    push('external_tool_calls', prodEtc, goldEtc);
  }

  // side_effects.tool_calls — compare prod broker.callLog against golden
  // side_effects.tool_calls. Normalize: strip timing fields, rename arg→args,
  // and project to {server, tool, args} for the equality check. Production's
  // broker is per-call observation; golden's is per-invocation manifest;
  // shapes converge after projection.
  const prodCalls = brokerCallLog.map((c) => ({ server: c.server, tool: c.tool, args: c.args }));
  const goldCallsRaw = (goldSideEffects?.tool_calls ?? []) as Array<Record<string, unknown>>;
  const goldCalls = goldCallsRaw.map((c) => ({ server: c.server, tool: c.tool, args: c.arg }));
  if (prodCalls.length > 0 || goldCalls.length > 0) {
    if (!deepEq(prodCalls, goldCalls)) {
      push('side_effects.tool_calls', prodCalls, goldCalls);
    }
  }

  // Dry-run inventory (when applicable).
  if (tc.dry_run) {
    const goldInv = (golden as Record<string, unknown>).dry_run_inventory as
      | { tool_references?: unknown[]; server_references?: unknown[]; input_var_contract?: unknown }
      | undefined;
    if (Array.isArray(payload.tool_references) && goldInv?.tool_references &&
        !arrEqAsSet(payload.tool_references as unknown[], goldInv.tool_references)) {
      push('dry_run.tool_references', payload.tool_references, goldInv.tool_references);
    }
    if (Array.isArray(payload.server_references) && goldInv?.server_references &&
        !arrEqAsSet(payload.server_references as unknown[], goldInv.server_references)) {
      push('dry_run.server_references', payload.server_references, goldInv.server_references);
    }
    if (payload.input_var_contract && goldInv?.input_var_contract &&
        !deepEq(payload.input_var_contract, goldInv.input_var_contract)) {
      push('dry_run.input_var_contract', payload.input_var_contract, goldInv.input_var_contract);
    }
  }

  return findings;
}

// ─── Driver ───────────────────────────────────────────────────────────────

async function main() {
  // Load every category so we cover the full corpus.
  const allCases = await loadCases();
  const allFindings: Finding[] = [];
  let okCount = 0;
  let divergent = 0;
  const skipPilots = new Set<string>([
    // Intentional self-test of the comparator's divergence-detection path.
    // Production matches expect: under match_some; comparing the golden's
    // return against production's would surface the same intentional
    // mismatch — irrelevant for the P/G compliance question.
    'mtf-e-10-intentional-mismatch',
    // GG-016 (TOFU-drift broker adapter) + GG-017 (dry-run pre-scan
    // bypass) are now resolved — those pilots go through the normal
    // P/G compare path.
    //
    // Spec ambiguity: `wc` default behavior not specified (REQ-038 ac1
    // enumerates flags but doesn't pin no-flag default). Filed as
    // spec-clarifier candidate, not a golden or production bug.
    'mtf-d-803-shell-wc-line-count',
  ]);

  for (const tc of allCases) {
    if (skipPilots.has(tc.id)) continue;

    let payload: Record<string, unknown>;
    let brokerLog: Array<{ server: string; tool: string; args: unknown }> = [];
    try {
      const drive = await driveTest(tc);
      payload = drive.payload;
      brokerLog = (drive.broker?.callLog ?? []).map((c) => ({ server: c.server, tool: c.tool, args: c.args }));
      await drive.cleanup();
    } catch (e) {
      allFindings.push({
        pilot: tc.__file ?? tc.id,
        field: '<production drive error>',
        production: (e as Error).message,
        golden: '(not run)',
      });
      divergent += 1;
      continue;
    }

    let goldenEnv: Record<string, unknown>;
    try {
      const inputVars = (tc.input_vars ?? {}) as Record<string, Value>;
      const vault = (tc.vault ?? {}) as Record<string, string>;
      const reg = buildGoldenRegistry(tc.tools);
      const sb = tc.self_binding;
      const selfBinding: SelfBinding | undefined = sb
        ? {
            path: sb.path,
            frontmatter: (sb.frontmatter ?? {}) as Record<string, Value>,
            title: sb.title,
            tags: (sb.tags ?? []) as Value[],
            fq_id: sb.fq_id,
          }
        : undefined;
      const captureOpts: Record<string, unknown> = {};
      if (selfBinding) captureOpts.selfBinding = selfBinding;
      if (tc.dry_run) captureOpts.dryRun = true; // pass dry_run through; otherwise the capture runs the macro normally and surfaces pre-scan-denial findings that don't exist in production's dry-run path
      // Thread trace_mode/progress_mode through so the golden capture honors
      // them exactly as production's evaluateProgram does — without this the
      // golden always captures a default-mode trace and a `trace_mode: none`
      // pilot spuriously diverges (golden emits a trace, production suppresses it).
      if (tc.trace_mode) captureOpts.traceMode = tc.trace_mode;
      if (tc.progress_mode) captureOpts.progressMode = tc.progress_mode;
      goldenEnv = (await captureSnapshot(tc.macro, inputVars, vault, { registry: reg }, captureOpts)) as unknown as Record<string, unknown>;
    } catch (e) {
      allFindings.push({
        pilot: tc.__file ?? tc.id,
        field: '<golden capture error>',
        production: '(succeeded)',
        golden: (e as Error).message,
      });
      divergent += 1;
      continue;
    }

    const findings = diffPilot(tc.__file ?? tc.id, payload, brokerLog, goldenEnv, tc);
    if (findings.length === 0) {
      okCount += 1;
    } else {
      divergent += 1;
      allFindings.push(...findings);
    }
  }

  process.stdout.write(JSON.stringify(allFindings, null, 2));
  process.stderr.write(`\n\nP/G envelope diff summary:\n  Pilots: ${allCases.length - skipPilots.size}\n  Clean:    ${okCount}\n  Diverges: ${divergent}\n  Findings: ${allFindings.length}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

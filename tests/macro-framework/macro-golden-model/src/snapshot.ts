// Snapshot-capture API (golden patch §5.6 + §5.6.1).
//
// `captureSnapshot()` runs a macro against the golden model and returns a
// structured envelope ready for embedding into a test YAML's
// `golden_snapshot:` field. Per §5.6.1 the envelope includes `state_notes`
// — exhaustive per-step intermediate-state events — plus the trace,
// side-effects manifest, permission decisions, and version metadata.

import { parse, ParseError, type ParseErrorDetail } from "./parser.ts";
import {
  evaluate,
  makeExecContext,
  MacroBudgetError,
  MacroCancellationError,
  MacroFailError,
  MacroForbiddenFlagError,
  MacroNeedsUserInputError,
  MacroPermissionError,
  MacroPrescanError,
  MacroPreflightError,
  MacroBuiltinPreflightError,
  MacroRuntimeError,
  ForbiddenPathError,
  type SelfBinding,
} from "./evaluator.ts";
import { builtins } from "./builtins.ts";
import { defaultToolRegistry } from "./mockfq.ts";
import type {
  BudgetCaps,
  ToolRegistry,
  TraceMode,
  ProgressMode,
  Value,
} from "./types.ts";
import { selectMacroSource, MacroExtractError } from "./extract.ts";
import { GOLDEN_VERSION } from "./version.ts";
import type { McpBroker } from "./broker.ts";
import { NullMcpBroker } from "./broker.ts";
import type {
  GoldenSnapshot,
  MacroExecutionResult,
  MacroExecutionError,
  MacroParseError,
  MacroDryRunResult,
} from "./envelope.ts";
import {
  MACRO_ERROR_CODES,
  macroResult,
  macroError,
  macroParseError,
} from "./envelope.ts";

export type ToolSurface = {
  // Static registry. Used for in-process / golden runs.
  registry?: ToolRegistry;
  // Optional broker for live `_exists` and brokered dispatch.
  broker?: McpBroker;
};

export type CaptureOptions = {
  selector?: string;
  budgetCaps?: BudgetCaps;
  traceMode?: TraceMode;
  progressMode?: ProgressMode;
  dryRun?: boolean;
  vaultRoot?: string;
  caller?: string;
  // Tier 2 (REQ-103): when supplied, bind `_self` to this snapshot. When
  // omitted the macro is treated as inline-source and `_self.*` access
  // raises a runtime error with the spec-mandated message.
  selfBinding?: SelfBinding;
};

export type SnapshotEnvelope = GoldenSnapshot;

// GG-007 (2026-05-20): `vaultState` is now materialized to a temp directory
// when non-empty. Previously the parameter was prefixed `_vaultState` (unused)
// so any pilot that exercised a shell verb (cat/ls/wc) saw an empty FS
// regardless of what the pilot YAML declared. Each capture allocates its own
// temp dir under `os.tmpdir()/fq-golden-capture-<random>/`, writes each
// declared file, sets that path as `vaultRoot`, and cleans up after capture
// completes. The caller can still pass `options.vaultRoot` to override.
export async function captureSnapshot(
  macroSource: string,
  inputVars: Record<string, Value>,
  vaultState: Record<string, string>,
  toolSurface: ToolSurface,
  options: CaptureOptions = {},
): Promise<SnapshotEnvelope> {
  const tools = toolSurface.registry ?? defaultToolRegistry;
  const broker = toolSurface.broker ?? new NullMcpBroker();
  const startedAtIso = new Date().toISOString();

  // GG-007: materialize vault state if any. The temp dir is cleaned up
  // in a `finally` block after capture completes.
  let materializedVaultRoot: string | undefined;
  if (vaultState && Object.keys(vaultState).length > 0 && !options.vaultRoot) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    materializedVaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fq-golden-capture-"));
    for (const [filePath, content] of Object.entries(vaultState)) {
      // filePath is vault-relative (leading slash means root). Strip the
      // leading slash so path.join treats it as relative to the vault root.
      const relPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
      const fullPath = path.join(materializedVaultRoot, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
  }
  const effectiveVaultRoot = options.vaultRoot ?? materializedVaultRoot;

  let source: string;
  try {
    source = selectMacroSource(macroSource, options.selector);
  } catch (e) {
    if (e instanceof MacroExtractError) {
      const exec = makeExecContext({
        macroSource: macroSource.slice(0, 200),
        budgetCaps: options.budgetCaps,
        traceMode: options.traceMode,
        progressMode: options.progressMode,
        dryRun: options.dryRun,
        broker,
        caller: options.caller,
      });
      // Pass through the extractor's details (which carry available_names,
      // unnamed_block_count, etc. per REQ-006 ac8) under the parse_error
      // envelope so consumers can read them.
      const passThrough: Record<string, Value> = { reason: e.detail.reason };
      if (e.detail.details) {
        for (const [k, v] of Object.entries(e.detail.details)) {
          passThrough[k] = v as Value;
        }
      }
      return assembleEnvelope(exec, null, startedAtIso, {
        code: "parse_error",
        message: e.message,
        details: passThrough,
      });
    }
    throw e;
  }

  // Parse to AST.
  let program;
  try {
    program = parse(source);
  } catch (e) {
    if (e instanceof ParseError) {
      const exec = makeExecContext({
        macroSource: source.slice(0, 200),
        budgetCaps: options.budgetCaps,
        traceMode: options.traceMode,
        progressMode: options.progressMode,
        dryRun: options.dryRun,
        broker,
        caller: options.caller,
      });
      const detail = e.errors[0];
      return assembleEnvelope(exec, null, startedAtIso, {
        code: "parse_error",
        message: e.message,
        details: parseErrorDetails(detail),
      });
    }
    throw e;
  }

  const exec = makeExecContext({
    macroSource: source.slice(0, 200),
    budgetCaps: options.budgetCaps,
    traceMode: options.traceMode,
    progressMode: options.progressMode,
    dryRun: options.dryRun,
    broker,
    caller: options.caller,
  });

  let returnValue: Value | null = null;
  let errorInfo: SnapshotEnvelope["error"] = undefined;

  try {
    returnValue = await evaluate(program, {
      builtins,
      tools,
      inputVars,
      vaultRoot: effectiveVaultRoot, // GG-007: materialized vault dir or caller override
      exec,
      log: () => undefined, // capture mode: silent
      selfBinding: options.selfBinding,
    });
    exec.taskRegistry.complete(exec.taskId, returnValue);
  } catch (e) {
    const info = classifyError(e);
    exec.taskRegistry.fail(exec.taskId, { kind: info.code, message: info.message });
    errorInfo = info;
  } finally {
    // GG-007: clean up the temp vault dir we created.
    if (materializedVaultRoot) {
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(materializedVaultRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; OS tmpdir GC handles the rest.
      }
    }
  }

  return assembleEnvelope(exec, returnValue, startedAtIso, errorInfo);
}

function parseErrorDetails(detail: ParseErrorDetail | undefined): Record<string, Value> {
  if (!detail) return {};
  return {
    reason: detail.reason,
    at_line: detail.at_line,
    near_token: (detail.near_token ?? null) as Value,
  };
}

function classifyError(e: unknown): { code: keyof typeof MACRO_ERROR_CODES; message: string; details?: Record<string, Value> } {
  if (e instanceof ParseError) {
    const d = e.errors[0];
    return { code: "parse_error", message: e.message, details: parseErrorDetails(d) };
  }
  if (e instanceof MacroPreflightError) {
    return {
      code: "invalid_input",
      message: e.message,
      details: {
        required_inputs: e.details.required_inputs,
        optional_inputs: e.details.optional_inputs,
        provided_inputs: e.details.provided_inputs,
        missing_inputs: e.details.missing_inputs,
        ...(e.details.reason ? { reason: e.details.reason as Value } : {}),
        ...(e.details.key ? { key: e.details.key as Value } : {}),
        ...(e.details.default_kind ? { default_kind: e.details.default_kind as Value } : {}),
        // GG-008: propagate arg_kind + line for input_var_key_must_be_literal.
        ...(e.details.arg_kind ? { arg_kind: e.details.arg_kind as Value } : {}),
        ...(e.details.line !== undefined ? { line: e.details.line as Value } : {}),
      },
    };
  }
  if (e instanceof MacroBuiltinPreflightError) {
    // §14.3.0 — statically-visible data-builtin fault. Surfaces as
    // `invalid_input` with a lean `{ reason, line }` details block, matching
    // production's generic `MacroPreflightError('invalid_input', …)` envelope.
    return {
      code: "invalid_input",
      message: e.message,
      details: {
        reason: e.reason,
        ...(e.line !== undefined ? { line: e.line as Value } : {}),
      },
    };
  }
  if (e instanceof MacroFailError) {
    // REQ-024 ac5 / REQ-054: brokered-tool failures use the dedicated
    // `tool_call_failed` code; author-initiated `fail()` calls use
    // `macro_aborted`. The discriminator is `MacroFailError.brokered`.
    const code: keyof typeof MACRO_ERROR_CODES = e.brokered ? "tool_call_failed" : "macro_aborted";
    return { code, message: e.message, details: { line: (e.line ?? null) as Value } };
  }
  if (e instanceof MacroNeedsUserInputError) {
    // Tier 2 / REQ-105: fifth termination class. The snapshot envelope's
    // `error` block uses code `needs_user_input` so testgen-generated tests
    // recognize this as a normal control-flow exit (not a runtime failure).
    const detailsCopy: Record<string, Value> = {};
    for (const [k, v] of Object.entries(e.payload)) {
      if (v !== undefined) detailsCopy[k] = v as Value;
    }
    return {
      code: "needs_user_input",
      message: e.message,
      details: detailsCopy,
    };
  }
  if (e instanceof MacroPrescanError) {
    return {
      code: e.code,
      message: e.message,
      details: {
        unknown_servers: e.details.unknown_servers,
        unknown_tools: e.details.unknown_tools,
        forbidden: e.details.forbidden,
        allowed: e.details.allowed,
      },
    };
  }
  if (e instanceof ForbiddenPathError) {
    return { code: "forbidden_path", message: e.message, details: { macro_path: e.macroPath, reason: e.reason } };
  }
  if (e instanceof MacroForbiddenFlagError) {
    return { code: "forbidden_shell_flag", message: e.message, details: { verb: e.verb, flag: e.flag, reason: e.reason } };
  }
  if (e instanceof MacroCancellationError) {
    return { code: "cancelled", message: e.message, details: { at_safe_point: (e.at_safe_point ?? null) as Value } };
  }
  if (e instanceof MacroPermissionError) {
    return { code: "permission_denied", message: e.message, details: { tool: e.tool, reason: e.reason } };
  }
  if (e instanceof MacroBudgetError) {
    // REQ-054 / REQ-060 ac1: timeout has its own top-level code.
    const code: keyof typeof MACRO_ERROR_CODES = e.kind === "timeout_ms" ? "timeout" : "budget_exceeded";
    const details: Record<string, Value> =
      e.kind === "timeout_ms"
        ? { timeout_ms: e.cap, elapsed_ms: e.actual }
        : { kind: e.kind, cap: e.cap, actual: e.actual };
    return { code, message: e.message, details };
  }
  if (e instanceof MacroRuntimeError) {
    // GG-005 (2026-05-20): per REQ-054 / `MACRO_ERROR_CODES`, the canonical
    // envelope code for unexpected runtime errors is `tool_call_failed`. The
    // golden previously emitted an out-of-list `runtime_error` here; that
    // code was not in the spec's REQ-054 enumeration. Production has always
    // used `tool_call_failed` (src/macro/evaluator.ts:448-457), so the golden
    // and production are now structurally identical at this envelope boundary.
    // The exception class itself is unchanged; only the wire-format string is.
    //
    // GG-018 (2026-05-20): propagate `e.details` (the runtime error's
    // sub-discriminator — e.g. shell `path_not_found`) so the envelope's
    // `details.reason` matches production. `line` is merged in unless the
    // details already carry one.
    return {
      code: "tool_call_failed",
      message: e.message,
      details: {
        ...(e.details ?? {}),
        ...(e.line !== undefined && !(e.details && "line" in e.details)
          ? { line: e.line as Value }
          : {}),
      },
    };
  }
  const ee = e as Error;
  // GG-005: catch-all for unrecognized errors also maps to `tool_call_failed`,
  // matching production's catch-all at evaluator.ts:458-463.
  return { code: "tool_call_failed", message: String(ee?.message ?? e) };
}

function assembleEnvelope(
  exec: import("./types.ts").ExecContext,
  returnValue: Value | null,
  _startedAtIso: string,
  errorInfo: SnapshotEnvelope["error"],
): SnapshotEnvelope {
  // `taskRegistry.get()` reads from both active and terminal snapshot
  // maps, so this works regardless of whether the run has reached a
  // terminal state already (REQ-049 ac3 keeps a post-mortem copy).
  const task = exec.taskRegistry.get(exec.taskId);
  const trace = task ? [...task.trace] : [];

  // REQ-052/053/054: assemble the spec-shape engine envelope embedded
  // alongside the golden-only snapshot fields.
  let result_envelope: MacroExecutionResult | MacroExecutionError | MacroParseError | MacroDryRunResult;
  if (errorInfo) {
    if (errorInfo.code === "parse_error") {
      // REQ-053 parse-failure: parsed_ok: false discriminator.
      const details = (errorInfo.details ?? {}) as Record<string, Value | undefined>;
      const parseDetails: { reason: string; at_line?: number; near_token?: string | null; [k: string]: Value | undefined } = {
        ...details,
        reason: typeof details.reason === "string" ? details.reason : "parse_error",
      };
      if (typeof details.at_line === "number") parseDetails.at_line = details.at_line;
      if (typeof details.near_token === "string") parseDetails.near_token = details.near_token;
      else if (details.near_token === null) parseDetails.near_token = null;
      result_envelope = macroParseError(errorInfo.message, parseDetails);
    } else {
      // REQ-052 error envelope: parsed_ok: true, error+message present.
      result_envelope = macroError(exec.taskId, errorInfo.code, errorInfo.message, {
        details: errorInfo.details,
        trace: exec.traceMode === "none" ? undefined : trace,
        warnings: exec.warnings.length > 0 ? [...exec.warnings] : undefined,
      });
    }
  } else if (exec.dryRun) {
    // REQ-053 dry-run envelope: includes the static inventory.
    result_envelope = {
      parsed_ok: true,
      task_id: exec.taskId,
      result: null,
      input_var_contract: exec.dryRunInventory?.input_var_contract ?? { required: [], optional: [] },
      tool_references: exec.dryRunInventory?.tool_references ?? [],
      server_references: exec.dryRunInventory?.server_references ?? [],
      ...(exec.traceMode === "none" ? {} : { trace }),
      ...(exec.warnings.length > 0 ? { warnings: [...exec.warnings] } : {}),
    };
  } else {
    // REQ-052 success envelope.
    result_envelope = macroResult(exec.taskId, returnValue, {
      trace: exec.traceMode === "none" ? undefined : trace,
      warnings: exec.warnings.length > 0 ? [...exec.warnings] : undefined,
      token_total: exec.budgetCounters.tokens > 0 ? exec.budgetCounters.tokens : undefined,
      model_calls: exec.budgetCounters.model_calls > 0 ? exec.budgetCounters.model_calls : undefined,
      external_tool_calls:
        exec.budgetCounters.external_tool_calls > 0 ? exec.budgetCounters.external_tool_calls : undefined,
      elapsed_ms: Date.now() - exec.budgetCounters.started_at,
    });
  }

  return {
    return: returnValue,
    trace,
    side_effects: {
      vault_writes: [...exec.sideEffects.vault_writes],
      tool_calls: [...exec.sideEffects.tool_calls],
    },
    state_notes: [...exec.stateNotes],
    permission_decisions: [...exec.permissionDecisions],
    warnings: [...exec.warnings],
    golden_version: GOLDEN_VERSION,
    golden_run_at: new Date().toISOString(),
    result_envelope,
    error: errorInfo,
  };
}

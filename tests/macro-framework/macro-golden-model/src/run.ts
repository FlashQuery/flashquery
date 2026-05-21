// CLI runner — parse and execute a macro file from disk.
//
// Golden patch item 2 (REQ-024): stderr text emissions replaced with JSON
// envelopes (`macro_aborted`, `forbidden_path`, `forbidden_shell_flag`,
// `cancelled`, `invalid_input`, `unknown_server`, `unknown_tool`).
//
// Golden patch item 16 (REQ-005/006): supports `<file>::<name>` selector
// for documents containing multiple `fqm` fenced blocks.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, ParseError } from "./parser.ts";
import {
  evaluate,
  makeExecContext,
  MacroRuntimeError,
  MacroCancellationError,
  MacroFailError,
  MacroNeedsUserInputError,
  MacroPreflightError,
  ForbiddenPathError,
  MacroForbiddenFlagError,
  MacroPermissionError,
  MacroPrescanError,
  MacroBudgetError,
  type SelfBinding,
} from "./evaluator.ts";
import { builtins } from "./builtins.ts";
import { defaultToolRegistry } from "./mockfq.ts";
import { selectMacroSource, MacroExtractError } from "./extract.ts";
import type { ProgressMode, Value } from "./types.ts";

// ----- Argument parsing -----

const argv = process.argv.slice(2);
if (argv.length < 1) {
  console.error("Usage: tsx src/run.ts <macro-file>[::name] [--input-vars '<JSON>'] [--progress-mode full|milestones|silent]");
  process.exit(2);
}

let filePath: string | undefined;
let inputVars: Record<string, Value> | undefined;
let vaultRoot: string | undefined;
// --without-server <name> simulates a registered-but-disconnected broker:
// the named server is removed from the registry passed to the engine, so
// `<server>._exists()` falls through to the broker probe (NullMcpBroker
// returns false). Used by example 11 to demonstrate REQ-045 ac3+ac6:
// `_exists() = false` for a brokered server with no live broker.
const withoutServers = new Set<string>();
// Tier 2 (REQ-103): --self-binding <path> loads a sidecar JSON file
// describing the macro's source document and binds `_self` accordingly.
// Without this flag, the macro is treated as "loaded via inline source"
// and any `_self.*` access raises a runtime error.
let selfBinding: SelfBinding | undefined;
// REQ-048: --progress-mode {full|milestones|silent} controls auto-progress
// and `status` builtin emissions. Defaults to "full" when omitted.
let progressMode: ProgressMode | undefined;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--input-vars") {
    const json = argv[i + 1];
    if (!json) {
      console.error("--input-vars requires a JSON argument");
      process.exit(2);
    }
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.error("--input-vars must be a JSON object");
        process.exit(2);
      }
      inputVars = parsed as Record<string, Value>;
    } catch (e) {
      console.error(`--input-vars JSON parse error: ${(e as Error).message}`);
      process.exit(2);
    }
    i++;
  } else if (arg.startsWith("--input-vars=")) {
    const json = arg.slice("--input-vars=".length);
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.error("--input-vars must be a JSON object");
        process.exit(2);
      }
      inputVars = parsed as Record<string, Value>;
    } catch (e) {
      console.error(`--input-vars JSON parse error: ${(e as Error).message}`);
      process.exit(2);
    }
  } else if (arg === "--vault-root") {
    const v = argv[i + 1];
    if (!v) {
      console.error("--vault-root requires a path argument");
      process.exit(2);
    }
    vaultRoot = resolve(v);
    i++;
  } else if (arg.startsWith("--vault-root=")) {
    vaultRoot = resolve(arg.slice("--vault-root=".length));
  } else if (arg === "--without-server") {
    const name = argv[i + 1];
    if (!name) {
      console.error("--without-server requires a server name argument");
      process.exit(2);
    }
    withoutServers.add(name);
    i++;
  } else if (arg.startsWith("--without-server=")) {
    withoutServers.add(arg.slice("--without-server=".length));
  } else if (arg === "--progress-mode" || arg.startsWith("--progress-mode=")) {
    // REQ-048: control progress-event emission.
    let v: string;
    if (arg === "--progress-mode") {
      v = argv[++i] ?? "";
    } else {
      v = arg.slice("--progress-mode=".length);
    }
    if (v !== "full" && v !== "milestones" && v !== "silent") {
      console.error(`--progress-mode must be one of: full, milestones, silent (got "${v}")`);
      process.exit(2);
    }
    progressMode = v as ProgressMode;
  } else if (arg === "--self-binding" || arg.startsWith("--self-binding=")) {
    // Tier 2 (REQ-103): load `_self` sidecar JSON.
    let sidecarPath: string;
    if (arg === "--self-binding") {
      sidecarPath = argv[++i] ?? "";
    } else {
      sidecarPath = arg.slice("--self-binding=".length);
    }
    if (!sidecarPath) {
      console.error("--self-binding requires a JSON file path");
      process.exit(2);
    }
    try {
      const raw = readFileSync(resolve(sidecarPath), "utf8");
      const parsed = JSON.parse(raw) as Partial<SelfBinding>;
      if (
        typeof parsed.path !== "string" ||
        typeof parsed.title !== "string" ||
        typeof parsed.fq_id !== "string" ||
        typeof parsed.frontmatter !== "object" ||
        parsed.frontmatter === null ||
        Array.isArray(parsed.frontmatter) ||
        !Array.isArray(parsed.tags)
      ) {
        console.error("--self-binding JSON must have { path, title, fq_id, frontmatter: object, tags: array }");
        process.exit(2);
      }
      selfBinding = {
        path: parsed.path,
        title: parsed.title,
        fq_id: parsed.fq_id,
        frontmatter: parsed.frontmatter as Record<string, Value>,
        tags: parsed.tags as Value[],
      };
    } catch (e) {
      console.error(`--self-binding load error: ${(e as Error).message}`);
      process.exit(2);
    }
  } else if (!filePath) {
    filePath = arg; // selector handling below
  } else {
    console.error(`Unexpected argument: ${arg}`);
    process.exit(2);
  }
}

if (!vaultRoot) {
  const here = dirname(fileURLToPath(import.meta.url));
  vaultRoot = resolve(here, "..", "sample-vault");
}

if (!filePath) {
  console.error("Usage: tsx src/run.ts <macro-file>[::name] [--input-vars '<JSON>'] [--progress-mode full|milestones|silent]");
  process.exit(2);
}

// Optional `path::selector` form.
let selector: string | undefined;
let actualPath = filePath;
const sepIdx = filePath.lastIndexOf("::");
if (sepIdx > 0) {
  actualPath = filePath.slice(0, sepIdx);
  selector = filePath.slice(sepIdx + 2);
}
actualPath = resolve(actualPath);

let rawSource: string;
try {
  rawSource = readFileSync(actualPath, "utf8");
} catch (e) {
  console.error(`Could not read file: ${actualPath}`);
  console.error(String((e as Error).message ?? e));
  process.exit(2);
}

// Select macro from fenced blocks if applicable.
let source: string;
try {
  source = selectMacroSource(rawSource, selector);
} catch (e) {
  if (e instanceof MacroExtractError) {
    console.error("PARSE ERROR:");
    console.error(JSON.stringify({ error: "parse_error", reason: e.detail.reason, message: e.message, details: e.detail.details ?? {} }, null, 2));
    process.exit(1);
  }
  throw e;
}

const exec = makeExecContext({ macroSource: source, progressMode });

// Apply --without-server filters to the registry. The named servers are
// dropped so their `_exists()` calls fall through to the broker probe.
const effectiveRegistry = withoutServers.size > 0
  ? Object.fromEntries(
      Object.entries(defaultToolRegistry).filter(([k]) => !withoutServers.has(k)),
    )
  : defaultToolRegistry;

async function main() {
  try {
    const program = parse(source);
    const result = await evaluate(program, {
      builtins,
      tools: effectiveRegistry,
      inputVars,
      vaultRoot,
      exec,
      selfBinding,
    });
    exec.taskRegistry.complete(exec.taskId, null);
    if (result !== null) {
      console.log("\n--- macro result ---");
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    if (e instanceof MacroCancellationError) {
      const envelope = {
        error: "cancelled",
        message: e.message,
        details: { task_id: exec.taskId, at_safe_point: e.at_safe_point ?? null },
      };
      console.error("CANCELLED:");
      console.error(JSON.stringify(envelope, null, 2));
      exec.taskRegistry.clearCurrentTask();
      process.exit(130);
    }
    exec.taskRegistry.fail(exec.taskId, {
      kind: (e as Error).constructor?.name ?? "Error",
      message: String((e as Error).message ?? e),
    });
    exec.taskRegistry.clearCurrentTask();

    if (e instanceof ParseError) {
      const detail = e.errors[0];
      const envelope = {
        error: "parse_error",
        message: e.message,
        details: detail ? { reason: detail.reason, at_line: detail.at_line, near_token: detail.near_token ?? null } : {},
      };
      console.error("PARSE ERROR:");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroPreflightError) {
      const envelope = {
        error: "invalid_input",
        message: e.message,
        details: e.details,
      };
      console.error("INVALID INPUT (pre-flight):");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof ForbiddenPathError) {
      const envelope = {
        error: "forbidden_path",
        message: e.message,
        details: { macro_path: e.macroPath, reason: e.reason },
      };
      console.error("FORBIDDEN PATH:");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroForbiddenFlagError) {
      const envelope = {
        error: "forbidden_shell_flag",
        message: e.message,
        details: { verb: e.verb, flag: e.flag, reason: e.reason },
      };
      console.error("FORBIDDEN SHELL FLAG:");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroFailError) {
      // REQ-054: brokered failures use `tool_call_failed`; author-initiated
      // `fail()` uses `macro_aborted`.
      const errorCode = e.brokered ? "tool_call_failed" : "macro_aborted";
      const envelope = {
        error: errorCode,
        message: e.message,
        details: { line: e.line ?? null },
      };
      console.error(e.brokered ? "TOOL CALL FAILED:" : "MACRO ABORTED (fail):");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroNeedsUserInputError) {
      // Tier 2 / REQ-105: fifth termination — render the canonical envelope.
      // Exit code 0 because needs_user_input is a normal control-flow exit
      // (the host will re-invoke the macro after collecting the answer);
      // it isn't an error in the operational sense.
      const envelope = {
        error: "needs_user_input",
        message: e.message,
        details: { ...e.payload },
      };
      console.error("NEEDS USER INPUT:");
      console.error(JSON.stringify(envelope, null, 2));
      exec.taskRegistry.clearCurrentTask();
      process.exit(0);
    } else if (e instanceof MacroPrescanError) {
      // REQ-028 ac4: one envelope listing every pre-scan violation.
      const envelope = {
        error: e.code,
        message: e.message,
        details: e.details,
      };
      const label =
        e.code === "unknown_server" ? "UNKNOWN SERVER (pre-scan):" :
        e.code === "unknown_tool" ? "UNKNOWN TOOL (pre-scan):" :
        e.code === "template_masquerade_tools_not_callable_from_macro" ? "TEMPLATE MASQUERADE TOOLS (pre-scan):" :
        "FORBIDDEN TOOLS (pre-scan):";
      console.error(label);
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroPermissionError) {
      const envelope = {
        error: "permission_denied",
        message: e.message,
        details: { tool: e.tool, reason: e.reason },
      };
      console.error("PERMISSION DENIED:");
      console.error(JSON.stringify(envelope, null, 2));
    } else if (e instanceof MacroBudgetError) {
      // REQ-054 / REQ-060 ac1: timeout uses its own top-level code.
      if (e.kind === "timeout_ms") {
        const envelope = {
          error: "timeout",
          message: e.message,
          details: { timeout_ms: e.cap, elapsed_ms: e.actual },
        };
        console.error("TIMEOUT:");
        console.error(JSON.stringify(envelope, null, 2));
      } else {
        const envelope = {
          error: "budget_exceeded",
          message: e.message,
          details: { kind: e.kind, cap: e.cap, actual: e.actual },
        };
        console.error("BUDGET EXCEEDED:");
        console.error(JSON.stringify(envelope, null, 2));
      }
    } else if (e instanceof MacroRuntimeError) {
      console.error("RUNTIME ERROR:");
      // GG-005: unexpected runtime errors use the canonical `tool_call_failed`
      // envelope code per REQ-054 / `MACRO_ERROR_CODES`. The class name is
      // `MacroRuntimeError` because the failure happens at runtime; the
      // ENVELOPE code is `tool_call_failed` because that's the spec's
      // catch-all for the XC-5 unexpected path.
      // GG-019: propagate `e.details` (the runtime error's sub-discriminator,
      // e.g. shell `reason: head_line_count_type`) and merge `line` the same
      // way snapshot.ts does, so the CLI rendering matches the captured
      // envelope instead of dropping `details.reason`.
      console.error(JSON.stringify({
        error: "tool_call_failed",
        message: e.message,
        details: {
          ...(e.details ?? {}),
          ...(e.line !== undefined && !(e.details && "line" in e.details)
            ? { line: e.line }
            : {}),
        },
      }, null, 2));
    } else {
      console.error("UNEXPECTED ERROR:");
      console.error(e);
    }
    process.exit(1);
  }
  exec.taskRegistry.clearCurrentTask();
}

main();

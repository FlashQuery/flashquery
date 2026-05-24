import { macroResult, withWarnings, type ToolResult, type WarningCode } from '../mcp/utils/response-formats.js';
import { preScanForbiddenShellFlags } from './forbidden-flag-scan.js';
import { collectToolReferences, preScanToolReferences } from './permission-prescan.js';
import { collectInputVarContract, preflightProgram, validateInputVars } from './preflight.js';
import type { MacroValue } from './runtime-types.js';
import type { Program, ToolRegistry, MacroCallerContext } from './types.js';

export interface RunDryRunOptions {
  program: Program;
  inputVars: Record<string, MacroValue>;
  taskId: string;
  registry: ToolRegistry;
  allowlist: ReadonlySet<string>;
  templateToolNames?: ReadonlySet<string> | readonly string[];
  hardExcludedReasons?: ReadonlyMap<string, string>;
  callerContext?: MacroCallerContext;
  warnings: WarningCode[];
}

export function runDryRun(options: RunDryRunOptions): ToolResult {
  preScanForbiddenShellFlags(options.program);
  preflightProgram(options.program);
  const contract = collectInputVarContract(options.program);
  validateInputVars(contract, options.inputVars);
  const permissionError = preScanToolReferences({
    program: options.program,
    registry: options.registry,
    allowlist: options.allowlist,
    ...(options.templateToolNames === undefined ? {} : { templateToolNames: options.templateToolNames }),
    ...(options.hardExcludedReasons === undefined ? {} : { hardExcludedReasons: options.hardExcludedReasons }),
    ...(options.callerContext === undefined ? {} : { callerContext: options.callerContext }),
  });
  if (permissionError) return permissionError;

  const toolReferences = [...new Set(collectToolReferences(options.program).map((ref) => `${ref.server}.${ref.tool}`))].sort();
  const serverReferences = [...new Set(toolReferences.map((ref) => ref.split('.')[0]).filter(Boolean))].sort();
  const optional = Object.entries(contract.optional)
    .map(([key, value]) => ({ key, default: value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return macroResult(withWarnings({
    task_id: options.taskId,
    parsed_ok: true,
    input_var_contract: { required: [...contract.required].sort(), optional },
    tool_references: toolReferences,
    server_references: serverReferences,
  }, options.warnings));
}

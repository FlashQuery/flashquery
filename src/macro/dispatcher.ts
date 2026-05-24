import { jsonExpectedError, type ToolResult } from '../mcp/utils/response-formats.js';
import type { MacroInvocationContext, MacroValue } from './runtime-types.js';
import type { ToolRegistry } from './types.js';

export interface DispatchMacroToolOptions {
  registry: ToolRegistry;
  allowlist: ReadonlySet<string>;
  server: string;
  tool: string;
  arg: Record<string, MacroValue>;
  context: MacroInvocationContext;
}

export async function dispatchMacroTool(options: DispatchMacroToolOptions): Promise<MacroValue | ToolResult> {
  const serverEntry = options.registry[options.server];
  if (!serverEntry) {
    return jsonExpectedError({
      error: 'unknown_server',
      message: `Unknown tool server '${options.server}'.`,
      details: { server: options.server },
    });
  }

  const toolFn = serverEntry.tools[options.tool];
  if (!toolFn) {
    return jsonExpectedError({
      error: 'unknown_tool',
      message: `Unknown tool '${options.server}.${options.tool}'.`,
      details: {
        server: options.server,
        tool: options.tool,
        available: Object.keys(serverEntry.tools).sort(),
      },
    });
  }

  const toolReference = `${options.server}.${options.tool}`;
  if (!options.allowlist.has(toolReference)) {
    return jsonExpectedError({
      error: 'forbidden_tools',
      message: `Tool '${toolReference}' is not allowed for this macro invocation.`,
      details: {
        forbidden: [toolReference],
        allowed: [...options.allowlist].sort(),
      },
    });
  }

  return await toolFn(options.arg, options.context);
}

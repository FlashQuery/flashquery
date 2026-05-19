import { expect } from 'vitest';
import { parseMacroSource } from '../../src/macro/parser.js';
import type { MacroBuiltin, MacroValue } from '../../src/macro/evaluator.js';
import type { Program, ToolRegistry } from '../../src/macro/types.js';
import type { ToolResult } from '../../src/mcp/utils/response-formats.js';

export function parseProgram(source: string): Program {
  const result = parseMacroSource(source.trim());
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.program;
}

export function parseToolPayload(result: ToolResult): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}

export function basicBuiltins(extra: Record<string, MacroBuiltin> = {}): Record<string, MacroBuiltin> {
  const adaptedExtra = Object.fromEntries(
    Object.entries(extra).map(([name, builtin]) => [
      name,
      ((positional, named, context) =>
        builtin.length < 3
          ? (builtin as unknown as (args: MacroValue[], context: unknown) => MacroValue | Promise<MacroValue>)(
              positional,
              context
            )
          : builtin(positional, named, context)) satisfies MacroBuiltin,
    ])
  ) as Record<string, MacroBuiltin>;
  const builtins: Record<string, MacroBuiltin> = {
    add: (positional) => Number(positional[0] ?? 0) + Number(positional[1] ?? 0),
    echo: (positional) => positional[0] ?? null,
    exit: (positional) => positional[0] ?? null,
    ...adaptedExtra,
  };
  return builtins;
}

export function resultOf(payload: Record<string, unknown>): MacroValue {
  return payload['result'] as MacroValue;
}

export function dispatchRegistry(toolRefs: string[]): {
  toolRegistry: ToolRegistry;
  allowedToolNames: string[];
} {
  const registry: ToolRegistry = {};
  for (const ref of toolRefs) {
    const [server, tool] = ref.split('.');
    if (!server || !tool) throw new Error(`Invalid tool reference '${ref}'`);
    registry[server] ??= { label: server, tools: {} };
    registry[server].tools[tool] = async (arg, context) => {
      if (!context.dispatchTool) {
        throw new Error(`No dispatchTool configured for '${ref}'`);
      }
      const result = await context.dispatchTool(server, tool, arg, context);
      const text = result.content[0]?.text ?? '';
      try {
        return JSON.parse(text) as MacroValue;
      } catch {
        return text;
      }
    };
  }
  return {
    toolRegistry: registry,
    allowedToolNames: toolRefs,
  };
}

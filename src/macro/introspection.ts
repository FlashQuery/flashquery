import type { McpBroker } from '../services/mcp-broker.js';
import { MacroRuntimeError } from './evaluator.js';

export async function resolveNamespaceIntrospection(
  server: string,
  method: string,
  broker: McpBroker,
  context: { line?: number }
): Promise<boolean> {
  if (method !== '_exists') {
    throw new MacroRuntimeError('Unsupported namespace introspection method.', context.line, {
      reason: 'unsupported_introspection_method',
      server,
      method,
    });
  }

  if (server === 'fq') {
    return true;
  }

  return broker.isConnected(server);
}

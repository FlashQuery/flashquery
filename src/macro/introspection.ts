import type { McpBroker } from '../services/mcp-broker.js';
import { MacroRuntimeError } from './runtime-errors.js';

export const BROKER_EXISTS_DEEP_PROBE_TIMEOUT_MS = 250;

export async function resolveNamespaceIntrospection(
  server: string,
  method: string,
  broker: McpBroker,
  context: { line?: number; probeTimeoutMs?: number }
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

  return brokerIsConnectedWithTimeout(broker, server, BROKER_EXISTS_DEEP_PROBE_TIMEOUT_MS);
}

async function brokerIsConnectedWithTimeout(
  broker: McpBroker,
  server: string,
  timeoutMs: number
): Promise<boolean> {
  if (timeoutMs <= 0) {
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      broker.isConnected(server, { deepProbe: true, timeoutMs }),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

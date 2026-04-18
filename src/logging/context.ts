import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RequestContext {
  correlationId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AsyncLocalStorage instance
// ─────────────────────────────────────────────────────────────────────────────

const requestContext = new AsyncLocalStorage<RequestContext>();

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an 8-character correlation ID from a random UUID.
 * Uses first 8 chars of UUID (hex only, no dashes).
 */
export function generateCorrelationId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Retrieve the current correlation ID from the active async context.
 * Returns undefined if called outside of an initialized context.
 */
export function getCurrentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}

/**
 * Run a callback within an async context that carries the given correlation ID.
 * This context propagates through all async operations (await, Promise, setTimeout, etc.)
 * spawned within the callback.
 *
 * Usage (MCP server handler wrapping):
 *   await initializeContext(cid, () => handler(request));
 */
export function initializeContext<T>(
  correlationId: string,
  callback: () => Promise<T>
): Promise<T> {
  return requestContext.run({ correlationId }, callback);
}

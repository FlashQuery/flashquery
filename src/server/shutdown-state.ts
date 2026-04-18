/**
 * Global shutdown state module
 *
 * Provides a cross-module shutdown flag that prevents new requests
 * from starting during graceful shutdown sequence.
 *
 * This is read by:
 * - ShutdownCoordinator (to set the flag)
 * - All MCP tool handlers (to check and reject requests)
 * - Background scanner (to check and exit early)
 */

let isShuttingDown = false;

export function setShuttingDown(value: boolean): void {
  isShuttingDown = value;
}

export function getIsShuttingDown(): boolean {
  return isShuttingDown;
}

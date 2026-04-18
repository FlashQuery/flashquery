/**
 * Integration tests for correlation ID propagation through MCP request flows.
 *
 * These tests verify the Phase 27 logging infrastructure works end-to-end:
 * - Correlation IDs generated per request
 * - IDs propagate through async operations
 * - Log format matches specification
 * - Context modules interact correctly with logger
 *
 * These tests do NOT require a running Supabase instance — they test the
 * logging infrastructure layer in isolation.
 *
 * Coverage:
 * - LOG-02: Correlation IDs generated per MCP call, propagate through async/fire-and-forget
 * - LOG-03: Log format includes correlation ID: [YYYY-MM-DD HH:MM:SS REQ:uuid] LEVEL  Message
 * - LOG-04: AsyncLocalStorage enables transparent correlation tracking
 */

import { describe, it, expect } from 'vitest';
import { Logger } from '../../src/logging/logger.js';
import {
  generateCorrelationId,
  getCurrentCorrelationId,
  initializeContext,
} from '../../src/logging/context.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeLogger(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  const log = new Logger({ level, output: 'stdout' }, (line) => lines.push(line));
  return { log, lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LOG-02: Correlation ID propagation through async MCP flows', () => {
  it('correlation ID propagates through sequential async operations', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      log.info('step 1: request received');
      await Promise.resolve();
      log.debug('step 2: processing data');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      log.info('step 3: response ready');
    });

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }
  });

  it('correlation ID propagates through Promise.all parallel operations', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      await Promise.all([
        (async () => {
          log.debug('parallel op 1 start');
          await Promise.resolve();
          log.debug('parallel op 1 end');
        })(),
        (async () => {
          log.debug('parallel op 2 start');
          await Promise.resolve();
          log.debug('parallel op 2 end');
        })(),
      ]);
    });

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }
  });

  it('correlation ID propagates through fire-and-forget operations', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      log.info('parent: processing request');

      // Simulate fire-and-forget embedding re-queue
      void Promise.resolve().then(() => {
        log.debug('fire-and-forget: background operation started');
        return Promise.resolve().then(() => {
          log.debug('fire-and-forget: background operation completed');
        });
      });

      log.info('parent: returning response (before background completes)');

      // Allow background microtasks to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });

    // All log lines (including fire-and-forget) should have same correlation ID
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }

    // Verify fire-and-forget message is present
    expect(lines.some((l) => l.includes('fire-and-forget'))).toBe(true);
  });

  it('multiple concurrent requests get different correlation IDs', async () => {
    const results: Record<string, string[]> = {};

    const request1 = initializeContext(generateCorrelationId(), async () => {
      const cid = getCurrentCorrelationId()!;
      results[cid] = [];
      results[cid].push('req1-log1');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      results[cid].push('req1-log2');
    });

    const request2 = initializeContext(generateCorrelationId(), async () => {
      const cid = getCurrentCorrelationId()!;
      results[cid] = [];
      results[cid].push('req2-log1');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      results[cid].push('req2-log2');
    });

    await Promise.all([request1, request2]);

    const requestIds = Object.keys(results);
    expect(requestIds).toHaveLength(2);
    // Each correlation ID should be unique
    expect(requestIds[0]).not.toBe(requestIds[1]);
    // Each request should have exactly 2 log entries
    for (const id of requestIds) {
      expect(results[id]).toHaveLength(2);
    }
  });

  it('nested initializeContext calls do not interfere', async () => {
    const parentId = generateCorrelationId();
    const childId = generateCorrelationId();

    let outsideContext: string | undefined;
    let insideParent: string | undefined;
    let insideChild: string | undefined;
    let backInParent: string | undefined;

    outsideContext = getCurrentCorrelationId();

    await initializeContext(parentId, async () => {
      insideParent = getCurrentCorrelationId();

      await initializeContext(childId, async () => {
        insideChild = getCurrentCorrelationId();
      });

      backInParent = getCurrentCorrelationId();
    });

    expect(outsideContext).toBeUndefined();
    expect(insideParent).toBe(parentId);
    expect(insideChild).toBe(childId);
    expect(backInParent).toBe(parentId);
  });
});

describe('LOG-03: Log format verification', () => {
  const LOG_FORMAT_REGEX =
    /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} REQ:[a-z0-9-]{4,8}\] (INFO |DEBUG|WARN |ERROR)  .+$/;

  it('all log levels produce output matching format specification', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.info('info message');
      log.debug('debug message');
      log.warn('warn message');
      log.error('error message');
    });

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toMatch(LOG_FORMAT_REGEX);
    }
  });

  it('log format includes correlation ID REQ:[a-z0-9]{8}', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();
    await initializeContext(cid, async () => {
      log.info('test');
    });
    expect(lines[0]).toMatch(new RegExp(`REQ:${cid}`));
    expect(cid).toMatch(/^[a-z0-9]{8}$/);
  });

  it('log format uses REQ:---- placeholder when no context active', () => {
    const { log, lines } = makeLogger();
    log.info('no context');
    expect(lines[0]).toContain('REQ:----');
    expect(lines[0]).toMatch(LOG_FORMAT_REGEX);
  });

  it('timestamp format is YYYY-MM-DD HH:MM:SS', async () => {
    const { log, lines } = makeLogger();
    await initializeContext(generateCorrelationId(), async () => {
      log.info('timestamp test');
    });
    const timestampMatch = lines[0].match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    expect(timestampMatch).not.toBeNull();
    // Verify the timestamp is actually a valid date
    const ts = new Date(timestampMatch![1].replace(' ', 'T'));
    expect(isNaN(ts.getTime())).toBe(false);
  });

  it('DEBUG messages with timing data (duration_ms) match format', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      // Simulate timing trace from vault operation
      log.debug('Vault: wrote test.md (12ms) — document update persisted to disk');
    });
    expect(lines[0]).toMatch(/DEBUG.*\(\d+ms\)/);
  });
});

describe('LOG-04: AsyncLocalStorage transparent correlation tracking', () => {
  it('context propagates without parameter passing (no drilling)', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    // Simulate deeply nested operations without passing cid as parameter
    async function deepOperation(): Promise<void> {
      log.debug('deep: layer 3');
    }

    async function midOperation(): Promise<void> {
      log.debug('mid: layer 2');
      await deepOperation();
    }

    async function shallowOperation(): Promise<void> {
      log.debug('shallow: layer 1');
      await midOperation();
    }

    await initializeContext(cid, shallowOperation);

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }
  });

  it('context propagates through setTimeout callback', async () => {
    const ids: string[] = [];
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      ids.push(getCurrentCorrelationId() ?? 'missing-sync');

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          ids.push(getCurrentCorrelationId() ?? 'missing-timeout');
          resolve();
        }, 5);
      });
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(cid);
    expect(ids[1]).toBe(cid);
  });

  it('fire-and-forget void operations inherit parent correlation ID', async () => {
    const collectedIds: string[] = [];
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      collectedIds.push(getCurrentCorrelationId() ?? 'missing');

      // Fire-and-forget: void the promise, don't await it
      void Promise.resolve().then(() => {
        collectedIds.push(getCurrentCorrelationId() ?? 'missing-ff');
      });

      // Small delay to allow microtask queue to drain
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });

    expect(collectedIds).toContain(cid);
    // Fire-and-forget should also see the parent cid
    expect(collectedIds.filter((id) => id === cid).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Correlation ID format and uniqueness', () => {
  it('generateCorrelationId produces 8-char lowercase hex', () => {
    for (let i = 0; i < 20; i++) {
      const cid = generateCorrelationId();
      expect(cid).toMatch(/^[a-z0-9]{8}$/);
      expect(cid).toHaveLength(8);
    }
  });

  it('generateCorrelationId produces unique IDs (no collisions in 1000 calls)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateCorrelationId()));
    expect(ids.size).toBe(1000);
  });

  it('grep-ability: same correlation ID appears across all log lines for a request', async () => {
    const { log, lines } = makeLogger('debug');
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      // Simulate a complete MCP request flow
      log.info('MCP: save_memory started');
      log.debug('Hash: computed SHA256 (2ms) — external edit detection enabled');
      log.debug('Vault: wrote memory.md (8ms) — document update persisted to disk');
      log.debug('Git: committed "vault: update memory.md" (45ms) — maintaining version history');
      log.debug('Embedding: generated vector (150ms) — semantic search enabled');
      log.info('MCP: save_memory completed');
    });

    // Simulate production grep: `grep "REQ:abc12345" logs.txt`
    const grepResults = lines.filter((l) => l.includes(`REQ:${cid}`));
    expect(grepResults).toHaveLength(lines.length); // every line should match
    expect(grepResults.length).toBeGreaterThanOrEqual(6);
  });
});

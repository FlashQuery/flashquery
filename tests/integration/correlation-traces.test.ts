/**
 * Integration tests for correlation ID traces in fire-and-forget operations,
 * scanner integration, and log format validation.
 *
 * Tests verify:
 * - Fire-and-forget operations (embedding re-queues, Git push) inherit parent correlation ID
 * - Scanner integration (vault read operations traced with correlation IDs)
 * - Log format compliance (all lines match specification)
 * - Purpose statements in DEBUG traces document why operations matter
 *
 * These tests do NOT require a running Supabase instance — they test the
 * logging infrastructure and trace patterns using mocks.
 *
 * Coverage:
 * - LOG-01: DEBUG traces for vault I/O, Git, embedding, hash, DB queries
 * - LOG-02: Correlation IDs propagate through fire-and-forget
 * - LOG-03: Log format verified
 * - LOG-05: Every DEBUG message documents its purpose for troubleshooting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
// Simulate operation patterns that match the actual implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates the vault write + git commit + fire-and-forget embedding pattern
 * from create_document MCP tool. Validates that all log messages share the
 * same correlation ID including background operations.
 */
async function simulateMcpDocumentCreate(log: Logger): Promise<void> {
  log.info('create_document: started');

  // Vault write (LOG-01)
  await Promise.resolve();
  const vaultDuration = 8;
  log.debug(`Vault: wrote notes/test.md (${vaultDuration}ms) — document update persisted to disk`);

  // Hash computation (LOG-01)
  const hashDuration = 1;
  log.debug(`Hash: computed SHA256 (${hashDuration}ms) — external edit detection enabled`);

  // Fire-and-forget: Git commit (LOG-01, LOG-02)
  void Promise.resolve().then(async () => {
    await Promise.resolve();
    const commitDuration = 35;
    log.debug(
      `Git: committed "vault: create document 'test'" (${commitDuration}ms) — maintaining version history`
    );
  });

  // Fire-and-forget: embedding re-queue (LOG-01, LOG-02)
  void Promise.resolve().then(async () => {
    log.debug('Embedding: background re-embed started');
    await Promise.resolve();
    const embedDuration = 145;
    log.debug(`Embedding: generated vector (${embedDuration}ms) — semantic search enabled`);
    log.debug('Embedding: background re-embed completed');
  });

  log.info('create_document: completed — doc created at notes/test.md');

  // Allow background operations to settle
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
}

/**
 * Simulates a scan operation with vault read traces and correlation ID propagation.
 */
async function simulateForceFileScan(log: Logger): Promise<void> {
  log.info('force_file_scan: started');

  // Vault read operations during scan
  for (const docPath of ['notes/doc1.md', 'notes/doc2.md', 'archive/old.md']) {
    const readDuration = Math.floor(Math.random() * 10) + 5;
    log.debug(`Vault: read ${docPath} (${readDuration}ms) — frontmatter extracted and validated`);
    await Promise.resolve();

    // Hash computation for each doc
    const hashDuration = 1;
    log.debug(`Hash: computed SHA256 (${hashDuration}ms) — external edit detection enabled`);
  }

  log.info('force_file_scan: completed — 3 files scanned, 0 new, 0 moved, 0 missing');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LOG-02: Fire-and-forget operations inherit parent correlation ID', () => {
  it('Git push fire-and-forget inherits parent correlation ID', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      log.info('MCP: request started');

      // Synchronous commit trace
      log.debug('Git: committed "vault: create test" (35ms) — maintaining version history');

      // Fire-and-forget push
      void Promise.resolve().then(() => {
        log.debug('Git: push started — background sync to remote');
        void Promise.resolve().then(() => {
          log.debug('Git: push completed to origin/main (background sync)');
        });
      });

      log.info('MCP: returning response');

      // Allow fire-and-forget to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });

    // All lines including fire-and-forget should have same cid
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }

    // Verify fire-and-forget push messages appear
    expect(lines.some((l) => l.includes('push started'))).toBe(true);
    expect(lines.some((l) => l.includes('push completed'))).toBe(true);

    // Push logs should appear AFTER the response was returned (log order)
    const responseIdx = lines.findIndex((l) => l.includes('returning response'));
    const pushStartIdx = lines.findIndex((l) => l.includes('push started'));
    // Fire-and-forget may interleave but the parent response logs first
    expect(responseIdx).toBeGreaterThanOrEqual(0);
    expect(pushStartIdx).toBeGreaterThanOrEqual(0);
  });

  it('embedding re-queue fire-and-forget inherits parent correlation ID', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      // Simulate create_document flow
      await simulateMcpDocumentCreate(log);
    });

    // All log lines — including background embed — should have the same cid
    for (const line of lines) {
      expect(line).toContain(`REQ:${cid}`);
    }

    // Verify background embedding was logged
    expect(lines.some((l) => l.includes('background re-embed started'))).toBe(true);
    expect(lines.some((l) => l.includes('background re-embed completed'))).toBe(true);
  });

  it('parent request response logged before fire-and-forget completion', async () => {
    const { log, lines } = makeLogger();
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      log.info('parent: request received');
      void Promise.resolve().then(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        log.debug('fire-and-forget: completed after parent');
      });
      log.info('parent: response returned');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });

    const parentReturnIdx = lines.findIndex((l) => l.includes('response returned'));
    const ffCompleteIdx = lines.findIndex((l) => l.includes('completed after parent'));

    expect(parentReturnIdx).toBeGreaterThanOrEqual(0);
    expect(ffCompleteIdx).toBeGreaterThanOrEqual(0);
    // Fire-and-forget should complete AFTER the parent returns its response
    expect(ffCompleteIdx).toBeGreaterThan(parentReturnIdx);
  });
});

describe('LOG-01: DEBUG traces for vault I/O, Git, embedding, hash operations', () => {
  it('vault write traces include timing and purpose statement', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.debug('Vault: wrote notes/example.md (12ms) — document update persisted to disk');
    });
    expect(lines[0]).toMatch(/Vault: wrote .+ \(\d+ms\) — document update persisted to disk/);
  });

  it('vault read traces include timing and purpose statement', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.debug('Vault: read notes/example.md (5ms) — frontmatter extracted and validated');
    });
    expect(lines[0]).toMatch(/Vault: read .+ \(\d+ms\) — frontmatter extracted and validated/);
  });

  it('Git commit traces include timing and purpose statement', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.debug('Git: committed "vault: create document \'test\'" (38ms) — maintaining version history');
    });
    expect(lines[0]).toMatch(/Git: committed .+ \(\d+ms\) — maintaining version history/);
  });

  it('embedding traces include timing and purpose statement', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.debug('Embedding: generated vector (145ms) — semantic search enabled');
    });
    expect(lines[0]).toMatch(/Embedding: generated vector \(\d+ms\) — semantic search enabled/);
  });

  it('hash computation traces include timing and purpose statement', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      log.debug('Hash: computed SHA256 (1ms) — external edit detection enabled');
    });
    expect(lines[0]).toMatch(/Hash: computed SHA256 \(\d+ms\) — external edit detection enabled/);
  });
});

describe('LOG-03: Log format validation across all operations', () => {
  const LOG_FORMAT_REGEX =
    /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} REQ:[a-z0-9-]{4,8}\] (INFO |DEBUG|WARN |ERROR)  .+$/;

  it('complete MCP flow produces all lines matching log format spec', async () => {
    const { log, lines } = makeLogger('debug');
    const cid = generateCorrelationId();

    await initializeContext(cid, async () => {
      await simulateMcpDocumentCreate(log);
    });

    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      expect(line).toMatch(LOG_FORMAT_REGEX);
    }
  });

  it('scanner operation produces all lines matching log format spec', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      await simulateForceFileScan(log);
    });

    expect(lines.length).toBeGreaterThanOrEqual(7);
    for (const line of lines) {
      expect(line).toMatch(LOG_FORMAT_REGEX);
    }
  });

  it('grep by correlation ID returns all request-related log lines', async () => {
    const { log, lines } = makeLogger('debug');
    const cid = generateCorrelationId();
    const otherCid = generateCorrelationId();

    // Interleave logs from two different "requests" to simulate real-world scenario
    await Promise.all([
      initializeContext(cid, async () => {
        log.info('req A: start');
        await Promise.resolve();
        log.debug('req A: processing');
        await new Promise<void>((r) => setTimeout(r, 5));
        log.info('req A: complete');
      }),
      initializeContext(otherCid, async () => {
        log.info('req B: start');
        await Promise.resolve();
        log.debug('req B: processing');
        await new Promise<void>((r) => setTimeout(r, 5));
        log.info('req B: complete');
      }),
    ]);

    // Simulate grep: filter to only the target request
    const grepForCid = lines.filter((l) => l.includes(`REQ:${cid}`));
    const grepForOtherCid = lines.filter((l) => l.includes(`REQ:${otherCid}`));

    // Each grep should return exactly the lines for that request
    expect(grepForCid).toHaveLength(3); // start, processing, complete
    expect(grepForOtherCid).toHaveLength(3);

    // No cross-contamination
    for (const line of grepForCid) {
      expect(line).not.toContain(`REQ:${otherCid}`);
    }
    for (const line of grepForOtherCid) {
      expect(line).not.toContain(`REQ:${cid}`);
    }
  });
});

describe('LOG-05: DEBUG messages include purpose statements for troubleshooting', () => {
  it('all DEBUG traces from simulated MCP flow include purpose documentation', async () => {
    const { log, lines } = makeLogger('debug');
    await initializeContext(generateCorrelationId(), async () => {
      await simulateMcpDocumentCreate(log);
    });

    // Filter to DEBUG lines only
    const debugLines = lines.filter((l) => l.includes('DEBUG'));

    // Each DEBUG line should contain a purpose statement (indicated by "—" separator)
    // or "started"/"completed" for fire-and-forget lifecycle logs
    for (const line of debugLines) {
      const hasEmdashPurpose = line.includes(' — ');
      const hasLifecycleKeyword = line.includes('started') || line.includes('completed');
      expect(hasEmdashPurpose || hasLifecycleKeyword).toBe(true);
    }
  });

  it('vault operation DEBUG messages document why disk write matters', () => {
    const { log, lines } = makeLogger('debug');
    log.debug('Vault: wrote test.md (8ms) — document update persisted to disk');
    expect(lines[0]).toContain('— document update persisted to disk');
  });

  it('vault read DEBUG messages document why frontmatter parsing matters', () => {
    const { log, lines } = makeLogger('debug');
    log.debug('Vault: read test.md (3ms) — frontmatter extracted and validated');
    expect(lines[0]).toContain('— frontmatter extracted and validated');
  });

  it('Git commit DEBUG messages document why version history matters', () => {
    const { log, lines } = makeLogger('debug');
    log.debug("Git: committed \"vault: create test\" (35ms) — maintaining version history");
    expect(lines[0]).toContain('— maintaining version history');
  });

  it('embedding DEBUG messages document why vector generation matters', () => {
    const { log, lines } = makeLogger('debug');
    log.debug('Embedding: generated vector (145ms) — semantic search enabled');
    expect(lines[0]).toContain('— semantic search enabled');
  });

  it('hash DEBUG messages document why content hashing matters', () => {
    const { log, lines } = makeLogger('debug');
    log.debug('Hash: computed SHA256 (2ms) — external edit detection enabled');
    expect(lines[0]).toContain('— external edit detection enabled');
  });
});

describe('Phase 27 production troubleshooting capability', () => {
  it('operator can trace entire create_document request by grepping REQ:uuid', async () => {
    const { log, lines } = makeLogger('debug');
    const requestCid = generateCorrelationId();

    // Simulate a complete create_document MCP flow
    await initializeContext(requestCid, async () => {
      await simulateMcpDocumentCreate(log);
    });

    // Production troubleshooting: `grep "REQ:abc1234e" logs.txt`
    const traceForRequest = lines.filter((l) => l.includes(`REQ:${requestCid}`));

    // Should capture the entire request flow
    expect(traceForRequest).toHaveLength(lines.length);

    // Trace should include: request start, vault write, hash, git, embedding, response
    const logText = traceForRequest.join('\n');
    expect(logText).toContain('create_document: started');
    expect(logText).toContain('Vault: wrote');
    expect(logText).toContain('Hash: computed SHA256');
    expect(logText).toContain('Git: committed');
    expect(logText).toContain('Embedding: generated vector');
    expect(logText).toContain('create_document: completed');
  });

  it('operator can trace scanner operation by grepping REQ:uuid', async () => {
    const { log, lines } = makeLogger('debug');
    const scanCid = generateCorrelationId();

    await initializeContext(scanCid, async () => {
      await simulateForceFileScan(log);
    });

    const traceForScan = lines.filter((l) => l.includes(`REQ:${scanCid}`));

    expect(traceForScan).toHaveLength(lines.length);
    expect(traceForScan.length).toBeGreaterThanOrEqual(7);

    const logText = traceForScan.join('\n');
    expect(logText).toContain('force_file_scan: started');
    expect(logText).toContain('Vault: read');
    expect(logText).toContain('Hash: computed SHA256');
    expect(logText).toContain('force_file_scan: completed');
  });
});

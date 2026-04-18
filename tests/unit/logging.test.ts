import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Logger } from '../../src/logging/logger.js';
import { initializeContext } from '../../src/logging/context.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helper factory
// ─────────────────────────────────────────────────────────────────────────────

function makeLogger(level: 'debug' | 'info' | 'warn' | 'error' = 'debug', lines: string[] = []) {
  const logging = { level, output: 'stdout' as const };
  return { log: new Logger(logging, (line) => lines.push(line)), lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger', () => {
  describe('output format', () => {
    it('Test 1: logger.info outputs line matching new format [YYYY-MM-DD HH:MM:SS REQ:----] INFO   hello', () => {
      const { log, lines } = makeLogger('debug');
      log.info('hello');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} REQ:----\] INFO   hello$/);
    });

    it('Test 2: logger.debug outputs line containing DEBUG at debug level', () => {
      const { log, lines } = makeLogger('debug');
      log.debug('x');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('DEBUG');
    });

    it('Test 3: logger.warn outputs line containing WARN  (padded to 5 chars)', () => {
      const { log, lines } = makeLogger('debug');
      log.warn('x');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('WARN ');
    });

    it('Test 4: logger.error outputs line containing ERROR', () => {
      const { log, lines } = makeLogger('debug');
      log.error('x');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('ERROR');
    });
  });

  describe('level filtering', () => {
    it('Test 5: At info level, logger.debug produces no output', () => {
      const { log, lines } = makeLogger('info');
      log.debug('hidden');
      expect(lines).toHaveLength(0);
    });

    it('Test 6: At warn level, logger.debug and logger.info produce no output', () => {
      const { log, lines } = makeLogger('warn');
      log.debug('hidden');
      log.info('hidden');
      expect(lines).toHaveLength(0);
    });

    it('Test 7: At error level, only logger.error produces output', () => {
      const { log, lines } = makeLogger('error');
      log.debug('hidden');
      log.info('hidden');
      log.warn('hidden');
      log.error('visible');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('ERROR');
      expect(lines[0]).toContain('visible');
    });

    it('Test 8: At debug level, all four methods produce output', () => {
      const { log, lines } = makeLogger('debug');
      log.debug('a');
      log.info('b');
      log.warn('c');
      log.error('d');
      expect(lines).toHaveLength(4);
    });
  });

  describe('detail method', () => {
    it('Test 9: logger.detail at debug level outputs line containing DEBUG    sub-item (2-space indent)', () => {
      const { log, lines } = makeLogger('debug');
      log.detail('sub-item');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('DEBUG');
      expect(lines[0]).toContain('  sub-item');
    });

    it('Test 10: logger.detail at info level produces no output (detail is DEBUG level)', () => {
      const { log, lines } = makeLogger('info');
      log.detail('sub-item');
      expect(lines).toHaveLength(0);
    });
  });

  describe('file output', () => {
    let tmpFile: string;

    afterEach(() => {
      if (tmpFile && existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    });

    it('Test 11: File output mode writes to file, not stdout', () => {
      tmpFile = join(tmpdir(), `fqc-logger-test-${Date.now()}.log`);
      const logging = { level: 'debug' as const, output: 'file' as const, file: tmpFile };
      const log = new Logger(logging);
      log.info('file-message');

      // File must exist and contain the message
      expect(existsSync(tmpFile)).toBe(true);
      const content = readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('INFO');
      expect(content).toContain('file-message');
    });
  });

  describe('correlation ID support', () => {
    it('Test 12: Without context, logs show REQ:---- placeholder', () => {
      const { log, lines } = makeLogger('debug');
      log.info('no-context');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('REQ:----');
    });

    it('Test 13: With context initialized, logs include REQ:correlationId', async () => {
      const { log, lines } = makeLogger('debug');
      await initializeContext('abc12345', async () => {
        log.info('with-context');
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('REQ:abc12345');
    });

    it('Test 14: Correlation ID appears between timestamp and level in new format', async () => {
      const { log, lines } = makeLogger('debug');
      await initializeContext('deadbeef', async () => {
        log.info('format-test');
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} REQ:deadbeef\] INFO   format-test$/);
    });

    it('Test 15: Log format matches [YYYY-MM-DD HH:MM:SS REQ:uuid] LEVEL  message', async () => {
      const { log, lines } = makeLogger('debug');
      await initializeContext('cafef00d', async () => {
        log.debug('timing-test');
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} REQ:[a-z0-9]{8}\] DEBUG  timing-test$/);
    });

    it('Test 16: Messages with duration info embedded in string are passed through unchanged', () => {
      const { log, lines } = makeLogger('debug');
      log.debug('operation completed (145ms)');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('operation completed (145ms)');
    });

    it('Test 17: Backward compatibility — simple calls without duration work unchanged', () => {
      const { log, lines } = makeLogger('info');
      log.info('simple message');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('simple message');
      expect(lines[0]).toContain('INFO');
    });

    it('Test 18: Context propagates through nested async operations', async () => {
      const { log, lines } = makeLogger('debug');
      await initializeContext('nested01', async () => {
        await Promise.resolve(); // simulate async gap
        log.info('after-await');
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('REQ:nested01');
    });
  });
});

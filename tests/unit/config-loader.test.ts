import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDeprecationWarnings, loadConfig } from '../../src/config/loader.js';

const tempDirs: string[] = [];

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-config-loader-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, contents);
  return configPath;
}

function baseConfig(locking = ''): string {
  return `
instance:
  id: "legacy-lock-config-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
${locking}
`;
}

describe('REQ-004 legacy ttl_seconds config compatibility', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-I-006 legacy-write-lock locking.ttl_seconds loads but is not exposed as effective TTL behavior and emits one deprecation warning', () => {
    const configPath = writeConfig(baseConfig(`
locking:
  enabled: true
  ttl_seconds: 30
`));

    const config = loadConfig(configPath);

    expect(config.locking.enabled).toBe(true);
    expect(config.locking).not.toHaveProperty('ttlSeconds');
    expect(getDeprecationWarnings(config)).toEqual([
      'locking.ttl_seconds is deprecated; advisory locks do not use TTL and this key is safe to remove.',
    ]);
  });

  it('legacy-write-lock absent ttl_seconds does not emit a locking deprecation warning', () => {
    const config = loadConfig(writeConfig(baseConfig()));

    expect(config.locking.enabled).toBe(true);
    expect(config.locking.lockTimeoutSeconds).toBe(10);
    expect(config.locking).not.toHaveProperty('ttlSeconds');
    expect(getDeprecationWarnings(config).filter((warning) => warning.includes('ttl_seconds'))).toEqual([]);
  });

  it('T-U-014 lock-timeout configured loads locking.lock_timeout_seconds as lockTimeoutSeconds', () => {
    const config = loadConfig(writeConfig(baseConfig(`
locking:
  lock_timeout_seconds: 5
`)));

    expect(config.locking.lockTimeoutSeconds).toBe(5);
  });

  it('lock-timeout config loader default applies when lock_timeout_seconds is absent', () => {
    const config = loadConfig(writeConfig(baseConfig()));

    expect(config.locking.lockTimeoutSeconds).toBe(10);
  });

  it.each(['0', '-1', '1.5'])('rejects invalid lock_timeout_seconds value %s', (value) => {
    expect(() =>
      loadConfig(writeConfig(baseConfig(`
locking:
  lock_timeout_seconds: ${value}
`)))
    ).toThrow();
  });
});

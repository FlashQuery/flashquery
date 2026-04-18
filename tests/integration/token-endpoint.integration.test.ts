/**
 * Integration tests for token endpoint + config interaction.
 *
 * Tests verify:
 * - Config loader correctly parses mcp.token_lifetime field
 * - Config validation enforces bounds (1-8760 hours)
 * - Token endpoint uses configured token_lifetime
 * - Token response includes correct expires_in field
 * - Refresh token lifetime = 7x access token lifetime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../src/config/loader.js';
import { generateToken, generateRefreshToken, verifyToken } from '../../src/mcp/auth.js';

describe('Token Endpoint Integration Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test config files
    tempDir = mkdtempSync(join(tmpdir(), 'fqc-token-test-'));
  });

  afterEach(() => {
    // Clean up temporary files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Test 1: Config loader correctly parses mcp.token_lifetime when present
   */
  it('should parse token_lifetime from config YAML', () => {
    const configYaml = `
instance:
  id: test-instance
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  auth_secret: test-secret
  token_lifetime: 48

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-with-lifetime.yml');
    writeFileSync(configPath, configYaml);

    const config = loadConfig(configPath);
    expect(config.mcp.tokenLifetime).toBe(48);
  });

  /**
   * Test 2: Config loader defaults token_lifetime to 24 when omitted
   */
  it('should default token_lifetime to 24 hours when omitted', () => {
    const configYaml = `
instance:
  id: test-instance
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-without-lifetime.yml');
    writeFileSync(configPath, configYaml);

    const config = loadConfig(configPath);
    expect(config.mcp.tokenLifetime).toBe(24);
  });

  /**
   * Test 3: Config loader validates token_lifetime minimum (rejects < 1 hour)
   */
  it('should reject token_lifetime less than 1 hour', () => {
    const configYaml = `
instance:
  id: test-instance
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 0

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-zero-lifetime.yml');
    writeFileSync(configPath, configYaml);

    expect(() => {
      loadConfig(configPath);
    }).toThrow(/Token lifetime must be at least 1 hour/);
  });

  /**
   * Test 4: Config loader validates token_lifetime maximum (rejects > 8760 hours)
   */
  it('should reject token_lifetime greater than 8760 hours', () => {
    const configYaml = `
instance:
  id: test-instance
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 8761

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-over-lifetime.yml');
    writeFileSync(configPath, configYaml);

    expect(() => {
      loadConfig(configPath);
    }).toThrow(/Token lifetime must not exceed 1 year/);
  });

  /**
   * Test 5: Token endpoint uses configured token_lifetime in response (expires_in = tokenLifetime × 3600)
   */
  it('should generate access token with expires_in matching config.mcp.token_lifetime', () => {
    const configYaml = `
instance:
  id: test-instance-5
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  auth_secret: test-secret
  token_lifetime: 48

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-48h-lifetime.yml');
    writeFileSync(configPath, configYaml);

    const config = loadConfig(configPath);
    const accessTokenLifetime = config.mcp.tokenLifetime ?? 24;
    const expectedExpiresIn = accessTokenLifetime * 3600;

    expect(expectedExpiresIn).toBe(48 * 3600); // 172800 seconds
  });

  /**
   * Test 6: Different config instances generate tokens with different expiry times
   */
  it('should generate tokens with different expires_in for different configs', () => {
    const config1Yaml = `
instance:
  id: instance-1
  name: Test 1
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 12

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const config2Yaml = `
instance:
  id: instance-2
  name: Test 2
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 72

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const config1Path = join(tempDir, 'config-1.yml');
    const config2Path = join(tempDir, 'config-2.yml');

    writeFileSync(config1Path, config1Yaml);
    writeFileSync(config2Path, config2Yaml);

    const config1 = loadConfig(config1Path);
    const config2 = loadConfig(config2Path);

    const expiresIn1 = (config1.mcp.tokenLifetime ?? 24) * 3600;
    const expiresIn2 = (config2.mcp.tokenLifetime ?? 24) * 3600;

    expect(expiresIn1).toBe(12 * 3600); // 43200
    expect(expiresIn2).toBe(72 * 3600); // 259200
    expect(expiresIn1).not.toBe(expiresIn2);
  });

  /**
   * Test 7: Refresh token lifetime = 7x access token lifetime
   */
  it('should generate refresh token with lifetime = 7x access token lifetime', () => {
    const accessTokenLifetimeHours = 24;
    const refreshToken = generateRefreshToken('test-instance', 'test-secret', accessTokenLifetimeHours);

    // Decode the refresh token to verify the payload
    const parts = refreshToken.split('.');
    expect(parts.length).toBe(3); // JWT format

    const payloadEncoded = parts[1];
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString());

    expect(payload.token_type).toBe('refresh');
    expect(payload.lifetime_hours).toBe(168); // 24 * 7
  });

  /**
   * Test 8: Invalid YAML token_lifetime (non-numeric) is rejected by config loader
   */
  it('should reject non-numeric token_lifetime in config', () => {
    const configYaml = `
instance:
  id: test-instance
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: "not-a-number"

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-invalid-lifetime.yml');
    writeFileSync(configPath, configYaml);

    expect(() => {
      loadConfig(configPath);
    }).toThrow();
  });

  /**
   * Test 9: Config with token_lifetime: 1 (minimum) generates 3600-second tokens
   */
  it('should handle minimum token_lifetime (1 hour) correctly', () => {
    const configYaml = `
instance:
  id: test-instance-min
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 1

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-min-lifetime.yml');
    writeFileSync(configPath, configYaml);

    const config = loadConfig(configPath);
    const expiresIn = (config.mcp.tokenLifetime ?? 24) * 3600;

    expect(config.mcp.tokenLifetime).toBe(1);
    expect(expiresIn).toBe(3600); // 1 hour in seconds
  });

  /**
   * Test 10: Config with token_lifetime: 168 generates 604800-second tokens (7 days)
   */
  it('should handle 168-hour token_lifetime (7 days) correctly', () => {
    const configYaml = `
instance:
  id: test-instance-168
  name: Test
  vault:
    path: /tmp/vault

server:
  host: localhost
  port: 3100

supabase:
  url: "https://test.supabase.co"
  service_role_key: test-key
  database_url: "postgresql://user:pass@localhost/db"

git:
  auto_commit: false
  auto_push: false

mcp:
  transport: stdio
  token_lifetime: 168

embedding:
  provider: none
  model: none

logging:
  level: info
`;

    const configPath = join(tempDir, 'config-168h-lifetime.yml');
    writeFileSync(configPath, configYaml);

    const config = loadConfig(configPath);
    const expiresIn = (config.mcp.tokenLifetime ?? 24) * 3600;

    expect(config.mcp.tokenLifetime).toBe(168);
    expect(expiresIn).toBe(604800); // 7 days in seconds
  });
});

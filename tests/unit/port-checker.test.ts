import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Port Checker Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkPortAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves when port is available', async () => {
    // Mock the port-checker module to return a resolved promise
    const { checkPortAvailable } = await import('../../src/server/port-checker.js');

    // Since we can't easily mock net.createServer in ESM, we'll use a real server
    // but bind to a random available port (port 0) and immediately release it
    // This is a lightweight integration test that validates the function works
    await expect(checkPortAvailable(0, '127.0.0.1')).resolves.toBeUndefined();
  });

  it('rejects with EADDRINUSE error message when port is in use', async () => {
    // This test requires actually binding a port and then trying to use the same port
    // We'll create a real server on port 0 (which gives us a random available port),
    // then try to bind the same port with checkPortAvailable
    const net = await import('node:net');
    const { checkPortAvailable } = await import('../../src/server/port-checker.js');

    // Create a server and bind to port 0 to get an available port
    const realServer = net.createServer();

    await new Promise<number>((resolve, reject) => {
      realServer.once('error', reject);
      realServer.once('listening', () => {
        const addr = realServer.address();
        if (addr && typeof addr !== 'string') {
          resolve(addr.port);
        } else {
          reject(new Error('Could not get port'));
        }
      });
      realServer.listen(0, '127.0.0.1');
    });

    // Get the port the server is listening on
    const boundPort = (realServer.address() as any).port;

    try {
      // Try to check the same port - should fail with EADDRINUSE
      await expect(checkPortAvailable(boundPort, '127.0.0.1')).rejects.toThrow(
        /Port .* already in use/
      );

      await expect(checkPortAvailable(boundPort, '127.0.0.1')).rejects.toThrow(
        /change mcp.port in your config/
      );
    } finally {
      realServer.close();
    }
  });

  it('accepts valid ports in the valid range', async () => {
    const { checkPortAvailable } = await import('../../src/server/port-checker.js');

    // Test port 0 (which gives an available port from OS)
    await expect(checkPortAvailable(0, '127.0.0.1')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// McpSchema Port Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('McpSchema port validation', () => {
  it('rejects port 0 with min constraint error', () => {
    const tmpFile = join(tmpdir(), `fqc-test-port0-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test FlashQuery"
  id: "test-fqc"
  vault:
    path: "./test-vault"
    markdown_extensions: [".md"]
server:
  host: "localhost"
  port: 3100
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8"
  database_url: "postgresql://postgres:testpass@db.test.supabase.co:5432/postgres"
git:
  auto_commit: false
  auto_push: false
  remote: "origin"
  branch: "main"
mcp:
  transport: "streamable-http"
  port: 0
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('rejects port 65536 with max constraint error', () => {
    const tmpFile = join(tmpdir(), `fqc-test-port65536-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test FlashQuery"
  id: "test-fqc"
  vault:
    path: "./test-vault"
    markdown_extensions: [".md"]
server:
  host: "localhost"
  port: 3100
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8"
  database_url: "postgresql://postgres:testpass@db.test.supabase.co:5432/postgres"
git:
  auto_commit: false
  auto_push: false
  remote: "origin"
  branch: "main"
mcp:
  transport: "streamable-http"
  port: 65536
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('accepts valid port 3100', () => {
    const tmpFile = join(tmpdir(), `fqc-test-port3100-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test FlashQuery"
  id: "test-fqc"
  vault:
    path: "./test-vault"
    markdown_extensions: [".md"]
server:
  host: "localhost"
  port: 3100
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8"
  database_url: "postgresql://postgres:testpass@db.test.supabase.co:5432/postgres"
git:
  auto_commit: false
  auto_push: false
  remote: "origin"
  branch: "main"
mcp:
  transport: "streamable-http"
  port: 3100
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.mcp.port).toBe(3100);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('accepts valid port 8080', () => {
    const tmpFile = join(tmpdir(), `fqc-test-port8080-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test FlashQuery"
  id: "test-fqc"
  vault:
    path: "./test-vault"
    markdown_extensions: [".md"]
server:
  host: "localhost"
  port: 3100
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8"
  database_url: "postgresql://postgres:testpass@db.test.supabase.co:5432/postgres"
git:
  auto_commit: false
  auto_push: false
  remote: "origin"
  branch: "main"
mcp:
  transport: "streamable-http"
  port: 8080
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.mcp.port).toBe(8080);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('allows port to be omitted (defaults at runtime)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-port-omitted-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test FlashQuery"
  id: "test-fqc"
  vault:
    path: "./test-vault"
    markdown_extensions: [".md"]
server:
  host: "localhost"
  port: 3100
supabase:
  url: "https://test.supabase.co"
  service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8"
  database_url: "postgresql://postgres:testpass@db.test.supabase.co:5432/postgres"
git:
  auto_commit: false
  auto_push: false
  remote: "origin"
  branch: "main"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.mcp.port).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

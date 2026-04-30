import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, getDeprecationWarnings } from '../../src/config/loader.js';

const FIXTURE_PATH = new URL('../fixtures/flashquery.test.yml', import.meta.url).pathname;

describe('loadConfig', () => {
  it('loads a valid config file and returns a FlashQueryConfig object', () => {
    // The fixture still has projects/defaults/vault sections — update fixture below or use a minimal config
    // This test uses a minimal config without legacy fields
    const tmpFile = join(tmpdir(), `fqc-test-valid-${Date.now()}.yaml`);
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
      expect(config.instance.name).toBe('Test FlashQuery');
      expect(config.instance.id).toBe('test-fqc');
      expect(config.instance.vault.path).toBe(resolve(tmpdir(), './test-vault'));
      expect(config.instance.vault.markdownExtensions).toEqual(['.md']);
      expect(config.server.host).toBe('localhost');
      expect(config.server.port).toBe(3100);
      expect(config.supabase.url).toBe('https://test.supabase.co');
      expect(config.supabase.serviceRoleKey).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.-2W8ousOco2W648h27GKbwsC1BBDtfOTCjCuDsyIcw8');
      expect(config.supabase.databaseUrl).toBe('postgresql://postgres:testpass@db.test.supabase.co:5432/postgres');
      expect(config.git.autoCommit).toBe(false);
      expect(config.git.autoPush).toBe(false);
      expect(config.embedding.provider).toBe('openai');
      expect(config.embedding.model).toBe('text-embedding-3-small');
      expect(config.embedding.dimensions).toBe(1536);
      expect(config.logging.level).toBe('info');
      expect(config.logging.output).toBe('stdout');
      // v1.7: no defaults or projects properties
      expect((config as Record<string, unknown>)['defaults']).toBeUndefined();
      expect((config as Record<string, unknown>)['projects']).toBeUndefined();
      expect((config as Record<string, unknown>)['vault']).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('uses camelCase keys in returned object (snake_case in YAML)', () => {
    const config = loadConfig(FIXTURE_PATH);
    // TypeScript type guards — these properties must exist on the returned object
    expect(config.supabase.serviceRoleKey).toBeDefined();
    expect(config.supabase.databaseUrl).toBeDefined();
    expect(config.git.autoCommit).toBeDefined();
    expect(config.git.autoPush).toBeDefined();
    // instance.vault uses camelCase
    expect(config.instance.vault.markdownExtensions).toBeDefined();
    // Raw snake_case should NOT be present (we verify by checking the shape)
    expect((config.supabase as Record<string, unknown>)['service_role_key']).toBeUndefined();
    expect((config.supabase as Record<string, unknown>)['database_url']).toBeUndefined();
    expect((config.git as Record<string, unknown>)['auto_commit']).toBeUndefined();
    expect((config.instance.vault as Record<string, unknown>)['markdown_extensions']).toBeUndefined();
  });

  it('has correct types: port is number, autoCommit is boolean', () => {
    const config = loadConfig(FIXTURE_PATH);
    expect(typeof config.server.port).toBe('number');
    expect(typeof config.git.autoCommit).toBe('boolean');
    expect(typeof config.git.autoPush).toBe('boolean');
    expect(typeof config.embedding.dimensions).toBe('number');
    expect(Array.isArray(config.instance.vault.markdownExtensions)).toBe(true);
  });

  it('loads new nested instance.vault structure correctly', () => {
    const tmpFile = join(tmpdir(), `fqc-test-nested-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Nested Test"
  id: "nested-test"
  vault:
    path: "./my-vault"
    markdown_extensions: [".md", ".txt", ".mdx"]
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.instance.vault.path).toBe(resolve(tmpdir(), './my-vault'));
      expect(config.instance.vault.markdownExtensions).toEqual(['.md', '.txt', '.mdx']);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('rejects legacy top-level vault section with a clear error message', () => {
    const tmpFile = join(tmpdir(), `fqc-test-legacy-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Legacy Test"
  id: "legacy-test"
  vault:
    path: "./instance-vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
vault:
  path: "./legacy-vault"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/Top-level 'vault:' section removed in v1.7/);
      expect(() => loadConfig(tmpFile)).toThrow(/instance\.vault/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('emits deprecation warning for .yaml extension (not .yml)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-ext-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Ext Test"
  id: "ext-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      const warnings = getDeprecationWarnings(config);
      expect(warnings.some(w => w.includes('flashquery.yaml') && w.includes('rename to flashquery.yml'))).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('does not emit .yaml deprecation warning for .yml extension', () => {
    const tmpFile = join(tmpdir(), `fqc-test-ext-${Date.now()}.yml`);
    writeFileSync(tmpFile, `
instance:
  name: "Yml Test"
  id: "yml-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      const warnings = getDeprecationWarnings(config);
      const yamlExtWarnings = warnings.filter(w => w.includes('rename to flashquery.yml'));
      expect(yamlExtWarnings).toHaveLength(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('throws a clear error when a required field (supabase.database_url) is missing', () => {
    const tmpFile = join(tmpdir(), `fqc-test-missing-db-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test"
  id: "test-id"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/supabase\.database_url/);
      expect(() => loadConfig(tmpFile)).toThrow(/required/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('throws a clear error when instance.id is missing', () => {
    const tmpFile = join(tmpdir(), `fqc-test-missing-id-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/instance\.id/);
      expect(() => loadConfig(tmpFile)).toThrow(/required/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('throws a clear error with hint when instance.vault.path is missing', () => {
    const tmpFile = join(tmpdir(), `fqc-test-missing-vault-path-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test"
  id: "test-id"
  vault:
    markdown_extensions: [".md"]
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/instance\.vault\.path/);
      expect(() => loadConfig(tmpFile)).toThrow(/required/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('throws a "not found" error when the config file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/flashquery.yaml')).toThrow(
      /not found|no such file/i
    );
  });

  it('throws a YAML error with line info when YAML is malformed', () => {
    const tmpFile = join(tmpdir(), `fqc-test-malformed-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  name: "Test"
  id: bad: yaml: here
  broken
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/yaml/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('applies defaults for optional fields (minimal config with nested vault)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-minimal-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "minimal-fqc"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.instance.name).toBe('FlashQuery');
      expect(config.instance.vault.markdownExtensions).toEqual(['.md']);
      expect(config.server.host).toBe('localhost');
      expect(config.server.port).toBe(3100);
      expect(config.git.autoCommit).toBe(false);
      expect(config.logging.level).toBe('info');
      // v1.7: no defaults or projects properties
      expect((config as Record<string, unknown>)['defaults']).toBeUndefined();
      expect((config as Record<string, unknown>)['projects']).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('rejects unknown top-level fields with strict validation (v1.7)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-extra-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "test"
  name: "Test"
  unknown_field: "should be stripped"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
  extra_supabase_setting: "ignored"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
future_section:
  some_setting: "ignored"
`);
    try {
      // strict() rejects unrecognized top-level keys (future_section)
      // unknown_field and extra_supabase_setting are stripped at the nested level (sub-schemas use .strip())
      expect(() => loadConfig(tmpFile)).toThrow();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('expands ${VAR_NAME} environment variables in string values', () => {
    const tmpFile = join(tmpdir(), `fqc-test-envvar-${Date.now()}.yaml`);
    process.env.TEST_CONFIG_VAR = 'expanded-value';
    writeFileSync(tmpFile, `
instance:
  id: "env-test"
  name: "Test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "\${TEST_CONFIG_VAR}"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  api_key: "\${TEST_CONFIG_VAR}"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.supabase.serviceRoleKey).toBe('expanded-value');
      expect(config.embedding.apiKey).toBe('expanded-value');
    } finally {
      delete process.env.TEST_CONFIG_VAR;
      unlinkSync(tmpFile);
    }
  });

  it('leaves ${UNSET_VAR} as literal string when env var is not set', () => {
    const tmpFile = join(tmpdir(), `fqc-test-unset-${Date.now()}.yaml`);
    delete process.env.UNSET_TEST_VAR_FQC;
    writeFileSync(tmpFile, `
instance:
  id: "unset-test"
  name: "Test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "real-key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
  api_key: "\${UNSET_TEST_VAR_FQC}"
`);
    try {
      const config = loadConfig(tmpFile);
      // api_key is optional in embedding — the literal string is preserved
      expect(config.embedding.apiKey).toBe('${UNSET_TEST_VAR_FQC}');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('rejects old projects section with clear error message (v1.7)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-projects-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "test"
  name: "Test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
projects:
  areas:
    - name: "Work"
      projects:
        - name: "CRM"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/projects.*removed in v1\.7/i);
      expect(() => loadConfig(tmpFile)).toThrow(/path-based/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('applies default locking config when locking section is omitted', () => {
    const tmpFile = join(tmpdir(), `fqc-test-locking-default-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "lock-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.locking.enabled).toBe(true);
      expect(config.locking.ttlSeconds).toBe(30);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('accepts custom locking.ttl_seconds and converts to camelCase', () => {
    const tmpFile = join(tmpdir(), `fqc-test-locking-custom-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "lock-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
locking:
  ttl_seconds: 60
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.locking.enabled).toBe(true);
      expect(config.locking.ttlSeconds).toBe(60);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('passes mcp.auth_secret through to authSecret in camelCase', () => {
    const tmpFile = join(tmpdir(), `fqc-test-auth-secret-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "auth-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
mcp:
  auth_secret: "test-secret-value"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.mcp.authSecret).toBe('test-secret-value');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('results in undefined authSecret when mcp.auth_secret is omitted', () => {
    const tmpFile = join(tmpdir(), `fqc-test-no-auth-secret-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "no-auth-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
`);
    try {
      const config = loadConfig(tmpFile);
      expect(config.mcp.authSecret).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('rejects old defaults.project with clear error message (v1.7)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-defaults-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `
instance:
  id: "test"
  name: "Test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
defaults:
  project: "General"
`);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/defaults.*project.*eliminated in v1\.7/i);
      expect(() => loadConfig(tmpFile)).toThrow(/tags/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  // ── D-07: embedding dual-config deprecation warning (Phase 104) ────────────

  const MINIMAL_LLM_YAML = `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
      api_key: sk-test
  models:
    - name: embed-model
      provider_name: openai
      model: text-embedding-3-small
      type: embedding
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: embedding
      description: Embedding purpose
      models: [embed-model]
`;

  const MINIMAL_BASE_YAML = `
instance:
  id: "d07-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
`;

  it('D-07a: emits deprecation warning when embedding: (provider≠none) AND llm.purposes contains embedding', () => {
    const tmpFile = join(tmpdir(), `fqc-test-d07a-${Date.now()}.yml`);
    writeFileSync(tmpFile, MINIMAL_BASE_YAML + `
embedding:
  provider: openai
  model: text-embedding-3-small
` + MINIMAL_LLM_YAML);
    try {
      const config = loadConfig(tmpFile);
      const warnings = getDeprecationWarnings(config);
      expect(warnings.some(w => w.includes("'embedding:' config section is deprecated"))).toBe(true);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('D-07b: no deprecation warning when embedding.provider=none AND llm.purposes contains embedding (migrated user)', () => {
    const tmpFile = join(tmpdir(), `fqc-test-d07b-${Date.now()}.yml`);
    writeFileSync(tmpFile, MINIMAL_BASE_YAML + `
embedding:
  provider: none
  model: text-embedding-3-small
` + MINIMAL_LLM_YAML);
    try {
      const config = loadConfig(tmpFile);
      const warnings = getDeprecationWarnings(config);
      expect(warnings.some(w => w.includes("'embedding:' config section is deprecated"))).toBe(false);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('D-07c: no D-07 deprecation warning when embedding: is set but llm has no embedding purpose', () => {
    const tmpFile = join(tmpdir(), `fqc-test-d07c-${Date.now()}.yml`);
    writeFileSync(tmpFile, MINIMAL_BASE_YAML + `
embedding:
  provider: openai
  model: text-embedding-3-small
`);
    try {
      const config = loadConfig(tmpFile);
      const warnings = getDeprecationWarnings(config);
      expect(warnings.some(w => w.includes("'embedding:' config section is deprecated"))).toBe(false);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

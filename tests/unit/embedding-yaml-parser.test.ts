import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

const tempDirs: string[] = [];

function writeConfig(extraYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-embedding-yaml-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, `${baseConfigYaml()}${extraYaml}`);
  return configPath;
}

function writeRawConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-embedding-yaml-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, yaml);
  return configPath;
}

function baseConfigYaml(): string {
  return `
instance:
  name: "Embedding Catalog Test"
  id: "embedding-catalog-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "none"
  model: ""
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com/v1
    - name: local
      type: ollama
      endpoint: http://localhost:11434
  models:
    - name: gpt-4o
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: General
      models:
        - gpt-4o
`;
}

describe('embedding-catalog YAML parser', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-U-001 parses a valid top-level embeddings block into typed catalog entries', () => {
    const config = loadConfig(writeConfig(`
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
        rate_limit:
          min_delay_ms: 25
          max_backoff_retries: 3
          backoff_base_ms: 1000
        max_input_chars: 12000
      - provider_name: local
        model: nomic-embed-text
`));

    expect(config.embeddings).toEqual([
      {
        name: 'primary',
        dimensions: 1536,
        endpoints: [
          {
            providerName: 'openai',
            model: 'text-embedding-3-small',
            rateLimit: { minDelayMs: 25, maxBackoffRetries: 3, backoffBaseMs: 1000 },
            maxInputChars: 12000,
          },
          {
            providerName: 'local',
            model: 'nomic-embed-text',
          },
        ],
      },
    ]);
  });

  it.each([
    ['name', '  - dimensions: 1536\n    endpoints:\n      - provider_name: openai\n        model: text-embedding-3-small'],
    ['dimensions', '  - name: primary\n    endpoints:\n      - provider_name: openai\n        model: text-embedding-3-small'],
    ['endpoints', '  - name: primary\n    dimensions: 1536'],
    ['non-empty endpoints', '  - name: primary\n    dimensions: 1536\n    endpoints: []'],
  ])('T-U-002 rejects an embedding entry missing %s', (_field, entryYaml) => {
    expect(() => loadConfig(writeConfig(`embeddings:\n${entryYaml}\n`))).toThrow(/embeddings/i);
  });

  it('T-U-003 rejects duplicate embedding entry names', () => {
    expect(() => loadConfig(writeConfig(`
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
  - name: primary
    dimensions: 768
    endpoints:
      - provider_name: local
        model: nomic-embed-text
`))).toThrow(/duplicate embedding name 'primary'/i);
  });

  it.each([
    ['provider_name', '      - model: text-embedding-3-small'],
    ['model', '      - provider_name: openai'],
  ])('T-U-004 rejects an endpoint missing %s', (_field, endpointYaml) => {
    expect(() => loadConfig(writeConfig(`
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
${endpointYaml}
`))).toThrow(/embeddings/i);
  });

  it('T-U-005 treats missing catalog dimensions as a hard error instead of defaulting to 1536', () => {
    expect(() => loadConfig(writeConfig(`
embeddings:
  - name: primary
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
`))).toThrow(/dimensions/i);
  });

  it('T-U-005 rejects an active legacy embedding config without explicit dimensions', () => {
    const configPath = writeRawConfig(`
instance:
  name: "Embedding Catalog Test"
  id: "embedding-catalog-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "openai"
  model: "text-embedding-3-small"
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com/v1
  models: []
  purposes: []
`);

    expect(() => loadConfig(configPath)).toThrow(/embedding\.dimensions.*required/i);
  });

  it.each(['Primary', 'my-embed', '1primary'])(
    'rejects embedding catalog name %s before DDL',
    (name) => {
      expect(() => loadConfig(writeConfig(`
embeddings:
  - name: ${name}
    dimensions: 1536
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
`))).toThrow(/embedding name.*lowercase/i);
    }
  );

  it('rejects embeddings provider references when llm providers are absent', () => {
    const configPath = writeRawConfig(`
instance:
  name: "Embedding Catalog Test"
  id: "embedding-catalog-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "none"
  model: ""
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
`);

    expect(() => loadConfig(configPath)).toThrow(/provider_name 'openai' references unknown llm provider/i);
  });
});

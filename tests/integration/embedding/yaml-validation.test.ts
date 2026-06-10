import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../../src/config/loader.js';

const tempDirs: string[] = [];

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-embedding-yaml-validation-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, contents);
  return configPath;
}

describe('embedding-catalog YAML validation', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-I-004 fails startup config validation when endpoint provider_name is unresolved', () => {
    const configPath = writeConfig(`
instance:
  name: "Embedding Catalog Validation Test"
  id: "embedding-catalog-validation-test"
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
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
      - provider_name: missing-provider
        model: text-embedding-3-small
`);

    expect(() => loadConfig(configPath)).toThrow(
      /embedding 'primary' endpoint provider_name 'missing-provider' references unknown llm provider/i
    );
  });
});

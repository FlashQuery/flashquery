import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

const tempDirs: string[] = [];

function writeConfig(extraYaml = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-graph-config-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, `${baseConfigYaml()}${extraYaml}`);
  return configPath;
}

function baseConfigYaml(): string {
  return `
instance:
  name: "Graph Config Test"
  id: "graph-config-test"
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
    - name: graph-classifier
      description: Graph classifier
      models:
        - gpt-4o
embeddings:
  - name: primary
    dimensions: 1536
    endpoints:
      - provider_name: openai
        model: text-embedding-3-small
`;
}

describe('graph config', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-U-001 no graph block resolves to disabled graph defaults', () => {
    const config = loadConfig(writeConfig());

    expect(config.graph).toMatchObject({ enabled: false });
  });

  it('T-U-002 graph.enabled:false preserves disabled config behavior', () => {
    const config = loadConfig(writeConfig(`
graph:
  enabled: false
`));

    expect(config.graph).toMatchObject({ enabled: false });
  });

  it('T-U-003 partial enabled graph config without required embedding fails', () => {
    expect(() =>
      loadConfig(writeConfig(`
graph:
  enabled: true
`))
    ).toThrow(/graph\.embedding_name.*required/i);
  });

  it('T-U-004 valid graph config resolves embedding and classification purpose', () => {
    const config = loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: primary
  classification_purpose: graph-classifier
`));

    expect(config.graph).toMatchObject({
      enabled: true,
      embeddingName: 'primary',
      classificationPurpose: 'graph-classifier',
    });
  });

  it('T-U-005 unknown graph.embedding_name fails config load', () => {
    expect(() =>
      loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: missing
`))
    ).toThrow(/graph\.embedding_name 'missing'.*unknown embedding/i);
  });

  it('T-U-006 classification resolver keys are mutually exclusive', () => {
    expect(() =>
      loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: primary
  classification_purpose: graph-classifier
  classification_model: gpt-4o
`))
    ).toThrow(/classification_purpose.*classification_model.*mutually exclusive/i);
  });

  it('T-U-007 omitted classification resolver enables Tier 1-only mode', () => {
    const config = loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: primary
`));

    expect(config.graph?.classificationPurpose).toBeUndefined();
    expect(config.graph?.classificationModel).toBeUndefined();
  });

  it('T-U-050 classification_purpose absent from llm.purposes fails', () => {
    expect(() =>
      loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: primary
  classification_purpose: missing-purpose
`))
    ).toThrow(/classification_purpose 'missing-purpose'.*unknown llm purpose/i);
  });

  it('T-U-051 classification_model absent from llm.models fails', () => {
    expect(() =>
      loadConfig(writeConfig(`
graph:
  enabled: true
  embedding_name: primary
  classification_model: missing-model
`))
    ).toThrow(/classification_model 'missing-model'.*unknown llm model/i);
  });
});

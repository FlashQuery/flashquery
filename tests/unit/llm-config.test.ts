import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

const BASE_CONFIG_YAML = `
instance:
  name: "Test FlashQuery"
  id: "test-fqc-llm"
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
`;

describe('loadConfig() — LLM three-layer schema', () => {
  it('[U-01] parses a valid three-layer llm config with one provider, one model, one purpose', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
      api_key: "\${OPENAI_API_KEY}"
  models:
    - name: gpt-4o
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: default
      description: "General"
      models: [gpt-4o]
`;
    writeFileSync(tmpFile, yamlContent);
    const prevEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-abc';
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers).toHaveLength(1);
      expect(config.llm?.providers[0].name).toBe('openai');
      expect(config.llm?.providers[0].apiKey).toBe('sk-test-abc');
      expect(config.llm?.providers[0].endpoint).toBe('https://api.openai.com');
      expect(config.llm?.models[0].providerName).toBe('openai');
      expect(config.llm?.models[0].costPerMillion.input).toBe(2.5);
      expect(config.llm?.models[0].costPerMillion.output).toBe(10);
      expect(config.llm?.purposes[0].models).toEqual(['gpt-4o']);
    } finally {
      unlinkSync(tmpFile);
      if (prevEnv === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevEnv;
    }
  });

  it('[U-02] accepts valid names matching [a-z0-9][a-z0-9_-]*: fast, local-ollama, auto_tag', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: fast
      type: openai-compatible
      endpoint: "https://api.fast.io"
    - name: local-ollama
      type: ollama
      endpoint: "http://localhost:11434"
    - name: auto_tag
      type: openai-compatible
      endpoint: "https://api.autotag.io"
  models:
    - name: fast-model
      provider_name: fast
      model: fast-model-id
      type: language
      cost_per_million:
        input: 0
        output: 0
    - name: local-model
      provider_name: local-ollama
      model: llama3
      type: language
      cost_per_million:
        input: 0
        output: 0
    - name: tag-model
      provider_name: auto_tag
      model: tag-model-id
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: "General"
      models: [fast-model, local-model, tag-model]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers).toHaveLength(3);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-03] accepts a purpose with empty models: [] list (deferred to runtime per PURP-02)', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: gpt-4o
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: empty-purpose
      description: "Empty fallback chain"
      models: []
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].models).toEqual([]);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-04] expands ${ENV_VAR} in api_key and endpoint per MOD-03', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: test-provider
      type: openai-compatible
      endpoint: "\${TEST_FQC_LLM_ENDPOINT}"
      api_key: "\${TEST_FQC_LLM_KEY}"
  models:
    - name: test-model
      provider_name: test-provider
      model: test-model-id
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: "General"
      models: [test-model]
`;
    writeFileSync(tmpFile, yamlContent);
    process.env.TEST_FQC_LLM_KEY = 'sk-expanded';
    process.env.TEST_FQC_LLM_ENDPOINT = 'https://example.invalid/v1';
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers[0].apiKey).toBe('sk-expanded');
      expect(config.llm?.providers[0].endpoint).toBe('https://example.invalid/v1');
    } finally {
      unlinkSync(tmpFile);
      delete process.env.TEST_FQC_LLM_KEY;
      delete process.env.TEST_FQC_LLM_ENDPOINT;
    }
  });

  it('[U-05] accepts cost_per_million: { input: 0, output: 0 } for local/free models per MOD-02', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: local-ollama
      type: ollama
      endpoint: "http://localhost:11434"
  models:
    - name: llama3
      provider_name: local-ollama
      model: llama3
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: "Local model"
      models: [llama3]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].costPerMillion.input).toBe(0);
      expect(config.llm?.models[0].costPerMillion.output).toBe(0);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-06] preserves arbitrary keys in purpose.defaults per PURP-01/PURP-03', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: gpt-4o
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: default
      description: "With defaults"
      models: [gpt-4o]
      defaults:
        temperature: 0.2
        max_tokens: 1024
        custom_flag: true
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].defaults).toBeDefined();
      expect(Object.keys(config.llm!.purposes[0].defaults!)).toEqual(expect.arrayContaining(['temperature']));
      expect(JSON.stringify(config.llm!.purposes[0].defaults)).toMatch(/1024/);
      expect(JSON.stringify(config.llm!.purposes[0].defaults)).toMatch(/true/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-07] config with no llm: section loads without error per CONF-05', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    writeFileSync(tmpFile, BASE_CONFIG_YAML);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-08] case-normalizes Nano -> nano and OpenAI -> openai per CONF-07', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: OpenAI
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: Nano
      provider_name: OpenAI
      model: nano
      type: language
      cost_per_million:
        input: 0.1
        output: 0.4
  purposes:
    - name: FAST
      description: "Fast purpose"
      models: [Nano]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers[0].name).toBe('openai');
      expect(config.llm?.models[0].name).toBe('nano');
      expect(config.llm?.models[0].providerName).toBe('openai');
      expect(config.llm?.purposes[0].name).toBe('fast');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-09] resolves mixed-case provider_name in model after lowercase normalization', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: gpt-4o
      provider_name: OpenAI
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: default
      description: "General"
      models: [gpt-4o]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].providerName).toBe('openai');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-10] rejects provider name with spaces with clear error per CONF-01', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: "my provider"
      type: openai-compatible
      endpoint: "https://api.example.com"
  models:
    - name: mymodel
      provider_name: "my provider"
      model: mymodel
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: "General"
      models: [mymodel]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/Provider name.*'my provider'.*\[a-z0-9\]\[a-z0-9_-\]\*/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-11] rejects duplicate model names post-normalization per CONF-02', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: Fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.6
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.6
  purposes:
    - name: default
      description: "General"
      models: [fast]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/duplicate.*model.*['"]?fast['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-12] rejects model with unknown provider_name per CONF-03', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: gpt-4o
      provider_name: nonexistent
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: default
      description: "General"
      models: [gpt-4o]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/model.*provider.*['"]?nonexistent['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-13] rejects purpose referencing nonexistent model per CONF-04', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: "https://api.openai.com"
  models:
    - name: gpt-4o
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes:
    - name: default
      description: "General"
      models: [ghost-model]
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/purpose.*model.*['"]?ghost-model['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[CONF-06] rejects pre-v3.0 flat llm: { provider, model } config with migration error', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const prevEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-abc';
    const yamlContent = BASE_CONFIG_YAML + `
llm:
  provider: openai
  model: gpt-4o
  api_key: "\${OPENAI_API_KEY}"
`;
    writeFileSync(tmpFile, yamlContent);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/pre-v3\.0 flat format/);
    } finally {
      unlinkSync(tmpFile);
      if (prevEnv === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevEnv;
    }
  });
});

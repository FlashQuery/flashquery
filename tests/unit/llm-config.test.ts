import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

// Minimal base config YAML — each test appends its own llm: section to a copy of this.
const BASE_CONFIG_YAML = `
instance:
  name: "Test FlashQuery"
  id: "test-fqc-llm"
  vault:
    path: "/tmp/test-vault-llm"
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
  provider: "none"
  model: ""
  dimensions: 1536
logging:
  level: "info"
  output: "stdout"
`;

describe('loadConfig() — LLM three-layer schema', () => {
  it('[U-01] parses a valid three-layer llm config with one provider, one model, one purpose', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-abc';
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      description: General
      models:
        - gpt-4o
`;
    writeFileSync(tmpFile, yaml);
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
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[U-02] accepts valid names matching [a-z0-9][a-z0-9_-]*: fast, local-ollama, auto_tag', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: fast
      type: openai-compatible
      endpoint: https://api.fast.example.com
    - name: local-ollama
      type: ollama
      endpoint: http://localhost:11434
    - name: auto_tag
      type: openai-compatible
      endpoint: https://api.auto.example.com
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
      model: llama3.2
      type: language
      cost_per_million:
        input: 0
        output: 0
    - name: auto-model
      provider_name: auto_tag
      model: auto-v1
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: All three providers
      models:
        - fast-model
        - local-model
        - auto-model
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers).toHaveLength(3);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-03] accepts a purpose with empty models: [] list (deferred to runtime per PURP-02)', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      description: Purpose with no models yet
      models: []
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].models).toEqual([]);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-04] expands ${ENV_VAR} in api_key and endpoint per MOD-03', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const prevKey = process.env['TEST_FQC_LLM_KEY'];
    const prevEndpoint = process.env['TEST_FQC_LLM_ENDPOINT'];
    process.env['TEST_FQC_LLM_KEY'] = 'sk-expanded';
    process.env['TEST_FQC_LLM_ENDPOINT'] = 'https://example.invalid/v1';
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: testprovider
      type: openai-compatible
      endpoint: "\${TEST_FQC_LLM_ENDPOINT}"
      api_key: "\${TEST_FQC_LLM_KEY}"
  models:
    - name: testmodel
      provider_name: testprovider
      model: gpt-4o
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: default
      description: Test purpose
      models:
        - testmodel
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.providers[0].apiKey).toBe('sk-expanded');
      expect(config.llm?.providers[0].endpoint).toBe('https://example.invalid/v1');
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['TEST_FQC_LLM_KEY'];
      else process.env['TEST_FQC_LLM_KEY'] = prevKey;
      if (prevEndpoint === undefined) delete process.env['TEST_FQC_LLM_ENDPOINT'];
      else process.env['TEST_FQC_LLM_ENDPOINT'] = prevEndpoint;
    }
  });

  it('[U-05] accepts cost_per_million: { input: 0, output: 0 } for local/free models per MOD-02', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: local
      type: ollama
      endpoint: http://localhost:11434
  models:
    - name: llama3
      provider_name: local
      model: llama3.2
      type: language
      cost_per_million:
        input: 0
        output: 0
  purposes:
    - name: free
      description: Free local model
      models:
        - llama3
`;
    writeFileSync(tmpFile, yaml);
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
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      description: General
      models:
        - gpt-4o
      defaults:
        temperature: 0.2
        max_tokens: 1024
        custom_flag: true
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].defaults).toBeDefined();
      // temperature key must be present regardless of camelCase conversion
      expect(Object.keys(config.llm!.purposes[0].defaults!)).toEqual(
        expect.arrayContaining(['temperature'])
      );
      // 1024 and true must be preserved regardless of key name transformation
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
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: OpenAI
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: Nano
      provider_name: OpenAI
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.6
  purposes:
    - name: FAST
      description: Fast purpose
      models:
        - Nano
`;
    writeFileSync(tmpFile, yaml);
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
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      description: General
      models:
        - gpt-4o
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].providerName).toBe('openai');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-10] rejects provider name with spaces with clear error per CONF-01', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: my provider
      type: openai-compatible
      endpoint: https://api.openai.com
  models: []
  purposes: []
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/Provider name.*'my provider'.*\[a-z0-9\]\[a-z0-9_-\]\*/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-11] rejects duplicate model names post-normalization per CONF-02', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      model: gpt-4o-mini-v2
      type: language
      cost_per_million:
        input: 0.15
        output: 0.6
  purposes: []
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/duplicate.*model.*['"]?fast['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-12] rejects model with unknown provider_name per CONF-03', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: gpt-4o
      provider_name: nonexistent
      model: gpt-4o
      type: language
      cost_per_million:
        input: 2.5
        output: 10.0
  purposes: []
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/model.*provider.*['"]?nonexistent['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-13] rejects purpose referencing nonexistent model per CONF-04', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
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
      description: General
      models:
        - ghost-model
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/purpose.*model.*['"]?ghost-model['"]?/i);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[CONF-06] rejects pre-v3.0 flat llm: { provider, model } config with migration error', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-abc';
    const yaml = BASE_CONFIG_YAML + `
llm:
  provider: openai
  model: gpt-4o
  api_key: "\${OPENAI_API_KEY}"
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/pre-v3\.0 flat format/);
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });
});

describe('loadConfig() — DISC-05 optional model fields', () => {
  it('[U-DISC-05-01] parses a model declaring all three optional fields (description, context_window, capabilities)', () => {
    const tmpFile = join(tmpdir(), `fqc-disc05-01-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      description: "A fast small model for routine tasks"
      context_window: 131072
      capabilities: ["tools", "vision"]
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].description).toBe('A fast small model for routine tasks');
      expect(config.llm?.models[0].contextWindow).toBe(131072);
      expect(config.llm?.models[0].capabilities).toEqual(['tools', 'vision']);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-02] omits all three optional fields when not declared (undefined, NOT null/empty)', () => {
    const tmpFile = join(tmpdir(), `fqc-disc05-02-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].description).toBeUndefined();
      expect(config.llm?.models[0].contextWindow).toBeUndefined();
      expect(config.llm?.models[0].capabilities).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-03] preserves capabilities: [] (declared empty array, NOT undefined)', () => {
    const tmpFile = join(tmpdir(), `fqc-disc05-03-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      capabilities: []
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].capabilities).toEqual([]);
      expect(config.llm?.models[0].capabilities).not.toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-04] declaring description only leaves context_window and capabilities undefined', () => {
    const tmpFile = join(tmpdir(), `fqc-disc05-04-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      description: "Just description"
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].description).toBe('Just description');
      expect(config.llm?.models[0].contextWindow).toBeUndefined();
      expect(config.llm?.models[0].capabilities).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-05] rejects context_window: -1 and 0 and 1.5 at parse time (positive integer constraint)', () => {
    const buildYaml = (cw: string) => BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      context_window: ${cw}
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    for (const bad of ['-1', '0', '1.5']) {
      const tmpFile = join(tmpdir(), `fqc-disc05-05-${bad}-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
      writeFileSync(tmpFile, buildYaml(bad));
      try {
        expect(() => loadConfig(tmpFile)).toThrow();
      } finally {
        unlinkSync(tmpFile);
      }
    }
  });

  it('[U-DISC-05-06] passes custom capability strings through unchanged (no validation of values)', () => {
    const tmpFile = join(tmpdir(), `fqc-disc05-06-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      capabilities: ["tools", "custom-thing-no-validation", "vision-experimental"]
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].capabilities).toEqual(['tools', 'custom-thing-no-validation', 'vision-experimental']);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

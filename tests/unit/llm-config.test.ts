import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { loadConfig } from '../../src/config/loader.js';
import { modelCapabilitiesWithDefaults } from '../../src/llm/capabilities.js';
import { logger } from '../../src/logging/logger.js';

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
templates:
  default_access: restrictive
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
templates:
  default_access: restrictive
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
templates:
  default_access: restrictive
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
templates:
  default_access: restrictive
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
templates:
  default_access: restrictive
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

  it('hard-fails removed legacy purpose tool names with replacement suggestions and no aliases', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-legacy-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
        input: 1
        output: 1
  purposes:
    - name: default
      description: General
      models: [gpt-4o]
      tools: [search_documents, save_memory, force_file_scan]
      excluded_tools: [create_document]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow("Tool 'search_documents' has been replaced by 'search'");
      expect(() => loadConfig(tmpFile)).toThrow("Tool 'create_document' has been replaced by 'write_document'");
      expect(() => loadConfig(tmpFile)).toThrow("Tool 'save_memory' has been replaced by 'write_memory'");
      expect(() => loadConfig(tmpFile)).toThrow("Tool 'force_file_scan' has been replaced by 'maintain_vault'");
      expect(() => loadConfig(tmpFile)).toThrow('FlashQuery does not alias legacy tool names');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('keeps transitional purpose tool names valid until their removal gates', () => {
    const tmpFile = join(tmpdir(), `fqc-llm-transitional-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
        input: 1
        output: 1
  purposes:
    - name: default
      description: General
      models: [gpt-4o]
      tools: [get_briefing, insert_doc_link]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].tools).toEqual(['get_briefing', 'insert_doc_link']);
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

  it('[ATL-U-08] parses purpose tools, excluded_tools, templates, provider defaults, and numeric loop guardrails', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-purpose-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
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
    - name: researcher
      description: Research with bounded loop controls
      models:
        - gpt-4o
      tools:
        - get_memory
      excluded_tools:
        - search_records
      templates:
        - Templates/research.md
      defaults:
        temperature: 0.2
        vendor_flag: enabled
        response_format:
          type: json_object
        timeout_ms: 30000
        max_cost_usd: 0.25
        max_tokens_budget: 12000
        max_iterations: 5
        result_summary_chars: 2000
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      const purpose = config.llm?.purposes[0];
      expect(purpose?.tools).toEqual(['get_memory']);
      expect(purpose?.excludedTools).toEqual(['search_records']);
      expect(purpose?.templates).toEqual(['Templates/research.md']);
      expect(purpose?.defaults?.['temperature']).toBe(0.2);
      expect(purpose?.defaults?.['vendor_flag']).toBe('enabled');
      expect(purpose?.defaults?.['timeout_ms']).toBe(30000);
      expect(purpose?.defaults?.['max_cost_usd']).toBe(0.25);
      expect(purpose?.defaults?.['max_tokens_budget']).toBe(12000);
      expect(purpose?.defaults?.['max_iterations']).toBe(5);
      expect(purpose?.defaults?.['result_summary_chars']).toBe(2000);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects excluded_tools without tools', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-excluded-without-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
      cost_per_million: { input: 2.5, output: 10.0 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [gpt-4o]
      excluded_tools: [get_memory]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/\[purpose\].*excluded_tools requires tools/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects unknown purpose tool tier names', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-unknown-tier-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
      cost_per_million: { input: 2.5, output: 10.0 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [gpt-4o]
      tools: [tier:unknown]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/\[purpose\].*unknown tool tier 'tier:unknown'/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects unknown native tools in tools', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-unknown-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
      cost_per_million: { input: 2.5, output: 10.0 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [gpt-4o]
      tools: [not_a_tool]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/\[purpose\].*unknown native tool 'not_a_tool'/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects unknown native tools in excluded_tools', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-unknown-excluded-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
      cost_per_million: { input: 2.5, output: 10.0 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [gpt-4o]
      tools: [tier:read-only]
      excluded_tools: [not_a_tool]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/\[purpose\].*unknown native tool 'not_a_tool'/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] preserves hard-excluded native tool declarations for registry diagnostics', () => {
    vi.mocked(logger.warn).mockClear();
    const tmpFile = join(tmpdir(), `fqc-atl-u08-hard-excluded-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
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
      cost_per_million: { input: 2.5, output: 10.0 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [gpt-4o]
      tools: [call_model, register_plugin]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes[0].tools).toEqual(['call_model', 'register_plugin']);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("purpose 'agentic' lists hard-excluded native tool 'call_model'"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("purpose 'agentic' lists hard-excluded native tool 'register_plugin'"));
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] defaults top-level templates.default_access to permissive', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-templates-default-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    writeFileSync(tmpFile, BASE_CONFIG_YAML);
    try {
      expect(loadConfig(tmpFile).templates?.defaultAccess).toBe('permissive');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] accepts only permissive or restrictive for templates.default_access', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-templates-invalid-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: open
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/templates\.default_access/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects unknown top-level purpose keys including tols and audit_document', () => {
    const buildYaml = (field: string) => BASE_CONFIG_YAML + `
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
      ${field}: true
`;

    for (const field of ['tols', 'audit_document']) {
      const tmpFile = join(tmpdir(), `fqc-atl-u08-unknown-${field}-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
      writeFileSync(tmpFile, buildYaml(field));
      try {
        expect(() => loadConfig(tmpFile)).toThrow(new RegExp(field));
      } finally {
        unlinkSync(tmpFile);
      }
    }
  });

  it('[ATL-U-08] rejects non-number loop guardrail defaults while preserving provider parameters', () => {
    const buildYaml = (key: string) => BASE_CONFIG_YAML + `
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
        temperature: 0.1
        vendor_flag: passthrough
        ${key}: bad
`;

    for (const key of ['timeout_ms', 'max_cost_usd', 'max_tokens_budget', 'max_iterations', 'result_summary_chars']) {
      const tmpFile = join(tmpdir(), `fqc-atl-u08-guardrail-${key}-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
      writeFileSync(tmpFile, buildYaml(key));
      try {
        expect(() => loadConfig(tmpFile)).toThrow(new RegExp(key));
      } finally {
        unlinkSync(tmpFile);
      }
    }
  });

  it('[ATL-U-08] migrates legacy string capabilities to tags and preserves structured behavioral capabilities', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-capabilities-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: legacy
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      capabilities:
        - tools
        - vision
    - name: structured
      provider_name: openai
      model: gpt-4o
      type: language
      cost_per_million: { input: 2.5, output: 10.0 }
      tags: ["vision"]
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: false
        parallel_tool_calls: true
        structured_outputs_with_tools: true
  purposes:
    - name: default
      description: General
      models: [legacy, structured]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].tags).toEqual(['tools', 'vision']);
      expect(config.llm?.models[0].capabilities).toBeUndefined();
      expect(config.llm?.models[1].tags).toEqual(['vision']);
      expect(config.llm?.models[1].capabilities).toEqual({
        tool_calling: true,
        usage_on_tool_calls: true,
        strict_tools: false,
        parallel_tool_calls: true,
        structured_outputs_with_tools: true,
      });
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
  it('[U-DISC-05-01] parses optional discovery metadata plus structured behavioral capabilities', () => {
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
      tags: ["vision"]
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: true
        parallel_tool_calls: false
        structured_outputs_with_tools: true
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
      expect(config.llm?.models[0].tags).toEqual(['vision']);
      expect(config.llm?.models[0].capabilities).toEqual({
        tool_calling: true,
        usage_on_tool_calls: true,
        strict_tools: true,
        parallel_tool_calls: false,
        structured_outputs_with_tools: true,
      });
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-02] omits optional model metadata when not declared (undefined, NOT null/empty)', () => {
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
      expect(config.llm?.models[0].tags).toBeUndefined();
      expect(config.llm?.models[0].capabilities).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-03] migrates an explicitly empty legacy capability list to empty tags', () => {
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
      capabilities:
        []
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].tags).toEqual([]);
      expect(config.llm?.models[0].tags).not.toBeUndefined();
      expect(config.llm?.models[0].capabilities).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[U-DISC-05-04] declaring description only leaves context_window, tags, and capabilities undefined', () => {
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
      expect(config.llm?.models[0].tags).toBeUndefined();
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

  it('[U-DISC-05-06] migrates custom legacy capability strings to tags', () => {
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
      capabilities:
        - tools
        - legacy-custom-tag
        - vision-experimental
  purposes:
    - name: default
      description: General
      models: [fast]
`;
    writeFileSync(tmpFile, yaml);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models[0].tags).toEqual(['tools', 'legacy-custom-tag', 'vision-experimental']);
      expect(config.llm?.models[0].capabilities).toBeUndefined();
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

describe('loadConfig() — ATL-U-08 capability admission', () => {
  it('[ATL-U-08] defaults official OpenAI structured capabilities to true', () => {
    const caps = modelCapabilitiesWithDefaults(
      { capabilities: undefined },
      { name: 'openai', type: 'openai-compatible' }
    );
    expect(caps).toEqual({
      tool_calling: true,
      usage_on_tool_calls: true,
      strict_tools: true,
      parallel_tool_calls: true,
      structured_outputs_with_tools: true,
    });
  });

  it('[ATL-U-08] leaves openrouter, custom OpenAI-compatible, and ollama capabilities as unknown declarations', () => {
    for (const provider of [
      { name: 'openrouter', type: 'openai-compatible' as const },
      { name: 'custom', type: 'openai-compatible' as const },
      { name: 'local-ollama', type: 'ollama' as const },
    ]) {
      const caps = modelCapabilitiesWithDefaults({ capabilities: undefined }, provider);
      expect(caps.tool_calling).toBeUndefined();
      expect(caps.usage_on_tool_calls).toBeUndefined();
      expect(caps.structured_outputs_with_tools).toBeUndefined();
    }
  });

  it('[ATL-U-08] rejects tool-exposing purposes when a fallback model has unknown declaration diagnostics with remediation', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-unknown-admission-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openrouter
      type: openai-compatible
      endpoint: https://openrouter.ai/api
  models:
    - name: router-model
      provider_name: openrouter
      model: anthropic/claude-sonnet-4.5
      type: language
      cost_per_million: { input: 3, output: 15 }
  purposes:
    - name: agentic
      description: Agentic purpose
      models: [router-model]
      tools: [get_memory]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/unknown declaration.*capabilities\.tool_calling: true\|false.*capabilities\.usage_on_tool_calls: true\|false/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects template-exposing purposes when a fallback model declares unsupported usage_on_tool_calls', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-unsupported-admission-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
  models:
    - name: weak
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million: { input: 0.15, output: 0.6 }
      capabilities:
        tool_calling: true
        usage_on_tool_calls: false
  purposes:
    - name: templated
      description: Template tool purpose
      models: [weak]
      templates: [Templates/research-skill.md]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/declared unsupported.*usage_on_tool_calls/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] rejects permissive default template exposure when capabilities are unknown', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-permissive-mode2-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
llm:
  providers:
    - name: local
      type: ollama
      endpoint: http://localhost:11434
  models:
    - name: llama
      provider_name: local
      model: llama3.2
      type: language
      cost_per_million: { input: 0, output: 0 }
  purposes:
    - name: plain
      description: Plain purpose with default template exposure
      models: [llama]
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/unknown declaration.*capabilities\.tool_calling: true\|false/);
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('[ATL-U-08] treats restrictive/no-binding purposes as Mode 1 even when capabilities are unknown', () => {
    const tmpFile = join(tmpdir(), `fqc-atl-u08-mode1-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    const yaml = BASE_CONFIG_YAML + `
templates:
  default_access: restrictive
llm:
  providers:
    - name: local
      type: ollama
      endpoint: http://localhost:11434
  models:
    - name: llama
      provider_name: local
      model: llama3.2
      type: language
      cost_per_million: { input: 0, output: 0 }
  purposes:
    - name: plain
      description: Plain Mode 1 purpose
      models: [llama]
      defaults:
        response_format:
          type: json_object
`;
    writeFileSync(tmpFile, yaml);
    try {
      expect(loadConfig(tmpFile).llm?.purposes[0].name).toBe('plain');
    } finally {
      unlinkSync(tmpFile);
    }
  });
});

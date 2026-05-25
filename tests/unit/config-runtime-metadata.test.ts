import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDeprecationWarnings,
  getLlmApiKeyRefs,
  getResolvedHostToolExposure,
  getStartupWarnings,
  loadConfig,
  type FlashQueryConfig,
} from '../../src/config/loader.js';

const tempFiles: string[] = [];

function writeTempConfig(name: string, yaml: string): string {
  const path = join(tmpdir(), `fqc-${name}-${process.pid}-${Date.now()}-${tempFiles.length}.yaml`);
  writeFileSync(path, yaml);
  tempFiles.push(path);
  return path;
}

afterEach(() => {
  while (tempFiles.length > 0) {
    const path = tempFiles.pop();
    if (!path) continue;
    try {
      unlinkSync(path);
    } catch {
      // Best-effort cleanup for temp config files.
    }
  }
  delete process.env['OPENAI_API_KEY'];
});

function minimalYaml(extra: string): string {
  return `
instance:
  id: "runtime-metadata-test"
  vault:
    path: "./vault"
supabase:
  url: "https://test.supabase.co"
  service_role_key: "key"
  database_url: "postgresql://localhost/db"
embedding:
  provider: "none"
  model: ""
${extra}`;
}

describe('config runtime metadata', () => {
  it('[T-U-026] preserves loaded deprecation and startup warning metadata through accessors', () => {
    const configPath = writeTempConfig(
      'warnings',
      minimalYaml(`
host_mcp_tools:
  tools:
    - category:system
`)
    );

    const config = loadConfig(configPath);

    expect(getDeprecationWarnings(config)).toEqual([
      expect.stringContaining('rename to flashquery.yml'),
    ]);
    expect(getStartupWarnings(config)).toEqual([
      expect.stringContaining('only system category enabled'),
    ]);
  });

  it('[T-U-027] returns stored host exposure for loaded configs and recomputes fallback for manual configs', () => {
    const configPath = writeTempConfig(
      'host-exposure',
      minimalYaml(`
host_mcp_tools:
  tools:
    - category:doc-read
  excluded_tools:
    - search
`)
    );
    const loadedConfig = loadConfig(configPath);

    loadedConfig.hostMcpTools = { tools: ['category:system'] };

    expect(getResolvedHostToolExposure(loadedConfig).hostEnabledToolNames).toContain('get_document');
    expect(getResolvedHostToolExposure(loadedConfig).hostEnabledToolNames).not.toContain('maintain_vault');

    const manualConfig = {
      ...loadedConfig,
      hostMcpTools: { tools: ['category:system'] },
    } satisfies FlashQueryConfig;

    expect(getResolvedHostToolExposure(manualConfig).hostEnabledToolNames).toContain('maintain_vault');
    expect(getResolvedHostToolExposure(manualConfig).hostEnabledToolNames).not.toContain('get_document');
  });

  it('[T-U-028] returns raw LLM api_key refs without leaking resolved secret values', () => {
    process.env['OPENAI_API_KEY'] = 'sk-resolved-secret';
    const configPath = writeTempConfig(
      'llm-raw-ref',
      minimalYaml(`
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
      api_key: \${OPENAI_API_KEY}
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
      models: [gpt-4o]
`)
    );

    const config = loadConfig(configPath);
    const rawRefs = getLlmApiKeyRefs(config);

    expect(rawRefs.get('openai')).toBe('${OPENAI_API_KEY}');
    expect([...rawRefs.values()]).not.toContain('sk-resolved-secret');
    expect(config.llm?.providers[0]?.apiKey).toBe('sk-resolved-secret');
  });

  it('[T-U-029] removes selected config metadata side-channel casts from loader.ts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/config/loader.ts'), 'utf8');
    const selectedMetadataCastPattern =
      /as unknown as Record<string, unknown>.*_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs)|_(deprecationWarnings|startupWarnings|resolvedHostToolExposure|rawLlmApiKeyRefs).*as unknown as Record<string, unknown>/;

    expect(source).not.toMatch(selectedMetadataCastPattern);
  });
});

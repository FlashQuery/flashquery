import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

// Minimal base config YAML — each LLM test appends the un-commented LLM block to this.
// embedding.provider: "none" keeps the legacy embedding path quiet so tests isolate the LLM section.
const BASE_CONFIG_YAML = `
instance:
  name: "Test FlashQuery"
  id: "test-fqc-tmpl"
  vault:
    path: "/tmp/test-vault-tmpl"
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

/**
 * Extracts the commented `# llm:` block from a raw YAML string and returns it
 * with one leading `# ` (or `#`) prefix stripped per line, producing a valid
 * YAML fragment. Lines starting with `# # ` (double-commented sub-examples)
 * become `# ` after stripping one prefix, so YAML still treats them as
 * comments — this isolates the default shipping config from the extra examples.
 *
 * Stops at the first blank line or any non-`#`-prefixed line after the block.
 */
function extractCommentedLlmBlock(raw: string): string {
  const lines = raw.split('\n');
  const startIdx = lines.findIndex(l => /^# llm:\s*$/.test(l));
  if (startIdx === -1) throw new Error('# llm: header not found in template');
  const out: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Strip ONE leading "# " (preserving deeper "# " for sub-examples that should stay commented)
    if (line.startsWith('# ')) out.push(line.slice(2));
    else if (line === '#') out.push('');
    else if (line.trim() === '') { out.push(''); break; } // blank line ends the block
    else break;
  }
  return out.join('\n');
}

describe('Phase 105 — Config Template Updates (TMPL-01)', () => {
  it('[TMPL-01] flashquery.example.yml LLM block parses through loadConfig() after un-commenting', () => {
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const rawYaml = readFileSync(examplePath, 'utf-8');
    const llmBlock = extractCommentedLlmBlock(rawYaml);
    const combined = BASE_CONFIG_YAML + llmBlock;
    const tmpFile = join(tmpdir(), `fqc-tmpl-test-parse-${Date.now()}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-for-template-validation';
    writeFileSync(tmpFile, combined);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm).toBeDefined();
      // After 105-01: endpoint must include /v1 suffix (D-02). Current template has https://api.openai.com (missing /v1).
      expect(config.llm?.providers[0].endpoint).toBe('https://api.openai.com/v1');
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] flashquery.example.yml uses provider_name (not provider) for model entries', () => {
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const rawYaml = readFileSync(examplePath, 'utf-8');
    const llmBlock = extractCommentedLlmBlock(rawYaml);
    const combined = BASE_CONFIG_YAML + llmBlock;
    const tmpFile = join(tmpdir(), `fqc-tmpl-test-provname-${Date.now()}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-for-template-validation';
    writeFileSync(tmpFile, combined);
    try {
      const config = loadConfig(tmpFile);
      // After parse: camelCase field is providerName
      expect(config.llm?.models[0].providerName).toBe('openai');
      // Raw extracted block must contain provider_name: and NOT have a bare "provider:" line
      expect(llmBlock).toMatch(/provider_name:/);
      expect(llmBlock).not.toMatch(/^\s*-?\s*provider:\s/m);
      // After 105-01: there must be exactly 2 models. Current template has 1 model (gpt-4o) — fails today.
      expect(config.llm?.models).toHaveLength(2);
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] flashquery.example.yml has exactly 1 active provider (openai) with correct endpoint', () => {
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const rawYaml = readFileSync(examplePath, 'utf-8');
    const llmBlock = extractCommentedLlmBlock(rawYaml);
    const combined = BASE_CONFIG_YAML + llmBlock;
    const tmpFile = join(tmpdir(), `fqc-tmpl-test-providers-${Date.now()}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-for-template-validation';
    writeFileSync(tmpFile, combined);
    try {
      const config = loadConfig(tmpFile);
      // The helper strips ONE "# " per line, so double-commented "# # " lines remain
      // commented after stripping — only the default openai provider is active.
      expect(config.llm?.providers).toHaveLength(1);
      expect(config.llm?.providers[0].name).toBe('openai');
      expect(config.llm?.providers[0].endpoint).toBe('https://api.openai.com/v1');
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] flashquery.example.yml has exactly 2 default models: embeddings (text-embedding-3-small, embedding) and fast (gpt-5-nano, language)', () => {
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const rawYaml = readFileSync(examplePath, 'utf-8');
    const llmBlock = extractCommentedLlmBlock(rawYaml);
    const combined = BASE_CONFIG_YAML + llmBlock;
    const tmpFile = join(tmpdir(), `fqc-tmpl-test-models-${Date.now()}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-for-template-validation';
    writeFileSync(tmpFile, combined);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.models).toHaveLength(2);
      // First model: embeddings
      const embedModel = config.llm?.models.find(m => m.name === 'embeddings');
      expect(embedModel).toBeDefined();
      expect(embedModel?.model).toBe('text-embedding-3-small');
      expect(embedModel?.type).toBe('embedding');
      expect(embedModel?.costPerMillion.input).toBe(0.02);
      expect(embedModel?.costPerMillion.output).toBe(0.00);
      // Second model: fast
      const fastModel = config.llm?.models.find(m => m.name === 'fast');
      expect(fastModel).toBeDefined();
      expect(fastModel?.model).toBe('gpt-5-nano');
      expect(fastModel?.type).toBe('language');
      expect(fastModel?.costPerMillion.input).toBe(0.15);
      expect(fastModel?.costPerMillion.output).toBe(0.60);
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] flashquery.example.yml has exactly 2 default purposes: embedding and general — no default purpose', () => {
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const rawYaml = readFileSync(examplePath, 'utf-8');
    const llmBlock = extractCommentedLlmBlock(rawYaml);
    const combined = BASE_CONFIG_YAML + llmBlock;
    const tmpFile = join(tmpdir(), `fqc-tmpl-test-purposes-${Date.now()}.yml`);
    const prevKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-test-for-template-validation';
    writeFileSync(tmpFile, combined);
    try {
      const config = loadConfig(tmpFile);
      expect(config.llm?.purposes).toHaveLength(2);
      const names = config.llm?.purposes.map(p => p.name).sort();
      expect(names).toEqual(['embedding', 'general']);
      // No 'default' purpose
      expect(llmBlock).not.toMatch(/purposes:[\s\S]*?name:\s*default\b/);
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] no flat llm: { provider, model } format remains in any of the 3 template files', () => {
    const exampleYml = readFileSync(resolve(process.cwd(), 'flashquery.example.yml'), 'utf-8');
    const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf-8');
    const envTestExample = readFileSync(resolve(process.cwd(), '.env.test.example'), 'utf-8');

    for (const [filename, content] of [
      ['flashquery.example.yml', exampleYml],
      ['.env.example', envExample],
      ['.env.test.example', envTestExample],
    ] as [string, string][]) {
      // The old flat format was: llm:\n  provider: <value>
      // This regex matches that pattern. None of the 3 template files should have it.
      expect(
        content,
        `${filename} must not contain old flat llm: { provider, model } format`
      ).not.toMatch(/llm:\s*\n\s+provider:\s/);
    }

    // After 105-01: stale gpt-4o model name must be gone from flashquery.example.yml
    // (replaced by the default shipping config with embeddings + fast models — D-03).
    // The current template shows gpt-4o as the default model — this assertion fails today.
    expect(exampleYml).not.toMatch(/^\s*#\s+- name: gpt-4o\s*$/m);
  });

  it('[TMPL-01] .env.example has OPENAI_API_KEY as an active (uncommented) variable entry', () => {
    const content = readFileSync(resolve(process.cwd(), '.env.example'), 'utf-8');
    // Must have an uncommented OPENAI_API_KEY= line
    expect(content).toMatch(/^OPENAI_API_KEY=/m);
    // OPENROUTER_API_KEY must remain commented (D-08)
    expect(content).toMatch(/^# OPENROUTER_API_KEY=/m);
  });

  it('[TMPL-01] .env.test.example contains a commented OPENROUTER_API_KEY entry', () => {
    const content = readFileSync(resolve(process.cwd(), '.env.test.example'), 'utf-8');
    // Must have a commented OPENROUTER_API_KEY entry (D-11)
    expect(content).toMatch(/^# OPENROUTER_API_KEY=/m);
    // OPENAI_API_KEY must still be present (D-10 — not regressed)
    expect(content).toMatch(/^OPENAI_API_KEY=/m);
  });
});

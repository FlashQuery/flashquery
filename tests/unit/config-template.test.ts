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
 * Extracts the LLM block from a raw YAML string and returns a valid YAML
 * fragment that can be appended to BASE_CONFIG_YAML and parsed by loadConfig().
 *
 * Supports two template shapes:
 *   - Legacy commented: `# llm:` heading — strips one "# " per line
 *   - Active defaults (post-106): bare `llm:` heading — passes active lines
 *     through verbatim; strips "# " from single-commented sub-examples so they
 *     remain comments in the output (double-commented → stays commented after parse).
 *
 * Stops when a top-level YAML key (column-0, non-comment, non-llm) is encountered.
 */
function extractCommentedLlmBlock(raw: string): string {
  const lines = raw.split('\n');
  // Accept either `# llm:` (legacy commented) or `llm:` (post-106 active heading).
  let startIdx = lines.findIndex(l => /^# llm:\s*$/.test(l));
  let isCommented = startIdx !== -1;
  if (!isCommented) {
    startIdx = lines.findIndex(l => /^llm:\s*$/.test(l));
  }
  if (startIdx === -1) throw new Error('llm: header (commented or active) not found in template');
  const out: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isCommented) {
      // Legacy mode: strip one leading "# " per line.
      if (line.startsWith('# ')) out.push(line.slice(2));
      else if (line === '#') out.push('');
      else if (line.trim() === '') { out.push(''); break; }
      else break;
    } else {
      // Active mode: pass through bare lines verbatim; strip "# " from sub-examples
      // so that single-commented sub-examples become double-commented after parse
      // (i.e., they remain comments and don't get included in the parsed config).
      if (line.length === 0) {
        // blank line — keep as a separator unless it ends the section
        out.push('');
      } else if (line.startsWith('#')) {
        // Comment line — include verbatim so YAML treats it as a comment.
        out.push(line);
      } else if (/^\S/.test(line) && !/^llm:/.test(line) && i !== startIdx) {
        // A new top-level YAML key (column 0, no leading space) ends the section.
        break;
      } else {
        out.push(line);
      }
    }
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
      // After Phase 106 B-01 fix: endpoint is the BASE URL (no /v1 suffix); src/llm/client.ts appends /v1/chat/completions itself.
      expect(config.llm?.providers[0].endpoint).toBe('https://api.openai.com');
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

  it('[TMPL-01] flashquery.example.yml has 2 active providers — openai (default) and local-ollama (local: true demonstration per Verification Correction 4)', () => {
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
      // Verification Correction 4: live (uncommented) provider with `local: true`
      // is required so the config example demonstrates the field — not just shows
      // it inside a commented-out block.
      expect(config.llm?.providers).toHaveLength(2);

      const openai = config.llm?.providers.find((p) => p.name === 'openai');
      expect(openai).toBeDefined();
      expect(openai?.endpoint).toBe('https://api.openai.com');
      expect(openai?.local).toBeUndefined();

      const ollama = config.llm?.providers.find((p) => p.name === 'local-ollama');
      expect(ollama).toBeDefined();
      expect(ollama?.type).toBe('ollama');
      expect(ollama?.endpoint).toBe('http://localhost:11434');
      expect(ollama?.local).toBe(true);
    } finally {
      unlinkSync(tmpFile);
      if (prevKey === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = prevKey;
    }
  });

  it('[TMPL-01] flashquery.example.yml has exactly 2 default models: embeddings (text-embedding-3-small, embedding) and fast (gpt-4o-mini, language)', () => {
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
      expect(fastModel?.model).toBe('gpt-4o-mini');
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

  it('[DISC-05] flashquery.example.yml shows optional discovery fields on model entries and local on commented Ollama provider', () => {
    // Correction 4: flashquery.example.yml must annotate the new optional discovery fields
    // so users know they exist when copying the template (DISC-05, dev plan §6.4.1).
    const examplePath = resolve(process.cwd(), 'flashquery.example.yml');
    const content = readFileSync(examplePath, 'utf-8');

    // model entries must show context_window, capabilities, and description fields
    expect(content).toMatch(/context_window:/);
    expect(content).toMatch(/capabilities:/);
    // description: field on at least one model entry
    // (purposes already have description:, so we check the models section specifically)
    const modelsSection = content.slice(content.indexOf('\n  models:'));
    expect(modelsSection).toMatch(/description:/);

    // The commented-out Ollama provider block must include local: true
    expect(content).toMatch(/local:\s*true/);

    // Comment explaining these fields are surfaced via list_models discovery
    expect(content).toMatch(/list_models/);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HELP_HINT,
  TOOL_META_GLOB,
  validateToolMeta,
} from '../../../src/services/tool-search/tool-meta.js';

const CORE_HELP_PAGE_BATCH = [
  'apply_tags',
  'archive_document',
  'archive_memory',
  'copy_document',
  'get_document',
  'get_memory',
  'search',
  'write_document',
  'write_memory',
] as const;

const RECORD_PLUGIN_HELP_PAGE_BATCH = [
  'archive_record',
  'clear_pending_reviews',
  'get_plugin_info',
  'get_record',
  'register_plugin',
  'search_records',
  'unregister_plugin',
  'write_record',
] as const;

const LLM_VAULT_EDITING_HELP_PAGE_BATCH = [
  'call_macro',
  'call_model',
  'get_briefing',
  'get_llm_usage',
  'insert_doc_link',
  'insert_in_doc',
  'list_vault',
  'maintain_vault',
  'manage_directory',
  'move_document',
  'remove_document',
  'replace_doc_section',
  'search_tools',
] as const;

const CANONICAL_CALL_MACRO_DESCRIPTION =
  'Execute a FlashQuery macro to chain multiple tool operations, pass intermediate results between them, or run conditional logic in a single round-trip. Use for compound or composite work that combines several individual FlashQuery tool calls into one orchestrated execution. The macro language supports variables, conditionals, loops, and composition of any FlashQuery-native or brokered tool, with intermediate state held inside the engine rather than in the conversation context. For one-shot single-tool operations, prefer the direct tool. Pass help:true for syntax and patterns.';

const CANONICAL_CALL_MACRO_HELP_HINT =
  "FlashQuery's general-purpose execution tool — runs a macro that can chain multiple FlashQuery operations, pass intermediate results between them, or run conditional logic in a single round-trip. Best for compound or composite work; for one-shot single-tool operations, prefer the direct tool. Pass `{help: true}` for syntax and patterns.";

const REQUIRED_HELP_SECTIONS = [
  'purpose',
  'params',
  'returns',
  'examples',
  'gotchas',
  'related tools',
] as const;

const VALID_BODY = `
# Test tool

Purpose text with enough body content for validation tests.
`;

function fixture(
  name: string,
  frontmatter: string,
  body = VALID_BODY
): { filePath: string; raw: string } {
  return {
    filePath: `src/mcp/tools/${name}.tool.md`,
    raw: `---\n${frontmatter.trim()}\n---\n${body}`,
  };
}

function validFrontmatter(overrides = ''): string {
  return `
name: example_tool
description: "Use the example tool for validation coverage. Pass {help: true} for full documentation."
tier: read-only
args: {}
${overrides}
`;
}

describe('tool metadata loader validation', () => {
  it('T-U-028 fails validation when name is missing', () => {
    const result = validateToolMeta([
      fixture('example_tool', `
description: "Use the example tool for validation coverage. Pass {help: true} for full documentation."
tier: read-only
args: {}
`),
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        filePath: 'src/mcp/tools/example_tool.tool.md',
        message: expect.stringContaining("missing required frontmatter field 'name'"),
      }),
    ]));
  });

  it('T-U-029 fails validation when name does not match file basename', () => {
    const result = validateToolMeta([
      fixture('wrong_file', validFrontmatter()),
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        message: "frontmatter name 'example_tool' must match file basename 'wrong_file'",
      }),
    ]));
  });

  it('T-U-030 fails validation when description is missing the help true suffix', () => {
    const result = validateToolMeta([
      fixture('example_tool', `
name: example_tool
description: "Use the example tool for validation coverage."
tier: read-only
args: {}
`),
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('description must end with a sentence containing help and true'),
      }),
    ]));
  });

  it('T-U-031 fails validation on duplicate frontmatter names', () => {
    const result = validateToolMeta([
      fixture('example_tool', validFrontmatter()),
      fixture('example_tool_copy', validFrontmatter()),
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        message: "duplicate frontmatter name 'example_tool'",
      }),
    ]));
  });

  it('T-U-032 warns but does not fail when description is shorter than 40 chars', () => {
    const result = validateToolMeta([
      fixture('tiny_tool', `
name: tiny_tool
description: "Use help true."
tier: read-only
args: {}
`),
    ]);

    expect(result.ok).toBe(true);
    expect(result.meta.get('tiny_tool')?.description).toBe('Use help true.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('description is shorter than 40 characters'),
      }),
    ]));
  });

  it('T-U-033 exposes the canonical default help_hint verbatim', () => {
    expect(DEFAULT_HELP_HINT).toBe(
      "FlashQuery-native tool. Pass `{help: true}` for full documentation, examples, and common patterns before composing your call if you're uncertain about parameters."
    );

    const result = validateToolMeta([
      fixture('example_tool', validFrontmatter()),
    ]);

    expect(result.ok).toBe(true);
    expect(result.meta.get('example_tool')?.helpHint).toBe(DEFAULT_HELP_HINT);
  });

  it('reports YAML/frontmatter parse failures clearly', () => {
    const result = validateToolMeta([
      fixture('broken_tool', 'name: [unterminated'),
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('failed to parse frontmatter'),
      }),
    ]));
  });

  it('keeps the production loader fixed to source-tree tool help pages', () => {
    expect(TOOL_META_GLOB).toBe('src/mcp/tools/*.tool.md');
  });

  it('validates the first core memory document search help-page batch', () => {
    expectHelpPageBatch(CORE_HELP_PAGE_BATCH);
  });

  it('validates the records plugin and pending-review help-page batch', () => {
    expectHelpPageBatch(RECORD_PLUGIN_HELP_PAGE_BATCH);
  });

  it('validates the LLM, macro, vault, editing, and search_tools help-page batch', () => {
    const result = expectHelpPageBatch(LLM_VAULT_EDITING_HELP_PAGE_BATCH);

    expect(result.meta.get('call_macro')?.description).toBe(CANONICAL_CALL_MACRO_DESCRIPTION);
    expect(result.meta.get('call_macro')?.helpHint).toBe(CANONICAL_CALL_MACRO_HELP_HINT);

    const searchTools = result.meta.get('search_tools');
    expect(searchTools).toBeDefined();
    const searchToolsText = [
      searchTools?.description ?? '',
      searchTools?.helpHint ?? '',
      searchTools?.helpPageBody ?? '',
      JSON.stringify(searchTools?.args ?? {}),
    ].join('\n');

    for (const term of [
      'query',
      'limit',
      'SearchResult',
      'score',
      'normalizedScore',
      'has_help',
      'help_hint',
    ]) {
      expect(searchToolsText).toContain(term);
    }
  });
});

function expectHelpPageBatch(names: readonly string[]): ReturnType<typeof validateToolMeta> {
  const sources = names.map((name) => ({
    filePath: `src/mcp/tools/${name}.tool.md`,
    raw: readFileSync(`src/mcp/tools/${name}.tool.md`, 'utf8'),
  }));

  const result = validateToolMeta(sources);

  expect(result.ok).toBe(true);
  expect([...result.meta.keys()].sort()).toEqual([...names].sort());

  for (const name of names) {
    const meta = result.meta.get(name);
    expect(meta).toBeDefined();
    expect(meta?.description).toMatch(/help\s*[`:{]?\s*true[`}]?[^.]*\.\s*$/i);
    expect(meta?.helpHint).toEqual(expect.any(String));
    expect(meta?.helpHint.length).toBeGreaterThan(0);
    expect(meta?.helpPageBody.trim().length).toBeGreaterThan(0);

    const body = meta?.helpPageBody ?? '';
    for (const section of REQUIRED_HELP_SECTIONS) {
      expect(body).toMatch(new RegExp(`^## ${section}$`, 'im'));
    }
  }

  return result;
}

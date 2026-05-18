import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HELP_HINT,
  TOOL_META_GLOB,
  validateToolMeta,
} from '../../../src/services/tool-search/tool-meta.js';

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
});

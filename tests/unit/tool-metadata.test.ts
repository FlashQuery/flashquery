import { describe, expect, it } from 'vitest';
import {
  TOOL_METADATA,
  assertRegisteredToolsHaveMetadata,
  expandToolSelectors,
  getDelegatedHardExcludedTools,
  getLegacyToolSuggestion,
  getToolMetadata,
  getToolNamesByTier,
  requireToolMetadata,
} from '../../src/mcp/tool-metadata.js';

describe('tool metadata registry', () => {
  it('defines unique metadata entries', () => {
    const names = TOOL_METADATA.map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
    expect(getToolMetadata('get_document')?.name).toBe('get_document');
    expect(() => requireToolMetadata('missing_tool')).toThrow("Missing MCP tool metadata for 'missing_tool'.");
  });

  it('reports registered tools missing metadata', () => {
    expect(() => assertRegisteredToolsHaveMetadata([{ name: 'missing_registered_tool' }])).toThrow(
      'Missing MCP tool metadata for registered tools: missing_registered_tool'
    );
  });

  it('covers current, final, transitional, removed, and dead tool names', () => {
    expect(requireToolMetadata('get_document').status).toBe('final');
    expect(requireToolMetadata('create_document').status).toBe('removed');
    expect(requireToolMetadata('search_documents').status).toBe('removed');
    expect(requireToolMetadata('get_briefing').status).toBe('transitional');
    expect(requireToolMetadata('insert_doc_link').status).toBe('transitional');
    expect(requireToolMetadata('write_document').status).toBe('final');
    expect(requireToolMetadata('list_projects').status).toBe('dead');
    expect(TOOL_METADATA.filter((entry) => entry.status === 'removed').length).toBeGreaterThan(10);
  });

  it('keeps hard-cutover replacements separate from transitional legacy tools', () => {
    for (const entry of TOOL_METADATA.filter((tool) => tool.status === 'removed')) {
      expect(entry.replacement, `${entry.name} replacement`).toBeTruthy();
    }

    for (const entry of TOOL_METADATA.filter((tool) => tool.status === 'transitional')) {
      expect(entry.replacement, `${entry.name} replacement`).toBeUndefined();
    }
  });

  it('uses the four-block XC-8 description template for every entry', () => {
    for (const entry of TOOL_METADATA) {
      expect(entry.description, entry.name).toContain('Summary:');
      expect(entry.description, entry.name).toContain('Use when:');
      expect(entry.description, entry.name).toContain('Do not use when:');
      expect(entry.description, entry.name).toContain('Example:');
    }
  });

  it('documents get_document canonical expected-error envelopes and include vocabulary', () => {
    const description = requireToolMetadata('get_document').description;

    expect(description).toMatch(/canonical expected-error|expected-error/);
    expect(description).toContain('isError:false');
    expect(description).toContain('include');
    expect(description).toContain('body');
    expect(description).toContain('frontmatter');
    expect(description).toContain('headings');
  });

  it('expands delegated tiers from metadata', () => {
    expect(getToolNamesByTier('tier:read-only')).toEqual([
      'search_documents',
      'get_document',
      'search_memory',
      'get_memory',
      'list_memories',
      'search_records',
      'get_record',
      'search_all',
      'get_briefing',
    ]);
    expect(getToolNamesByTier('tier:read-write')).toEqual(expect.arrayContaining([
      'create_document',
      'update_document',
      'append_to_doc',
      'move_document',
      'save_memory',
      'update_memory',
      'create_record',
      'update_record',
      'apply_tags',
      'archive_document',
      'archive_memory',
      'archive_record',
      'create_directory',
      'remove_directory',
      'insert_doc_link',
    ]));
  });

  it('applies additive doc-write category expansion', () => {
    const expanded = expandToolSelectors(['category:doc-write'], { hostEligible: true });

    expect(expanded).toContain('get_document');
    expect(expanded).toContain('create_document');
    expect(expanded).toContain('archive_document');
  });

  it('keeps directory tools out of the system category', () => {
    expect(requireToolMetadata('create_directory').categories).toEqual(['doc-write']);
    expect(requireToolMetadata('remove_directory').categories).toEqual(['doc-write']);
    expect(requireToolMetadata('manage_directory').categories).toEqual(['doc-write']);

    const systemTools = expandToolSelectors(['category:system'], { hostEligible: true });

    expect(systemTools).toEqual(expect.arrayContaining(['force_file_scan', 'reconcile_documents']));
    expect(systemTools).not.toContain('create_directory');
    expect(systemTools).not.toContain('remove_directory');
    expect(systemTools).not.toContain('manage_directory');
  });

  it('lists delegated hard exclusions with per-tool reasons', () => {
    const exclusions = getDelegatedHardExcludedTools();

    expect(exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'call_model', reason: expect.stringContaining('recursively call models') }),
      expect.objectContaining({ tool: 'register_plugin', reason: expect.stringContaining('plugin administration') }),
      expect.objectContaining({ tool: 'unregister_plugin', reason: expect.stringContaining('plugin administration') }),
      expect.objectContaining({ tool: 'force_file_scan', reason: expect.stringContaining('maintenance') }),
      expect.objectContaining({ tool: 'reconcile_documents', reason: expect.stringContaining('maintenance') }),
    ]));
  });

  it('returns legacy replacement suggestions without aliasing', () => {
    expect(getLegacyToolSuggestion('create_document')).toEqual({
      replacement: 'write_document',
      message: expect.stringContaining("Tool 'create_document' has been replaced by 'write_document'"),
    });
    expect(getLegacyToolSuggestion('search_documents')).toEqual({
      replacement: 'search',
      message: expect.stringContaining("Tool 'search_documents' has been replaced by 'search'"),
    });
    expect(getLegacyToolSuggestion('get_briefing')).toBeUndefined();
    expect(getLegacyToolSuggestion('insert_doc_link')).toBeUndefined();
    expect(getLegacyToolSuggestion('get_document')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  TOOL_METADATA,
  type ToolMetadata,
  assertRegisteredToolsHaveMetadata,
  expandToolSelectors,
  getDelegatedHardExcludedTools,
  getLegacyToolSuggestion,
  getToolMetadata,
  getToolNamesByTier,
  getToolNamesByTierFromMetadata,
  isDelegatedTierEligible,
  requireToolMetadata,
} from '../../src/mcp/tool-metadata.js';

const PRE_REFACTOR_READ_ONLY_TIER = [
  'get_document',
  'search',
  'get_memory',
  'search_records',
  'get_record',
  'get_briefing',
];

const PRE_REFACTOR_READ_WRITE_TIER = [
  ...PRE_REFACTOR_READ_ONLY_TIER,
  'write_document',
  'move_document',
  'apply_tags',
  'archive_document',
  'remove_document',
  'archive_memory',
  'write_memory',
  'write_record',
  'archive_record',
  'manage_directory',
  'insert_doc_link',
];

const EXPECTED_DELEGATED_READ_ONLY_TIER = [
  'get_document',
  'list_vault',
  'get_briefing',
  'search',
  'get_memory',
  'get_record',
  'search_records',
];

const EXPECTED_DELEGATED_READ_WRITE_TIER = [
  'get_document',
  'list_vault',
  'copy_document',
  'move_document',
  'archive_document',
  'remove_document',
  'insert_in_doc',
  'replace_doc_section',
  'apply_tags',
  'get_briefing',
  'insert_doc_link',
  'write_document',
  'search',
  'get_memory',
  'archive_memory',
  'write_memory',
  'write_record',
  'get_record',
  'archive_record',
  'search_records',
  'manage_directory',
];

function addedNames(before: readonly string[], after: readonly string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((name) => !beforeSet.has(name));
}

function removedNames(before: readonly string[], after: readonly string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((name) => !afterSet.has(name));
}

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

  it('covers current, final, transitional, and removed tool names while omitting dead project tools', () => {
    expect(requireToolMetadata('get_document').status).toBe('final');
    expect(requireToolMetadata('create_document').status).toBe('removed');
    expect(requireToolMetadata('search_documents').status).toBe('removed');
    expect(requireToolMetadata('get_briefing').status).toBe('transitional');
    expect(requireToolMetadata('insert_doc_link').status).toBe('transitional');
    expect(requireToolMetadata('write_document').status).toBe('final');
    expect(getToolMetadata('list_projects')).toBeUndefined();
    expect(getToolMetadata('get_project_info')).toBeUndefined();
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

  it('does not apply legacy replacement wording to kept plugin and LLM tools', () => {
    for (const name of ['get_record', 'archive_record', 'search_records', 'clear_pending_reviews', 'call_model', 'get_llm_usage']) {
      const description = requireToolMetadata(name).description;

      expect(description, name).not.toContain('still exposes');
      expect(description, name).not.toContain('canonical replacement when available');
      expect(description, name).toContain('Summary:');
      expect(description, name).toContain('Use when:');
      expect(description, name).toContain('Do not use when:');
      expect(description, name).toContain('Example:');
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

  it('documents archive_document JSON identification blocks, archived_at, and idempotency', () => {
    const description = requireToolMetadata('archive_document').description;

    expect(description).toContain('JSON');
    expect(description).toContain('identification');
    expect(description).toContain('batch');
    expect(description).toContain('archived_at');
    expect(description).toMatch(/idempotent|re-archive/);
  });

  it('documents copy_document JSON identification output and no batch support', () => {
    const description = requireToolMetadata('copy_document').description;

    expect(description).toContain('JSON');
    expect(description).toContain('identification');
    expect(description).toMatch(/new copy/);
    expect(description).toMatch(/single-target|batch/);
  });

  it('documents move_document JSON identification output and plugin ownership warning code', () => {
    const description = requireToolMetadata('move_document').description;

    expect(description).toContain('JSON');
    expect(description).toContain('identification');
    expect(description).toContain('plugin_ownership_path_expectation');
    expect(description).toMatch(/warnings/);
  });

  it('documents list_vault structured entries and include-gated metadata/tracking output', () => {
    const description = requireToolMetadata('list_vault').description;

    expect(description).toContain('structured JSON');
    expect(description).toContain('entries');
    expect(description).toContain('metadata');
    expect(description).toContain('tracking');
    expect(description).toContain('include');
  });

  it('expands tier:read-only from metadata-derived delegated eligibility (U-tier-1)', () => {
    const readOnlyTools = getToolNamesByTier('tier:read-only');

    expect(readOnlyTools).toEqual(EXPECTED_DELEGATED_READ_ONLY_TIER);
    expect(readOnlyTools).toContain('list_vault');
    expect(readOnlyTools).not.toContain('get_llm_usage');

    for (const name of readOnlyTools) {
      expect(requireToolMetadata(name).tier, name).toBe('read-only');
    }
  });

  it('expands tier:read-write from metadata-derived delegated eligibility (U-tier-2)', () => {
    const readWriteTools = getToolNamesByTier('tier:read-write');

    expect(readWriteTools).toEqual(EXPECTED_DELEGATED_READ_WRITE_TIER);
    expect(readWriteTools).toEqual(expect.arrayContaining([
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(readWriteTools).not.toContain('get_llm_usage');
    expect(readWriteTools).not.toContain('list_projects');
    expect(readWriteTools).not.toContain('get_project_info');
  });

  it('keeps tier:read-only as a subset of tier:read-write (U-tier-3)', () => {
    const readWriteTools = getToolNamesByTier('tier:read-write');

    for (const name of getToolNamesByTier('tier:read-only')) {
      expect(readWriteTools, name).toContain(name);
    }
  });

  it('keeps hard-excluded tools out of delegated tier expansions (U-tier-4)', () => {
    const tierTools = new Set([
      ...getToolNamesByTier('tier:read-only'),
      ...getToolNamesByTier('tier:read-write'),
    ]);

    for (const name of [
      'call_model',
      'register_plugin',
      'unregister_plugin',
      'clear_pending_reviews',
      'force_file_scan',
      'reconcile_documents',
      'maintain_vault',
      'get_plugin_info',
    ]) {
      expect(requireToolMetadata(name).delegatedHardExcludedReason, name).toBeDefined();
      expect(tierTools.has(name), name).toBe(false);
    }
  });

  it('keeps admin-tier tools out of broad delegated tiers (U-tier-5)', () => {
    const tierTools = new Set([
      ...getToolNamesByTier('tier:read-only'),
      ...getToolNamesByTier('tier:read-write'),
    ]);

    for (const entry of TOOL_METADATA.filter((tool) => tool.tier === 'admin')) {
      expect(tierTools.has(entry.name), entry.name).toBe(false);
    }
  });

  it('keeps removed tools out of delegated tier expansions (U-tier-6)', () => {
    const tierTools = new Set([
      ...getToolNamesByTier('tier:read-only'),
      ...getToolNamesByTier('tier:read-write'),
    ]);

    for (const name of [
      'create_document',
      'update_document',
      'search_documents',
      'save_memory',
      'update_memory',
      'create_record',
      'update_record',
    ]) {
      expect(requireToolMetadata(name).status, name).toBe('removed');
      expect(tierTools.has(name), name).toBe(false);
    }
  });

  it('excludes non-data-category tools from broad delegated tiers (U-tier-7)', () => {
    const llmUsage = requireToolMetadata('get_llm_usage');

    expect(llmUsage).toMatchObject({
      status: 'final',
      categories: ['llm'],
      tier: 'read-only',
      hostEligible: true,
      delegatedEligible: false,
    });
    expect(llmUsage.delegatedHardExcludedReason).toBeUndefined();
    expect(llmUsage.delegatedExclusionReason).toBeUndefined();
    expect(getToolNamesByTier('tier:read-only')).not.toContain('get_llm_usage');
    expect(getToolNamesByTier('tier:read-write')).not.toContain('get_llm_usage');
  });

  it('honors synthetic delegatedExclusionReason fixtures (U-tier-8)', () => {
    const synthetic = {
      ...requireToolMetadata('list_vault'),
      name: 'list_vault_excluded_fixture',
      delegatedEligible: true,
      delegatedExclusionReason: 'Delegated listing disabled for this fixture.',
    } satisfies ToolMetadata;
    const metadataWithFixture = [...TOOL_METADATA, synthetic];

    expect(isDelegatedTierEligible(synthetic)).toBe(false);
    expect(getToolNamesByTierFromMetadata(metadataWithFixture, 'tier:read-only')).not.toContain(synthetic.name);
    expect(getToolNamesByTierFromMetadata(metadataWithFixture, 'tier:read-write')).not.toContain(synthetic.name);
    expect(synthetic.delegatedExclusionReason).toContain('fixture');
    expect(TOOL_METADATA.some((entry) => entry.delegatedExclusionReason !== undefined)).toBe(false);
  });

  it('changes delegated tier composition by exactly the corrected four tools (U-tier-9)', () => {
    expect(addedNames(PRE_REFACTOR_READ_ONLY_TIER, getToolNamesByTier('tier:read-only'))).toEqual(['list_vault']);
    expect(removedNames(PRE_REFACTOR_READ_ONLY_TIER, getToolNamesByTier('tier:read-only'))).toEqual([]);
    expect(addedNames(PRE_REFACTOR_READ_WRITE_TIER, getToolNamesByTier('tier:read-write'))).toEqual([
      'list_vault',
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]);
    expect(removedNames(PRE_REFACTOR_READ_WRITE_TIER, getToolNamesByTier('tier:read-write'))).toEqual([]);

    expect(addedNames(PRE_REFACTOR_READ_WRITE_TIER, getToolNamesByTier('tier:read-write')).filter((name) => name !== 'list_vault')).toEqual([
      'copy_document',
      'insert_in_doc',
      'replace_doc_section',
    ]);
  });

  it('applies additive doc-write category expansion', () => {
    const expanded = expandToolSelectors(['category:doc-write'], { hostEligible: true });

    expect(expanded).toContain('get_document');
    expect(expanded).toContain('write_document');
    expect(expanded).toContain('archive_document');
    expect(expanded).not.toContain('create_document');
  });

  it('keeps directory tools out of the system category', () => {
    expect(requireToolMetadata('create_directory').categories).toEqual(['doc-write']);
    expect(requireToolMetadata('remove_directory').categories).toEqual(['doc-write']);
    expect(requireToolMetadata('manage_directory').categories).toEqual(['doc-write']);

    const systemTools = expandToolSelectors(['category:system'], { hostEligible: true });

    expect(systemTools).toEqual(['maintain_vault']);
    expect(systemTools).not.toContain('force_file_scan');
    expect(systemTools).not.toContain('reconcile_documents');
    expect(systemTools).not.toContain('create_directory');
    expect(systemTools).not.toContain('remove_directory');
    expect(systemTools).not.toContain('manage_directory');
  });

  it('exposes Phase 127 final tools as current metadata with correct policy', () => {
    expect(requireToolMetadata('remove_document')).toMatchObject({
      status: 'final',
      categories: ['doc-write'],
      tier: 'read-write',
      hostEligible: true,
      delegatedEligible: true,
    });
    expect(requireToolMetadata('manage_directory')).toMatchObject({
      status: 'final',
      categories: ['doc-write'],
      tier: 'read-write',
      hostEligible: true,
      delegatedEligible: true,
    });
    expect(requireToolMetadata('maintain_vault')).toMatchObject({
      status: 'final',
      categories: ['system'],
      tier: 'admin',
      hostEligible: true,
      delegatedEligible: false,
      delegatedHardExcludedReason: expect.stringContaining('maintenance'),
    });
  });

  it('keeps Phase 127 merged legacy tools as removed suggestion metadata only', () => {
    expect(requireToolMetadata('create_directory')).toMatchObject({
      status: 'removed',
      replacement: 'manage_directory',
    });
    expect(requireToolMetadata('remove_directory')).toMatchObject({
      status: 'removed',
      replacement: 'manage_directory',
    });
    expect(requireToolMetadata('force_file_scan')).toMatchObject({
      status: 'removed',
      replacement: 'maintain_vault',
    });
    expect(requireToolMetadata('reconcile_documents')).toMatchObject({
      status: 'removed',
      replacement: 'maintain_vault',
    });
  });

  it('lists delegated hard exclusions with per-tool reasons', () => {
    const exclusions = getDelegatedHardExcludedTools();

    expect(exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'call_model', reason: expect.stringContaining('recursively call models') }),
      expect.objectContaining({ tool: 'register_plugin', reason: expect.stringContaining('plugin administration') }),
      expect.objectContaining({ tool: 'unregister_plugin', reason: expect.stringContaining('plugin administration') }),
      expect.objectContaining({ tool: 'maintain_vault', reason: expect.stringContaining('maintenance') }),
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
    expect(getLegacyToolSuggestion('list_projects')).toBeUndefined();
    expect(getLegacyToolSuggestion('get_project_info')).toBeUndefined();
  });
});

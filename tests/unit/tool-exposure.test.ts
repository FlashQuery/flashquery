import { describe, expect, it } from 'vitest';
import {
  buildToolExposureWarnings,
  resolveHostToolExposure,
  validateToolSelectors,
} from '../../src/mcp/tool-exposure.js';
import { listToolMetadata } from '../../src/mcp/tool-metadata.js';

describe('host MCP tool exposure', () => {
  it('defaults to all host-eligible tools', () => {
    const resolved = resolveHostToolExposure(undefined);

    expect(resolved.hostEnabledToolNames).toEqual(
      listToolMetadata({ hostEligible: true })
        .filter((entry) => entry.status === 'final' || entry.status === 'transitional')
        .map((entry) => entry.name)
    );
    expect(resolved.hostEnabledToolNames).toEqual(expect.arrayContaining([
      'get_document',
      'search',
      'call_model',
      'write_document',
      'manage_directory',
    ]));
  });

  it('rejects explicitly empty tools instead of silently enabling all tools', () => {
    expect(() => resolveHostToolExposure({ tools: [] })).toThrow(
      'tools is empty; omit host_mcp_tools.tools to keep the default host surface or list at least one selector'
    );
  });

  it('doc-write includes doc-read while doc-read remains read-only', () => {
    const docWrite = resolveHostToolExposure({ tools: ['category:doc-write'] }).hostEnabledToolNames;
    const docRead = resolveHostToolExposure({ tools: ['category:doc-read'] }).hostEnabledToolNames;

    expect(docWrite).toEqual(expect.arrayContaining([
      'get_document',
      'list_vault',
      'write_document',
      'archive_document',
      'remove_document',
      'manage_directory',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(docRead).toEqual(expect.arrayContaining(['get_document', 'list_vault']));
    expect(docRead).not.toContain('create_document');
    expect(docRead).not.toContain('manage_directory');
  });

  it('applies excluded_tools as the final deny layer', () => {
    const resolved = resolveHostToolExposure({
      tools: ['category:doc-write'],
      excludedTools: ['get_document'],
    });

    expect(resolved.hostEnabledToolNames).not.toContain('get_document');
    expect(resolved.hostEnabledToolNames).toContain('write_document');
    expect(resolved.hostEnabledToolNames).toContain('manage_directory');
  });

  it('expands host tiers from host-eligible metadata instead of delegated tier policy', () => {
    const readOnly = resolveHostToolExposure({ tools: ['tier:read-only'] }).hostEnabledToolNames;
    const readWrite = resolveHostToolExposure({ tools: ['tier:read-write'] }).hostEnabledToolNames;

    expect(readOnly).toContain('list_vault');
    expect(readOnly).toContain('search');
    expect(readOnly).toContain('get_llm_usage');
    expect(readOnly).not.toContain('create_document');
    expect(readWrite).toContain('list_vault');
    expect(readWrite).toContain('write_document');
    expect(readWrite).toContain('manage_directory');
  });


  it('rejects unknown selectors, host-ineligible tools, and removed tools with suggestions', () => {
    expect(validateToolSelectors(['category:not-real'])).toEqual(["unknown tool selector 'category:not-real'"]);
    expect(validateToolSelectors(['not_a_tool'])).toEqual(["unknown tool selector 'not_a_tool'"]);
    expect(validateToolSelectors(['write_document'])).toEqual([]);
    expect(validateToolSelectors(['list_projects'])).toEqual(["unknown tool selector 'list_projects'"]);
    expect(validateToolSelectors(['get_project_info'])).toEqual(["unknown tool selector 'get_project_info'"]);
    expect(validateToolSelectors(['create_document'])).toEqual([
      "Tool 'create_document' has been replaced by 'write_document'. Update configuration or calls to use the canonical tool name; FlashQuery does not alias legacy tool names.",
    ]);
    expect(validateToolSelectors(['manage_directory'])).toEqual([]);
  });

  it('emits stable warning prefixes for suspicious category combinations', () => {
    expect(buildToolExposureWarnings(['call_model'])).toEqual(expect.arrayContaining([
      expect.stringContaining('host_mcp_tools: system category disabled'),
      expect.stringContaining('host_mcp_tools: doc-read disabled while llm enabled'),
      expect.stringContaining('host_mcp_tools: data categories disabled while llm enabled'),
    ]));
    expect(buildToolExposureWarnings(['force_file_scan'])).toEqual(expect.arrayContaining([
      expect.stringContaining('host_mcp_tools: only system category enabled'),
    ]));
  });
});

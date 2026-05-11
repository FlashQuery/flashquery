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
        .filter((entry) => entry.status !== 'dead')
        .map((entry) => entry.name)
    );
    expect(resolved.hostEnabledToolNames).toEqual(expect.arrayContaining([
      'get_document',
      'save_memory',
      'call_model',
      'create_document',
    ]));
  });

  it('doc-write includes doc-read while doc-read remains read-only', () => {
    const docWrite = resolveHostToolExposure({ tools: ['category:doc-write'] }).hostEnabledToolNames;
    const docRead = resolveHostToolExposure({ tools: ['category:doc-read'] }).hostEnabledToolNames;

    expect(docWrite).toEqual(expect.arrayContaining([
      'get_document',
      'list_vault',
      'create_document',
      'archive_document',
      'insert_in_doc',
      'replace_doc_section',
    ]));
    expect(docRead).toEqual(expect.arrayContaining(['get_document', 'list_vault']));
    expect(docRead).not.toContain('create_document');
  });

  it('applies excluded_tools as the final deny layer', () => {
    const resolved = resolveHostToolExposure({
      tools: ['category:doc-write'],
      excludedTools: ['get_document'],
    });

    expect(resolved.hostEnabledToolNames).not.toContain('get_document');
    expect(resolved.hostEnabledToolNames).toContain('create_document');
  });

  it('expands host tiers from host-eligible metadata instead of delegated tier policy', () => {
    const readOnly = resolveHostToolExposure({ tools: ['tier:read-only'] }).hostEnabledToolNames;
    const readWrite = resolveHostToolExposure({ tools: ['tier:read-write'] }).hostEnabledToolNames;

    expect(readOnly).toContain('list_vault');
    expect(readOnly).toContain('get_llm_usage');
    expect(readOnly).not.toContain('create_document');
    expect(readWrite).toContain('list_vault');
    expect(readWrite).toContain('create_document');
  });


  it('rejects unknown selectors, host-ineligible tools, and dead tools', () => {
    expect(validateToolSelectors(['category:not-real'])).toEqual(["unknown tool selector 'category:not-real'"]);
    expect(validateToolSelectors(['not_a_tool'])).toEqual(["unknown tool selector 'not_a_tool'"]);
    expect(validateToolSelectors(['write_document'])).toEqual(["tool 'write_document' is not available for host MCP exposure"]);
    expect(validateToolSelectors(['list_projects'])).toEqual(["tool 'list_projects' is not available for host MCP exposure"]);
    expect(validateToolSelectors(['create_document'])).toEqual([]);
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

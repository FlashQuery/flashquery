import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ERROR_CODES,
  batchResult,
  directoryResult,
  documentIdentification,
  documentRemovalResult,
  formatBatchSeparator,
  formatEmptyResults,
  formatKeyValueEntry,
  formatTableHeader,
  formatTableRow,
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  llmCallIdentification,
  maintenanceActionResult,
  memoryIdentification,
  pluginIdentification,
  recordIdentification,
  withWarnings,
} from '../../src/mcp/utils/response-formats.js';
import {
  buildContentPreview,
  buildMemoryResult,
  buildOrderedMemoryResults,
  memoryNotFoundError,
} from '../../src/mcp/utils/memory-output.js';

function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '');
}

describe('JSON MCP response helpers', () => {
  it('returns parseable text content for success payloads', () => {
    const result = jsonToolResult({ ok: true });

    expect(result.content[0]?.type).toBe('text');
    expect(parseToolText(result)).toEqual({ ok: true });
  });

  it('returns expected errors as canonical JSON without runtime error semantics', () => {
    const result = jsonExpectedError({
      error: 'not_found',
      message: 'Missing',
      identifier: 'x',
    });

    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toEqual({
      error: 'not_found',
      message: 'Missing',
      identifier: 'x',
    });
  });

  it('marks runtime failures with isError true', () => {
    const result = jsonRuntimeError('DB unavailable');

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toEqual({
      error: 'runtime_error',
      message: 'DB unavailable',
    });
  });

  it('can emit runtime errors with canonical top-level identifiers', () => {
    const result = jsonRuntimeError({ message: 'Denied', identifier: 'vault/.obsidian' });

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toEqual({
      error: 'runtime_error',
      message: 'Denied',
      identifier: 'vault/.obsidian',
    });
  });

  it('adds warnings only when provided', () => {
    expect(withWarnings({ results: [] }, ['memory_disabled'])).toEqual({
      results: [],
      warnings: ['memory_disabled'],
    });
    expect(withWarnings({ results: [] }, [])).toEqual({ results: [] });
  });

  it('preserves batch result order exactly', () => {
    const success = { identifier: 'a' };
    const error = { error: 'not_found', identifier: 'b' };

    expect(batchResult([success, error])).toEqual([success, error]);
  });

  it('defines canonical error codes as lowercase snake_case', () => {
    expect(CANONICAL_ERROR_CODES).toEqual([
      'not_found',
      'ambiguous_identifier',
      'permission_denied',
      'invalid_input',
      'conflict',
      'unsupported',
      'not_supported_in_mode',
    ]);
    for (const code of CANONICAL_ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    }
  });
});

describe('identification builders', () => {
  it('builds required document identification fields', () => {
    expect(
      documentIdentification({
        identifier: 'Daily Note',
        title: 'Daily Note',
        path: 'notes/daily.md',
        fq_id: 'doc-1',
        modified: '2026-05-11T00:00:00.000Z',
        chars: 42,
      })
    ).toEqual({
      identifier: 'Daily Note',
      title: 'Daily Note',
      path: 'notes/daily.md',
      fq_id: 'doc-1',
      modified: '2026-05-11T00:00:00.000Z',
      size: { chars: 42 },
    });
  });

  it('builds required memory identification fields', () => {
    expect(
      memoryIdentification({
        memory_id: 'mem-1',
        content_preview: 'User prefers JSON outputs',
        tags: ['preferences'],
        plugin_scope: 'global',
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      })
    ).toEqual({
      memory_id: 'mem-1',
      content_preview: 'User prefers JSON outputs',
      tags: ['preferences'],
      plugin_scope: 'global',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    });
  });

  it('builds required record identification fields', () => {
    expect(
      recordIdentification({
        id: 'rec-1',
        plugin_id: 'crm',
        table: 'contacts',
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      })
    ).toEqual({
      id: 'rec-1',
      plugin_id: 'crm',
      table: 'contacts',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    });
  });

  it('preserves record plugin/table scope and timestamps', () => {
    const result = recordIdentification({
      id: 'rec-1',
      plugin_id: 'crm',
      table: 'contacts',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T01:00:00.000Z',
    });

    expect(result.plugin_id).toBe('crm');
    expect(result.table).toBe('contacts');
    expect(result.created_at).toBe('2026-05-12T00:00:00.000Z');
    expect(result.updated_at).toBe('2026-05-12T01:00:00.000Z');
  });

  it('builds required plugin identification fields', () => {
    expect(
      pluginIdentification({
        plugin_id: 'crm',
        name: 'CRM',
        status: 'active',
        table_count: 3,
      })
    ).toEqual({
      plugin_id: 'crm',
      name: 'CRM',
      status: 'active',
      table_count: 3,
    });
  });

  it('builds required LLM call identification fields', () => {
    expect(
      llmCallIdentification({
        resolver: 'purpose',
        name: 'summarize',
        resolved_model_name: 'gpt-5-mini',
        provider_name: 'openai',
      })
    ).toEqual({
      resolver: 'purpose',
      name: 'summarize',
      resolved_model_name: 'gpt-5-mini',
      provider_name: 'openai',
    });
  });

  it('builds JSON-compatible directory results for manage_directory', () => {
    expect(
      directoryResult({
        path: 'Projects/Acme',
        action: 'create',
        status: 'created',
        timestamp: '2026-05-12T00:00:00.000Z',
      })
    ).toEqual({
      path: 'Projects/Acme',
      action: 'create',
      status: 'created',
      timestamp: '2026-05-12T00:00:00.000Z',
    });
  });

  it('builds JSON-compatible maintenance action results without prose formatting', () => {
    expect(
      maintenanceActionResult({
        action: 'sync',
        started_at: '2026-05-12T00:00:00.000Z',
        finished_at: '2026-05-12T00:00:01.000Z',
        dry_run: false,
        counts: {
          scanned: 3,
          added: 1,
          updated: 1,
          repaired: 0,
          archived: 1,
        },
      })
    ).toEqual({
      action: 'sync',
      started_at: '2026-05-12T00:00:00.000Z',
      finished_at: '2026-05-12T00:00:01.000Z',
      dry_run: false,
      counts: {
        scanned: 3,
        added: 1,
        updated: 1,
        repaired: 0,
        archived: 1,
      },
    });
  });

  it('builds document removal results on top of archived document identification', () => {
    expect(
      documentRemovalResult({
        identifier: 'old.md',
        title: 'Old',
        path: 'Notes/old.md',
        fq_id: 'doc-1',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 25,
        archived_at: '2026-05-12T00:00:00.000Z',
        removed: true,
        moved_to: '.flashquery/removed/old.md',
        original_path: 'Notes/old.md',
      })
    ).toEqual({
      identifier: 'old.md',
      title: 'Old',
      path: 'Notes/old.md',
      fq_id: 'doc-1',
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: 25 },
      status: 'archived',
      archived_at: '2026-05-12T00:00:00.000Z',
      removed: true,
      moved_to: '.flashquery/removed/old.md',
      original_path: 'Notes/old.md',
    });
  });
});

describe('memory output helpers', () => {
  const memoryRow = {
    id: 'mem-1',
    content: 'User prefers concise JSON output for MCP tools.',
    tags: ['#preference', '#json'],
    plugin_scope: 'global',
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T01:00:00.000Z',
    version: 2,
    previous_version_id: 'mem-0',
    is_latest: true,
    archived_at: null,
  };

  it('builds content previews from normalized memory content', () => {
    expect(buildContentPreview('  Alpha\n\nBeta   Gamma  ', 12)).toBe('Alpha Bet...');
  });

  it('builds memory identification plus requested include payloads', () => {
    expect(buildMemoryResult(memoryRow, ['content', 'tags_full'])).toEqual({
      memory_id: 'mem-1',
      content_preview: 'User prefers concise JSON output for MCP tools.',
      tags: ['#preference', '#json'],
      plugin_scope: 'global',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T01:00:00.000Z',
      version: 2,
      previous_version_id: 'mem-0',
      is_latest: true,
      archived_at: null,
      content: 'User prefers concise JSON output for MCP tools.',
      tags_full: ['#preference', '#json'],
    });
  });

  it('preserves requested batch order and inserts canonical expected errors', () => {
    expect(buildOrderedMemoryResults(['missing', 'mem-1'], [memoryRow])).toEqual([
      {
        error: 'not_found',
        message: "No memory matches identifier 'missing'",
        identifier: 'missing',
      },
      expect.objectContaining({ memory_id: 'mem-1' }),
    ]);
  });

  it('returns canonical expected error envelopes for missing memories', () => {
    const result = memoryNotFoundError('mem-x');
    expect(result.isError).toBe(false);
    expect(parseToolText(result)).toEqual({
      error: 'not_found',
      message: "No memory matches identifier 'mem-x'",
      identifier: 'mem-x',
    });
  });
});

describe('legacy key-value helpers (transitional)', () => {
  it('formats key-value entries for existing callers', () => {
    expect(formatKeyValueEntry('Title', 'My Document')).toBe('Title: My Document');
    expect(formatKeyValueEntry('Tags', ['tag1', 'tag2'])).toBe('Tags: ["tag1","tag2"]');
    expect(formatKeyValueEntry('Active', true)).toBe('Active: true');
    expect(formatKeyValueEntry('Field', null)).toBe('Field: ');
  });

  it('preserves existing batch and empty result formatting', () => {
    expect(formatBatchSeparator()).toBe('---');
    expect(formatEmptyResults('documents')).toBe('No documents found.');
  });

  it('formats vault table helpers for existing list_vault callers', () => {
    expect(formatTableHeader().split('\n')).toHaveLength(2);
    expect(formatTableRow('notes.md', 'file', '2.3 KB', '2026-01-01', '2026-04-01')).toBe(
      '| notes.md | file | 2.3 KB | 2026-01-01 | 2026-04-01 |'
    );
  });
});

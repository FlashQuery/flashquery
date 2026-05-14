import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentArchiveResult } from '../../src/mcp/utils/response-formats.js';

describe('archive_document JSON result helpers', () => {
  it('adds archived status and archived_at to the document identification block', () => {
    expect(
      documentArchiveResult({
        identifier: 'Notes/Archive Me.md',
        title: 'Archive Me',
        path: 'Notes/Archive Me.md',
        fq_id: '11111111-1111-4111-8111-111111111111',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 128,
        archived_at: '2026-05-12T00:01:00.000Z',
      })
    ).toEqual({
      identifier: 'Notes/Archive Me.md',
      title: 'Archive Me',
      path: 'Notes/Archive Me.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: 128 },
      status: 'archived',
      archived_at: '2026-05-12T00:01:00.000Z',
    });
  });

  it('preserves an existing archived_at value for already archived documents', () => {
    const existingArchivedAt = '2026-05-11T22:30:00.000Z';

    const result = documentArchiveResult({
      identifier: 'Notes/Archived.md',
      title: 'Archived',
      path: 'Notes/Archived.md',
      fq_id: '22222222-2222-4222-8222-222222222222',
      modified: '2026-05-12T00:10:00.000Z',
      chars: 64,
      archived_at: existingArchivedAt,
    });

    expect(result.archived_at).toBe(existingArchivedAt);
    expect(result.status).toBe('archived');
  });

  it('keeps batch archive runtime failures inside positional JSON results', () => {
    const source = readFileSync('src/mcp/tools/documents.ts', 'utf8');
    const archiveSection = source.slice(
      source.indexOf("'archive_document'"),
      source.indexOf("'search_documents'")
    );

    expect(archiveSection).toContain('Supabase archive update failed');
    expect(archiveSection).toContain("error: 'runtime_error'");
    expect(archiveSection).toContain('return jsonToolResult(isBatch ? results : results[0])');
    expect(archiveSection).not.toContain('hasRuntimeFailure ? { ...result, isError: true }');
    expect(archiveSection).not.toContain("error: 'conflict',\n              message: msg");
  });
});

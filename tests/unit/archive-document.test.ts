import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentArchiveResult } from '../../src/mcp/utils/response-formats.js';

describe('archive_document JSON result helpers', () => {
  function archiveDocumentSource(): string {
    const source = readFileSync('src/mcp/tools/documents.ts', 'utf8');
    return source.slice(source.indexOf("'archive_document'"), source.indexOf("'remove_document'"));
  }

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
    const archiveSection = archiveDocumentSource();

    expect(archiveSection).toContain('Supabase archive update failed');
    expect(archiveSection).toContain("error: 'runtime_error'");
    expect(archiveSection).toContain('return jsonToolResult(isBatch ? results : results[0])');
    expect(archiveSection).not.toContain('hasRuntimeFailure ? { ...result, isError: true }');
    expect(archiveSection).not.toContain("error: 'conflict',\n              message: msg");
  });

  it('T-U-225 lock acquisition: archive_document acquires the standard documents lock before mutation', () => {
    const archiveSection = archiveDocumentSource();
    const acquireIndex = archiveSection.indexOf('await acquireLock(');
    const mutationIndex = archiveSection.indexOf('const supabase = supabaseManager.getClient()');

    expect(acquireIndex).toBeGreaterThan(-1);
    expect(mutationIndex).toBeGreaterThan(-1);
    expect(acquireIndex).toBeLessThan(mutationIndex);
    expect(archiveSection).toContain('config.instance.id');
    expect(archiveSection).toContain("'documents'");
    expect(archiveSection).toContain('{ ttlSeconds: config.locking.ttlSeconds }');
  });

  it('T-U-226 release in finally: archive_document releases the standard documents lock', () => {
    const archiveSection = archiveDocumentSource();
    const finallyIndex = archiveSection.indexOf('finally');
    const releaseIndex = archiveSection.indexOf('await releaseLock(');

    expect(finallyIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(finallyIndex);
    expect(archiveSection).toContain('supabaseManager.getClient(), config.instance.id, \'documents\'');
  });

  it('T-U-227 lock timeout: archive_document returns conflict lock_contention before archive mutation', () => {
    const archiveSection = archiveDocumentSource();
    const conflictIndex = archiveSection.indexOf("details: { reason: 'lock_contention' }");
    const mutationIndex = archiveSection.indexOf('targetedScan(');

    expect(conflictIndex).toBeGreaterThan(-1);
    expect(mutationIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeLessThan(mutationIndex);
    expect(archiveSection).toContain("error: 'conflict'");
    expect(archiveSection).toContain('Write lock timeout: another instance is writing to documents. Retry in a few seconds.');
  });
});

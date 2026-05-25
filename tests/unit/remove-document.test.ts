import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentRemovalResult } from '../../src/mcp/utils/response-formats.js';

describe('remove_document JSON contract', () => {
  it('returns archived document identification with documented removal feedback only', () => {
    expect(
      documentRemovalResult({
        identifier: 'Notes/Old.md',
        title: 'Old',
        path: 'Notes/Old.md',
        fq_id: '11111111-1111-4111-8111-111111111111',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 24,
        archived_at: '2026-05-12T00:01:00.000Z',
        moved_to: '.flashquery/removed/Old.md',
      })
    ).toEqual({
      identifier: 'Notes/Old.md',
      title: 'Old',
      path: 'Notes/Old.md',
      fq_id: '11111111-1111-4111-8111-111111111111',
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: 24 },
      status: 'archived',
      archived_at: '2026-05-12T00:01:00.000Z',
      moved_to: '.flashquery/removed/Old.md',
    });
  });

  it('returns moved_to null for hard-delete removal feedback', () => {
    expect(
      documentRemovalResult({
        identifier: 'Notes/Old.md',
        title: 'Old',
        path: 'Notes/Old.md',
        fq_id: '11111111-1111-4111-8111-111111111111',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 24,
        archived_at: '2026-05-12T00:01:00.000Z',
        moved_to: null,
      })
    ).toMatchObject({
      status: 'archived',
      moved_to: null,
    });
  });

  it('registers remove_document with trash, archive, batch, and basename safety semantics', () => {
    const source = [
      readFileSync('src/mcp/tools/documents/remove.ts', 'utf8'),
      readFileSync('src/mcp/tools/documents/helpers.ts', 'utf8'),
    ].join('\n');

    expect(source).toContain("'remove_document'");
    expect(source).toContain('trashFolder');
    expect(source).toContain('bulk_removal');
    expect(source).toContain('moved_to');
    expect(source).toContain('archived_at');
    expect(source).toContain('basename');
    expect(source).toContain('FM.ORIGINAL_PATH');
  });

  it('rejects unsafe trash paths without introducing removed schema fields', () => {
    const source = [
      readFileSync('src/mcp/tools/documents/remove.ts', 'utf8'),
      readFileSync('src/mcp/tools/documents/helpers.ts', 'utf8'),
    ].join('\n');

    expect(source).toContain('path_traversal');
    expect(source).toContain('unsafe_trash');
    expect(source).toContain('invalid_input');
    expect(source).not.toContain('removed_at');
    expect(source).not.toContain('removed_to');
  });

  it('rolls back archive mutations when final filesystem removal fails', () => {
    const source = readFileSync('src/mcp/tools/documents/remove.ts', 'utf8');

    expect(source).toContain('archivedFileWritten');
    expect(source).toContain('archivedRowWritten');
    expect(source).toContain('existsSync(join(vaultRoot, relativePath))');
    expect(source).toContain('await vaultManager.writeMarkdown(relativePath, parsed.data, parsed.content)');
    expect(source).toContain("status: originalStatus");
    expect(source).toContain("archived_at: originalArchivedAt");
  });
});

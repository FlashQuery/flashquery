import { describe, expect, it } from 'vitest';
import {
  buildDocumentWriteResult,
  resolveTagsFrontmatterConflict,
  resolveTitleFrontmatterConflict,
  validateReservedFrontmatter,
  validateWriteDocumentInput,
} from '../../src/mcp/utils/document-write.js';
import { FM } from '../../src/constants/frontmatter-fields.js';

describe('write_document helper contract', () => {
  it('requires explicit mode with create/update guidance', () => {
    expect(validateWriteDocumentInput({})).toEqual({
      error: 'invalid_input',
      message: 'mode is required; use mode: "create" or mode: "update"',
    });
  });

  it('validates create and update mode parameter combinations', () => {
    expect(validateWriteDocumentInput({ mode: 'create', title: 'T' })).toMatchObject({
      error: 'invalid_input',
      details: { field: 'path' },
    });
    expect(validateWriteDocumentInput({ mode: 'create', path: 'a.md', title: 'T', identifier: 'x' })).toMatchObject({
      error: 'invalid_input',
      details: { field: 'identifier' },
    });
    expect(validateWriteDocumentInput({ mode: 'update', identifier: 'a.md', path: 'b.md' })).toMatchObject({
      error: 'invalid_input',
      details: { field: 'path' },
    });
    expect(validateWriteDocumentInput({ mode: 'update', identifier: 'a.md' })).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'no_mutable_fields' },
    });
  });

  it('rejects differing tags and frontmatter fq_tags values', () => {
    expect(resolveTagsFrontmatterConflict(['planning'], { [FM.TAGS]: ['research'] })).toMatchObject({
      error: 'invalid_input',
      details: { field: FM.TAGS },
    });

    expect(resolveTagsFrontmatterConflict(['planning'], { [FM.TAGS]: ['planning'] })).toBeNull();
  });

  it('rejects reserved managed frontmatter fields', () => {
    expect(validateReservedFrontmatter({ [FM.ARCHIVED_AT]: '2026-05-12' })).toMatchObject({
      error: 'invalid_input',
      details: { field: FM.ARCHIVED_AT },
    });
  });

  it('rejects differing title and frontmatter fq_title values', () => {
    expect(resolveTitleFrontmatterConflict('Top Title', { [FM.TITLE]: 'Other' })).toMatchObject({
      error: 'invalid_input',
      details: { field: FM.TITLE },
    });
  });

  it('builds JSON document identification plus mode with no prose', () => {
    expect(buildDocumentWriteResult({
      mode: 'create',
      identifier: 'Notes/a.md',
      title: 'A',
      path: 'Notes/a.md',
      fq_id: 'doc-id',
      modified: '2026-05-12T00:00:00.000Z',
      chars: 5,
    })).toEqual({
      identifier: 'Notes/a.md',
      title: 'A',
      path: 'Notes/a.md',
      fq_id: 'doc-id',
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: 5 },
      mode: 'create',
    });
  });
});

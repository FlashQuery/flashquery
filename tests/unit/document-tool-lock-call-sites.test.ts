import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const DOCUMENT_TOOL_FILES = [
  'src/mcp/tools/documents/write.ts',
  'src/mcp/tools/documents/archive.ts',
  'src/mcp/tools/documents/remove.ts',
  'src/mcp/tools/documents/copy.ts',
  'src/mcp/tools/documents/move.ts',
  'src/mcp/tools/compound.ts',
];

describe('REQ-001/REQ-010 document tool lock call sites', () => {
  it('T-I-001/T-I-002 scaffolding: document and compound tools no longer acquire the coarse documents lock directly', async () => {
    const offenders: string[] = [];

    for (const file of DOCUMENT_TOOL_FILES) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf-8');
      if (/from ['"].*services\/write-lock\.js['"]/.test(source)) offenders.push(file);
      if (/acquireLock\([^)]*['"]documents['"]/.test(source)) offenders.push(file);
      if (/releaseLock\([^)]*['"]documents['"]/.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('T-I-017/T-I-018 scaffolding: compound document mutations route through withDocumentLock', async () => {
    const source = await readFile(new URL('../../src/mcp/tools/compound.ts', import.meta.url), 'utf-8');

    expect(source).toContain("from '../../services/document-lock.js'");
    expect(source).toMatch(/insert_doc_link[\s\S]*withDocumentLock/);
    expect(source).toMatch(/apply_tags[\s\S]*withDocumentLock/);
  });

  it('compound document mutations report lock contention as expected conflicts', async () => {
    const source = await readFile(new URL('../../src/mcp/tools/compound.ts', import.meta.url), 'utf-8');
    const toolChunk = (name: string) => {
      const start = source.indexOf(`'${name}'`);
      const next = source.indexOf('server.registerTool(', start + 1);
      return source.slice(start, next === -1 ? undefined : next);
    };

    expect(source).toMatch(/sourceErr instanceof LockTimeoutError/);
    expect(source).toMatch(/itemErr instanceof LockTimeoutError/);
    expect(toolChunk('insert_in_doc')).toMatch(/err instanceof LockTimeoutError[\s\S]*lockContentionError\(err, identifier\)/);
    expect(toolChunk('replace_doc_section')).toMatch(/err instanceof LockTimeoutError[\s\S]*reason: 'lock_contention'/);
  });

  it('archive_document and remove_document batch paths report lock contention as expected conflicts', async () => {
    for (const file of ['archive.ts', 'remove.ts']) {
      const source = await readFile(new URL(`../../src/mcp/tools/documents/${file}`, import.meta.url), 'utf-8');

      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*error: 'conflict'/);
      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*identifier: id/);
      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*reason: 'lock_contention'/);
    }
  });
});

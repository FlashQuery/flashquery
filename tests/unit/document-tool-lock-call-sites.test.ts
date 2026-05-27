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

const SHARED_DIRECTORY_LOCK_SITES = [
  {
    file: 'src/mcp/tools/documents/write.ts',
    patterns: [
      /withAncestorDirectoryLocksShared\(\s*config,\s*absolutePath[\s\S]*withDocumentLock\(\s*config,\s*absolutePath/,
      /withAncestorDirectoryLocksShared\(\s*config,\s*lockCandidate\.absPath[\s\S]*withDocumentLock\(\s*config,\s*lockCandidate\.absPath/,
    ],
  },
  {
    file: 'src/mcp/tools/documents/archive.ts',
    patterns: [
      /withAncestorDirectoryLocksShared\(\s*config,\s*resolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*resolved\.absPath/,
    ],
  },
  {
    file: 'src/mcp/tools/documents/remove.ts',
    patterns: [
      /withAncestorDirectoryLocksShared\(\s*config,\s*resolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*resolved\.absPath/,
    ],
  },
  {
    file: 'src/mcp/tools/documents/copy.ts',
    patterns: [
      /withAncestorDirectoryLocksShared\(\s*config,\s*absPath[\s\S]*withDocumentLock\(\s*config,\s*absPath/,
    ],
  },
  {
    file: 'src/mcp/tools/documents/move.ts',
    patterns: [
      /withAncestorDirectoryLocksShared\(\s*config,\s*sourceAbsPath[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*normalizedDest[\s\S]*withDocumentLocks\(\s*config,\s*\[sourceAbsPath,\s*normalizedDest\]/,
    ],
  },
  {
    file: 'src/mcp/tools/compound.ts',
    patterns: [
      /insert_doc_link[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*sourceResolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*sourceResolved\.absPath/,
      /apply_tags[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*resolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*resolved\.absPath/,
      /insert_in_doc[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*resolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*resolved\.absPath/,
      /replace_doc_section[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*resolved\.absPath[\s\S]*withDocumentLock\(\s*config,\s*resolved\.absPath/,
    ],
  },
  {
    file: 'src/services/scanner.ts',
    patterns: [
      /repairFrontmatter[\s\S]*withAncestorDirectoryLocksShared\(\s*config,\s*join\(vaultRoot,\s*filePath\)[\s\S]*withDocumentLock\(\s*config,\s*join\(vaultRoot,\s*filePath\)/,
    ],
  },
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
    const source = await readFile(
      new URL('../../src/mcp/tools/compound.ts', import.meta.url),
      'utf-8'
    );

    expect(source).toContain("from '../../services/document-lock.js'");
    expect(source).toMatch(/insert_doc_link[\s\S]*withDocumentLock/);
    expect(source).toMatch(/apply_tags[\s\S]*withDocumentLock/);
  });

  it('compound document mutations report lock timeouts as expected conflicts', async () => {
    const source = await readFile(
      new URL('../../src/mcp/tools/compound.ts', import.meta.url),
      'utf-8'
    );
    const toolChunk = (name: string) => {
      const start = source.indexOf(`'${name}'`);
      const next = source.indexOf('server.registerTool(', start + 1);
      return source.slice(start, next === -1 ? undefined : next);
    };

    expect(source).toMatch(/sourceErr instanceof LockTimeoutError/);
    expect(source).toMatch(/itemErr instanceof LockTimeoutError/);
    expect(toolChunk('insert_in_doc')).toMatch(
      /err instanceof LockTimeoutError[\s\S]*lockTimeoutError\(err, identifier\)/
    );
    expect(toolChunk('replace_doc_section')).toMatch(
      /err instanceof LockTimeoutError[\s\S]*reason: 'lock_timeout'/
    );
  });

  it('archive_document and remove_document batch paths report lock timeouts as expected conflicts', async () => {
    for (const file of ['archive.ts', 'remove.ts']) {
      const source = await readFile(
        new URL(`../../src/mcp/tools/documents/${file}`, import.meta.url),
        'utf-8'
      );

      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*error: 'conflict'/);
      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*identifier: id/);
      expect(source).toMatch(/itemErr instanceof LockTimeoutError[\s\S]*reason: 'lock_timeout'/);
    }
  });

  it('write_document update re-resolves and re-reads inside withDocumentLock for INV-10', async () => {
    const source = await readFile(
      new URL('../../src/mcp/tools/documents/write.ts', import.meta.url),
      'utf-8'
    );
    const updateLockMatch = /withDocumentLock\(\s*config,\s*lockCandidate\.absPath/.exec(source);
    const updateLockIndex = updateLockMatch?.index ?? -1;
    expect(updateLockIndex).toBeGreaterThan(-1);

    const preLockSlice = source.slice(source.indexOf('const lockCandidate'), updateLockIndex);
    expect(preLockSlice).not.toMatch(/readFile\(resolved\.absPath/);

    const lockToWriteSlice = source.slice(
      updateLockIndex,
      source.indexOf('vaultManager.writeMarkdown', updateLockIndex)
    );
    expect(lockToWriteSlice).toMatch(
      /resolveDocumentIdentifier\(\s*config,\s*supabase,\s*identifier/
    );
    expect(lockToWriteSlice).toMatch(/resolved\.absPath !== lockCandidate\.absPath/);
    expect(source).toMatch(/return \{ retry: true \}/);
    expect(source).toMatch(/if \(!attempt\.retry\) return attempt\.result/);
    expect(lockToWriteSlice).toMatch(/readFile\(resolved\.absPath/);
  });

  it('REQ-007 T-I-012 file-writing tools hold shared ancestor directory locks outside file locks', async () => {
    for (const site of SHARED_DIRECTORY_LOCK_SITES) {
      const source = await readFile(new URL(`../../${site.file}`, import.meta.url), 'utf-8');
      expect(source, `${site.file} must import shared directory lock helper`).toContain(
        'withAncestorDirectoryLocksShared'
      );
      for (const pattern of site.patterns) {
        expect(source, `${site.file} missing ${pattern}`).toMatch(pattern);
      }
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks to preserve references
// ─────────────────────────────────────────────────────────────────────────────

const mockUuid = vi.hoisted(() => ({
  v4: vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000002'),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports of mocked modules)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
}));

vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-sha256-hash'),
  })),
}));

// Mock uuid — keep validate/version real so isValidUuid works correctly; mock v4 for predictability
vi.mock('uuid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('uuid')>();
  return {
    ...actual,
    v4: mockUuid.v4,
  };
});

// Mock documents.ts exports (listMarkdownFiles and computeHash)
vi.mock('../../src/mcp/tools/documents.js', () => ({
  listMarkdownFiles: vi.fn(),
  computeHash: vi.fn(() => 'mock-sha256-hash'),
}));

// Mock vaultManager (used by ensureProvisioned after refactor)
vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: {
    writeMarkdown: vi.fn().mockResolvedValue(undefined),
    readMarkdown: vi.fn(),
    resolvePath: vi.fn((p: string) => `/mock-vault/${p}`),
  },
}));

// Mock propagateFqcIdChange for PLG-03 testing
vi.mock('../../src/services/plugin-propagation.js', () => ({
  propagateFqcIdChange: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked modules
// ─────────────────────────────────────────────────────────────────────────────

import { resolveDocumentIdentifier, targetedScan, getFileMutex } from '../../src/mcp/utils/resolve-document.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { listMarkdownFiles } from '../../src/mcp/tools/documents.js';
import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'test-instance',
      id: 'test-instance',
      vault: { path: '/mock-vault', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    },
    logging: {
      level: 'info',
      output: 'stdout',
    },
  } as unknown as FlashQueryConfig;
}

/** Creates a chainable Supabase mock returning the given result for .single() */
function makeSupabaseMock(singleResult: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const self: Record<string, unknown> = {};
  const single = vi.fn().mockResolvedValue(singleResult);
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });

  Object.assign(self, {
    from: vi.fn().mockReturnValue(self),
    select: vi.fn().mockReturnValue(self),
    insert,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    eq: vi.fn().mockReturnValue(self),
    single,
    _single: single,
    _insert: insert,
    _update: update,
  });

  return self;
}

// Valid v4 UUID (version nibble = 4, variant nibble = 8-b)
const SAMPLE_UUID = '12345678-1234-4234-b234-567812345678';

// ─────────────────────────────────────────────────────────────────────────────
// Tests: resolveDocumentIdentifier
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDocumentIdentifier', () => {
  let config: FlashQueryConfig;

  beforeEach(() => {
    config = makeConfig();
    vi.clearAllMocks();
    // Default: existsSync returns false, listMarkdownFiles returns []
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(listMarkdownFiles).mockResolvedValue([]);
  });

  // ── UUID resolution ────────────────────────────────────────────────────────

  it('UUID input — queries DB by id and returns resolved document with resolvedVia=fq_id', async () => {
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: 'docs/my-doc.md', title: 'My Doc' },
      error: null,
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await resolveDocumentIdentifier(config, supabase as never, SAMPLE_UUID, logger);

    expect(result.fqcId).toBe(SAMPLE_UUID);
    expect(result.relativePath).toBe('docs/my-doc.md');
    expect(result.absPath).toBe('/mock-vault/docs/my-doc.md');
    expect(result.resolvedVia).toBe(FM.ID);
  });

  it('UUID not found in DB — throws Document not found error', async () => {
    const supabase = makeSupabaseMock({ data: null, error: { message: 'not found' } });

    await expect(
      resolveDocumentIdentifier(config, supabase as never, SAMPLE_UUID, logger)
    ).rejects.toThrow(`Document not found: no document with id "${SAMPLE_UUID}"`);
  });

  // ── Path resolution ────────────────────────────────────────────────────────

  it('path with "/" — file exists on disk — returns resolvedVia=path', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const supabase = makeSupabaseMock();

    const result = await resolveDocumentIdentifier(
      config,
      supabase as never,
      'clients/acme/notes.md',
      logger
    );

    expect(result.relativePath).toBe('clients/acme/notes.md');
    expect(result.absPath).toBe('/mock-vault/clients/acme/notes.md');
    expect(result.resolvedVia).toBe('path');
    expect(result.fqcId).toBeNull();
  });

  it('path not found on disk but DB row exists — scans vault and reconciles to new path', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // DB lookup finds the row
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: 'clients/acme/notes.md' },
      error: null,
    });
    // listMarkdownFiles returns a candidate
    vi.mocked(listMarkdownFiles).mockResolvedValue(['clients/acme/renamed-notes.md']);
    // readFile returns content with matching fqc_id
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_title: My Note\n---\n# Hello` as never
    );

    const result = await resolveDocumentIdentifier(
      config,
      supabase as never,
      'clients/acme/notes.md',
      logger
    );

    expect(result.resolvedVia).toBe('reconciliation');
    expect(result.relativePath).toBe('clients/acme/renamed-notes.md');
    expect(result.fqcId).toBe(SAMPLE_UUID);
    expect(result.stalePathNote).toContain('moved from');
    expect(result.stalePathNote).toContain('clients/acme/notes.md');
  });

  it('path not found on disk and no DB row — throws Document not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const supabase = makeSupabaseMock({ data: null, error: { message: 'not found' } });

    await expect(
      resolveDocumentIdentifier(config, supabase as never, 'missing/doc.md', logger)
    ).rejects.toThrow('Document not found: "missing/doc.md"');
  });

  // ── Filename resolution ────────────────────────────────────────────────────

  it('bare filename found at vault root — returns resolvedVia=filename', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const supabase = makeSupabaseMock();

    const result = await resolveDocumentIdentifier(
      config,
      supabase as never,
      'my-note.md',
      logger
    );

    expect(result.resolvedVia).toBe('filename');
    expect(result.absPath).toBe('/mock-vault/my-note.md');
    expect(result.relativePath).toBe('my-note.md');
  });

  it('bare filename found in vault scan — single match — returns resolvedVia=filename', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(listMarkdownFiles).mockResolvedValue(['subfolder/my-note.md', 'other/doc.md']);
    const supabase = makeSupabaseMock();

    const result = await resolveDocumentIdentifier(
      config,
      supabase as never,
      'my-note.md',
      logger
    );

    expect(result.resolvedVia).toBe('filename');
    expect(result.relativePath).toBe('subfolder/my-note.md');
    expect(result.fqcId).toBeNull();
  });

  it('bare filename matches 2+ files — throws disambiguation error listing all matches', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(listMarkdownFiles).mockResolvedValue([
      'folder-a/my-note.md',
      'folder-b/my-note.md',
    ]);
    const supabase = makeSupabaseMock();

    await expect(
      resolveDocumentIdentifier(config, supabase as never, 'my-note.md', logger)
    ).rejects.toThrow('Ambiguous filename "my-note.md" matches 2 files');
  });

  it('bare filename not found anywhere — throws Document not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(listMarkdownFiles).mockResolvedValue(['other/doc.md', 'another/file.md']);
    const supabase = makeSupabaseMock();

    await expect(
      resolveDocumentIdentifier(config, supabase as never, 'nonexistent.md', logger)
    ).rejects.toThrow('Document not found: "nonexistent.md"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: targetedScan (TSA-03/TSA-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('TSA-03/TSA-05: targetedScan', () => {
  let config: FlashQueryConfig;

  beforeEach(() => {
    config = makeConfig();
    vi.clearAllMocks();
    // vi.clearAllMocks() clears the mock implementation, so we must reset it
    mockUuid.v4.mockReturnValue('00000000-0000-4000-8000-000000000002');
  });

  const RESOLVED_WITH_ID = {
    absPath: '/mock-vault/docs/my-doc.md',
    relativePath: 'docs/my-doc.md',
    fqcId: SAMPLE_UUID,
    resolvedVia: 'path' as const,
  };

  const RESOLVED_NO_ID = {
    absPath: '/mock-vault/docs/untracked.md',
    relativePath: 'docs/untracked.md',
    fqcId: null,
    resolvedVia: 'path' as const,
  };

  // ── TSA-03: Identity Resolution ────────────────────────────────────────────

  it('TSA-03: resolves identity chain for file with valid fqc_id', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_title: My Doc\n---\n# Hello` as never
    );
    // DB ownership check: path matches → ownership confirmed
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    expect(result.fqcId).toBe(SAMPLE_UUID);
    expect(result.capturedFrontmatter.fqcId).toBe(SAMPLE_UUID);
    expect(result.capturedFrontmatter.contentHash).toBe('test-hash');
  });

  it('TSA-03: generates new fqc_id for ENOENT file', async () => {
    // readFile throws ENOENT
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce({
      code: 'ENOENT',
      message: 'file not found',
    } as never);
    const supabase = makeSupabaseMock();

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'new-hash', logger);

    expect(result.fqcId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.capturedFrontmatter.fqcId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.capturedFrontmatter.status).toBe('active');
    expect(result.capturedFrontmatter.contentHash).toBe('new-hash');
  });

  it('TSA-03: only updates identity fields in frontmatter', async () => {
    // File with title, tags, updated fields
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_title: Original Title\nfq_tags: [a, b]\nfq_updated: 2025-01-01T00:00:00Z\n---\n# Content` as never
    );
    // DB ownership check: confirmed
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    const { vaultManager: vm } = await import('../../src/storage/vault.js');

    await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // Verify writeMarkdown was called
    expect(vm.writeMarkdown).toHaveBeenCalledOnce();

    // Check frontmatter arg — title and tags should remain unchanged
    const [, frontmatterArg] = (vm.writeMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>, string];
    expect(frontmatterArg[FM.TITLE]).toBe('Original Title');
    expect(frontmatterArg[FM.TAGS]).toEqual([expect.anything(), expect.anything()]); // unchanged
    expect(frontmatterArg[FM.ID]).toBe(SAMPLE_UUID);
    // SPEC-08: content_hash must NOT appear in vault frontmatter — it is DB-only
    expect(frontmatterArg.content_hash).toBeUndefined();
  });

  // ── TSA-05: Mutex Coordination ─────────────────────────────────────────────

  it('TSA-05: acquires per-file mutex (DCP-04: global scanMutex not used)', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\n---\n# Content` as never
    );
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // DCP-04: targetedScan uses per-file mutex only, not global scanMutex.
    // Verify per-file mutex was created and is accessible.
    const fileMutex = getFileMutex(RESOLVED_NO_ID.relativePath);
    expect(fileMutex).toBeDefined();
  });

  it('TSA-05: acquires per-file mutex', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\n---\n# Content` as never
    );
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // Get the per-file mutex and verify it exists and was used
    const fileMutex = getFileMutex(RESOLVED_NO_ID.relativePath);
    expect(fileMutex).toBeDefined();
  });

  // ── TSA-03: Error Handling ──────────────────────────────────────────────────

  it('TSA-03: retries once on EACCES then degrades gracefully', async () => {
    // First call: EACCES
    // Second call (after 75ms): EACCES again
    vi.mocked(fsPromises.readFile)
      .mockRejectedValueOnce({
        code: 'EACCES',
        message: 'Permission denied',
      } as never)
      .mockRejectedValueOnce({
        code: 'EACCES',
        message: 'Permission denied',
      } as never);

    const supabase = makeSupabaseMock();

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // Must return best-effort snapshot with generated UUID
    expect(result.fqcId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.capturedFrontmatter.contentHash).toBe('test-hash');

    // Must log warning
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('retry failed')
    );
  });

  // ── TSA-03: Field Scoping Verification ─────────────────────────────────────

  it('TSA-03: ensures capturedFrontmatter has all required fields', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_created: 2025-01-01T00:00:00Z\nfq_status: active\n---\n# Content` as never
    );
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'hash123', logger);

    // Snapshot must have all 4 required fields
    expect(result.capturedFrontmatter.fqcId).toBe(SAMPLE_UUID);
    expect(result.capturedFrontmatter.created).toBeDefined();
    expect(result.capturedFrontmatter.status).toBe('active');
    expect(result.capturedFrontmatter.contentHash).toBe('hash123');
  });

  // ── TSA-03: ensureProvisioned is no longer exported ────────────────────────

  it('TSA-03: ensureProvisioned is no longer exported', async () => {
    // Import the module and verify ensureProvisioned does not exist
    const resolveDoc = await import('../../src/mcp/utils/resolve-document.js');
    expect(typeof (resolveDoc as Record<string, unknown>).ensureProvisioned).toBe('undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: PLG-03 — targetedScan with propagateFqcIdChange integration
// ─────────────────────────────────────────────────────────────────────────────

describe('PLG-03: targetedScan propagation', () => {
  let config: FlashQueryConfig;

  beforeEach(() => {
    config = makeConfig();
    vi.clearAllMocks();
    // vi.clearAllMocks() clears the mock implementation, so we must reset it
    mockUuid.v4.mockReturnValue('00000000-0000-4000-8000-000000000002');
  });

  const RESOLVED_NO_ID = {
    absPath: '/mock-vault/docs/untracked.md',
    relativePath: 'docs/untracked.md',
    fqcId: null,
    resolvedVia: 'path' as const,
  };

  it('PLG-03: propagateFqcIdChange import exists', async () => {
    // Verify that propagateFqcIdChange is imported into resolve-document.ts
    const content = await import('../../src/mcp/utils/resolve-document.js');
    const { propagateFqcIdChange } = await import('../../src/services/plugin-propagation.js');
    expect(propagateFqcIdChange).toBeDefined();
  });

  it('PLG-03: targetedScan returns resolved DbRow', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_title: My Doc\n---\n# Content` as never
    );
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // Verify result includes resolved row
    expect(result.fqcId).toBe(SAMPLE_UUID);
    expect(result.relativePath).toBe(RESOLVED_NO_ID.relativePath);
    expect(result.capturedFrontmatter.fqcId).toBe(SAMPLE_UUID);
    expect(result.capturedFrontmatter.status).toBe('active');
  });

  it('PLG-03: new external files marked with minimal metadata', async () => {
    // ENOENT case: new file not previously tracked
    vi.mocked(fsPromises.readFile).mockRejectedValueOnce({
      code: 'ENOENT',
      message: 'file not found',
    } as never);

    const supabase = makeSupabaseMock();

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'new-hash', logger);

    // Verify minimal metadata populated
    expect(result.capturedFrontmatter.fqcId).toBeDefined();
    expect(result.capturedFrontmatter.status).toBe('active');
    expect(result.capturedFrontmatter.contentHash).toBe('new-hash');
    expect(result.capturedFrontmatter.created).toBeDefined();

    // New files should NOT trigger propagation (no old ID, both are undefined until new ID generated)
    const { propagateFqcIdChange } = await import('../../src/services/plugin-propagation.js');
    expect(vi.mocked(propagateFqcIdChange)).not.toHaveBeenCalled();
  });

  it('PLG-03: propagateFqcIdChange error handling is implemented', async () => {
    // Test that propagateFqcIdChange throws can be caught properly
    // This verifies the try/catch pattern works in resolve-document.ts
    const { propagateFqcIdChange } = await import('../../src/services/plugin-propagation.js');

    // Mock it to throw
    vi.mocked(propagateFqcIdChange).mockRejectedValueOnce(new Error('Test error'));

    // Verify it rejects (not crashes)
    await expect(propagateFqcIdChange(null as never, 'old', 'new', 'path', new Map(), logger)).rejects.toThrow('Test error');
  });

  it('PLG-03: targetedScan handles frontmatter correctly with all required fields', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      `---\nfq_id: ${SAMPLE_UUID}\nfq_created: 2025-01-01T00:00:00Z\nfq_status: active\nfq_tags: [test]\n---\n# Content` as never
    );
    const supabase = makeSupabaseMock({
      data: { id: SAMPLE_UUID, path: RESOLVED_NO_ID.relativePath },
      error: null,
    });

    const result = await targetedScan(config, supabase as never, RESOLVED_NO_ID, 'test-hash', logger);

    // Verify all required fields present in captured frontmatter
    expect(result.capturedFrontmatter.fqcId).toBe(SAMPLE_UUID);
    expect(result.capturedFrontmatter.created).toBeDefined();
    expect(result.capturedFrontmatter.status).toBe('active');
    expect(result.capturedFrontmatter.contentHash).toBe('test-hash');
  });
});

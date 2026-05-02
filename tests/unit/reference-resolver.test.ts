import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseReferences,
  resolveReferences,
  hydrateMessages,
  buildInjectedReferences,
  computePromptChars,
} from '../../src/llm/reference-resolver.js';
import type {
  ParsedRef,
  ParseRefError,
  ResolvedRef,
  FailedRef,
} from '../../src/llm/reference-resolver.js';

// Mock resolveAndBuildDocument and DocumentRequestError from document-output.js
vi.mock('../../src/mcp/utils/document-output.js', () => ({
  resolveAndBuildDocument: vi.fn(),
  DocumentRequestError: class DocumentRequestError extends Error {
    constructor(public envelope: Record<string, unknown>) {
      super(typeof envelope.message === 'string' ? envelope.message : 'document request failed');
      this.name = 'DocumentRequestError';
    }
  },
}));

// Mock logger, supabaseManager, embeddingProvider
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({})) },
}));

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: { embed: vi.fn() },
}));

import { resolveAndBuildDocument, DocumentRequestError } from '../../src/mcp/utils/document-output.js';

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────

describe('parseReferences (REFS-01, REFS-02, REFS-07)', () => {
  it('[U-RR-01] detects {{ref:path}} — full body by path', () => {
    const result = parseReferences([
      { role: 'user', content: 'See {{ref:Research/doc.md}} for details.' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].placeholder).toBe('{{ref:Research/doc.md}}');
    expect(refs[0].ref).toBe('{{ref:Research/doc.md}}');
    expect(refs[0].identifierType).toBe('ref');
    expect(refs[0].identifier).toBe('Research/doc.md');
    expect(refs[0].section).toBeUndefined();
    expect(refs[0].pointer).toBeUndefined();
    expect(refs[0].messageIndex).toBe(0);
  });

  it('[U-RR-02] detects {{ref:path#Section}} — section by path', () => {
    const result = parseReferences([
      { role: 'user', content: 'Read {{ref:Research/doc.md#Open Questions}} now.' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('{{ref:Research/doc.md#Open Questions}}');
    expect(refs[0].identifier).toBe('Research/doc.md');
    expect(refs[0].section).toBe('Open Questions');
    expect(refs[0].pointer).toBeUndefined();
  });

  it('[U-RR-03] detects {{ref:path->pointer}} — dereference by path', () => {
    const result = parseReferences([
      { role: 'user', content: '{{ref:Research/doc.md->projections.summary}} ok' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('{{ref:Research/doc.md->projections.summary}}');
    expect(refs[0].identifier).toBe('Research/doc.md');
    expect(refs[0].pointer).toBe('projections.summary');
    expect(refs[0].section).toBeUndefined();
  });

  it('[U-RR-04] detects {{id:uuid}} — full body by id', () => {
    const result = parseReferences([
      { role: 'user', content: 'Doc: {{id:550e8400-e29b-41d4-a716-446655440000}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('{{id:550e8400-e29b-41d4-a716-446655440000}}');
    expect(refs[0].identifierType).toBe('id');
    expect(refs[0].identifier).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(refs[0].section).toBeUndefined();
    expect(refs[0].pointer).toBeUndefined();
  });

  it('[U-RR-05] detects {{id:uuid#Section}} — section by id', () => {
    const result = parseReferences([
      { role: 'user', content: '{{id:550e8400-e29b-41d4-a716-446655440000#Conclusions}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('{{id:550e8400-e29b-41d4-a716-446655440000#Conclusions}}');
    expect(refs[0].identifierType).toBe('id');
    expect(refs[0].section).toBe('Conclusions');
  });

  it('[U-RR-06] detects {{id:uuid->pointer}} — dereference by id', () => {
    const result = parseReferences([
      { role: 'user', content: '{{id:abc-uuid->next.ref}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].ref).toBe('{{id:abc-uuid->next.ref}}');
    expect(refs[0].identifierType).toBe('id');
    expect(refs[0].identifier).toBe('abc-uuid');
    expect(refs[0].pointer).toBe('next.ref');
  });

  it('[U-RR-07] returns ParseRefError when # and -> both present (REFS-02)', () => {
    const result = parseReferences([
      { role: 'user', content: '{{ref:doc.md#Sec->pointer}}' },
    ]);
    expect(Array.isArray(result)).toBe(false);
    const err = result as ParseRefError;
    expect(err.error).toBe('invalid_reference_syntax');
    expect(err.reason).toBe('invalid reference syntax: # and -> are mutually exclusive');
    expect(err.ref).toBe('{{ref:doc.md#Sec->pointer}}');
  });

  it('[U-RR-08] returns empty array when no patterns in messages (REFS-07)', () => {
    const result = parseReferences([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2+2?' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(0);
  });

  it('[U-RR-09] counts duplicate placeholders separately (not deduplicated)', () => {
    const result = parseReferences([
      { role: 'user', content: 'See {{ref:doc.md}} and also {{ref:doc.md}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(2);
    expect(refs[0].placeholder).toBe('{{ref:doc.md}}');
    expect(refs[1].placeholder).toBe('{{ref:doc.md}}');
  });

  it('[U-RR-10] sets messageIndex correctly for refs in different messages', () => {
    const result = parseReferences([
      { role: 'system', content: '{{ref:sys.md}}' },
      { role: 'user', content: 'no ref here' },
      { role: 'assistant', content: '{{ref:asst.md}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(2);
    expect(refs[0].messageIndex).toBe(0);
    expect(refs[1].messageIndex).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('hydrateMessages (REFS-03 partial)', () => {
  it('[U-RR-11] replaces placeholder with resolved content inline', () => {
    const messages = [{ role: 'user', content: 'Body: {{ref:doc.md}} end.' }];
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', content: 'HELLO', chars: 5, messageIndex: 0 },
    ];
    const out = hydrateMessages(messages, resolved);
    expect(out[0].content).toBe('Body: HELLO end.');
  });

  it('[U-RR-12] produces new array — does not mutate original messages', () => {
    const messages = [{ role: 'user', content: '{{ref:doc.md}}' }];
    const original = messages[0].content;
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', content: 'X', chars: 1, messageIndex: 0 },
    ];
    const out = hydrateMessages(messages, resolved);
    expect(messages[0].content).toBe(original);
    expect(out[0].content).toBe('X');
    expect(out).not.toBe(messages);
  });

  it('[U-RR-13] single-pass — does not re-process injected content', () => {
    // a.md's content itself contains a literal {{ref:b.md}} string
    const messages = [{ role: 'user', content: 'A: {{ref:a.md}} B: {{ref:b.md}}' }];
    const resolved: ResolvedRef[] = [
      {
        kind: 'resolved',
        placeholder: '{{ref:a.md}}',
        ref: '{{ref:a.md}}',
        content: '[from a.md, contains literal {{ref:b.md}}]',
        chars: 42,
        messageIndex: 0,
      },
      {
        kind: 'resolved',
        placeholder: '{{ref:b.md}}',
        ref: '{{ref:b.md}}',
        content: '[from b.md]',
        chars: 11,
        messageIndex: 0,
      },
    ];
    const out = hydrateMessages(messages, resolved);
    // The literal {{ref:b.md}} inside a.md's injected content should NOT be replaced again
    expect(out[0].content).toContain('[from a.md, contains literal {{ref:b.md}}]');
    expect(out[0].content).toContain('[from b.md]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildInjectedReferences (REFS-04)', () => {
  it('[U-RR-14] omits resolved_to when undefined; includes it when set', () => {
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:a.md}}', ref: '{{ref:a.md}}', content: 'X', chars: 1, messageIndex: 0 },
      {
        kind: 'resolved',
        placeholder: '{{ref:b.md->p}}',
        ref: '{{ref:b.md->p}}',
        content: 'Y',
        chars: 1,
        resolvedTo: 'target/b-target.md',
        messageIndex: 0,
      },
    ];
    const out = buildInjectedReferences(resolved);
    expect(out[0]).toStrictEqual({ ref: '{{ref:a.md}}', chars: 1 });
    expect('resolved_to' in out[0]).toBe(false);
    expect(out[1]).toStrictEqual({ ref: '{{ref:b.md->p}}', chars: 1, resolved_to: 'target/b-target.md' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('computePromptChars (REFS-05)', () => {
  it('[U-RR-15] sums content.length across all messages', () => {
    const messages = [
      { role: 'system', content: 'abc' },   // 3
      { role: 'user', content: 'hello' },   // 5
      { role: 'assistant', content: '' },   // 0
    ];
    const total = computePromptChars(messages);
    expect(total).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveReferences (resolution + error mapping)', () => {
  const fakeConfig = {} as import('../../src/config/loader.js').FlashQueryConfig;
  const fakeSm = { getClient: vi.fn(() => ({})) } as unknown as typeof import('../../src/storage/supabase.js').supabaseManager;
  const fakeEp = { embed: vi.fn() } as unknown as typeof import('../../src/embedding/provider.js').embeddingProvider;
  const fakeLog = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as typeof import('../../src/logging/logger.js').logger;

  it('[U-RR-16] returns ResolvedRef[] on success with body content', async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce({
      identifier: 'doc.md',
      title: 'doc',
      path: 'doc.md',
      fq_id: null,
      modified: '2026-01-01',
      size: { chars: 5 },
      body: 'HELLO',
    } as unknown as Record<string, unknown>);

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:doc.md}}',
        ref: '{{ref:doc.md}}',
        identifierType: 'ref',
        identifier: 'doc.md',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    expect(out).toHaveLength(1);
    const resolved = out[0] as ResolvedRef;
    expect('reason' in resolved).toBe(false);
    expect(resolved.content).toBe('HELLO');
    expect(resolved.chars).toBe(5);
    expect(resolved.placeholder).toBe('{{ref:doc.md}}');
    expect(resolved.ref).toBe('{{ref:doc.md}}');
    expect(resolved.messageIndex).toBe(0);
  });

  it('[U-RR-17] returns FailedRef on DocumentRequestError', async () => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(
      new DocumentRequestError({
        error: 'section_not_found',
        message: "No heading matching 'Open Questions' found in document",
      })
    );

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:doc.md#Open Questions}}',
        ref: '{{ref:doc.md#Open Questions}}',
        identifierType: 'ref',
        identifier: 'doc.md',
        section: 'Open Questions',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    expect(out).toHaveLength(1);
    const failed = out[0];
    expect('reason' in failed).toBe(true);
    const f = failed as FailedRef;
    expect(f.ref).toBe('{{ref:doc.md#Open Questions}}');
    expect(f.reason).toBe("No heading matching 'Open Questions' found in document");
  });

  it('[U-RR-18] returns FailedRef on generic Error (document not found)', async () => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(
      new Error('Document not found: missing/ghost.md')
    );

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:missing/ghost.md}}',
        ref: '{{ref:missing/ghost.md}}',
        identifierType: 'ref',
        identifier: 'missing/ghost.md',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    expect(out).toHaveLength(1);
    const f = out[0] as FailedRef;
    expect('reason' in f).toBe(true);
    expect(f.ref).toBe('{{ref:missing/ghost.md}}');
    expect(f.reason).toBe('Document not found: missing/ghost.md');
  });
});

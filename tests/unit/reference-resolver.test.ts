import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseReferences,
  resolveReferences,
  hydrateMessages,
  buildInjectedReferences,
  computePromptChars,
} from '../../src/llm/reference-resolver.js';
import {
  REFERENCE_FAILURE_REASONS,
  isReferenceFailureReason,
} from '../../src/constants/reference-failures.js';
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
import {
  AmbiguousDocumentIdentifierError,
  DocumentNotFoundError,
  DocumentReadError,
} from '../../src/mcp/utils/resolve-document.js';

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────

describe('ReferenceFailureReason constants (D-05, T-113-04)', () => {
  it('exports a unique runtime-enumerable reason set guarded by isReferenceFailureReason', () => {
    expect(new Set(REFERENCE_FAILURE_REASONS).size).toBe(REFERENCE_FAILURE_REASONS.length);
    expect(REFERENCE_FAILURE_REASONS).toContain('invalid_reference_syntax');
    expect(REFERENCE_FAILURE_REASONS).toContain('ambiguous_document_identifier');
    for (const reason of REFERENCE_FAILURE_REASONS) {
      expect(isReferenceFailureReason(reason)).toBe(true);
    }
    expect(isReferenceFailureReason('free_form_failure')).toBe(false);
  });
});

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

  it('[U-RR-04] treats active legacy {{id:uuid}} as literal text', () => {
    const result = parseReferences([
      { role: 'user', content: 'Doc: {{id:550e8400-e29b-41d4-a716-446655440000}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('[U-RR-05] treats active legacy {{id:uuid#Section}} as literal text', () => {
    const result = parseReferences([
      { role: 'user', content: '{{id:550e8400-e29b-41d4-a716-446655440000#Conclusions}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('[U-RR-06] treats active legacy {{id:uuid->pointer}} as literal text', () => {
    const result = parseReferences([
      { role: 'user', content: '{{id:abc-uuid->next.ref}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
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

  it('[U-RR-08b] rejects {{ref:}} with empty identifier (REFS-08) (Phase 3 Gap 8)', () => {
    // REFS-08: empty identifier in a `ref:` placeholder must be rejected at
    // parse time with `invalid_reference_syntax`. Without this test the
    // implementation's REFS-08 guard (reference-resolver.ts:108-117) is
    // unverified — a future regression that lets an empty identifier
    // propagate to resolveAndBuildDocument would produce an opaque
    // "document not found" failure instead of the clear parse error.
    const result = parseReferences([
      { role: 'user', content: 'See {{ref:}} for nothing.' },
    ]);
    expect(Array.isArray(result)).toBe(false);
    const err = result as ParseRefError;
    expect(err.error).toBe('invalid_reference_syntax');
    expect(err.reason).toContain('empty');
    expect(err.ref).toBe('{{ref:}}');
  });

  it('[U-RR-08c] treats active legacy {{id:}} with empty identifier as literal text', () => {
    const result = parseReferences([
      { role: 'user', content: 'See {{id:}} for nothing.' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseReferences Phase 113 DRS grammar (D-02, D-03, D-04)', () => {
  it.each([
    ['path', 'See {{ref:path.md}}', { identifier: 'path.md' }],
    ['uuid', 'See {{ref:550e8400-e29b-41d4-a716-446655440000}}', { identifier: '550e8400-e29b-41d4-a716-446655440000' }],
    ['email-ish path', 'See {{ref:People/alice@example.com.md}}', { identifier: 'People/alice@example.com.md' }],
  ])('accepts active {{ref:...}} form for %s', (_name, content, expected) => {
    const result = parseReferences([{ role: 'user', content }]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      identifierType: 'ref',
      ...expected,
    });
  });

  it.each([
    ['empty alias', '{{ref:@}}'],
    ['alias with section', '{{ref:@alias#Section}}'],
    ['alias with pointer', '{{ref:@alias->pointer}}'],
    ['empty section', '{{ref:doc.md#}}'],
    ['empty pointer', '{{ref:doc.md->}}'],
    ['whitespace before section operator', '{{ref:doc.md # Section}}'],
    ['whitespace before pointer operator', '{{ref:doc.md -> key}}'],
  ])('rejects invalid Phase 113 syntax: %s', (_name, placeholder) => {
    const result = parseReferences([{ role: 'user', content: placeholder }]);
    expect(Array.isArray(result)).toBe(false);
    const err = result as ParseRefError;
    expect(err.error).toBe('invalid_reference_syntax');
    expect(err.ref).toBe(placeholder);
  });

  it('allows # characters inside section names after the section operator', () => {
    const result = parseReferences([
      { role: 'user', content: '{{ref:doc.md#Phase A # Phase B}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    const refs = result as ParsedRef[];
    expect(refs).toHaveLength(1);
    expect(refs[0].identifier).toBe('doc.md');
    expect(refs[0].section).toBe('Phase A # Phase B');
  });

  it.each([
    ['whitespace after section operator', '{{ref:doc.md# Section}}'],
    ['whitespace before section operator', '{{ref:doc.md #Section}}'],
    ['blank section after operator space', '{{ref:doc.md# }}'],
    ['whitespace after pointer operator', '{{ref:doc.md-> key}}'],
    ['whitespace before pointer operator', '{{ref:doc.md ->key}}'],
  ])('rejects operator-boundary whitespace: %s', (_name, placeholder) => {
    const result = parseReferences([{ role: 'user', content: placeholder }]);
    expect(Array.isArray(result)).toBe(false);
    const err = result as ParseRefError;
    expect(err.error).toBe('invalid_reference_syntax');
    expect(err.detail).toContain('whitespace');
  });

  it('treats malformed opener and legacy {{id:...}} as literal text with no metadata', () => {
    const result = parseReferences([
      { role: 'user', content: 'literal {{ref:doc.md and {{id:550e8400-e29b-41d4-a716-446655440000}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it.each([
    [String.raw`\{{ref:doc.md}}`, 0],
    [String.raw`\\{{ref:doc.md}}`, 1],
    [String.raw`\\\{{ref:doc.md}}`, 0],
    [String.raw`\{{ref:}}`, 0],
    [String.raw`\\\\{{ref:doc.md}}`, 1],
    [String.raw`\\\\\{{ref:doc.md}}`, 0],
    [String.raw`\{{id:550e8400-e29b-41d4-a716-446655440000}}`, 0],
  ])('applies DRS escape parity to %s', (content, count) => {
    const result = parseReferences([{ role: 'user', content }]);
    expect(Array.isArray(result)).toBe(true);
    expect(result as ParsedRef[]).toHaveLength(count);
  });

  it('preserves duplicate identical active placeholders as distinct metadata entries', () => {
    const result = parseReferences([
      { role: 'user', content: '{{ref:doc.md}} and {{ref:doc.md}}' },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result as ParsedRef[]).toHaveLength(2);
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

  it('[U-RR-13b] single-pass — placeholder for a doc NOT in resolved set survives literally in injected content (TC3-W1)', () => {
    // TC3-W1: the [U-RR-13] setup is good-path only (both a.md and b.md
    // exist in `resolved`), so it can't distinguish "single-pass" from
    // "multi-pass that happens to find b.md". Here, a.md's body contains a
    // literal {{ref:c.md}} placeholder, but c.md is NOT in the resolved set.
    // A correct single-pass implementation MUST leave that literal
    // placeholder in the output verbatim (no resolution attempt, no
    // failure entry). A multi-pass implementation would either re-scan
    // the injected text and produce a failure for c.md, or leak it as
    // an unresolved placeholder string in a different way.
    const messages = [{ role: 'user', content: 'See {{ref:a.md}} for context.' }];
    const resolved: ResolvedRef[] = [
      {
        kind: 'resolved',
        placeholder: '{{ref:a.md}}',
        ref: '{{ref:a.md}}',
        content: '[from a.md, contains literal {{ref:c.md}} that must NOT be re-resolved]',
        chars: 67,
        messageIndex: 0,
      },
    ];
    const out = hydrateMessages(messages, resolved);
    // The literal {{ref:c.md}} from a.md's injected body must remain
    // exactly as-is in the output — proving single-pass behaviour.
    expect(out[0].content).toContain('{{ref:c.md}}');
    expect(out[0].content).toContain('[from a.md, contains literal {{ref:c.md}} that must NOT be re-resolved]');
    // And the original {{ref:a.md}} placeholder must have been replaced.
    expect(out[0].content).not.toContain('{{ref:a.md}}');
  });

  it('[U-RR-13d] hydrateMessages — messageIndex routes ResolvedRefs into the correct message (Phase 3 Gap 9)', () => {
    // Phase 3 Gap 9: all existing hydrateMessages tests use single-message
    // arrays, so the cursor logic that respects ParsedRef.messageIndex (set
    // by parseReferences when refs span multiple messages) is unverified.
    // This test passes ResolvedRefs whose messageIndex points to messages
    // 0 and 2 — message 1 has no refs and must pass through unchanged.
    // A naive implementation that flattens all refs across messages would
    // either inject content into the wrong message or smush placeholders
    // and content together; a correct implementation routes per messageIndex.
    const messages = [
      { role: 'system', content: 'sys: {{ref:sys.md}}' },
      { role: 'user', content: 'plain user content (no ref here)' },
      { role: 'assistant', content: 'asst: {{ref:asst.md}}' },
    ];
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:sys.md}}', ref: '{{ref:sys.md}}', content: 'SYSBODY', chars: 7, messageIndex: 0 },
      { kind: 'resolved', placeholder: '{{ref:asst.md}}', ref: '{{ref:asst.md}}', content: 'ASSTBODY', chars: 8, messageIndex: 2 },
    ];
    const out = hydrateMessages(messages, resolved);
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe('sys: SYSBODY');
    // Message 1 (no refs) must be unchanged — proves we don't accidentally
    // inject into messages whose index doesn't appear in resolved[].
    expect(out[1].content).toBe('plain user content (no ref here)');
    expect(out[2].content).toBe('asst: ASSTBODY');
    // Crossover-protection: SYSBODY must NOT appear in message 2's output,
    // and ASSTBODY must NOT appear in message 0's output.
    expect(out[0].content).not.toContain('ASSTBODY');
    expect(out[2].content).not.toContain('SYSBODY');
  });

  it('[U-RR-13c] hydrateMessages — duplicate placeholders consume successive ResolvedRef entries (TC3-M1)', () => {
    // TC3-M1: [U-RR-09] only verifies the parser side of the
    // "duplicate placeholders not deduplicated" rule. The downstream
    // hydrateMessages cursor logic — which must consume each ResolvedRef
    // in input order rather than reusing the first match — was not
    // exercised. This test passes two ResolvedRef entries for the SAME
    // placeholder string with DIFFERENT content; if hydrateMessages
    // simply searched-and-replaced globally, both occurrences would
    // resolve to the first content (which would be wrong).
    const messages = [
      { role: 'user', content: 'First: {{ref:doc.md}}; second: {{ref:doc.md}}.' },
    ];
    const resolved: ResolvedRef[] = [
      {
        kind: 'resolved',
        placeholder: '{{ref:doc.md}}',
        ref: '{{ref:doc.md}}',
        content: 'ALPHA',
        chars: 5,
        messageIndex: 0,
      },
      {
        kind: 'resolved',
        placeholder: '{{ref:doc.md}}',
        ref: '{{ref:doc.md}}',
        content: 'BETA',
        chars: 4,
        messageIndex: 0,
      },
    ];
    const out = hydrateMessages(messages, resolved);
    // The two placeholders must resolve to ALPHA and BETA in input order,
    // not both to ALPHA (which would happen with a naive replaceAll).
    expect(out[0].content).toBe('First: ALPHA; second: BETA.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildInjectedReferences (REFS-04)', () => {
  it('[U-RR-14] omits non-spec identifier, includes resolved_to only when set', () => {
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:a.md}}', ref: '{{ref:a.md}}', content: 'X', chars: 1, identifier: 'a.md', messageIndex: 0 },
      {
        kind: 'resolved',
        placeholder: '{{ref:b.md->p}}',
        ref: '{{ref:b.md->p}}',
        content: 'Y',
        chars: 1,
        resolvedTo: 'target/b-target.md',
        messageIndex: 0,
      },
      {
        kind: 'resolved',
        placeholder: '{{ref:c.md#Section}}',
        ref: '{{ref:c.md#Section}}',
        content: 'Z',
        chars: 1,
        identifier: 'c.md',
        resolvedTo: 'nested/c.md',
        messageIndex: 0,
      },
    ];
    const out = buildInjectedReferences(resolved);
    expect(out[0]).toStrictEqual({ ref: '{{ref:a.md}}', chars: 1 });
    expect('identifier' in out[0]).toBe(false);
    expect('resolved_to' in out[0]).toBe(false);
    expect(out[1]).toStrictEqual({ ref: '{{ref:b.md->p}}', chars: 1, resolved_to: 'target/b-target.md' });
    expect(out[2]).toStrictEqual({ ref: '{{ref:c.md#Section}}', chars: 1, resolved_to: 'nested/c.md' });
    expect('identifier' in out[2]).toBe(false);
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

  it('[U-RR-15b] prompt_chars (post-hydration) >= sum(injected_references[].chars) (Phase 3 Gap 2)', () => {
    // Phase 3 Gap 2: the spec invariant is that prompt_chars (computed on
    // the hydrated, fully-injected messages) must be at least the sum of
    // injected_references[].chars — because each injected entry replaces
    // its placeholder with content of `chars` length, and the hydrated
    // messages also contain the surrounding prose, so the total can only
    // be larger. Without this test a regression that, e.g., subtracted
    // chars instead of added them, would not be caught at unit level.
    const original = [
      { role: 'user', content: 'See {{ref:a.md}} and also {{ref:b.md#Sec}} for context.' },
    ];
    const resolved: ResolvedRef[] = [
      { kind: 'resolved', placeholder: '{{ref:a.md}}', ref: '{{ref:a.md}}', content: 'AAAAAAAAAA', chars: 10, messageIndex: 0 },
      { kind: 'resolved', placeholder: '{{ref:b.md#Sec}}', ref: '{{ref:b.md#Sec}}', content: 'BBBBBBBBBBBBBBB', chars: 15, messageIndex: 0 },
    ];
    const hydrated = hydrateMessages(original, resolved);
    const promptChars = computePromptChars(hydrated);
    const injected = buildInjectedReferences(resolved);
    const sumChars = injected.reduce((acc, e) => acc + (e.chars as number), 0);
    expect(sumChars).toBe(25);
    // Spec invariant: prompt_chars >= sum(injected[].chars). Surrounding
    // prose ("See ", " and also ", " for context.") makes the total
    // strictly greater than 25, but the >= form is the spec contract.
    expect(promptChars).toBeGreaterThanOrEqual(sumChars);
    // Tighter sanity check: prompt_chars equals the literal hydrated
    // string length (proves the inequality is real, not vacuous).
    expect(promptChars).toBe(hydrated[0].content.length);
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

  it('[U-RR-16b] sets resolvedTo for fq_id and filename refs whose canonical path diverges', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce({
        identifier: '550e8400-e29b-41d4-a716-446655440000',
        title: 'doc',
        path: 'Research/doc.md',
        fq_id: '550e8400-e29b-41d4-a716-446655440000',
        modified: '2026-01-01',
        size: { chars: 5 },
        body: 'HELLO',
      } as unknown as Record<string, unknown>)
      .mockResolvedValueOnce({
        identifier: 'doc',
        title: 'doc',
        path: 'Research/doc.md',
        fq_id: null,
        modified: '2026-01-01',
        size: { chars: 5 },
        body: 'HELLO',
      } as unknown as Record<string, unknown>)
      .mockResolvedValueOnce({
        identifier: 'Research/doc.md',
        title: 'doc',
        path: 'Research/doc.md',
        fq_id: null,
        modified: '2026-01-01',
        size: { chars: 5 },
        body: 'HELLO',
      } as unknown as Record<string, unknown>);

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:550e8400-e29b-41d4-a716-446655440000}}',
        ref: '{{ref:550e8400-e29b-41d4-a716-446655440000}}',
        identifierType: 'ref',
        identifier: '550e8400-e29b-41d4-a716-446655440000',
        messageIndex: 0,
      },
      {
        placeholder: '{{ref:doc}}',
        ref: '{{ref:doc}}',
        identifierType: 'ref',
        identifier: 'doc',
        messageIndex: 0,
      },
      {
        placeholder: '{{ref:Research/doc.md}}',
        ref: '{{ref:Research/doc.md}}',
        identifierType: 'ref',
        identifier: 'Research/doc.md',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    const metadata = buildInjectedReferences(out.filter((entry) => entry.kind === 'resolved') as ResolvedRef[]);
    expect(metadata).toStrictEqual([
      { ref: '{{ref:550e8400-e29b-41d4-a716-446655440000}}', chars: 5, resolved_to: 'Research/doc.md' },
      { ref: '{{ref:doc}}', chars: 5, resolved_to: 'Research/doc.md' },
      { ref: '{{ref:Research/doc.md}}', chars: 5 },
    ]);
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
    expect(f.reason).toBe('section_not_found');
    expect(f.detail).toBe("No heading matching 'Open Questions' found in document");
  });

  it('[U-RR-18] returns FailedRef on typed document not found', async () => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(
      new DocumentNotFoundError('missing/ghost.md')
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
    expect(f.reason).toBe('document_not_found');
    expect(f.detail).toBe('Document not found: "missing/ghost.md"');
  });

  it('[U-RR-19] aggregates multiple failures — both refs appear in failed[] (Phase 3 Gap 1, OQ #7)', async () => {
    // Phase 3 Gap 1 (HIGH PRIORITY): the existing tests verify a single
    // failure path. The spec's fail-fast semantics (REFS-06) require that
    // when 2+ references fail in the same call, BOTH appear in the
    // returned failed_references[] array (so the AI consumer can see all
    // failures at once rather than getting them one-at-a-time across
    // retries). Without this test, an implementation that returned only
    // the first failure (or aggregated them into one entry) would not be
    // caught at unit level. This is the unit-level companion to the
    // directed L-31 step and the YAML two-failure case.
    vi.mocked(resolveAndBuildDocument)
      .mockRejectedValueOnce(new DocumentNotFoundError('missing/a.md'))
      .mockRejectedValueOnce(
        new DocumentRequestError({
          error: 'section_not_found',
          message: "No heading matching 'Ghost' found in document",
        })
      );

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:missing/a.md}}',
        ref: '{{ref:missing/a.md}}',
        identifierType: 'ref',
        identifier: 'missing/a.md',
        messageIndex: 0,
      },
      {
        placeholder: '{{ref:b.md#Ghost}}',
        ref: '{{ref:b.md#Ghost}}',
        identifierType: 'ref',
        identifier: 'b.md',
        section: 'Ghost',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    expect(out).toHaveLength(2);
    const failed = out.filter((r) => 'reason' in r) as FailedRef[];
    expect(failed).toHaveLength(2);
    // Positional correspondence: the first failure pairs with the first
    // input ref, etc.
    expect(failed[0].ref).toBe('{{ref:missing/a.md}}');
    expect(failed[0].reason).toBe('document_not_found');
    expect(failed[0].detail).toBe('Document not found: "missing/a.md"');
    expect(failed[1].ref).toBe('{{ref:b.md#Ghost}}');
    expect(failed[1].reason).toBe('section_not_found');
    expect(failed[1].detail).toBe("No heading matching 'Ghost' found in document");
  });

  it.each([
    [new DocumentNotFoundError('missing.md'), 'document_not_found'],
    [new AmbiguousDocumentIdentifierError('shared', ['A/shared.md', 'B/shared.md']), 'ambiguous_document_identifier'],
    [new DocumentReadError('locked.md', 'locked.md', Object.assign(new Error('permission denied'), { code: 'EACCES' })), 'read_error'],
    [Object.assign(new Error('permission denied'), { code: 'EACCES' }), 'read_error'],
  ])('maps typed/non-message document errors to %s', async (error, expectedReason) => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(error);
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
    const failed = out[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe(expectedReason);
    expect(fakeLog.warn).not.toHaveBeenCalled();
  });

  it('does not classify generic human-readable message text by regex', async () => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(
      new Error('Document not found: missing.md')
    );
    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:missing.md}}',
        ref: '{{ref:missing.md}}',
        identifierType: 'ref',
        identifier: 'missing.md',
        messageIndex: 0,
      },
    ];

    const out = await resolveReferences(parsed, fakeConfig, fakeSm, fakeEp, fakeLog);
    const failed = out[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('unknown_reference_error');
    expect(fakeLog.warn).toHaveBeenCalled();
  });

  it.each([
    ['document_not_found', 'document_not_found'],
    ['ambiguous_document_identifier', 'ambiguous_document_identifier'],
    ['read_error', 'read_error'],
    ['section_not_found', 'section_not_found'],
    ['occurrence_out_of_range', 'occurrence_out_of_range'],
    ['reference_path_not_found', 'reference_path_not_found'],
    ['reference_path_not_string', 'reference_path_not_string'],
    ['pointer_target_not_found', 'pointer_target_not_found'],
  ])('maps DocumentRequestError envelope error=%s to exact ReferenceFailureReason', async (error, expectedReason) => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(
      new DocumentRequestError({
        error,
        message: `detail for ${error}`,
      })
    );

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
    const failed = out[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe(expectedReason);
    expect(isReferenceFailureReason(failed.reason)).toBe(true);
  });
});

describe('resolveReferences template parameter contracts (TMPL-01..05)', () => {
  const fakeConfig = {} as import('../../src/config/loader.js').FlashQueryConfig;
  const fakeSm = { getClient: vi.fn(() => ({})) } as unknown as typeof import('../../src/storage/supabase.js').supabaseManager;
  const fakeEp = { embed: vi.fn() } as unknown as typeof import('../../src/embedding/provider.js').embeddingProvider;
  const fakeLog = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as typeof import('../../src/logging/logger.js').logger;
  const resolveWithTemplateParams = resolveReferences as unknown as (
    parsed: ParsedRef[],
    config: typeof fakeConfig,
    sm: typeof fakeSm,
    ep: typeof fakeEp,
    log: typeof fakeLog,
    templateParams?: Record<string, Record<string, unknown>>
  ) => Promise<Array<ResolvedRef | FailedRef>>;

  beforeEach(() => {
    vi.mocked(resolveAndBuildDocument).mockReset();
  });

  function parsedRef(ref: string, identifier = ref.slice('{{ref:'.length, -'}}'.length)): ParsedRef {
    const isAlias = ref.startsWith('{{ref:@');
    return {
      placeholder: ref,
      ref,
      identifierType: 'ref',
      identifier,
      alias: isAlias ? identifier : undefined,
      messageIndex: 0,
    };
  }

  function templateResult(path: string, body: string, fqParams: Record<string, unknown>) {
    return {
      identifier: path,
      title: path,
      path,
      fq_id: null,
      modified: '2026-05-06',
      size: { chars: body.length },
      body,
      frontmatter: {
        fq_template: true,
        fq_params: fqParams,
      },
    } as unknown as Record<string, unknown>;
  }

  function plainResult(path: string, body: string) {
    return {
      identifier: path,
      title: path,
      path,
      fq_id: null,
      modified: '2026-05-06',
      size: { chars: body.length },
      body,
      frontmatter: {},
    } as unknown as Record<string, unknown>;
  }

  it('[U-TMPL-01] renders fq_template true documents with path-keyed template_params', async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce(
      templateResult('Templates/greeting.md', 'Hello {{name}}', {
        name: { type: 'string', required: true },
      })
    );

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/greeting.md}}', 'Templates/greeting.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/greeting.md': { name: 'Ada' } }
    );

    const resolved = out[0] as ResolvedRef;
    expect(resolved.kind).toBe('resolved');
    expect(resolved.content).toBe('Hello Ada');
    const metadata = buildInjectedReferences([resolved]) as Array<Record<string, unknown>>;
    expect(metadata[0].template_params_used).toEqual({
      name: { type: 'string', chars: 3 },
    });
  });

  it('[U-TMPL-02] ignores template_params for plain documents and injects literal body unchanged', async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce(
      plainResult('Templates/plain.md', 'Hello {{name}}')
    );

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/plain.md}}', 'Templates/plain.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/plain.md': { name: 'Ada' } }
    );

    const resolved = out[0] as ResolvedRef;
    expect(resolved.kind).toBe('resolved');
    expect(resolved.content).toBe('Hello {{name}}');
    const metadata = buildInjectedReferences([resolved]) as Array<Record<string, unknown>>;
    expect(metadata[0].template_params_used).toBeUndefined();
  });

  it('[U-TMPL-03] fails missing required template params with template_missing_required_param', async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce(
      templateResult('Templates/greeting.md', 'Hello {{name}}', {
        name: { type: 'string', required: true },
      })
    );

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/greeting.md}}', 'Templates/greeting.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/greeting.md': {} }
    );

    const failed = out[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('template_missing_required_param');
    expect(failed.detail).toContain('name');
  });

  it('[U-TMPL-04] applies default string params and rejects non-string values with template_param_invalid_type', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce(
        templateResult('Templates/tone.md', 'Tone: {{tone}}', {
          tone: { type: 'string', default: 'standard' },
        })
      )
      .mockResolvedValueOnce(
        templateResult('Templates/tone.md', 'Tone: {{tone}}', {
          tone: { type: 'string', default: 'standard' },
        })
      );

    const defaulted = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/tone.md}}', 'Templates/tone.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/tone.md': {} }
    );
    expect((defaulted[0] as ResolvedRef).content).toBe('Tone: standard');

    const invalid = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/tone.md}}', 'Templates/tone.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/tone.md': { tone: 42 } }
    );
    const failed = invalid[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('template_param_invalid_type');
    expect(failed.detail).toContain('tone');
  });

  it('[U-TMPL-05] resolves document params through document resolver and maps failures to template_param_doc_not_found', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce(
        templateResult('Templates/review.md', 'Doc:\n{{target_doc}}', {
          target_doc: { type: 'document', required: true },
        })
      )
      .mockResolvedValueOnce(plainResult('Research/target.md', 'TARGET BODY'))
      .mockResolvedValueOnce(
        templateResult('Templates/review.md', 'Doc:\n{{target_doc}}', {
          target_doc: { type: 'document', required: true },
        })
      )
      .mockRejectedValueOnce(new DocumentNotFoundError('Research/missing.md'));

    const resolved = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/review.md}}', 'Templates/review.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/review.md': { target_doc: 'Research/target.md' } }
    );
    expect((resolved[0] as ResolvedRef).content).toBe('Doc:\nTARGET BODY');
    expect(resolveAndBuildDocument).toHaveBeenCalledWith(
      'Research/target.md',
      expect.objectContaining({ effectiveInclude: ['body'] }),
      expect.objectContaining({ config: fakeConfig })
    );

    const failedOut = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/review.md}}', 'Templates/review.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      { 'Templates/review.md': { target_doc: 'Research/missing.md' } }
    );
    const failed = failedOut[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('template_param_doc_not_found');
    expect(failed.detail).toContain('target_doc');
    expect(failed.detail).toContain('Research/missing.md');
  });

  it(String.raw`[U-TMPL-06] substitutes once, preserves escaped \{{name}}, and does not recurse into param-introduced refs`, async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce(
      templateResult(
        'Templates/single-pass.md',
        String.raw`Name: {{name}} Escaped: \{{name}} Later: {{later}}`,
        {
          name: { type: 'string', required: true },
          later: { type: 'string', required: true },
        }
      )
    );

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:Templates/single-pass.md}}', 'Templates/single-pass.md')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        'Templates/single-pass.md': {
          name: 'Ada',
          later: '{{ref:later.md}}',
        },
      }
    );

    expect((out[0] as ResolvedRef).content).toBe('Name: Ada Escaped: {{name}} Later: {{ref:later.md}}');
    expect(resolveAndBuildDocument).toHaveBeenCalledTimes(1);
  });

  it('[U-TMPL-09] renders duplicate alias _template uses with different alias-keyed values', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce(
        templateResult('Templates/review.md', 'Criteria: {{criteria}}', {
          criteria: { type: 'string', required: true },
        })
      )
      .mockResolvedValueOnce(
        templateResult('Templates/review.md', 'Criteria: {{criteria}}', {
          criteria: { type: 'string', required: true },
        })
      );

    const parsed: ParsedRef[] = [
      {
        placeholder: '{{ref:@review-a}}',
        ref: '{{ref:@review-a}}',
        identifierType: 'ref',
        identifier: 'review-a',
        alias: 'review-a',
        messageIndex: 0,
        start: 10,
        end: 27,
      },
      {
        placeholder: '{{ref:@review-b}}',
        ref: '{{ref:@review-b}}',
        identifierType: 'ref',
        identifier: 'review-b',
        alias: 'review-b',
        messageIndex: 0,
        start: 39,
        end: 56,
      },
    ];

    const out = await resolveWithTemplateParams(parsed, fakeConfig, fakeSm, fakeEp, fakeLog, {
      'review-a': { _template: 'Templates/review.md', criteria: 'completeness' },
      'review-b': { _template: 'Templates/review.md', criteria: 'consistency' },
    });

    const hydrated = hydrateMessages(
      [{ role: 'user', content: 'Review A: {{ref:@review-a}}\nReview B: {{ref:@review-b}}' }],
      out as ResolvedRef[]
    );
    expect(hydrated[0].content).toBe('Review A: Criteria: completeness\nReview B: Criteria: consistency');
  });

  // [U-TMPL-010] preserves the plan's grep contract; canonical ID is [U-TMPL-10].
  it('[U-TMPL-10] renders alias _items in order with _separator and metadata items/resolved_to_count', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce(plainResult('Research/a.md', 'ALPHA'))
      .mockResolvedValueOnce(
        templateResult('Templates/context.md', 'Focus: {{focus}}', {
          focus: { type: 'string', required: true },
        })
      );

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:@background}}', 'background')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        background: {
          _items: [
            'Research/a.md',
            { _template: 'Templates/context.md', focus: 'readiness' },
          ],
          _separator: '\n---\n',
        },
      }
    );

    const resolved = out[0] as ResolvedRef;
    expect(resolved.kind).toBe('resolved');
    expect(resolved.content).toBe('ALPHA\n---\nFocus: readiness');
    const metadata = buildInjectedReferences([resolved]) as Array<Record<string, unknown>>;
    expect(metadata[0].resolved_to_count).toBe(2);
    expect(metadata[0].items).toEqual([
      { resolved_to: 'Research/a.md', chars: 5 },
      { resolved_to: 'Templates/context.md', chars: 16 },
    ]);
    expect(metadata[0].template_params_used).not.toHaveProperty('_items');
    expect(metadata[0].template_params_used).not.toHaveProperty('_separator');
  });

  it('[U-TMPL-10] wraps _items failures with multi_ref_item_failed and preserves item detail', async () => {
    vi.mocked(resolveAndBuildDocument).mockRejectedValueOnce(new DocumentNotFoundError('Research/missing.md'));

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:@background}}', 'background')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        background: {
          _items: ['Research/missing.md'],
          _separator: '\n\n',
        },
      }
    );

    const failed = out[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('multi_ref_item_failed');
    expect(failed.detail).toContain('background');
    expect(failed.detail).toContain('item 0');
    expect(failed.detail).toContain('template_param_doc_not_found');
  });

  it('[U-TMPL-10b] _items string entries reuse section and pointer grammar and keep ordered item refs', async () => {
    vi.mocked(resolveAndBuildDocument)
      .mockResolvedValueOnce(plainResult('Research/a.md', 'SECTION BODY'))
      .mockResolvedValueOnce({
        ...plainResult('Research/b.md', 'unused'),
        followed_ref: { body: 'POINTER BODY', resolved_to: 'Research/target.md' },
      });

    const out = await resolveWithTemplateParams(
      [parsedRef('{{ref:@background}}', 'background')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        background: {
          _items: ['Research/a.md#Summary', 'Research/b.md->next.doc'],
        },
      }
    );

    const resolved = out[0] as ResolvedRef;
    expect(resolved.kind).toBe('resolved');
    expect(resolved.content).toBe('SECTION BODYPOINTER BODY');
    expect(resolveAndBuildDocument).toHaveBeenNthCalledWith(
      1,
      'Research/a.md',
      expect.objectContaining({ sectionsList: ['Summary'], followRef: undefined }),
      expect.objectContaining({ config: fakeConfig })
    );
    expect(resolveAndBuildDocument).toHaveBeenNthCalledWith(
      2,
      'Research/b.md',
      expect.objectContaining({ sectionsList: [], followRef: 'next.doc' }),
      expect.objectContaining({ config: fakeConfig })
    );
    const metadata = buildInjectedReferences([resolved]) as Array<Record<string, unknown>>;
    expect(metadata[0].items).toEqual([
      { ref: 'Research/a.md#Summary', resolved_to: 'Research/a.md', chars: 12 },
      { ref: 'Research/b.md->next.doc', resolved_to: 'Research/target.md', chars: 12 },
    ]);
  });

  it('[U-TMPL-10c] _items object entries record template metadata and wrap missing _template by index', async () => {
    vi.mocked(resolveAndBuildDocument).mockResolvedValueOnce(
      templateResult('Templates/context.md', 'Focus: {{focus}}', {
        focus: { type: 'string', required: true },
      })
    );

    const resolvedOut = await resolveWithTemplateParams(
      [parsedRef('{{ref:@background}}', 'background')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        background: {
          _items: [{ _template: 'Templates/context.md', focus: 'readiness' }],
        },
      }
    );
    const metadata = buildInjectedReferences([resolvedOut[0] as ResolvedRef]) as Array<Record<string, unknown>>;
    expect(metadata[0].items).toEqual([
      {
        ref: 'Templates/context.md',
        resolved_to: 'Templates/context.md',
        chars: 16,
        template: true,
        template_path: 'Templates/context.md',
      },
    ]);

    const failedOut = await resolveWithTemplateParams(
      [parsedRef('{{ref:@background}}', 'background')],
      fakeConfig,
      fakeSm,
      fakeEp,
      fakeLog,
      {
        background: {
          _items: [{}],
        },
      }
    );
    const failed = failedOut[0] as FailedRef;
    expect(failed.kind).toBe('failed');
    expect(failed.reason).toBe('multi_ref_item_failed');
    expect(failed.detail).toContain('alias=background');
    expect(failed.detail).toContain('index=0');
    expect(failed.detail).toContain('alias_missing_template_field');
  });
});

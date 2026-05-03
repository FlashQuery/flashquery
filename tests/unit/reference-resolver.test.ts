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

  it('[U-RR-08c] rejects {{id:}} with empty identifier (REFS-08) (Phase 3 Gap 8)', () => {
    // Companion to U-RR-08b: same rule for the `id:` form.
    const result = parseReferences([
      { role: 'user', content: 'See {{id:}} for nothing.' },
    ]);
    expect(Array.isArray(result)).toBe(false);
    const err = result as ParseRefError;
    expect(err.error).toBe('invalid_reference_syntax');
    expect(err.reason).toContain('empty');
    expect(err.ref).toBe('{{id:}}');
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
  it('[U-RR-14] omits resolved_to when undefined; includes it when set; section-only refs also omit resolved_to (TC3-W3)', () => {
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
      // TC3-W3: section-only reference (with #, no ->) — must also OMIT
      // the resolved_to key, since §5.4 reserves resolved_to for the
      // -> dereference operator only. Without this entry the test
      // couldn't tell apart "path-only omits" from "everything-non-arrow
      // omits"; this proves the rule is operator-based, not kind-based.
      {
        kind: 'resolved',
        placeholder: '{{ref:c.md#Section}}',
        ref: '{{ref:c.md#Section}}',
        content: 'Z',
        chars: 1,
        messageIndex: 0,
      },
    ];
    const out = buildInjectedReferences(resolved);
    expect(out[0]).toStrictEqual({ ref: '{{ref:a.md}}', chars: 1 });
    expect('resolved_to' in out[0]).toBe(false);
    expect(out[1]).toStrictEqual({ ref: '{{ref:b.md->p}}', chars: 1, resolved_to: 'target/b-target.md' });
    // TC3-W3: section-only ref entry — same shape as path-only, no resolved_to.
    expect(out[2]).toStrictEqual({ ref: '{{ref:c.md#Section}}', chars: 1 });
    expect('resolved_to' in out[2]).toBe(false);
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
      .mockRejectedValueOnce(new Error('Document not found: missing/a.md'))
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
    expect(failed[0].reason).toBe('Document not found: missing/a.md');
    expect(failed[1].ref).toBe('{{ref:b.md#Ghost}}');
    expect(failed[1].reason).toBe("No heading matching 'Ghost' found in document");
  });
});

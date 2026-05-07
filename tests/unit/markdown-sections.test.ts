import { describe, it, expect } from 'vitest';
import {
  extractSection,
  findHeadingOccurrence,
  extractMultipleSections,
  SectionExtractError,
  type MultiSectionResult,
} from '../../src/mcp/utils/markdown-sections.js';
import { extractHeadings } from '../../src/mcp/utils/markdown-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture content — spec §4.2 demo document structure
// ─────────────────────────────────────────────────────────────────────────────
const MULTI_SECTION_FIXTURE = [
  '## 1. Progress Updates',
  '',
  'Body text 1.',
  '',
  '## 2. Blockers',
  '',
  'Body text 2.',
  '',
  '## 3. Action Items',
  '',
  '- Item one',
  '- Item two',
  '',
  '## 4. Action Items',
  '',
  '- Item three',
  '- Item four',
  '',
  '## 5. Notes',
  '',
  'Final notes.',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// describe: headingMatchesQuery (via findHeadingOccurrence) — GDOC-06
// ─────────────────────────────────────────────────────────────────────────────

describe('headingMatchesQuery (via findHeadingOccurrence) — GDOC-06', () => {
  it('[U-04] case-insensitive substring match — "open questions" matches "3. Open Questions"', () => {
    // NOTE: This test FAILS today — current findHeadingOccurrence uses exact match (h.text === name)
    const headings = [{ level: 2, text: '3. Open Questions', line: 5 }];
    const result = findHeadingOccurrence(headings, 'open questions');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('3. Open Questions');
  });

  it('[U-05] numeric anchor "3" matches "3. Scope" but NOT "13. Conversations"', () => {
    // NOTE: This test FAILS today — current code uses exact match
    const headings = [
      { level: 2, text: '3. Scope', line: 1 },
      { level: 2, text: '13. Conversations', line: 10 },
    ];
    const resultFor3 = findHeadingOccurrence(headings, '3');
    expect(resultFor3).not.toBeNull();
    expect(resultFor3?.text).toBe('3. Scope');

    const resultFor13 = findHeadingOccurrence(headings, '13');
    expect(resultFor13).not.toBeNull();
    expect(resultFor13?.text).toBe('13. Conversations');
  });

  it('[U-05a] multi-digit anchor "12" matches "12. Appendix" but NOT "112. Notes" or "120. Other"', () => {
    const headings = [
      { level: 2, text: '12. Appendix', line: 1 },
      { level: 2, text: '112. Notes', line: 10 },
      { level: 2, text: '120. Other', line: 20 },
    ];
    const result = findHeadingOccurrence(headings, '12');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('12. Appendix');
  });

  it('[U-05a] dot-hierarchy anchor "3." matches "3. Scope" and "3.1 Details" but NOT "30. Whatever" (TC1-W5 negative assertion)', () => {
    const scopeHeadings = [
      { level: 2, text: '3. Scope', line: 1 },
      { level: 2, text: '3.1 Details', line: 5 },
      { level: 2, text: '30. Whatever', line: 10 },
    ];
    // "3." should match "3. Scope" (first occurrence)
    const resultFirst = findHeadingOccurrence(scopeHeadings, '3.');
    expect(resultFirst).not.toBeNull();
    expect(resultFirst?.text).toBe('3. Scope');
    // Second occurrence should be "3.1 Details"
    const resultSecond = findHeadingOccurrence(scopeHeadings, '3.', 2);
    expect(resultSecond).not.toBeNull();
    expect(resultSecond?.text).toBe('3.1 Details');
    // TC1-W5: the test name claims "but NOT '30. Whatever'" — assert it.
    // Asking for a 3rd occurrence of "3." must return null because
    // "30. Whatever" is digit-prefix anchored to "30", not "3.".
    expect(findHeadingOccurrence(scopeHeadings, '3.', 3)).toBeNull();
  });

  it('[U-05a] digit-prefix "3D Modeling" anchors to start — matches headings starting with "3d"', () => {
    // Pitfall 9: ANY query starting with a digit uses numeric anchoring
    const headings = [
      { level: 2, text: '3D Modeling Techniques', line: 1 },
      { level: 2, text: '2D Animation', line: 5 },
      { level: 2, text: 'Other 3D Methods', line: 10 },
    ];
    const result = findHeadingOccurrence(headings, '3D Modeling');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('3D Modeling Techniques');
    // "Other 3D Methods" does NOT start with "3d" — it should not match
    const noMatch = findHeadingOccurrence(headings, '3D Methods');
    expect(noMatch).toBeNull();
  });

  it('[U-04] empty/non-matching query returns null', () => {
    const headings = [{ level: 2, text: 'Progress Updates', line: 1 }];
    const result = findHeadingOccurrence(headings, 'nonexistent section');
    expect(result).toBeNull();
  });

  it('[U-04] case-insensitive: query "BLOCKERS" matches heading "2. Blockers"', () => {
    const headings = [{ level: 2, text: '2. Blockers', line: 1 }];
    const result = findHeadingOccurrence(headings, 'BLOCKERS');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('2. Blockers');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: extractSection (GDOC-06 case-insensitive)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractSection (GDOC-06 case-insensitive)', () => {
  const content = '## 2. Blockers\n\nbody text\n\n## 3. Action Items\n\nmore text';

  it('[U-04] extractSection with lowercase query matches case-insensitively', () => {
    // NOTE: FAILS today — extractSection uses findHeadingOccurrence which is case-sensitive
    const result = extractSection(content, 'blockers');
    expect(result.section).toContain('2. Blockers');
  });

  it('[U-04] extractSection with uppercase query "BLOCKERS" also matches', () => {
    const result = extractSection(content, 'BLOCKERS');
    expect(result.section).toContain('2. Blockers');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: U-06 single-section no match
// ─────────────────────────────────────────────────────────────────────────────

describe('U-06 single-section no match', () => {
  it('[U-06] extractSection throws "not found" error when heading does not exist', () => {
    const content = '## Progress\n\nbody text\n';
    expect(() => extractSection(content, 'Retrospective')).toThrow(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: U-07 occurrence out of range
// ─────────────────────────────────────────────────────────────────────────────

describe('U-07 occurrence out of range', () => {
  it('[U-07] extractSection throws SectionExtractError(kind="occurrence_out_of_range") on overflow', () => {
    // Content has only 2 "Action Items" headings; requesting occurrence=3 should throw a typed
    // SectionExtractError so the wrapper in document-output.ts can emit the spec-correct
    // occurrence_out_of_range error code (verification report Correction 1).
    let thrown: unknown = null;
    try {
      extractSection(MULTI_SECTION_FIXTURE, 'Action Items', true, 3);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown).toBeInstanceOf(SectionExtractError);
    const typed = thrown as SectionExtractError;
    expect(typed.kind).toBe('occurrence_out_of_range');
    expect(typed.matched.length).toBe(2);
    expect(typed.requestedOccurrence).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: extractMultipleSections (GDOC-08, GDOC-09)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractMultipleSections (GDOC-08, GDOC-09)', () => {
  // NOTE: All tests in this block FAIL today — extractMultipleSections does not exist yet

  it('[U-08j] input order preserved; sequential repeats return successive occurrences (TC1-W4 strict equality)', () => {
    // queries: Blockers, Action Items (1st), Action Items (2nd)
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Blockers', 'Action Items', 'Action Items'],
      { includeNested: true }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.matches).toHaveLength(3);

    // TC1-W4: strict equality on heading text — the prior fuzzy
    // .toLowerCase().toContain('action items') check would have passed
    // even if both Action Items matches resolved to the same occurrence.
    // The fixture has '## 3. Action Items' and '## 4. Action Items' —
    // the multi-section helper must return them in input order.
    expect(result.matches[0].heading).toBe('2. Blockers');
    expect(result.matches[1].heading).toBe('3. Action Items');
    expect(result.matches[2].heading).toBe('4. Action Items');

    // They should NOT be the same content (different occurrences)
    expect(result.matches[1].content).not.toBe(result.matches[2].content);
  });

  it('[U-08k] interleaved repeats: [A, B, A] returns 1st A, 1st B, 2nd A in that order', () => {
    // Content has "## A" twice and "## B" once
    const content = [
      '## A',
      '',
      'First A content.',
      '',
      '## B',
      '',
      'B content.',
      '',
      '## A',
      '',
      'Second A content.',
    ].join('\n');

    const result: MultiSectionResult = extractMultipleSections(
      content,
      ['A', 'B', 'A'],
      { includeNested: true }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.matches).toHaveLength(3);

    // TC1-W4: strict equality on heading text in input-order positions —
    // ensures we got the actual 1st A, 1st B, 2nd A and not a re-shuffle.
    expect(result.matches[0].heading).toBe('A');
    expect(result.matches[1].heading).toBe('B');
    expect(result.matches[2].heading).toBe('A');

    // matches[0] = 1st A
    expect(result.matches[0].content).toContain('First A content');
    // matches[1] = 1st B
    expect(result.matches[1].content).toContain('B content');
    // matches[2] = 2nd A
    expect(result.matches[2].content).toContain('Second A content');

    // Both A matches must have different content (different occurrences)
    expect(result.matches[0].content).not.toBe(result.matches[2].content);
  });

  it('[U-08l] each match has content string (not pre-joined) and chars equals content.length (TC1-W3 aggregate invariant)', () => {
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Blockers', 'Notes'],
      { includeNested: true }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.matches).toHaveLength(2);

    // Each match must have a content string (not pre-joined array)
    for (const match of result.matches) {
      expect(typeof match.content).toBe('string');
      // chars must equal content.length (per-match invariant)
      expect(match.chars).toBe(match.content.length);
    }

    // TC1-W3: spec aggregate invariant — when matches are joined with the
    // canonical "\n\n" separator (2 chars between each pair), the joined body
    // length must equal sum(chars) + 2*(N-1). Per-match equality alone does
    // not lock down the join-by-blank-line contract from §4.5 Example 7b.
    const joined = result.matches.map((m) => m.content).join('\n\n');
    const sumChars = result.matches.reduce((acc, m) => acc + m.chars, 0);
    expect(sumChars + 2 * (result.matches.length - 1)).toBe(joined.length);
  });

  it('[U-08m] all-fail no_match: both Foo and Bar return errors with reason:no_match', () => {
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Foo', 'Bar'],
      { includeNested: true }
    );

    expect(result.matches).toHaveLength(0);
    expect(result.errors).toHaveLength(2);

    const queries = result.errors.map((e) => e.query);
    expect(queries).toContain('Foo');
    expect(queries).toContain('Bar');

    for (const error of result.errors) {
      expect(error.reason).toBe('no_match');
    }
  });

  it('[U-08n] insufficient_occurrences is aggregated per distinct name (Pitfall 5): 3 slots for "Action Items" but only 2 found → 1 error entry', () => {
    // Content has 2 "Action Items" headings; requesting 3 occurrences → 1 error
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Action Items', 'Action Items', 'Action Items'],
      { includeNested: true }
    );

    expect(result.matches).toHaveLength(0);
    // CRITICAL: ONE error entry for "Action Items", NOT three
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].query).toBe('Action Items');
    expect(result.errors[0].reason).toBe('insufficient_occurrences');
    expect(result.errors[0].requested_count).toBe(3);
    expect(result.errors[0].found_count).toBe(2);
  });

  it('[U-08o] mixed failures: Foo=no_match + Action Items (3x requested, 2 found)=insufficient_occurrences → 2 error entries', () => {
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Foo', 'Action Items', 'Action Items', 'Action Items'],
      { includeNested: true }
    );

    expect(result.matches).toHaveLength(0);
    expect(result.errors).toHaveLength(2);

    const fooError = result.errors.find((e) => e.query === 'Foo');
    const actionError = result.errors.find((e) => e.query === 'Action Items');

    expect(fooError).toBeDefined();
    expect(fooError!.reason).toBe('no_match');

    expect(actionError).toBeDefined();
    expect(actionError!.reason).toBe('insufficient_occurrences');
    expect(actionError!.requested_count).toBe(3);
    expect(actionError!.found_count).toBe(2);
  });

  it('[U-08l] char-count check: every successful match has chars equal to content.length, and the joined-body aggregate invariant holds (TC1-W3)', () => {
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Blockers', 'Notes'],
      { includeNested: true }
    );

    for (const match of result.matches) {
      expect(match.chars).toBe(match.content.length);
    }

    // TC1-W3 second instance: aggregate invariant
    // sum(chars) + 2*(N-1) === joined-body length, with the canonical "\n\n"
    // separator. This locks down both the chars-correctness and the
    // joining-contract simultaneously.
    const joined = result.matches.map((m) => m.content).join('\n\n');
    const sumChars = result.matches.reduce((acc, m) => acc + m.chars, 0);
    expect(sumChars + 2 * (result.matches.length - 1)).toBe(joined.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: extractMultipleSections type contract
// ─────────────────────────────────────────────────────────────────────────────

describe('extractMultipleSections type contract', () => {
  it('return value conforms to MultiSectionResult shape at runtime', () => {
    // NOTE: FAILS today — extractMultipleSections does not exist yet
    const result: MultiSectionResult = extractMultipleSections(
      MULTI_SECTION_FIXTURE,
      ['Blockers'],
      { includeNested: true }
    );

    // Verify shape: { matches: Array<{ heading, content, chars }>, errors: Array<...> }
    expect(result).toHaveProperty('matches');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.matches)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);

    if (result.matches.length > 0) {
      const match = result.matches[0];
      expect(match).toHaveProperty('heading');
      expect(match).toHaveProperty('content');
      expect(match).toHaveProperty('chars');
      expect(typeof match.heading).toBe('string');
      expect(typeof match.content).toBe('string');
      expect(typeof match.chars).toBe('number');
    }
  });
});

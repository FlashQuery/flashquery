import { describe, expect, it } from 'vitest';
import { findMatchingHeadings, insertAtPosition, resolveHeadingTarget } from '../../src/mcp/utils/markdown-sections.js';

describe('insert_in_doc contract helpers', () => {
  const body = [
    '# Doc',
    '',
    '## Parent',
    'Parent body.',
    '### Child',
    'Child body.',
    '## Next',
    'Next body.',
  ].join('\n');

  it('inserts at end_of_section after nested children by default', () => {
    const result = insertAtPosition(body, 'end_of_section', 'Nested-inclusive insert.', 'Parent', 1, true);

    expect(result).toContain('Child body.\nNested-inclusive insert.\n## Next');
  });

  it('supports include_nested false for direct parent body insertion', () => {
    const result = insertAtPosition(body, 'end_of_section', 'Direct parent insert.', 'Parent', 1, false);

    expect(result).toContain('Parent body.\nDirect parent insert.\n### Child');
  });

  it('preserves bottom insertion behavior that replaces append_to_doc scenarios', () => {
    const result = insertAtPosition('Body', 'bottom', 'Appended');

    expect(result).toBe('Body\nAppended');
  });

  it('supports exact heading matching without accepting substring-only candidates', () => {
    expect(() =>
      insertAtPosition(body, 'after_heading', 'Inserted', 'Par', undefined, true, {
        headingMatch: 'exact',
      })
    ).toThrow(/not found/i);

    const result = insertAtPosition(body, 'after_heading', 'Inserted', 'Parent', undefined, true, {
      headingMatch: 'exact',
    });

    expect(result).toContain('## Parent\nInserted\nParent body.');
  });

  it('narrows anchor matching by heading level', () => {
    const nested = ['# Doc', '## Risks', 'Top risks.', '### Risks', 'Nested risks.'].join('\n');

    const result = insertAtPosition(nested, 'after_heading', 'Nested insert.', 'Risks', undefined, true, {
      headingLevel: 3,
    });

    expect(result).toContain('### Risks\nNested insert.\nNested risks.');
    expect(result).toContain('## Risks\nTop risks.');
  });

  it('can detect omitted-occurrence ambiguity before mutation', () => {
    const headings = findMatchingHeadings(body, 'Section', { headingMatch: 'contains' });
    expect(headings).toHaveLength(0);

    const duplicateBody = ['# Doc', '## Section One', 'A', '## Section Two', 'B'].join('\n');
    const duplicateHeadings = findMatchingHeadings(duplicateBody, 'Section', { headingMatch: 'contains' });
    expect(duplicateHeadings).toHaveLength(2);

    expect(resolveHeadingTarget(duplicateHeadings, undefined)).toEqual({
      status: 'ambiguous',
      matches: [
        { heading: 'Section One', level: 2, line: 2, occurrence: 1 },
        { heading: 'Section Two', level: 2, line: 4, occurrence: 2 },
      ],
    });
  });
});

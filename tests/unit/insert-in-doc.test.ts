import { describe, expect, it } from 'vitest';
import { insertAtPosition } from '../../src/mcp/utils/markdown-sections.js';

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
});

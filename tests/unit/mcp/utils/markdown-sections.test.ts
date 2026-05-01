import { describe, it, expect } from 'vitest';
import {
  extractSection,
  findHeadingOccurrence,
  getNextHeadingIndex,
  getSectionBoundaries,
  insertAtPosition,
  buildSectionResponse,
} from '../../../../src/mcp/utils/markdown-sections.js';

const SAMPLE_DOC = `# Title

## Configuration

API key required: yes
Default timeout: 30s

### API Keys

Primary key required

### Timeouts

Default: 30s

## Examples

Example 1: Basic usage

## Advanced

Section at end`;

describe('markdown-sections utilities', () => {
  describe('extractSection', () => {
    it('extracts a section by heading name', () => {
      const result = extractSection(SAMPLE_DOC, 'Configuration');
      expect(result.section).toContain('## Configuration');
      expect(result.section).toContain('API key required');
      expect(result.lineNumber).toBe(3);
      expect(result.totalOccurrences).toBe(1);
    });

    it('includes heading line in response', () => {
      const result = extractSection(SAMPLE_DOC, 'Examples');
      expect(result.section.startsWith('## Examples')).toBe(true);
    });

    it('handles include_subheadings true (default)', () => {
      const result = extractSection(SAMPLE_DOC, 'Configuration', true);
      expect(result.section).toContain('### API Keys');
      expect(result.section).toContain('### Timeouts');
    });

    it('handles include_subheadings false', () => {
      const result = extractSection(SAMPLE_DOC, 'Configuration', false);
      expect(result.section).toContain('API key required: yes');
      expect(result.section).not.toContain('### API Keys');
    });

    it('throws error for missing heading', () => {
      expect(() => extractSection(SAMPLE_DOC, 'NonExistent')).toThrow();
    });

    it('handles duplicate headings with occurrence', () => {
      const docWithDuplicates = `# Overview\nContent 1\n# Overview\nContent 2`;
      const first = extractSection(docWithDuplicates, 'Overview', true, 1);
      const second = extractSection(docWithDuplicates, 'Overview', true, 2);
      expect(first.occurrence).toBe(1);
      expect(second.occurrence).toBe(2);
      expect(first.totalOccurrences).toBe(2);
    });

    it('extracts first occurrence when multiple exist', () => {
      const docWithDuplicates = `# Config\nContent 1\n# Config\nContent 2`;
      const result = extractSection(docWithDuplicates, 'Config');
      expect(result.occurrence).toBe(1);
      expect(result.totalOccurrences).toBe(2);
      expect(result.section).toContain('Content 1');
    });
  });

  describe('findHeadingOccurrence', () => {
    it('finds first occurrence by default', () => {
      const headings = [
        { level: 1, text: 'Title', line: 1 },
        { level: 2, text: 'Configuration', line: 3 },
        { level: 2, text: 'Examples', line: 10 },
      ];
      const result = findHeadingOccurrence(headings, 'Configuration', 1);
      expect(result).toEqual({ level: 2, text: 'Configuration', line: 3 });
    });

    it('finds nth occurrence', () => {
      const headings = [
        { level: 2, text: 'Config', line: 3 },
        { level: 2, text: 'Config', line: 10 },
        { level: 2, text: 'Config', line: 20 },
      ];
      const second = findHeadingOccurrence(headings, 'Config', 2);
      expect(second?.line).toBe(10);
    });

    it('returns null for occurrence beyond count', () => {
      const headings = [
        { level: 2, text: 'Config', line: 3 },
        { level: 2, text: 'Config', line: 10 },
      ];
      const result = findHeadingOccurrence(headings, 'Config', 5);
      expect(result).toBeNull();
    });

    it('throws error for occurrence < 1', () => {
      const headings = [{ level: 2, text: 'Config', line: 3 }];
      expect(() => findHeadingOccurrence(headings, 'Config', 0)).toThrow();
    });

    it('is case-insensitive (GDOC-06)', () => {
      const headings = [{ level: 2, text: 'Configuration', line: 3 }];
      expect(findHeadingOccurrence(headings, 'configuration', 1)).not.toBeNull();
    });
  });

  describe('getNextHeadingIndex', () => {
    it('finds next heading at same level', () => {
      const headings = [
        { level: 2, text: 'Section A', line: 3 },
        { level: 2, text: 'Section B', line: 10 },
        { level: 2, text: 'Section C', line: 20 },
      ];
      const result = getNextHeadingIndex(headings, 0);
      expect(result).toBe(1);
    });

    it('finds next heading at higher level', () => {
      const headings = [
        { level: 2, text: 'Section', line: 3 },
        { level: 3, text: 'Subsection', line: 10 },
        { level: 1, text: 'Chapter', line: 20 },
      ];
      const result = getNextHeadingIndex(headings, 0);
      expect(result).toBe(2);
    });

    it('skips lower level headings', () => {
      const headings = [
        { level: 2, text: 'Section', line: 3 },
        { level: 3, text: 'Subsection A', line: 10 },
        { level: 3, text: 'Subsection B', line: 15 },
        { level: 2, text: 'Next Section', line: 20 },
      ];
      const result = getNextHeadingIndex(headings, 0, 2);
      expect(result).toBe(3);
      expect(headings[result].text).toBe('Next Section');
    });

    it('returns -1 if no next heading', () => {
      const headings = [
        { level: 2, text: 'Section', line: 3 },
        { level: 3, text: 'Subsection', line: 10 },
      ];
      const result = getNextHeadingIndex(headings, 1);
      expect(result).toBe(-1);
    });
  });

  describe('getSectionBoundaries', () => {
    it('calculates section boundaries with include_subheadings true', () => {
      const boundaries = getSectionBoundaries(SAMPLE_DOC, 'Configuration', true);
      expect(boundaries.startLine).toBe(3);
      expect(boundaries.startLine <= boundaries.endLine).toBe(true);
      expect(boundaries.content).toContain('API Keys');
    });

    it('calculates section boundaries with include_subheadings false', () => {
      const boundaries = getSectionBoundaries(SAMPLE_DOC, 'Configuration', false);
      expect(boundaries.content).not.toContain('API Keys');
    });

    it('handles last section in document', () => {
      const boundaries = getSectionBoundaries(SAMPLE_DOC, 'Advanced');
      expect(boundaries.endLine).toBeLessThanOrEqual(SAMPLE_DOC.split('\n').length);
    });

    it('throws error for missing heading', () => {
      expect(() => getSectionBoundaries(SAMPLE_DOC, 'NonExistent')).toThrow();
    });
  });

  describe('insertAtPosition', () => {
    const simpleDoc = `## Section A\nContent A\n## Section B\nContent B`;

    it('inserts at top', () => {
      const result = insertAtPosition(simpleDoc, 'top', 'New content\n');
      expect(result.startsWith('New content')).toBe(true);
    });

    it('inserts at bottom', () => {
      const result = insertAtPosition(simpleDoc, 'bottom', '\nNew content');
      expect(result.endsWith('New content')).toBe(true);
    });

    it('inserts after heading', () => {
      const result = insertAtPosition(simpleDoc, 'after_heading', 'Inserted', 'Section A', 1);
      const lines = result.split('\n');
      const headingIdx = lines.findIndex((l) => l === '## Section A');
      expect(headingIdx >= 0).toBe(true);
      expect(lines[headingIdx + 1]).toBe('Inserted');
    });

    it('inserts before heading', () => {
      const result = insertAtPosition(simpleDoc, 'before_heading', 'Before', 'Section A', 1);
      const lines = result.split('\n');
      const headingIdx = lines.findIndex((l) => l === '## Section A');
      expect(lines[headingIdx - 1]).toBe('Before');
    });

    it('inserts at end of section', () => {
      const result = insertAtPosition(simpleDoc, 'end_of_section', 'EndSection', 'Section A', 1);
      const aIdx = result.indexOf('## Section A');
      const bIdx = result.indexOf('## Section B');
      const insertIdx = result.indexOf('EndSection');
      expect(insertIdx > aIdx && insertIdx < bIdx).toBe(true);
    });

    it('throws error for invalid position', () => {
      expect(() =>
        insertAtPosition(simpleDoc, 'invalid' as any, 'content', 'Section A')
      ).toThrow(/Invalid position/);
    });

    it('throws error for missing heading when required', () => {
      expect(() =>
        insertAtPosition(simpleDoc, 'after_heading', 'content', 'NonExistent')
      ).toThrow(/not found/);
    });

    it('handles duplicate headings with occurrence', () => {
      const docWithDuplicates = `## Section\nA\n## Section\nB`;
      const result = insertAtPosition(docWithDuplicates, 'after_heading', 'X', 'Section', 2);
      const parts = result.split('## Section');
      expect(parts[2]).toContain('X');
    });
  });

  describe('buildSectionResponse', () => {
    it('formats section response with metadata', () => {
      const heading = { level: 2, text: 'Configuration', line: 3 };
      const content = '## Configuration\nAPI key: yes';
      const response = buildSectionResponse(heading, content, 3, 1, 1);

      expect(response).toContain('## Configuration');
      expect(response).toContain('section_name: Configuration');
      expect(response).toContain('line_number: 3');
      expect(response).toContain('occurrence: 1');
      expect(response).toContain('total_occurrences: 1');
    });

    it('includes all metadata fields', () => {
      const heading = { level: 1, text: 'Title', line: 1 };
      const response = buildSectionResponse(heading, '# Title', 1, 1, 3);

      expect(response).toContain('section_name:');
      expect(response).toContain('line_number:');
      expect(response).toContain('occurrence:');
      expect(response).toContain('total_occurrences:');
    });

    it('handles multiple occurrences metadata', () => {
      const heading = { level: 2, text: 'Config', line: 10 };
      const response = buildSectionResponse(heading, '## Config', 10, 2, 5);
      expect(response).toContain('occurrence: 2');
      expect(response).toContain('total_occurrences: 5');
    });
  });
});

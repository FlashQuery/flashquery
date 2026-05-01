import { describe, it, expect } from 'vitest';
import {
  resolveTitle,
  buildMetadataEnvelope,
  buildHeadingEntries,
  buildConsolidatedResponse,
  validateParameterCombinations,
} from '../../src/mcp/utils/document-output.js';
import { FM } from '../../src/constants/frontmatter-fields.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures — spec §4.2 demo document
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_IDENTIFIER = 'Meetings/Weekly-Standup-Sprint-12.md';
const FIXTURE_FQC_ID = 'a1b2c3d4-5678-9abc-def0-123456789abc';
const FIXTURE_FQ_UPDATED = '2026-04-30T10:15:00Z';

const FIXTURE_RESOLVED = {
  relativePath: FIXTURE_IDENTIFIER,
  capturedFrontmatter: { fqcId: FIXTURE_FQC_ID },
};

const FIXTURE_FRONTMATTER: Record<string, unknown> = {
  [FM.TITLE]: 'Sprint 12 Standup',
  [FM.UPDATED]: FIXTURE_FQ_UPDATED,
};

const FIXTURE_BODY = '## Hi\n\nbody';

// ─────────────────────────────────────────────────────────────────────────────
// describe: resolveTitle (GDOC-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTitle (GDOC-03)', () => {
  it('[U-08a] returns fq_title when present', () => {
    const result = resolveTitle({ [FM.TITLE]: 'Sprint 12 Standup' }, 'Meetings/standup.md');
    expect(result).toBe('Sprint 12 Standup');
  });

  it('[U-08b] returns trimmed fq_title when it has surrounding whitespace', () => {
    const result = resolveTitle({ [FM.TITLE]: '  Sprint 12  ' }, 'Meetings/standup.md');
    expect(result).toBe('Sprint 12');
  });

  it('[U-08c] falls back to basename without extension when fq_title is absent', () => {
    const result = resolveTitle({}, 'Meetings/standup.md');
    expect(result).toBe('standup');
  });

  it('[U-08d] falls back to basename when fq_title is empty string', () => {
    const result = resolveTitle({ [FM.TITLE]: '' }, 'Meetings/standup.md');
    expect(result).toBe('standup');
  });

  it('[U-08e] falls back to basename when fq_title is whitespace-only', () => {
    const result = resolveTitle({ [FM.TITLE]: '   ' }, 'Meetings/standup.md');
    expect(result).toBe('standup');
  });

  it('[U-08f] falls back to basename when fq_title is null', () => {
    const result = resolveTitle({ [FM.TITLE]: null }, 'Meetings/standup.md');
    expect(result).toBe('standup');
  });

  it('[U-08g] coerces numeric fq_title to string via String()', () => {
    const result = resolveTitle({ [FM.TITLE]: 42 }, 'Meetings/standup.md');
    expect(result).toBe('42');
  });

  it('[U-08h] coerces boolean fq_title to string via String()', () => {
    const result = resolveTitle({ [FM.TITLE]: true }, 'Meetings/standup.md');
    expect(result).toBe('true');
  });

  it('[U-08i] falls back to basename from deeply nested path (no folder in output)', () => {
    const result = resolveTitle(
      {},
      'projections/Meetings/.projections/standup-s12-summary.md'
    );
    expect(result).toBe('standup-s12-summary');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: buildMetadataEnvelope (GDOC-02, GDOC-07)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMetadataEnvelope (GDOC-02, GDOC-07)', () => {
  it('[U-01] returns all 6 required envelope fields with correct values', () => {
    const envelope = buildMetadataEnvelope(
      FIXTURE_IDENTIFIER,
      FIXTURE_RESOLVED,
      FIXTURE_FRONTMATTER,
      FIXTURE_BODY
    );

    expect(envelope.identifier).toBe(FIXTURE_IDENTIFIER);
    expect(envelope.title).toBe('Sprint 12 Standup');
    expect(envelope.path).toBe(FIXTURE_IDENTIFIER);
    expect(envelope.fq_id).toBe(FIXTURE_FQC_ID);
    expect(envelope.modified).toBe(FIXTURE_FQ_UPDATED);
    expect(envelope.size.chars).toBe(FIXTURE_BODY.length);
  });

  it('[U-01b] size.chars reflects FULL body length (GDOC-07) even when sections would be extracted later', () => {
    const longBody = 'a'.repeat(680);
    const envelope = buildMetadataEnvelope(
      FIXTURE_IDENTIFIER,
      FIXTURE_RESOLVED,
      FIXTURE_FRONTMATTER,
      longBody
    );
    // size.chars must be 680 — the full body length, not any extracted subset
    expect(envelope.size.chars).toBe(680);
  });

  it('[U-01c] falls back to a current ISO timestamp when fq_updated is absent', () => {
    const frontmatterWithoutUpdated: Record<string, unknown> = {
      [FM.TITLE]: 'No Updated Field',
    };
    const envelope = buildMetadataEnvelope(
      FIXTURE_IDENTIFIER,
      FIXTURE_RESOLVED,
      frontmatterWithoutUpdated,
      FIXTURE_BODY
    );
    // Modified should be a valid ISO 8601 timestamp
    expect(envelope.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => new Date(envelope.modified)).not.toThrow();
  });

  it('[U-01d] fq_id is taken from resolved.capturedFrontmatter.fqcId (not hard-coded string)', () => {
    const customId = 'deadbeef-0000-4000-8000-000000000042';
    const resolved = {
      relativePath: 'Docs/test.md',
      capturedFrontmatter: { fqcId: customId },
    };
    const envelope = buildMetadataEnvelope('Docs/test.md', resolved, {}, 'body content');
    expect(envelope.fq_id).toBe(customId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: buildHeadingEntries (GDOC-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildHeadingEntries (GDOC-05)', () => {
  // Fixture content with H1, H2, H3, H2, H3, H4 headings
  // Section A (H2) has 50 chars of content, Sub under it (H3) has 20 chars, Section B (H2) has 30 chars
  const headingFixture = [
    '# Document Title',
    '',
    '## Section A',
    '',
    'Body text for Section A that fills up to make fifty chars.',
    '',
    '### Sub',
    '',
    'Sub body text here for twenty chars.',
    '',
    '## Section B',
    '',
    'Body text for Section B here.',
    '',
    '### Sub B',
    '',
    'Sub B content.',
    '',
    '#### Deep',
    '',
    'Very deep content.',
  ].join('\n');

  it('[U-02] returns heading entries with level, text, and chars for each heading', () => {
    const entries = buildHeadingEntries(headingFixture, 6);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('text');
      expect(entry).toHaveProperty('chars');
      expect(typeof entry.level).toBe('number');
      expect(typeof entry.text).toBe('string');
      expect(typeof entry.chars).toBe('number');
    }
  });

  it('[U-02b] maxDepth:2 excludes H3 and deeper headings', () => {
    const entries = buildHeadingEntries(headingFixture, 2);
    // Should only have H1 and H2 entries
    for (const entry of entries) {
      expect(entry.level).toBeLessThanOrEqual(2);
    }
    // There are 1 H1 + 2 H2 headings → should be 3 entries
    expect(entries.length).toBe(3);
  });

  it('[U-02c] entries are returned in document order', () => {
    const entries = buildHeadingEntries(headingFixture, 6);
    const texts = entries.map((e) => e.text);
    expect(texts[0]).toBe('Document Title');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: include_nested in buildHeadingEntries (GDOC-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('include_nested in buildHeadingEntries (GDOC-05)', () => {
  it('[U-05b] parent heading chars count INCLUDES child subheading content', () => {
    const content = [
      '## Parent',
      '',
      'Parent body text.',
      '',
      '### Child',
      '',
      'Child body text.',
    ].join('\n');

    const entries = buildHeadingEntries(content, 6);
    const parentEntry = entries.find((e) => e.text === 'Parent');
    const childEntry = entries.find((e) => e.text === 'Child');

    expect(parentEntry).toBeDefined();
    expect(childEntry).toBeDefined();

    // Parent chars should be >= child chars (include_nested-style: parent includes child content)
    expect(parentEntry!.chars).toBeGreaterThan(childEntry!.chars);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: buildConsolidatedResponse (GDOC-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConsolidatedResponse (GDOC-01)', () => {
  const baseEnvelope = {
    identifier: FIXTURE_IDENTIFIER,
    title: 'Sprint 12 Standup',
    path: FIXTURE_IDENTIFIER,
    fq_id: FIXTURE_FQC_ID,
    modified: FIXTURE_FQ_UPDATED,
    size: { chars: FIXTURE_BODY.length },
  };

  const sampleFrontmatter = { [FM.TITLE]: 'Sprint 12 Standup', custom_field: 'custom_value' };
  const sampleHeadings = [{ level: 2, text: 'Section A', chars: 50 }];

  it("[U-03a] include:['body'] — output has body and no frontmatter or headings keys", () => {
    const result = buildConsolidatedResponse(baseEnvelope, ['body'], {
      body: FIXTURE_BODY,
    });
    expect(result).toHaveProperty('body', FIXTURE_BODY);
    expect(result).not.toHaveProperty('frontmatter');
    expect(result).not.toHaveProperty('headings');
  });

  it("[U-03b] include:['frontmatter'] — output has frontmatter and no body or headings", () => {
    const result = buildConsolidatedResponse(baseEnvelope, ['frontmatter'], {
      frontmatter: sampleFrontmatter,
    });
    expect(result).toHaveProperty('frontmatter', sampleFrontmatter);
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('headings');
  });

  it("[U-03c] include:['headings'] — output has headings and no body or frontmatter", () => {
    const result = buildConsolidatedResponse(baseEnvelope, ['headings'], {
      headings: sampleHeadings,
    });
    expect(result).toHaveProperty('headings', sampleHeadings);
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('frontmatter');
  });

  it("[U-03d] include:['body','frontmatter','headings'] — all three present plus envelope fields", () => {
    const result = buildConsolidatedResponse(
      baseEnvelope,
      ['body', 'frontmatter', 'headings'],
      {
        body: FIXTURE_BODY,
        frontmatter: sampleFrontmatter,
        headings: sampleHeadings,
      }
    );
    expect(result).toHaveProperty('body', FIXTURE_BODY);
    expect(result).toHaveProperty('frontmatter', sampleFrontmatter);
    expect(result).toHaveProperty('headings', sampleHeadings);
    // Envelope fields always present
    expect(result).toHaveProperty('identifier', FIXTURE_IDENTIFIER);
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('fq_id');
    expect(result).toHaveProperty('size');
  });

  it('[U-08] empty include array defaults to body', () => {
    const result = buildConsolidatedResponse(baseEnvelope, [], {
      body: FIXTURE_BODY,
    });
    // With empty include, defaults to body
    expect(result).toHaveProperty('body', FIXTURE_BODY);
    expect(result).not.toHaveProperty('frontmatter');
    expect(result).not.toHaveProperty('headings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: validateParameterCombinations (Error 9)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateParameterCombinations (Error 9)', () => {
  it("[U-08p] returns sections_without_body error when sections provided but body not in include", () => {
    const result = validateParameterCombinations({
      include: ['headings'],
      sections: ['X'],
    });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('error', 'invalid_parameter_combination');
    expect((result as Record<string, unknown>)['details']).toMatchObject({
      conflict: 'sections_without_body',
    });
  });

  it('[U-08q] returns occurrence_with_multi_section error when occurrence provided with multi-element sections', () => {
    const result = validateParameterCombinations({
      include: ['body'],
      sections: ['X', 'Y'],
      occurrence: 2,
    });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('error', 'invalid_parameter_combination');
    const details = (result as Record<string, unknown>)['details'] as Record<string, unknown>;
    expect(details['conflict']).toBe('occurrence_with_multi_section');
    expect(details['sections_count']).toBe(2);
    expect(details['occurrence']).toBe(2);
  });

  it('[U-08r] returns null (valid) when single-element sections with occurrence', () => {
    const result = validateParameterCombinations({
      include: ['body'],
      sections: ['X'],
      occurrence: 2,
    });
    expect(result).toBeNull();
  });

  it('[U-08s] returns null (valid) when multi-element sections without explicit occurrence', () => {
    const result = validateParameterCombinations({
      include: ['body'],
      sections: ['X', 'Y'],
      // occurrence defaults to 1 — valid for multi-section
    });
    expect(result).toBeNull();
  });
});

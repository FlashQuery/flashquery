import { describe, expect, it } from 'vitest';

import { FM } from '../../src/constants/frontmatter-fields.js';
import {
  parseGraphProcessingLevel,
  shouldRunChunksForProcessingLevel,
  shouldRunGraphForProcessingLevel,
} from '../../src/embedding/chunks/scheduler.js';

describe('graph processing level frontmatter', () => {
  it('T-U-026 missing fq_processing defaults to full', () => {
    expect(parseGraphProcessingLevel({}).level).toBe('full');
    expect(shouldRunChunksForProcessingLevel('full')).toBe(true);
    expect(shouldRunGraphForProcessingLevel('full')).toBe(true);
  });

  it('accepts only full, embedded, and none', () => {
    expect(parseGraphProcessingLevel({ [FM.PROCESSING]: 'full' })).toMatchObject({ level: 'full' });
    expect(parseGraphProcessingLevel({ [FM.PROCESSING]: 'embedded' })).toMatchObject({ level: 'embedded' });
    expect(parseGraphProcessingLevel({ [FM.PROCESSING]: 'none' })).toMatchObject({ level: 'none' });

    expect(shouldRunChunksForProcessingLevel('embedded')).toBe(true);
    expect(shouldRunGraphForProcessingLevel('embedded')).toBe(false);
    expect(shouldRunChunksForProcessingLevel('none')).toBe(false);
    expect(shouldRunGraphForProcessingLevel('none')).toBe(false);
  });

  it('T-U-027 invalid fq_processing value produces a diagnostic and no partial graph processing', () => {
    const parsed = parseGraphProcessingLevel({ [FM.PROCESSING]: 'graph-only' });

    expect(parsed).toEqual({
      level: null,
      diagnostics: [
        {
          code: 'invalid_fq_processing',
          field: FM.PROCESSING,
          message: "Invalid fq_processing value 'graph-only'. Expected one of: full, embedded, none.",
          value: 'graph-only',
        },
      ],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_PROMPTS, validateGraphPrompts } from '../../src/graph/prompts.js';

describe('graph prompts', () => {
  it('T-U-010 prompt sidecar validates required graph namespace variables', () => {
    expect(validateGraphPrompts(DEFAULT_GRAPH_PROMPTS)).toEqual(DEFAULT_GRAPH_PROMPTS);
  });

  it('T-U-011 non-overridable prompt override is rejected', () => {
    expect(() =>
      validateGraphPrompts(
        [
          {
            id: 'internal',
            version: '1',
            template: '{{graph:classified_types}}',
            requiredVariables: ['graph:classified_types'],
            overridable: false,
          },
        ],
        { internal: 'override' }
      )
    ).toThrow(/not overridable/i);
  });

  it('T-U-076 prompt definitions require declared variables to appear in template', () => {
    expect(() =>
      validateGraphPrompts([
        {
          id: 'classify_edge',
          version: '1',
          template: 'No graph variable here',
          requiredVariables: ['graph:classified_types'],
          overridable: true,
        },
      ])
    ).toThrow(/missing required variable/i);
  });
});

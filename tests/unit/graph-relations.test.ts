import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_RELATIONS } from '../../src/graph/vocabulary.js';

describe('graph relation semantics', () => {
  it('T-U-015 default relation set classifies directionality and symmetry correctly', () => {
    const byName = new Map(DEFAULT_GRAPH_RELATIONS.map((relation) => [relation.name, relation]));

    expect(byName.get('contains')).toMatchObject({ category: 'structural', directionality: 'directed' });
    expect(byName.get('references')).toMatchObject({ category: 'structural', directionality: 'directed' });
    expect(byName.get('contradicts')).toMatchObject({ category: 'classified', directionality: 'symmetric' });
    expect(byName.get('duplicates')).toMatchObject({ category: 'classified', directionality: 'symmetric' });
    expect(byName.get('depends_on')).toMatchObject({ category: 'classified', directionality: 'directed' });
  });
});

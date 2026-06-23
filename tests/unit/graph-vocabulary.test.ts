import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_GRAPH_RELATIONS,
  loadGraphVocabulary,
  validateGraphRelations,
} from '../../src/graph/vocabulary.js';

const tempDirs: string[] = [];

function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-graph-vocabulary-'));
  tempDirs.push(dir);
  return dir;
}

describe('graph vocabulary', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-U-008 default vocabulary loads structural and classified relation definitions', () => {
    const names = DEFAULT_GRAPH_RELATIONS.map((relation) => relation.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'contains',
        'references',
        'supports',
        'contradicts',
        'supersedes',
        'duplicates',
        'depends_on',
        'elaborates',
        'summarizes',
        'rationale_for',
        'extends',
        'resolves',
      ])
    );
  });

  it('T-U-009 duplicate relation names fail validation', () => {
    expect(() =>
      validateGraphRelations([DEFAULT_GRAPH_RELATIONS[0], { ...DEFAULT_GRAPH_RELATIONS[0] }])
    ).toThrow(/duplicate graph relation 'contains'/i);
  });

  it('T-U-052 missing relations file deterministically falls back to packaged defaults', () => {
    const vaultPath = tempVault();

    expect(loadGraphVocabulary({ vaultPath, relationsPath: '.fqc/missing.yml' })).toEqual(
      DEFAULT_GRAPH_RELATIONS
    );
  });

  it('T-U-053 invalid directionality or detection method fails before workers run', () => {
    const vaultPath = tempVault();
    const filePath = join(vaultPath, 'edge-types.yml');
    writeFileSync(
      filePath,
      `
relations:
  - name: bad
    category: structural
    directionality: sideways
    detection_method: structural
    description: Bad relation
`
    );

    expect(() => loadGraphVocabulary({ vaultPath, relationsPath: filePath })).toThrow(
      /directionality/i
    );
  });

  it('T-U-016 rejects similarity as stored v1 topology', () => {
    expect(() =>
      validateGraphRelations([
        {
          name: 'semantically_similar_to',
          category: 'classified',
          directionality: 'symmetric',
          detectionMethod: 'classified',
          description: 'Rejected',
        },
      ])
    ).toThrow(/not stored graph topology/i);
  });
});

import { describe, expect, it } from 'vitest';

import { chunkContentHash } from '../../src/embedding/chunks/normalize.js';
import { deriveChunkId, deriveParentChunkId } from '../../src/embedding/chunks/identity.js';

const baseInput = {
  instanceId: 'inst-1',
  documentId: '2f078558-bf68-4e0f-9953-ecb2b7065691',
  headingPath: 'Guide > Setup',
};

describe('chunk identity', () => {
  it('T-U-021 derives UUID5 id from instance id, document id, heading path, and chunk index', () => {
    const id = deriveChunkId({ ...baseInput, chunkIndex: 0 });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveChunkId({ ...baseInput, chunkIndex: 0 })).toBe(id);
    expect(deriveChunkId({ ...baseInput, instanceId: 'inst-2', chunkIndex: 0 })).not.toBe(id);
    expect(deriveChunkId({ ...baseInput, documentId: '0bdfb39a-a733-48f4-bcad-cffb1ff5808c', chunkIndex: 0 })).not.toBe(
      id
    );
    expect(deriveChunkId({ ...baseInput, headingPath: 'Guide > Install', chunkIndex: 0 })).not.toBe(id);
    expect(deriveChunkId({ ...baseInput, chunkIndex: 1 })).not.toBe(id);
  });

  it('T-U-022 gives sub-split siblings and heading-less siblings distinct ids via chunk_index', () => {
    const headingless = { ...baseInput, headingPath: 'Untitled Document' };

    expect(deriveChunkId({ ...baseInput, chunkIndex: 0 })).not.toBe(deriveChunkId({ ...baseInput, chunkIndex: 1 }));
    expect(deriveChunkId({ ...headingless, chunkIndex: 0 })).not.toBe(deriveChunkId({ ...headingless, chunkIndex: 1 }));
  });

  it('T-U-023 preserves id but changes hash on body-only edit', () => {
    const idBefore = deriveChunkId({ ...baseInput, chunkIndex: 0 });
    const idAfter = deriveChunkId({ ...baseInput, chunkIndex: 0 });

    expect(idAfter).toBe(idBefore);
    expect(chunkContentHash('first body')).not.toBe(chunkContentHash('second body'));
  });

  it('T-U-024 changes descendant ids on heading rename and identifies old ids as orphans', () => {
    const oldIds = [
      deriveChunkId({ ...baseInput, headingPath: 'Guide > Setup > API', chunkIndex: 0 }),
      deriveChunkId({ ...baseInput, headingPath: 'Guide > Setup > API', chunkIndex: 1 }),
    ];
    const newIds = [
      deriveChunkId({ ...baseInput, headingPath: 'Guide > Configuration > API', chunkIndex: 0 }),
      deriveChunkId({ ...baseInput, headingPath: 'Guide > Configuration > API', chunkIndex: 1 }),
    ];

    expect(newIds).not.toEqual(oldIds);
    expect(oldIds.filter((id) => !newIds.includes(id))).toEqual(oldIds);
  });

  it('T-U-025 returns null parent for ordinary chunks and sibling 0 parent for sub-splits', () => {
    const parentId = deriveChunkId({ ...baseInput, chunkIndex: 0 });

    expect(deriveParentChunkId({ ...baseInput, chunkIndex: 0 })).toBeNull();
    expect(deriveParentChunkId({ ...baseInput, chunkIndex: 1 })).toBe(parentId);
    expect(deriveParentChunkId({ ...baseInput, chunkIndex: 2 })).toBe(parentId);
  });
});

import { v5 as uuidv5 } from 'uuid';

import type { ChunkIdentityInput } from './types.js';

export const FLASHQUERY_CHUNK_NAMESPACE = '51ad35c4-4f8e-5b95-b38f-f4f3d65c7f52';

export function chunkIdentityName(input: ChunkIdentityInput): string {
  return `${input.instanceId}:${input.documentId}:${input.headingPath}:${input.chunkIndex}`;
}

export function deriveChunkId(input: ChunkIdentityInput): string {
  return uuidv5(chunkIdentityName(input), FLASHQUERY_CHUNK_NAMESPACE);
}

export function deriveParentChunkId(input: ChunkIdentityInput): string | null {
  if (input.chunkIndex === 0) {
    return null;
  }

  return deriveChunkId({ ...input, chunkIndex: 0 });
}

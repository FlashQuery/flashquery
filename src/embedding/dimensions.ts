import type { FlashQueryConfig } from '../config/types.js';

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export function getEmbeddingDimensions(config: FlashQueryConfig): number {
  if (config.llm?.purposes) {
    const embeddingPurpose = config.llm.purposes.find((purpose) => purpose.name === 'embedding');
    if (embeddingPurpose?.models[0]) {
      const modelEntry = config.llm.models?.find((model) => model.name === embeddingPurpose.models[0]);
      if (modelEntry?.dimensions) return modelEntry.dimensions;
    }
  }

  return config.embedding?.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
}

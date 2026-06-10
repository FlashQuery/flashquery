import type { FlashQueryConfig } from '../config/types.js';

const LEGACY_EMBEDDING_DIMENSIONS = 1536;

export function getLegacyEmbeddingDimensions(config: FlashQueryConfig): number {
  if (config.llm?.purposes) {
    const embeddingPurpose = config.llm.purposes.find((purpose) => purpose.name === 'embedding');
    if (embeddingPurpose?.models[0]) {
      const modelEntry = config.llm.models?.find((model) => model.name === embeddingPurpose.models[0]);
      if (modelEntry?.dimensions) return modelEntry.dimensions;
    }
  }

  return config.embedding?.dimensions ?? LEGACY_EMBEDDING_DIMENSIONS;
}

import type { FlashQueryConfig } from '../../../config/loader.js';

export interface DocumentToolDeps {
  config: FlashQueryConfig;
}

export function createDocumentToolDeps(config: FlashQueryConfig): DocumentToolDeps {
  return { config };
}

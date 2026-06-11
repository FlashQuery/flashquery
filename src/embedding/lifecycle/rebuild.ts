import type { FlashQueryConfig } from '../../config/loader.js';
import type { MaintenanceLifecycleActionResult } from '../../mcp/utils/response-formats.js';
import type { LifecycleJobRef } from './jobs.js';
import type { LifecycleBaseInput } from './types.js';
import { runCoreLifecycle, type CoreLifecycleResult } from './core-processor.js';

export async function runRebuildEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'rebuild_embeddings' },
  backgroundJob?: LifecycleJobRef
): Promise<CoreLifecycleResult> {
  return await runCoreLifecycle({
    config,
    input,
    mode: 'rebuild_embeddings',
    ...(backgroundJob === undefined ? {} : { backgroundJob }),
  });
}

export type RebuildEmbeddingsResult = MaintenanceLifecycleActionResult;

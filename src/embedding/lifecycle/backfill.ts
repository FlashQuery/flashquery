import type { FlashQueryConfig } from '../../config/loader.js';
import type { MaintenanceLifecycleActionResult } from '../../mcp/utils/response-formats.js';
import type { LifecycleBaseInput } from './types.js';
import type { LifecycleJobRef } from './jobs.js';
import { runCoreLifecycle, type CoreLifecycleResult } from './core-processor.js';

export async function runBackfillEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'backfill_embeddings' },
  backgroundJob?: LifecycleJobRef
): Promise<CoreLifecycleResult> {
  return await runCoreLifecycle({
    config,
    input,
    mode: 'backfill_embeddings',
    ...(backgroundJob === undefined ? {} : { backgroundJob }),
  });
}

export type BackfillEmbeddingsResult = MaintenanceLifecycleActionResult;

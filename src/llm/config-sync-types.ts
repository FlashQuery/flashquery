import type { FlashQueryConfig } from '../config/types.js';

export interface ConfigSyncAdapter<T> {
  table: string;
  runtimeSources: Array<'api' | 'webapp'>;
  parseYaml(config: FlashQueryConfig): Promise<T[]> | T[];
  identity(item: T): Record<string, string>;
  toRow(item: T): Record<string, unknown>;
  describeIdentity(item: T): string;
  runtimeOwnershipWarning?: (item: T, source: 'api' | 'webapp') => string;
}

export interface ConfigSyncResult {
  inserted: number;
  skipped: number;
}

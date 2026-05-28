import type { PoolClient } from 'pg';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { __testing as documentLockTesting } from '../../src/services/document-lock.js';

export type AdvisoryLockMode = 'exclusive' | 'shared';

export interface AdvisoryLockRow {
  mode: string;
  classid: number;
  objid: number;
  key: bigint;
}

function advisoryMode(mode: AdvisoryLockMode): string {
  return mode === 'shared' ? 'ShareLock' : 'ExclusiveLock';
}

export async function advisoryKeyForDirectory(
  config: FlashQueryConfig,
  dirPath: string
): Promise<bigint> {
  const rawKey = BigInt(await documentLockTesting.deriveAdvisoryKey(config, dirPath, 'dir'));
  return BigInt.asIntN(64, rawKey);
}

export async function queryAdvisoryLocks(
  client: PoolClient,
  options: { mode?: AdvisoryLockMode; key?: bigint } = {}
): Promise<AdvisoryLockRow[]> {
  const result = await client.query<{
    mode: string;
    classid: number;
    objid: number;
  }>(
    `
      SELECT mode, classid::int AS classid, objid::int AS objid
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND granted = true
    `
  );

  return result.rows
    .map((row) => {
      const classid = BigInt.asUintN(32, BigInt(row.classid));
      const objid = BigInt.asUintN(32, BigInt(row.objid));
      const unsignedKey = (classid << 32n) | objid;
      return {
        mode: row.mode,
        classid: row.classid,
        objid: row.objid,
        key: BigInt.asIntN(64, unsignedKey),
      };
    })
    .filter((row) => (options.mode ? row.mode === advisoryMode(options.mode) : true))
    .filter((row) => (options.key !== undefined ? row.key === options.key : true));
}

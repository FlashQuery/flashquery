import { withPgClient } from '../utils/pg-client.js';

export type SessionAdvisoryLockFailureReason =
  | 'session_not_stable'
  | 'release_failed'
  | 'query_failed';

export type SessionAdvisoryLockCheckResult =
  | { ok: true }
  | { ok: false; reason: SessionAdvisoryLockFailureReason; message: string };

const STARTUP_ADVISORY_LOCK_KEY = '791580234627289650';

class StartupAdvisoryLockReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupAdvisoryLockReleaseError';
  }
}

function failure(
  reason: SessionAdvisoryLockFailureReason,
  detail: string
): SessionAdvisoryLockCheckResult {
  return {
    ok: false,
    reason,
    message:
      `FlashQuery requires a session-capable Postgres DATABASE_URL for session-scoped ` +
      `advisory locks. ${detail} This commonly means DATABASE_URL points at a ` +
      `transaction-mode pooler. Use a direct Postgres endpoint or a session-mode pooler; ` +
      `see the setup documentation for the session-capable DATABASE_URL requirement.`,
  };
}

export function formatSessionAdvisoryLockStartupError(
  result: Exclude<SessionAdvisoryLockCheckResult, { ok: true }>
): string {
  return result.message;
}

export async function verifySessionAdvisoryLocks(
  databaseUrl: string
): Promise<SessionAdvisoryLockCheckResult> {
  let acquired = false;
  let observed = false;

  try {
    return await withPgClient(databaseUrl, async (owner) => {
      try {
        await owner.query('SELECT pg_advisory_lock($1::bigint)', [STARTUP_ADVISORY_LOCK_KEY]);
        acquired = true;

        const observerResult = await withPgClient(databaseUrl, async (observer) =>
          observer.query<{ visible: boolean }>(
            `SELECT EXISTS (
              SELECT 1
              FROM pg_locks
              WHERE locktype = 'advisory'
                AND objsubid = 1
                AND granted = true
                AND ((classid::bigint << 32) | objid::bigint) = $1::bigint
            ) AS visible`,
            [STARTUP_ADVISORY_LOCK_KEY]
          )
        );
        observed = observerResult.rows[0]?.visible === true;

        if (!observed) {
          return failure(
            'session_not_stable',
            'Startup could not observe a throwaway advisory lock from a second checkout.'
          );
        }

        return { ok: true };
      } finally {
        if (acquired) {
          let released = false;
          try {
            const unlockResult = await owner.query<{ released: boolean }>(
              'SELECT pg_advisory_unlock($1::bigint) AS released',
              [STARTUP_ADVISORY_LOCK_KEY]
            );
            released = unlockResult.rows[0]?.released === true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new StartupAdvisoryLockReleaseError(message);
          }
          if (!released) {
            throw new StartupAdvisoryLockReleaseError('Throwaway advisory lock release returned false.');
          }
        }
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof StartupAdvisoryLockReleaseError) {
      return failure('release_failed', `Startup acquired the probe lock but release failed: ${message}.`);
    }
    return failure('query_failed', `Startup advisory-lock probe query failed: ${message}.`);
  }
}

export async function assertSessionAdvisoryLocksOrThrow(databaseUrl: string): Promise<void> {
  const result = await verifySessionAdvisoryLocks(databaseUrl);
  if (!result.ok) {
    throw new Error(formatSessionAdvisoryLockStartupError(result));
  }
}

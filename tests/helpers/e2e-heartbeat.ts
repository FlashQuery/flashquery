type HeartbeatMetadataValue = string | number | boolean | null | undefined;

export interface E2EHeartbeatOptions {
  intervalMs?: number;
  metadata?: Record<string, HeartbeatMetadataValue>;
  write?: (line: string) => void;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

export async function withE2EHeartbeat<T>(
  label: string,
  operation: () => Promise<T>,
  options: E2EHeartbeatOptions = {}
): Promise<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const startedAt = Date.now();
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const interval = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    write(`[e2e heartbeat] ${label} still running after ${elapsedSeconds}s${formatMetadata(options.metadata)}\n`);
  }, intervalMs);
  interval.unref?.();

  try {
    return await operation();
  } finally {
    clearInterval(interval);
  }
}

function formatMetadata(metadata: Record<string, HeartbeatMetadataValue> | undefined): string {
  if (!metadata) return '';
  const fields = Object.entries(metadata)
    .filter((entry): entry is [string, Exclude<HeartbeatMetadataValue, null | undefined>] =>
      entry[1] !== null && entry[1] !== undefined
    )
    .map(([key, value]) => `${key}=${String(value)}`);
  return fields.length === 0 ? '' : ` ${fields.join(' ')}`;
}

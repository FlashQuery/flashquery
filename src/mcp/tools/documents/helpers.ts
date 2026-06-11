import { existsSync } from 'node:fs';
import { relative, extname, normalize, basename, resolve, isAbsolute, join } from 'node:path';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../../../embedding/background-embed.js';
import type { ErrorEnvelope } from '../../utils/response-formats.js';
import type { ScheduleDocumentEmbeddingInput } from '../../utils/document-output.js';

export function isDocumentNotFoundError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'DocumentNotFoundError';
}

export function isAmbiguousDocumentIdentifierError(err: unknown): err is Error & { matches?: unknown } {
  return err instanceof Error && err.name === 'AmbiguousDocumentIdentifierError';
}

export function stringField(record: object, key: string, fallback: string): string {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export async function scheduleDocumentEmbedding({
  instanceId,
  id,
  label,
  embedText,
  provider,
  supabase,
  config,
  databaseUrl,
}: ScheduleDocumentEmbeddingInput): Promise<void> {
  if (!config) return;

  await scheduleBackgroundEmbeddingsForActiveEntries({
    config,
    target: documentEmbeddingTarget({ instanceId, id, label }),
    embedText,
    supabase,
    databaseUrl: databaseUrl ?? config.supabase.databaseUrl,
    legacyProvider: provider,
  });
}

interface TrashDestination {
  absPath: string;
  responsePath: string;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel));
}

function toVaultRelative(vaultRoot: string, absPath: string): string | null {
  if (!isPathInside(vaultRoot, absPath)) return null;
  return relative(resolve(vaultRoot), resolve(absPath)).replace(/\\/g, '/');
}

function compactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function resolveTrashRoot(vaultRoot: string, trashPath: string): { absPath: string } | ErrorEnvelope {
  const trimmed = trashPath.trim();
  if (trimmed === '') {
    return {
      error: 'invalid_input',
      message: 'trash_folder.path must not be empty.',
      details: { reason: 'unsafe_trash' },
    };
  }

  if (!isAbsolute(trimmed)) {
    const normalized = normalize(trimmed).replace(/\\/g, '/');
    if (normalized === '..' || normalized.startsWith('../')) {
      return {
        error: 'invalid_input',
        message: 'trash_folder.path escapes the vault root.',
        details: { reason: 'path_traversal' },
      };
    }
    return { absPath: resolve(vaultRoot, normalized) };
  }

  return { absPath: resolve(trimmed) };
}

export function buildTrashDestination(
  vaultRoot: string,
  sourceRelativePath: string,
  trashRootAbsPath: string,
  collisionStrategy: 'suffix' | 'timestamp'
): TrashDestination {
  const sourceBase = basename(sourceRelativePath);
  const ext = extname(sourceBase);
  const stem = ext ? sourceBase.slice(0, -ext.length) : sourceBase;
  let candidate = join(trashRootAbsPath, sourceBase);

  if (existsSync(candidate)) {
    if (collisionStrategy === 'timestamp') {
      const timestamp = compactTimestamp();
      let index = 0;
      do {
        const suffix = index === 0 ? timestamp : `${timestamp}-${index}`;
        candidate = join(trashRootAbsPath, `${stem}-${suffix}${ext}`);
        index += 1;
      } while (existsSync(candidate));
    } else {
      let index = 1;
      do {
        candidate = join(trashRootAbsPath, `${stem}-${index}${ext}`);
        index += 1;
      } while (existsSync(candidate));
    }
  }

  const vaultRelative = toVaultRelative(vaultRoot, candidate);
  return {
    absPath: candidate,
    responsePath: vaultRelative ?? candidate,
  };
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

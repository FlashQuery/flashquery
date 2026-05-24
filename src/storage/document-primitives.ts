import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import matter from 'gray-matter';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FM } from '../constants/frontmatter-fields.js';
import { logger } from '../logging/logger.js';

export interface DocMeta {
  relativePath: string;
  title: string;
  tags: string[];
  project: string;
  status: string;
  fqcId: string;
  modified: string;
  size: { chars: number };
}

export function computeHash(rawContent: string): string {
  const startTime = performance.now();
  const hash = createHash('sha256').update(rawContent).digest('hex');
  const duration = Math.round(performance.now() - startTime);
  logger?.debug(`Hash: computed SHA256 (${duration}ms) — external edit detection enabled`);
  return hash;
}

export async function listMarkdownFiles(
  vaultRoot: string,
  extensions: string[] = ['.md'],
  projectPrefix?: string
): Promise<string[]> {
  const searchRoot = projectPrefix ? join(vaultRoot, projectPrefix) : vaultRoot;

  if (!existsSync(searchRoot)) return [];

  const extsLower = extensions.map((e) => e.toLowerCase());
  const entries = await readdir(searchRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => {
      if (e.name.startsWith('.')) return false;

      const entryPath =
        (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? '';
      if (entryPath && entryPath.split(/[\\/]/).some((component) => component.startsWith('.'))) {
        return false;
      }

      return e.isFile() && extsLower.includes(extname(e.name).toLowerCase());
    })
    .map((e) => {
      const dir =
        (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? searchRoot;
      return relative(vaultRoot, join(dir, e.name));
    });
}

export async function parseDocMeta(vaultRoot: string, relativePath: string): Promise<DocMeta | null> {
  try {
    const fullPath = join(vaultRoot, relativePath);
    const raw = await readFile(fullPath, 'utf-8');
    const { data, content } = matter(raw);
    return {
      relativePath,
      title: String(data[FM.TITLE] ?? relativePath),
      tags: Array.isArray(data[FM.TAGS]) ? (data[FM.TAGS] as string[]) : [],
      project: String(data.project ?? ''),
      status: String(data[FM.STATUS] ?? 'active'),
      fqcId: String(data[FM.ID] ?? ''),
      modified: String(data[FM.UPDATED] ?? data[FM.CREATED] ?? new Date(0).toISOString()),
      size: { chars: content.length },
    };
  } catch {
    logger.warn(`search_documents: skipping malformed file ${relativePath}`);
    return null;
  }
}

export async function reconcileMissingRow(
  vaultRoot: string,
  fqcId: string,
  oldPath: string,
  supabase: SupabaseClient,
  extensions: string[] = ['.md']
): Promise<string | null> {
  const allFiles = await listMarkdownFiles(vaultRoot, extensions);
  let newPath: string | null = null;
  for (const candidate of allFiles) {
    try {
      const raw = await readFile(join(vaultRoot, candidate), 'utf-8');
      const { data: fm } = matter(raw);
      if (fm[FM.ID] === fqcId) {
        newPath = candidate;
        break;
      }
    } catch {
      // skip unreadable files
    }
  }

  if (newPath) {
    logger.info(
      `search_documents: file moved — updating path from "${oldPath}" to "${newPath}" for fqc_id=${fqcId}`
    );
    await supabase
      .from('fqc_documents')
      .update({ path: newPath, updated_at: new Date().toISOString() })
      .eq('id', fqcId);
    return newPath;
  }

  logger.info(
    `search_documents: vault file missing and not found in vault scan — marking fqc_id=${fqcId} as missing`
  );
  await supabase
    .from('fqc_documents')
    .update({ status: 'missing', updated_at: new Date().toISOString() })
    .eq('id', fqcId);
  return null;
}

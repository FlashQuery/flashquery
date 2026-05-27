/**
 * Shared frontmatter utility — atomic read/write of markdown frontmatter.
 * Extracted from src/storage/vault.ts (Phase 88 LEGACY-01, D-03).
 */

import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { logger } from '../logging/logger.js';
import { FM } from '../constants/frontmatter-fields.js';
import { writeVaultFile } from '../storage/vault-write.js';

interface LockAssertionConfig {
  instance: {
    vault?: {
      path: string;
    };
  };
}

/**
 * Update document frontmatter atomically using the .fqc-tmp pattern (WRT-03).
 *
 * Implementation:
 * 1. Read current document (full content + frontmatter)
 * 2. Parse existing frontmatter
 * 3. Merge updates into frontmatter (preserves existing fields)
 * 4. Serialize back to markdown
 * 5. Commit through writeVaultFile's durable temp-write/fsync/rename/dir-fsync sequence
 *
 * **Atomic guarantees:**
 * - Temp file is same directory (rename is atomic at filesystem level)
 * - If rename fails, .fqc-tmp left behind (next scan detects and cleans up)
 * - No partial writes to original file
 *
 * @param absolutePath - Absolute file path to document
 * @param updates - Frontmatter fields to update (merged with existing)
 */
export async function atomicWriteFrontmatter(
  absolutePath: string,
  updates: Record<string, unknown>,
  lockConfig?: LockAssertionConfig
): Promise<void> {
  const rawContent = await readFile(absolutePath, 'utf-8');
  const parsed = matter(rawContent);

  const mergedFrontmatter = {
    ...parsed.data,
    ...updates,
    [FM.UPDATED]: new Date().toISOString(),
  };

  const updatedContent = matter.stringify(parsed.content, mergedFrontmatter);
  await writeVaultFile(absolutePath, updatedContent, { lockConfig });

  logger.debug(`[WRT-03] frontmatter updated atomically for ${absolutePath}`);
}

/**
 * Shared frontmatter utility — atomic read/write of markdown frontmatter.
 * Extracted from src/storage/vault.ts (Phase 88 LEGACY-01, D-03).
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import matter from 'gray-matter';
import { logger } from '../logging/logger.js';

/**
 * Update document frontmatter atomically using the .fqc-tmp pattern (WRT-03).
 *
 * Implementation:
 * 1. Read current document (full content + frontmatter)
 * 2. Parse existing frontmatter
 * 3. Merge updates into frontmatter (preserves existing fields)
 * 4. Serialize back to markdown
 * 5. Write to .fqc-tmp temp file (same directory as original)
 * 6. Atomically rename .fqc-tmp → original path
 *
 * **Atomic guarantees:**
 * - Temp file is same directory (rename is atomic at filesystem level)
 * - If rename fails, .fqc-tmp left behind (next scan detects and cleans up)
 * - No partial writes to original file
 *
 * **Error handling:**
 * - Errors are logged at DEBUG level (transient failures, will retry on next scan)
 * - Errors are NOT thrown (DB already committed, discovery_status='complete')
 *
 * @param absolutePath - Absolute file path to document
 * @param updates - Frontmatter fields to update (merged with existing)
 * @returns void (errors logged, not thrown)
 */
export async function atomicWriteFrontmatter(
  absolutePath: string,
  updates: Record<string, any>
): Promise<void> {
  try {
    // Step 1: Read current document
    const rawContent = await readFile(absolutePath, 'utf-8');
    const parsed = matter(rawContent);

    // Step 2: Parse existing frontmatter (already done by gray-matter)
    const existingFrontmatter = parsed.data;

    // Step 3: Merge updates into existing frontmatter
    const mergedFrontmatter = {
      ...existingFrontmatter,
      ...updates,
      updated: new Date().toISOString(), // Always update timestamp
    };

    // Step 4: Serialize back to markdown
    const updatedContent = matter.stringify(parsed.content, mergedFrontmatter);

    // Step 5: Write to .fqc-tmp temp file (same directory)
    const tempPath = absolutePath + '.fqc-tmp';
    await writeFile(tempPath, updatedContent, 'utf-8');

    // Step 6: Atomically rename .fqc-tmp → original path
    await rename(tempPath, absolutePath);

    logger.debug(`[WRT-03] frontmatter updated atomically for ${absolutePath}`);
  } catch (error) {
    // Non-critical: log at DEBUG level, don't throw
    // DB already committed, next scan will retry
    logger.debug(`[ERR-02] atomicWriteFrontmatter failed for ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

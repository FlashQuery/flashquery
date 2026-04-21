import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { gitManager } from '../git/manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// OBS-04: Minimal frontmatter for externally-added files (D-06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts minimal frontmatter (fqc_id + status only) for new externally-added files.
 * Used to maintain database consistency while respecting external file integrity.
 *
 * When a file is added externally (e.g., via Obsidian, VS Code, or another tool),
 * we write ONLY essential fields to the frontmatter to track identity:
 * - fqc_id: document UUID (required for plugin table references)
 * - status: document state (e.g., 'active')
 *
 * Other fields (content_hash, version, created_at, etc.) are DB-only and computed
 * on next scan pass. This preserves the file's integrity and respects external tool
 * conventions.
 */
export function extractMinimalFrontmatter(fullFrontmatter: Record<string, unknown>): Record<string, unknown> {
  return {
    fqc_id: fullFrontmatter.fqc_id,
    status: fullFrontmatter.status ?? 'active',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: sanitize folder names for cross-platform filesystem safety (D-01)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces filesystem-illegal characters (`: \ / ? * | < >`) with spaces,
 * then collapses consecutive spaces and trims. Preserves the natural name for
 * display while remaining cross-platform safe.
 *
 * Examples:
 *   "Work: Projects" → "Work Projects"
 *   "Multiple::Colons" → "Multiple Colons"
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[:/\\?*|<>]/g, ' ') // replace each illegal char with space
    .replace(/\s+/g, ' ') // collapse multiple spaces to one
    .trim(); // remove leading/trailing whitespace
}

// ─────────────────────────────────────────────────────────────────────────────
// WriteMarkdownOptions — optional git commit metadata (GIT-01)
// ─────────────────────────────────────────────────────────────────────────────

export interface WriteMarkdownOptions {
  gitAction?: string; // 'create' | 'update'
  gitTitle?: string; // document title for commit message
}

// ─────────────────────────────────────────────────────────────────────────────
// VaultManager interface (D-09)
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultManager {
  /**
   * Writes a markdown file to the vault at relativePath (relative to vault root).
   * Always overwrites the `updated` field with the current ISO timestamp.
   * Creates intermediate directories if they don't exist.
   * If options.gitAction and options.gitTitle are provided, triggers a fire-and-forget
   * git commit after the file write (GIT-01). Never delays the caller.
   */
  writeMarkdown(
    relativePath: string,
    frontmatter: Record<string, unknown>,
    content: string,
    options?: WriteMarkdownOptions
  ): Promise<void>;

  /**
   * Reads a markdown file from the vault and returns parsed frontmatter data
   * and body content.
   */
  readMarkdown(relativePath: string): Promise<{ data: Record<string, unknown>; content: string }>;

  /**
   * Returns the absolute path for a document in the vault.
   * If project is null or undefined, returns path under _global/.
   * Area and project names are sanitized before use.
   */
  resolvePath(area: string, project: string | null | undefined, filename: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VaultManagerImpl (internal)
// ─────────────────────────────────────────────────────────────────────────────

class VaultManagerImpl implements VaultManager {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async initialize(config: FlashQueryConfig): Promise<void> {
    const vaultPath = config.instance.vault.path;

    // Detect existing content — respect structure without modification (D-02)
    if (existsSync(vaultPath) && readdirSync(vaultPath).length > 0) {
      logger.info(`Vault: existing content found at ${vaultPath}`);
    }

    // Create vault root only — no auto-folder creation (D-01)
    await mkdir(vaultPath, { recursive: true });

    logger.info(`Vault initialized at ${vaultPath} — organize content as needed`);
  }

  async writeMarkdown(
    relativePath: string,
    frontmatter: Record<string, unknown>,
    content: string,
    options?: WriteMarkdownOptions
  ): Promise<void> {
    const absolutePath = join(this.rootPath, relativePath);
    const startTime = performance.now();

    // Create intermediate directories if missing (D-06, Pitfall 3)
    await mkdir(dirname(absolutePath), { recursive: true });

    // Always overwrite `updated` with current timestamp (D-06)
    // NOTE: For externally-added files (new documents not previously tracked),
    // callers should use extractMinimalFrontmatter() to pass only fqc_id + status.
    // This preserves external file integrity per OBS-04. Other fields (content_hash,
    // version, etc.) are DB-only and computed on next scan pass.
    const fm = { ...frontmatter, updated: new Date().toISOString() };

    // Serialize using gray-matter (default import — CJS interop)
    const output = matter.stringify(content, fm);

    const tmpPath = absolutePath + '.fqc-tmp';
    await writeFile(tmpPath, output, 'utf-8');
    await rename(tmpPath, absolutePath);
    const duration = Math.round(performance.now() - startTime);
    logger.debug(`Vault: wrote ${relativePath} (${duration}ms) — document update persisted to disk`);

    // Fire-and-forget: git commit after vault write (GIT-01)
    // void prefix ensures this is never awaited — MCP response is not delayed
    // Optional chaining handles case where initGit hasn't run (Pitfall 1)
    if (options?.gitAction && options?.gitTitle) {
      void gitManager
        ?.commitVaultChanges(options.gitAction, options.gitTitle, relativePath)
        .catch((err) =>
          logger.warn(
            `Git: commitVaultChanges error: ${err instanceof Error ? err.message : String(err)}`
          )
        );
    }
  }

  async readMarkdown(
    relativePath: string
  ): Promise<{ data: Record<string, unknown>; content: string }> {
    const absolutePath = join(this.rootPath, relativePath);
    const startTime = performance.now();
    const raw = await readFile(absolutePath, 'utf-8');
    const parsed = matter(raw);
    const duration = Math.round(performance.now() - startTime);
    logger.debug(`Vault: read ${relativePath} (${duration}ms) — frontmatter extracted and validated`);
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content,
    };
  }

  resolvePath(area: string, project: string | null | undefined, filename: string): string {
    if (!project) {
      return join(this.rootPath, '_global', filename);
    }
    return join(this.rootPath, sanitizeFolderName(area), sanitizeFolderName(project), filename);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton (D-07) — mirrors supabaseManager / logger pattern
// ─────────────────────────────────────────────────────────────────────────────

export let vaultManager: VaultManager;

export async function initVault(config: FlashQueryConfig): Promise<void> {
  const manager = new VaultManagerImpl(config.instance.vault.path);
  await manager.initialize(config);
  vaultManager = manager;
}

export async function cleanStaleTempFiles(vaultPath: string): Promise<void> {
  const { readdir, unlink } = await import('node:fs/promises');
  logger.debug(`startup: scanning vault for stale temp files at ${vaultPath}`);

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory unreadable — skip
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.fqc-tmp')) {
        try {
          await unlink(full);
          logger.info(`startup: removed stale temp file ${full}`);
        } catch (err) {
          logger.warn(`startup: failed to remove stale temp file ${full}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  await walk(vaultPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// atomicWriteFrontmatter() — re-exported from shared utility (Phase 88 LEGACY-01)
// ─────────────────────────────────────────────────────────────────────────────
export { atomicWriteFrontmatter } from '../utils/frontmatter.js';

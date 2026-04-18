import { simpleGit, type SimpleGit } from 'simple-git';
import { Mutex } from 'async-mutex';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// GitManagerImpl
// ─────────────────────────────────────────────────────────────────────────────

export class GitManagerImpl {
  private vaultPath: string;
  private config: FlashQueryConfig['git'];
  private supabaseConfig: { databaseUrl: string };
  private mutex: Mutex;
  private git: SimpleGit;
  private gitAvailable: boolean = false;
  private vaultIsRepo: boolean = false;

  constructor(
    vaultPath: string,
    config: FlashQueryConfig['git'],
    supabaseConfig: { databaseUrl: string }
  ) {
    this.vaultPath = vaultPath;
    this.config = config;
    this.supabaseConfig = supabaseConfig;
    this.mutex = new Mutex();
    this.git = simpleGit(vaultPath);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // initialize (D-01): check git binary + .git directory at startup
  // ───────────────────────────────────────────────────────────────────────────

  async initialize(config: FlashQueryConfig): Promise<void> {
    // Check 1: git binary available
    try {
      await simpleGit().version();
      this.gitAvailable = true;
    } catch {
      logger.warn(
        'Git: git binary not found — git features disabled. Install git to enable auto-commit.'
      );
      return;
    }

    // Check 2: vault is a git repo
    if (!existsSync(join(this.vaultPath, '.git'))) {
      logger.warn(
        `Git: vault at ${this.vaultPath} is not a git repository — git features disabled. Run: git init ${this.vaultPath}`
      );
      return;
    }
    this.vaultIsRepo = true;

    logger.info(
      `Git: initialized — vault at ${this.vaultPath} (auto_commit=${config.git.autoCommit}, auto_push=${config.git.autoPush})`
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // isGitReady — true when git binary is available and vault is a git repo
  // ───────────────────────────────────────────────────────────────────────────

  get isGitReady(): boolean {
    return this.gitAvailable && this.vaultIsRepo;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // dumpDatabase (BCK-01, BCK-02) — export all fqc_* and fqcp_* tables to
  // [vault]/.fqc/backup.json via direct pg.Client. Returns relative path.
  // Throws on failure (caller handles exit codes).
  // ───────────────────────────────────────────────────────────────────────────

  async dumpDatabase(): Promise<string> {
    const dumpRelPath = '.fqc/backup.json';
    const dumpAbsDir = join(this.vaultPath, '.fqc');
    const dumpAbsPath = join(this.vaultPath, dumpRelPath);

    const pgClient = createPgClientIPv4(this.supabaseConfig.databaseUrl);
    try {
      await pgClient.connect();

      const tablesResult = await pgClient.query<{ tablename: string }>(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND (tablename LIKE 'fqc_%' OR tablename LIKE 'fqcp_%')
        ORDER BY tablename
      `);

      const backup: Record<string, unknown[]> = {};
      for (const { tablename } of tablesResult.rows) {
        const result = await pgClient.query(`SELECT * FROM ${pg.escapeIdentifier(tablename)}`);
        backup[tablename] = result.rows;
      }

      const output = JSON.stringify(
        { exported_at: new Date().toISOString(), tables: backup },
        null,
        2
      );

      await mkdir(dumpAbsDir, { recursive: true });
      await writeFile(dumpAbsPath, output, 'utf-8');
      logger.info(`Git: backup written to ${dumpRelPath} (${tablesResult.rows.length} tables)`);
      return dumpRelPath;
    } finally {
      await pgClient.end().catch(() => {});
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // commitAllVaultChanges (BCK-02) — stage ALL vault files (git add -A) and
  // commit with the provided message. Runs under mutex. Does NOT check
  // autoCommit flag — this is an explicit caller-driven operation.
  // ───────────────────────────────────────────────────────────────────────────

  async commitAllVaultChanges(message: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      await this.git.add('-A');
      await this.git.commit(message);
      logger.debug(`Git: committed all vault changes — "${message}"`);
    } catch (err) {
      logger.warn(
        `Git: commitAllVaultChanges failed — ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    } finally {
      release();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // tagBackup (BCK-02) — apply an annotated git tag marking a coherent backup.
  // Tag name format: fqc-backup-20260326T020000Z (compact ISO, no colons).
  // ───────────────────────────────────────────────────────────────────────────

  async tagBackup(tagName: string): Promise<void> {
    await this.git.addAnnotatedTag(
      tagName,
      `FQ coherent backup: db + vault files as of ${new Date().toISOString()}`
    );
    logger.info(`Git: backup tag applied — ${tagName}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // commitVaultChanges (D-02, D-03, D-04, D-05, GIT-01, GIT-02)
  // ───────────────────────────────────────────────────────────────────────────

  async commitVaultChanges(action: string, title: string, relativePath: string): Promise<void> {
    // Runtime re-check (D-02) — allows fix-without-restart
    if (!this.gitAvailable || !existsSync(join(this.vaultPath, '.git'))) {
      logger.warn(`Git: skipping commit for '${title}' — git not available or vault not a repo`);
      return;
    }

    // Silently skip if auto_commit not enabled
    if (!this.config.autoCommit) return;

    const startTime = performance.now();
    const release = await this.mutex.acquire();
    try {
      const message = `vault: ${action} document '${title}'`;
      await this.git.add(relativePath);
      await this.git.commit(message);
      const duration = Math.round(performance.now() - startTime);
      logger.debug(`Git: committed "${message}" (${duration}ms) — maintaining version history`);

      // Fire-and-forget push (D-05)
      if (this.config.autoPush) {
        logger.debug(`Git: push started — background sync to remote`);
        void this.git
          .push(this.config.remote, this.config.branch)
          .then(() => {
            logger.debug(`Git: push completed to ${this.config.remote}/${this.config.branch} — background sync to remote`);
          })
          .catch((err) =>
            logger.warn(`Git: push failed — ${err instanceof Error ? err.message : String(err)}. Manual push may be needed`)
          );
      }
    } catch (err) {
      logger.warn(
        `Git: commit failed for '${title}' — ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      release();
    }
  }

  /**
   * Graceful shutdown: acquire and release async-mutex with timeout
   *
   * Per D-05: 3-second timeout for releasing the mutex.
   * If a commit is in progress, we wait up to 3 seconds for it to complete.
   * If it doesn't complete by then, we log a warning and continue shutdown anyway.
   */
  async gracefulShutdown(): Promise<void> {
    try {
      logger.debug('Git: attempting graceful mutex release');
      // Try to acquire mutex (which tests if it's held) with 3-second timeout
      const release = await Promise.race([
        this.mutex.acquire(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('mutex release timeout')), 3_000) // 3s per D-05
        ),
      ]);
      release(); // Release immediately after acquiring
      logger.info('Git: mutex released gracefully');
    } catch (err: unknown) {
      logger.warn(`Git: mutex release timeout or error: ${err instanceof Error ? err.message : String(err)}`);
      // Do not throw — let shutdown continue
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton (mirrors vaultManager / initVault pattern)
// ─────────────────────────────────────────────────────────────────────────────

export let gitManager: GitManagerImpl;

export async function initGit(config: FlashQueryConfig): Promise<void> {
  const manager = new GitManagerImpl(config.instance.vault.path, config.git, {
    databaseUrl: config.supabase.databaseUrl,
  });
  await manager.initialize(config);
  gitManager = manager;
}

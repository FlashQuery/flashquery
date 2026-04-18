#!/usr/bin/env node

import dns from 'node:dns';
import net from 'node:net';

// Force IPv4 for all TCP connections to prevent PostgreSQL timeouts on Linux systems
// with broken/firewalled IPv6. Two settings are required together:
//
// 1. dns.setDefaultResultOrder('ipv4first') — ensures DNS resolution returns IPv4 addresses
//    before IPv6, so hostname lookups produce IPv4 results.
//
// 2. net.setDefaultAutoSelectFamily(false) — disables Node.js "Happy Eyeballs" (RFC 6555),
//    which by default tries IPv6 connections first even when DNS returned IPv4 first. The
//    pg library creates a bare `new net.Socket()` and calls `.connect(port, host)` with no
//    address-family hint — without this flag, autoSelectFamily attempts IPv6 and hangs on
//    systems where IPv6 is broken/unreachable. The `family: 4` option passed to pg.Client
//    config is NOT forwarded to the socket; pg does not support it.
//
// Together these ensure pg's raw TCP socket connects over IPv4 only.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);
console.error('[STARTUP] DNS result order set to: ipv4first, autoSelectFamily disabled (IPv4-only TCP)');

import 'dotenv/config'; // MUST be first — loads .env before any module evaluation (D-10)

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigPath, getDeprecationWarnings } from './config/loader.js';
import { unlockCommand } from './cli/commands/unlock.js';
import { discoverCommand } from './cli/commands/discover.js';
import { initLogger, logger } from './logging/logger.js';
import { checkPortAvailable } from './server/port-checker.js';
import { initSupabase } from './storage/supabase.js';
import { initVault, cleanStaleTempFiles } from './storage/vault.js';
import { initGit, GitManagerImpl } from './git/manager.js';
import { initEmbedding, embeddingProvider, NullEmbeddingProvider } from './embedding/provider.js';
import { initPlugins, pluginManager } from './plugins/manager.js';
import { initMCP } from './mcp/server.js';
import { initializeShutdownHandlers } from './server/shutdown.js';
import { runScanOnce, repairFrontmatter } from './services/scanner.js';
import { processDiscoveryQueueAsync } from './services/discovery-coordinator.js';
import { loadPluginManifests } from './services/manifest-loader.js';
import type { FolderMapping } from './services/manifest-loader.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

// ─────────────────────────────────────────────────────────────────────────────
// Re-export scanner service (Phase 26)
// ─────────────────────────────────────────────────────────────────────────────

export { runScanOnce, repairFrontmatter } from './services/scanner.js';
export type { ScanResult, DiscoveryQueueItem } from './services/scanner.js';

// ─────────────────────────────────────────────────────────────────────────────
// runScanCommand — exported for unit testing
// ─────────────────────────────────────────────────────────────────────────────

export async function runScanCommand(configPath: string): Promise<void> {
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return; // process.exit() may be mocked in tests
  }

  try {
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    initEmbedding(config);
    let folderMappings: Map<string, FolderMapping> = new Map();
    try {
      logger.info('Initializing plugin manifests...');
      folderMappings = await loadPluginManifests(config);
      logger.debug(`Loaded ${folderMappings.size} folder mapping(s)`);
    } catch (err: unknown) {
      logger.error(`Failed to load plugin manifests: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with empty mappings
    }
    const scanResult = await runScanOnce(config);
    const { hashMismatches, statusMismatches, newFiles, movedFiles, deletedFiles, discoveryQueue } = scanResult;
    process.stderr.write(
      `Scan complete: ${newFiles} new file(s), ${movedFiles} moved, ${deletedFiles} missing, ` +
      `${hashMismatches} hash mismatch(es) queued for re-embed, ${statusMismatches} status mismatch(es) logged.\n`
    );

    // Fire-and-forget discovery processing for documents in plugin-claimed folders
    // Discovery runs asynchronously; scanner doesn't wait for results (PERF-02)
    void processDiscoveryQueueAsync(discoveryQueue, config).catch((err: unknown) => {
      logger.error(`Discovery queue processing failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    process.exit(0);
    return;
  } catch (err: unknown) {
    console.error(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runBackupCommand — exported for unit testing
// ─────────────────────────────────────────────────────────────────────────────

export async function runBackupCommand(configPath: string, dbOnly: boolean): Promise<void> {
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return; // process.exit() may be mocked in tests — ensure we don't continue
  }

  // Use stderr for backup output so stdout is clean for any piping
  const backupLogger = (msg: string) => process.stderr.write(msg + '\n');

  const manager = new GitManagerImpl(config.instance.vault.path, config.git, {
    databaseUrl: config.supabase.databaseUrl,
  });
  await manager.initialize(config);

  // Step 1: DB dump (always; exit 1 on failure)
  let dumpPath: string;
  try {
    dumpPath = await manager.dumpDatabase();
    backupLogger(`✓ DB backup written: ${dumpPath}`);
  } catch (err: unknown) {
    console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return; // process.exit() may be mocked in tests — ensure we don't continue
  }

  // Step 2: Git operations (skip gracefully if vault is not a git repo)
  if (!manager.isGitReady) {
    backupLogger('Git not available or vault is not a repo — skipping git operations.');
    process.exit(0);
    return; // process.exit() may be mocked in tests — ensure we don't continue
  }

  if (dbOnly) {
    // --db-only: commit backup.json only
    try {
      await manager.commitAllVaultChanges(`chore: db backup ${new Date().toISOString()}`);
      backupLogger(`✓ Committed: ${dumpPath}`);
    } catch (err: unknown) {
      backupLogger(
        `Warning: git commit failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    // Full backup: commit all vault files + tag
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const tagName = `fqc-backup-${timestamp}`;
    try {
      await manager.commitAllVaultChanges(`chore: full vault backup ${new Date().toISOString()}`);
      backupLogger(`✓ Committed all vault files`);
      await manager.tagBackup(tagName);
      backupLogger(`✓ Tagged: ${tagName}`);
    } catch (err: unknown) {
      backupLogger(
        `Warning: git operations failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI routing — only executes when run directly (not imported as a module)
// ─────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const program = new Command();

  program
    .name('fqc')
    .description('FlashQuery — local-first data management layer for AI workflows')
    .version(`${version} (Node.js ${process.version})`, '-v, --version');

  program
    .command('start')
    .description('Start the FlashQuery MCP server')
    .option('--config <path>', 'explicit config file path (overrides auto-discovery)')
    .option('--transport <type>', 'transport type: stdio or http (overrides config)', undefined)
    .action(async (options: { config?: string; transport?: string }) => {
      const configPath = resolveConfigPath(options.config);
      const transportOverride =
        options.transport === 'http'
          ? ('streamable-http' as const)
          : options.transport === 'stdio'
            ? ('stdio' as const)
            : undefined;
      try {
        const config = loadConfig(configPath);
        initLogger(config);
        logger.debug(`DNS resolution order: ipv4first (${process.env.NODE_OPTIONS})`);

        // Emit any deprecation warnings (e.g., .yaml extension, legacy top-level vault)
        const deprecationWarnings = getDeprecationWarnings(config);
        for (const warning of deprecationWarnings) {
          logger.warn(`[DEPRECATION] ${warning}`);
        }

        // Display startup banner with instance and vault configuration
        logger.info('\u2500'.repeat(50));
        logger.info('FlashQuery \u2014 Instance Configuration');
        logger.info('\u2500'.repeat(50));
        logger.info(`Instance: ${config.instance.name} (id=${config.instance.id})`);
        logger.info(`Vault:    ${config.instance.vault.path} (extensions: ${config.instance.vault.markdownExtensions.join(', ')})`);
        logger.info('\u2500'.repeat(50));

        logger.debug(`Config loaded from ${configPath}`);
        // Log proxy env vars to help diagnose network issues when spawned by a parent process
        const proxyVars = [
          'HTTP_PROXY',
          'HTTPS_PROXY',
          'NO_PROXY',
          'http_proxy',
          'https_proxy',
          'no_proxy',
        ];
        const activeProxy = proxyVars
          .filter((v) => process.env[v])
          .map((v) => `${v}=${process.env[v]}`);
        if (activeProxy.length > 0) {
          logger.debug(`Proxy env vars: ${activeProxy.join(', ')}`);
        } else {
          logger.debug('Proxy env vars: none');
        }

        // Step 2.5: Check port availability before vault/Supabase initialization (D-02, D-05b)
        // Only runs for streamable-http transport; stdio has no port
        const resolvedTransport = transportOverride ?? config.mcp.transport;
        if (resolvedTransport === 'streamable-http') {
          const port = config.mcp.port ?? 3100;
          try {
            await checkPortAvailable(port, '127.0.0.1');
            logger.info(`Port ${port} available, binding to 127.0.0.1:${port}`); // D-02d
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(message); // D-03b
            process.exit(1); // D-03c
            return; // process.exit() may be mocked in tests — ensure we don't continue
          }
        }

        await initVault(config);
        await cleanStaleTempFiles(config.instance.vault.path);
        await initSupabase(config);
        let folderMappings: Map<string, FolderMapping> = new Map();
        try {
          logger.info('Initializing plugin manifests...');
          folderMappings = await loadPluginManifests(config);
          logger.debug(`Loaded ${folderMappings.size} folder mapping(s)`);
        } catch (err: unknown) {
          logger.error(`Failed to load plugin manifests: ${err instanceof Error ? err.message : String(err)}`);
          // Continue with empty mappings
        }
        await initGit(config);
        initEmbedding(config);
        await initPlugins(config);
        const httpServer = await initMCP(config, version, transportOverride);

        // Initialize shutdown handlers (SIGINT/SIGTERM) after server is ready
        // Pass the HTTP server reference so ShutdownCoordinator can track and close active connections
        // For stdio transport, httpServer will be undefined, which is fine
        await initializeShutdownHandlers(config, httpServer);
        logger.debug('Shutdown handlers initialized');

        // DISC-01/DISC-02: non-blocking startup scan — fire-and-forget
        void runScanOnce(config).catch((err: unknown) => {
          logger.warn(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
        });

        // Ready banner — stderr (after initMCP redirects logger)
        const mcpLine =
          resolvedTransport === 'streamable-http'
            ? `streamable-http:${config.mcp.port ?? 3100}`
            : 'stdio';
        const supabaseHost = new URL(config.supabase.url).hostname;
        logger.info('\u2500'.repeat(42));
        logger.info('FlashQuery ready.');
        logger.info(`  Version:   ${version}`);
        logger.info(`  MCP:       ${mcpLine}`);
        logger.info(`  Supabase:  ${supabaseHost}`);
        const embeddingStatus = embeddingProvider instanceof NullEmbeddingProvider
          ? 'Semantic search: DISABLED'
          : `Semantic search: ENABLED (${config.embedding.provider}/${config.embedding.model})`;
        logger.info(`  ${embeddingStatus}`);
        logger.info(
          `  Git:       auto_commit=${config.git.autoCommit}, auto_push=${config.git.autoPush}`
        );
        logger.debug(`  Plugins:   ${pluginManager.getAllEntries().length} active instance(s)`);
        logger.info('\u2500'.repeat(42));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });

  program
    .command('backup')
    .description('Backup vault and database')
    .option('--config <path>', 'explicit config file path')
    .option('--db-only', 'commit DB backup only, skip full vault commit')
    .action(async (options: { config?: string; dbOnly?: boolean }) => {
      const configPath = resolveConfigPath(options.config);
      await runBackupCommand(configPath, options.dbOnly ?? false);
    });

  program
    .command('scan')
    .description('Scan vault for content hash and status mismatches')
    .option('--config <path>', 'explicit config file path')
    .action(async (options: { config?: string }) => {
      const configPath = resolveConfigPath(options.config);
      await runScanCommand(configPath);
    });

  program
    .command('doctor')
    .description('Check system health: DB, pgvector, vault, embedding, git')
    .option('--config <path>', 'explicit config file path')
    .action(async (options: { config?: string }) => {
      // Doctor implementation will be added in Plan 03
      // For now, register the command so --help shows it
      const { runDoctorCommand } = await import('./cli/doctor.js');
      const configPath = options.config;
      await runDoctorCommand(configPath);
    });

  program.addCommand(unlockCommand);
  program.addCommand(discoverCommand);

  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

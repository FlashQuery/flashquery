import * as readline from 'node:readline';
import * as path from 'node:path';
import { Command } from 'commander';
import { loadConfig, resolveConfigPath } from '../../config/loader.js';
import { initLogger, logger } from '../../logging/logger.js';
import { initSupabase, supabaseManager } from '../../storage/supabase.js';
import { initVault, vaultManager } from '../../storage/vault.js';
import { initEmbedding } from '../../embedding/provider.js';
import { loadPluginManifests } from '../../services/manifest-loader.js';
import { executeDiscovery } from '../../services/discovery-orchestrator.js';
import type { GetUserPrompt, PluginOption } from '../../services/discovery-orchestrator.js';
import type { DiscoveryQueueItem } from '../../services/scanner.js';

// ─────────────────────────────────────────────────────────────────────────────
// DiscoverOutput — structured JSON output for --json flag
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverOutput {
  total: number;
  auto_discovered: number;
  prompted: {
    assigned: number;
    pending: number;
  };
  errors: Array<{ path: string; error: string }>;
  documents: Array<{
    path: string;
    ownership: string | null;
    status: 'complete' | 'pending' | 'failed';
    error?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// createUserPrompt — interactive stdin prompt for ownership selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a getUserPrompt callback that presents a numbered list and reads stdin.
 * Only shown when ownership is ambiguous (multiple plugins claim same folder).
 * Only shows plugins with "owner" claim type (watchers auto-detect separately).
 *
 * Security: T-57-01 — selections written immediately to DB and frontmatter.
 *           T-57-03 — all selections logged at INFO level for audit trail.
 */
function createUserPrompt(): GetUserPrompt {
  return async (filePath: string, options: PluginOption[]): Promise<string> => {
    // Validate path length (T-57-05)
    if (filePath.length > 1024) {
      logger.warn(`[T-57-05] path exceeds 1024 chars, truncating for display`);
    }

    // Display context and numbered list
    process.stderr.write(`\nAmbiguous: ${filePath} — which plugin owns this?\n`);
    options.forEach((opt, i) => {
      process.stderr.write(`  ${i + 1}) ${opt.plugin_id} (${opt.folder})\n`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    const selectedPluginId = await new Promise<string>((resolve) => {
      rl.question(`Enter selection (1-${options.length}): `, (answer) => {
        rl.close();
        const idx = parseInt(answer.trim(), 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < options.length) {
          resolve(options[idx].plugin_id);
        } else {
          // Default to first option on invalid input (Risk 1 mitigation)
          logger.debug(`[OWN-04] invalid selection "${answer}", defaulting to first option`);
          resolve(options[0].plugin_id);
        }
      });
    });

    // T-57-03: Log all ownership selections for audit trail
    logger.info(`[OWN-04] ownership selection: path=${filePath}, selected=${selectedPluginId}`);
    return selectedPluginId;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// queryFlaggedDocuments — query DB for documents needing discovery
// ─────────────────────────────────────────────────────────────────────────────

async function queryFlaggedDocuments(): Promise<DiscoveryQueueItem[]> {
  const client = supabaseManager.getClient();
  const { data, error } = await client
    .from('fqc_documents')
    .select('id, path')
    .eq('needs_discovery', true);

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    fqcId: row.id as string,
    path: row.path as string,
    pluginId: '', // Will be determined by discovery orchestrator
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// queryDocumentByPath — look up a single document by vault-relative path
// ─────────────────────────────────────────────────────────────────────────────

async function queryDocumentByPath(docPath: string): Promise<DiscoveryQueueItem | null> {
  // T-57-02: Normalize path to prevent path traversal
  const normalizedPath = path.normalize(docPath).replace(/^\/+/, '');

  const client = supabaseManager.getClient();
  const { data, error } = await client
    .from('fqc_documents')
    .select('id, path')
    .eq('path', normalizedPath)
    .limit(1);

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  return {
    fqcId: data[0].id as string,
    path: data[0].path as string,
    pluginId: '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runDiscoverCommand — main discovery logic (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export async function runDiscoverCommand(
  configPath: string,
  options: {
    path?: string;
    batch?: boolean;
    json?: boolean;
  }
): Promise<void> {
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  try {
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    initEmbedding(config);

    // Load plugin manifests so folder claims are available
    try {
      const folderMappings = await loadPluginManifests(config);
      logger.debug(`Loaded ${folderMappings.size} folder mapping(s) for discovery`);
    } catch (err: unknown) {
      logger.warn(`Failed to load plugin manifests: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Determine discovery scope
    let items: DiscoveryQueueItem[];
    if (options.path) {
      // T-57-02: Validate path length and normalize
      if (options.path.length > 1024) {
        console.error('Error: --path argument exceeds maximum length (1024 chars)');
        process.exit(1);
        return;
      }
      logger.info(`Starting discovery of specific path: ${options.path}`);
      const item = await queryDocumentByPath(options.path);
      if (!item) {
        // Document not in DB yet — construct a minimal item for discovery
        const normalizedPath = path.normalize(options.path).replace(/^\/+/, '');
        logger.info(`Document not found in DB, will discover by path: ${normalizedPath}`);
        // Use a placeholder fqcId; executeDiscovery will handle path-based lookup
        items = [{
          fqcId: '',
          path: normalizedPath,
          pluginId: '',
        }];
      } else {
        items = [item];
      }
    } else {
      logger.info('Querying flagged documents (needs_discovery=true)...');
      items = await queryFlaggedDocuments();
    }

    logger.info(`Starting discovery of ${items.length} document(s)`);

    // Set up getUserPrompt callback based on batch mode
    const getUserPrompt: GetUserPrompt | undefined = options.batch
      ? undefined   // Batch mode: skip prompts, use deterministic ordering
      : createUserPrompt();

    // Track results
    const output: DiscoverOutput = {
      total: items.length,
      auto_discovered: 0,
      prompted: { assigned: 0, pending: 0 },
      errors: [],
      documents: [],
    };

    // Process each document
    for (const item of items) {
      logger.debug(`Processing: ${item.path}`);

      try {
        // Skip documents with empty fqcId (path-based lookup failed gracefully above)
        if (item.fqcId === '' && !options.path) {
          logger.warn(`Skipping document with no fqcId: ${item.path}`);
          output.documents.push({
            path: item.path,
            ownership: null,
            status: 'pending',
            error: 'No fqcId — document not indexed in DB',
          });
          output.prompted.pending++;
          continue;
        }

        const result = await executeDiscovery(item, config, vaultManager);

        const ownership = result.plugin_id
          ? `${result.plugin_id}${result.type ? `/${result.type}` : ''}`
          : null;

        // Classify result
        if (result.status === 'complete') {
          if (result.plugin_id) {
            output.auto_discovered++;
          }
          output.documents.push({
            path: item.path,
            ownership,
            status: 'complete',
          });
          logger.debug(`[DISC] complete: ${item.path} → ${ownership}`);
        } else if (result.status === 'pending') {
          output.prompted.pending++;
          output.documents.push({
            path: item.path,
            ownership,
            status: 'pending',
            error: result.errors?.[0]?.error,
          });
          logger.debug(`[DISC] pending: ${item.path}`);
        } else {
          // failed
          const errMsg = result.errors?.[0]?.error ?? 'Unknown error';
          output.errors.push({ path: item.path, error: errMsg });
          output.documents.push({
            path: item.path,
            ownership: null,
            status: 'failed',
            error: errMsg,
          });
          logger.warn(`[DISC] failed: ${item.path} — ${errMsg}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[DISC] DB error for ${item.path}: ${errMsg}`);
        // DB errors halt processing per D-06
        if (!options.json) {
          process.stderr.write(`\nFatal DB error: ${errMsg}\n`);
        }
        process.exit(1);
        return;
      }
    }

    // Output results
    if (options.json) {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    } else {
      // Human-readable summary (D-05)
      process.stderr.write(`\nDiscovery complete: ${output.total} document(s)\n`);
      if (output.auto_discovered > 0) {
        process.stderr.write(`\u2713 ${output.auto_discovered} auto-discovered via folder matching\n`);
      }
      if (output.prompted.assigned > 0 || output.prompted.pending > 0) {
        process.stderr.write(
          `\u26a0 ${output.prompted.assigned + output.prompted.pending} required user prompts ` +
          `(${output.prompted.assigned} assigned, ${output.prompted.pending} pending)\n`
        );
      }
      if (output.errors.length > 0) {
        process.stderr.write(`\u2717 ${output.errors.length} errors:\n`);
        for (const err of output.errors) {
          process.stderr.write(`  - ${err.path}: ${err.error}\n`);
        }
      }
      if (output.total === 0) {
        process.stderr.write('No documents flagged for discovery.\n');
      }
    }

    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Discovery failed: ${message}`);
    console.error(`Discovery failed: ${message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// discoverCommand — Commander.js command for `flashquery discover`
// ─────────────────────────────────────────────────────────────────────────────

export const discoverCommand = new Command('discover')
  .description('Discover and assign plugin ownership for flagged documents')
  .option('--config <path>', 'explicit config file path (overrides auto-discovery)')
  .option('--path <path>', 'discover a specific document by vault-relative path')
  .option('--batch', 'skip interactive ownership prompts; use auto-determined ownership')
  .option('--json', 'output structured JSON instead of human-readable summary')
  .action(async (options: { config?: string; path?: string; batch?: boolean; json?: boolean }) => {
    const configPath = resolveConfigPath(options.config);
    await runDiscoverCommand(configPath, {
      path: options.path,
      batch: options.batch ?? false,
      json: options.json ?? false,
    });
  });

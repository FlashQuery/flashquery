import { basename, dirname, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { Mutex } from 'async-mutex';
import matter from 'gray-matter';
import pg from 'pg';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { vaultManager } from '../storage/vault.js';
import { logger } from '../logging/logger.js';
import { listMarkdownFiles, computeHash } from '../mcp/tools/documents.js';
import { isValidUuid } from '../utils/uuid.js';
import { propagateFqcIdChange } from './plugin-propagation.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { getIsShuttingDown } from '../server/shutdown-state.js';
import { FM } from '../constants/frontmatter-fields.js';

// ─────────────────────────────────────────────────────────────────────────────
// scanMutex — DCP-03: serializes concurrent runScanOnce() calls
// ─────────────────────────────────────────────────────────────────────────────

export const scanMutex = new Mutex();

// ─────────────────────────────────────────────────────────────────────────────
// ScanResult — summary of scan pass outcomes
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanResult {
  hashMismatches: number;
  statusMismatches: number;
  newFiles: number;
  movedFiles: number;
  deletedFiles: number;
  embeddingStatus: 'complete' | 'partial' | 'timed_out' | 'skipped'; // Result of embedding drain
  embedsAwaited: number; // Number of embed promises awaited during drain
}

// ─────────────────────────────────────────────────────────────────────────────
// titleFromFilename — derives title from filename (D-03: not from H1 heading)
// ─────────────────────────────────────────────────────────────────────────────

export function titleFromFilename(relativePath: string): string {
  const name = basename(relativePath, extname(relativePath));
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// DbRow — shape of a row loaded from fqc_documents for the scanner
// ─────────────────────────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  path: string;
  content_hash: string;
  title: string;
  status: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChangeDetectionResult — result of detectChanges() function
// ─────────────────────────────────────────────────────────────────────────────

interface ChangeDetectionResult {
  changed: boolean;
  newHash: string;
  changes?: {
    content: string;
    frontmatter: Record<string, unknown>;
    modified_at: string;
    size_bytes: number;
    content_hash: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detectChanges — detect modification by comparing content hash
// ─────────────────────────────────────────────────────────────────────────────

export function detectChanges(
  dbRow: DbRow,
  fileContent: string
): ChangeDetectionResult {
  const newHash = computeHash(fileContent);

  if (newHash === dbRow.content_hash) {
    // No change — file content identical
    return { changed: false, newHash };
  }

  // Hash mismatch: file was modified
  const { data: frontmatter } = matter(fileContent);

  return {
    changed: true,
    newHash,
    changes: {
      content: fileContent,
      frontmatter: frontmatter,
      modified_at: new Date().toISOString(),
      size_bytes: Buffer.byteLength(fileContent, 'utf8'),
      content_hash: newHash,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runScanOnce — core scanning engine
//
// DISC-02: status drift logging (DB-first — logs when vault frontmatter status
//          differs from DB status)
// MAIN PASS: hash-first file identity resolution (see large comment below)
// SCAN-04: deletion tracking — marks DB rows 'missing' when not found in vault
// ─────────────────────────────────────────────────────────────────────────────

export async function runScanOnce(config: FlashQueryConfig): Promise<ScanResult> {
  const release = await scanMutex.acquire();
  try {
    // SHUT-10: Check shutdown flag immediately
    if (getIsShuttingDown()) {
      logger.info('scan: shutdown in progress, aborting');
      return { hashMismatches: 0, statusMismatches: 0, newFiles: 0, movedFiles: 0, deletedFiles: 0, embeddingStatus: 'skipped', embedsAwaited: 0 };
    }

    const { supabaseManager } = await import('../storage/supabase.js');
    const { embeddingProvider } = await import('../embedding/provider.js');
    const supabase = supabaseManager.getClient();
    const vaultRoot = config.instance.vault.path;
    const instanceId = config.instance.id;
    const now = new Date().toISOString();

  let hashMismatches = 0;
  let statusMismatches = 0;
  let newFiles = 0;
  let movedFiles = 0;
  let deletedFiles = 0;

  // ── DISC-02: status mismatch scan ────────────────────────────────────────
  // For each DB doc, read vault frontmatter and log if status has drifted.
  // This is informational only — we do not auto-correct status here.
  const { data: docStatuses, error: statusError } = await supabase
    .from('fqc_documents')
    .select('path, status')
    .eq('instance_id', instanceId);

  if (statusError) {
    logger.warn(`scan: fqc_documents status query failed: ${statusError.message}`);
  } else {
    for (const doc of docStatuses ?? []) {
      const vaultPath = doc.path as string;
      let vaultFrontmatter: Record<string, unknown>;
      try {
        const { data } = await vaultManager.readMarkdown(vaultPath);
        vaultFrontmatter = data;
      } catch {
        continue; // file missing — skip
      }
      const vaultStatus = vaultFrontmatter[FM.STATUS] as string | undefined;
      const dbStatus = doc.status as string;
      if (vaultStatus && vaultStatus !== dbStatus) {
        statusMismatches++;
        logger.info(
          `[DISC-02] status mismatch: vault=${vaultStatus}, db=${dbStatus}, path=${vaultPath}`
        );
      }
    }
  }

  // ── Load all vault files ──────────────────────────────────────────────────
  const allVaultFiles = await listMarkdownFiles(
    vaultRoot,
    config.instance.vault.markdownExtensions
  );

  // ── Load all DB rows into memory for O(1) lookup ──────────────────────────
  // We load active AND missing rows (not archived) and build two maps:
  //   hashToRow: content_hash → DbRow  (for the hash-first check)
  //   idToRow:   fqc_id       → DbRow  (for the fqc_id fallback check)
  //
  // 'missing' rows are included intentionally: IDC-01 and IDC-02 restore missing→active
  // when a previously-missing file reappears (hash or fqc_id found in these maps).
  // SCAN-04 already guards with `rowStatus === 'active'` so missing rows are never
  // re-marked missing — the SCAN-04 loop only acts on active rows.
  const { data: allDbDocs, error: dbDocsError } = await (supabase
    .from('fqc_documents')
    .select('id, path, content_hash, title, status, updated_at')
    .eq('instance_id', instanceId)
    .in('status', ['active', 'missing']) as unknown as Promise<{ data: DbRow[] | null; error: unknown }>);

  const hashToRow = new Map<string, DbRow>();
  const idToRow = new Map<string, DbRow>();
  const pathToRow = new Map<string, DbRow>(); // INF-01: path-based identity fallback map
  const duplicateIdsToArchive: string[] = []; // INF-02: collect older duplicate rows for archiving
  const archivedDuplicateIds = new Set<string>(); // INF-02: track archived IDs to exclude from SCAN-04

  if (!dbDocsError && allDbDocs) {
    for (const dbRow of allDbDocs) {
      // WR-02: Deduplicate by content_hash — keep newer row, log warning (mirrors pathToRow pattern)
      const existingByHash = hashToRow.get(dbRow.content_hash);
      if (existingByHash) {
        const existingUpdated = existingByHash.updated_at ?? '';
        const rowUpdated = dbRow.updated_at ?? '';
        if (rowUpdated > existingUpdated) {
          hashToRow.set(dbRow.content_hash, dbRow);
          logger.warn(
            `[INF-02] duplicate content_hash="${dbRow.content_hash}" in DB — keeping newer of rows id=${existingByHash.id} (older) and id=${dbRow.id} (newer)`
          );
        } else {
          logger.warn(
            `[INF-02] duplicate content_hash="${dbRow.content_hash}" in DB — keeping newer of rows id=${dbRow.id} (older) and id=${existingByHash.id} (newer)`
          );
        }
      } else {
        hashToRow.set(dbRow.content_hash, dbRow);
      }
      idToRow.set(dbRow.id, dbRow);

      // INF-01: Build pathToRow map; INF-02: handle duplicate paths by keeping newer row
      const vaultPath = dbRow.path;
      const existing = pathToRow.get(vaultPath);
      if (existing) {
        // D-10: Two DB rows share the same vault_path — keep the one with more recent updated_at
        const existingUpdated = existing.updated_at ?? '';
        const rowUpdated = dbRow.updated_at ?? '';
        if (rowUpdated > existingUpdated) {
          // Current row is newer — archive the existing (older) one
          logger.warn(
            `[INF-02] duplicate path detected: "${vaultPath}" — rows id=${existing.id} (older) and id=${dbRow.id} (newer) — archiving older`
          );
          pathToRow.set(vaultPath, dbRow);
          duplicateIdsToArchive.push(existing.id);
        } else {
          // Existing row is newer — archive the current row
          logger.warn(
            `[INF-02] duplicate path detected: "${vaultPath}" — rows id=${dbRow.id} (older) and id=${existing.id} (newer) — archiving older`
          );
          duplicateIdsToArchive.push(dbRow.id);
        }
      } else {
        pathToRow.set(vaultPath, dbRow);
      }
    }
  }

  // INF-02 / D-11: Archive all older duplicate rows synchronously before main scan pass
  // Must be synchronous (not fire-and-forget) so tests and callers see correct state immediately
  // Add to seenFqcIds so SCAN-04 does not re-mark them as 'missing' (they are 'archived', not gone)
  for (const archiveId of duplicateIdsToArchive) {
    const { error: archiveErr } = await supabase
      .from('fqc_documents')
      .update({ status: 'archived', updated_at: now })
      .eq('id', archiveId);
    if (archiveErr) {
      logger.warn(`[INF-02] failed to archive duplicate row id=${archiveId}: ${archiveErr.message}`);
    } else {
      logger.info(`[INF-02] archived older duplicate row id=${archiveId}`);
    }
    archivedDuplicateIds.add(archiveId); // Prevent SCAN-04 from overwriting 'archived' with 'missing'
  }

  // ── MAIN PASS: hash-first file identity resolution ────────────────────────
  //
  // HASH-FIRST FILE IDENTITY DECISION TREE
  // ========================================
  //
  // This pass processes every markdown file in the vault and determines its
  // identity relative to the database. Hash-first detection establishes cheaply
  // whether the file changed at all before doing fqc_id lookups.
  //
  // INVARIANT: content_hash covers the FULL file content including frontmatter.
  // Any change — to body, title, tags, fqc_id, any frontmatter field — changes
  // the hash. This means: same hash ↔ truly identical bytes. Different hash ↔
  // something changed.
  //
  // ALGORITHM:
  //
  // For each vault file at path X with content hash H and frontmatter fqc_id Y:
  //
  //   Step 1: Look up H in the DB hash index.
  //
  //     Hash FOUND (content identical to a known DB row):
  //       - If X matches the DB row's path → file unchanged, skip.
  //       - If X differs from the DB row's path → file may have moved OR been
  //         duplicated. Check if the DB row's original path still exists on disk:
  //           - Original still exists → DUPLICATE. Assign new fqc_id, write to
  //             file's frontmatter, insert a new DB row.
  //           - Original is gone → MOVE. Update DB row's path to X.
  //
  //     Hash NOT FOUND (content is new or changed):
  //       - Look up Y (fqc_id from frontmatter) in the DB id index.
  //       - Y found in DB → CONTENT CHANGED. Update hash (and path if the file
  //         also moved). Trigger fire-and-forget re-embed.
  //       - Y not found (or Y absent) → NEW FILE. Generate new fqc_id, write to
  //         file's frontmatter, insert new DB row. Trigger fire-and-forget embed.
  //
  // CORNER CASES:
  //
  //   Case 1 — Duplicate with same fqc_id (identical bytes):
  //     File A is copied to B; both have the same fqc_id AND same content.
  //     → Hash found (A's hash = B's hash, same bytes). Path differs.
  //     → Check if A still exists → YES → DUPLICATE.
  //     → B gets a new fqc_id written to its frontmatter.
  //
  //   Case 2 — Duplicate with modified fqc_id (user edited fqc_id in copy):
  //     File A copied to B; user edited B's fqc_id but not the body.
  //     → Hash NOT found (fqc_id is in frontmatter, which is part of the hash).
  //     → Y (B's edited fqc_id) not in DB → treated as NEW FILE.
  //     → B gets a freshly generated fqc_id (the user's manual edit is replaced).
  //
  //   Case 3 — File moved (same fqc_id, same content):
  //     File A moved from old/path.md to new/path.md; fqc_id unchanged.
  //     → Hash found (bytes identical). Path differs.
  //     → Check if old path still exists → NO → MOVE.
  //     → DB row path updated to new/path.md.
  //
  //   Case 4 — File moved + content changed:
  //     File A moved AND edited; fqc_id unchanged.
  //     → Hash NOT found (content changed). Y found in DB → CONTENT CHANGED.
  //     → DB row gets new hash AND new path in the same UPDATE.
  //
  //   Case 5 — fqc_id changed in file (no move, content body unchanged):
  //     User edits frontmatter to change fqc_id; rest of file is same.
  //     → Hash NOT found (fqc_id field changes the hash).
  //     → New Y not in DB → treated as NEW FILE. New fqc_id generated.
  //     → Old row orphaned → caught by SCAN-04 as missing.
  //
  //   Case 6 — fqc_id changed in file (no move, content body also changed):
  //     Same outcome as Case 5: hash not found, new Y not in DB → NEW FILE.
  //
  //   Case 7 — fqc_id removed from file:
  //     User deletes fqc_id from frontmatter.
  //     → Hash NOT found (frontmatter changed). Y is absent → NEW FILE.
  //     → New fqc_id generated and written back.
  //     → Old row orphaned → caught by SCAN-04 as missing.
  //
  // WHY HASH-FIRST:
  //   If the hash matches a DB row, we know FOR CERTAIN the file content has not
  //   changed — not a single byte. This is the fast path for stable files (the
  //   majority). Only when the hash is absent do we fall back to fqc_id lookup
  //   to understand whether this is a changed-in-place file or something brand new.

  const seenFqcIds = new Set<string>();

  // EMBED-DRAIN: Collect embed promises so force_file_scan can await them all before returning.
  // Each entry is the full promise chain (embed → DB update), so awaiting it guarantees the vector
  // is written to the DB. fire-and-forget remains the default for create_document/update_document;
  // this collection is only drained when runScanOnce is called synchronously (force_file_scan).
  const embedPromises: Promise<void>[] = [];

  for (const relativePath of allVaultFiles) {
    // SHUT-10: Check shutdown flag frequently during scanning
    if (getIsShuttingDown()) {
      logger.info(`scan: shutdown signal received, stopping scan at file ${relativePath}`);
      break;
    }

    try {
      const absolutePath = `${vaultRoot}/${relativePath}`;

      // OBS-01: Check for symlinks and skip with logging
      try {
        const stat = lstatSync(absolutePath);
        if (stat.isSymbolicLink()) {
          logger.info(`Symlink skipped during vault walk: ${relativePath}`);
          continue;
        }
      } catch {
        // If lstatSync fails, continue to normal read attempt (will be caught below)
      }

      let rawBuffer: Buffer;
      try {
        rawBuffer = await readFile(absolutePath);
      } catch (readErr: unknown) {
        // ERR-01: dispatch on error.code — ENOENT vs transient errors
        const err = readErr instanceof Error ? readErr : new Error(String(readErr));
        const errorCode = (err as NodeJS.ErrnoException).code;

        if (errorCode === 'ENOENT') {
          // File is genuinely gone — SCAN-04 will verify via existsSync later
          logger.debug(`[READ_ERROR] ENOENT reading "${relativePath}" — file not found, will verify in SCAN-04`);
          continue;
        } else {
          // Transient/permission error (EACCES, EPERM, EIO, etc.) — protect DB row from false deletion
          logger.warn(`[READ_ERROR] ${errorCode} reading "${absolutePath}": ${err.message} — skipping, will retry next scan`);
          const dbRow = pathToRow.get(relativePath);
          if (dbRow) {
            seenFqcIds.add(dbRow.id);
          }
          continue;
        }
      }

      // ERR-02: Binary file detection — check first 8KB of raw bytes for null byte (0x00)
      // WR-01: Must be done on Buffer before UTF-8 decode — decoding can corrupt null byte positions
      if (rawBuffer.subarray(0, 8 * 1024).includes(0)) {
        logger.warn(`[BINARY_SKIP] "${relativePath}" contains null bytes in first 8KB — skipping`);
        const dbRow = pathToRow.get(relativePath);
        if (dbRow) {
          seenFqcIds.add(dbRow.id);
        }
        continue; // Skip matter() parse and all DB operations
      }

      const rawContent = rawBuffer.toString('utf-8');
      const H = computeHash(rawContent);

      // ERR-04: Try-catch around matter() to handle malformed YAML frontmatter
      let frontmatter: Record<string, unknown>;
      let content: string;

      try {
        // Attempt normal YAML parse via matter()
        const parsed = matter(rawContent);
        frontmatter = parsed.data;
        content = parsed.content;
      } catch (yamlErr: unknown) {
        // YAML parse failed — attempt regex recovery of fqc_id
        const err = yamlErr instanceof Error ? yamlErr : new Error(String(yamlErr));
        logger.warn(`[YAML_PARSE_ERROR] "${relativePath}": ${err.message} — attempting regex recovery`);

        // Extract fqc_id from first 1KB of file (frontmatter block) — T-38-05: limit scope
        const frontmatterBlock = rawContent.slice(0, 1024);
        const match = frontmatterBlock.match(new RegExp(`\\b${FM.ID}:\\s*([^\\s\\n]+)`));

        let recoveredFqcId: string | undefined;
        if (match && match[1]) {
          recoveredFqcId = match[1];
          if (isValidUuid(recoveredFqcId)) {
            // T-38-04: Only use recovered value after UUID validation
            logger.info(`[YAML_PARSE_ERROR] recovered valid fqc_id="${recoveredFqcId}" via regex`);
          } else {
            logger.warn(`[YAML_PARSE_ERROR] regex matched "${match[1]}" but failed isValidUuid validation`);
            recoveredFqcId = undefined;
          }
        }

        // Continue with empty frontmatter and regex-recovered fqc_id (may be undefined)
        frontmatter = {
          [FM.ID]: recoveredFqcId,
        };
        content = '';
      }

      const rawY = typeof frontmatter[FM.ID] === 'string' && (frontmatter[FM.ID] as string).length > 0
        ? (frontmatter[FM.ID] as string)
        : undefined;

      // INF-03, IDC-05: Validate UUID format — malformed values treated as absent with warning
      let Y: string | undefined;
      if (rawY !== undefined) {
        if (isValidUuid(rawY)) {
          Y = rawY;
        } else {
          // D-09: Log warning with original malformed value
          logger.warn(
            `[IDC-05] malformed fqc_id="${rawY}" in "${relativePath}" — treating as absent, will attempt path fallback`
          );
          Y = undefined; // fall through to path-based fallback or new UUID generation
        }
      }

      const title =
        (typeof frontmatter[FM.TITLE] === 'string' && (frontmatter[FM.TITLE] as string)) ||
        titleFromFilename(relativePath);

      const fqcOwner = typeof frontmatter[FM.OWNER] === 'string' ? (frontmatter[FM.OWNER] as string) : null;
      const fqcType = typeof frontmatter[FM.TYPE] === 'string' ? (frontmatter[FM.TYPE] as string) : null;

      const dbRowByHash = hashToRow.get(H);

      if (dbRowByHash) {
        // ── Hash found: content is identical to a known DB row ──────────────

        // IDC-03: Log at error level (not warn) if fqc_id in file doesn't match DB for this hash
        if (Y && Y !== dbRowByHash.id) {
          logger.error(
            `[SCAN-01] fqc_id mismatch: file "${relativePath}" has fqc_id=${Y} but DB row for same hash has id=${dbRowByHash.id}`
          );
        }

        if (relativePath === dbRowByHash.path) {
          // IDC-01: Restore missing → active for unchanged file that reappeared
          if (dbRowByHash.status === 'missing') {
            await supabase.from('fqc_documents')
              .update({ status: 'active', updated_at: now })
              .eq('id', dbRowByHash.id);
            logger.info(`[IDC-01] restored missing -> active: "${relativePath}" (fqc_id=${dbRowByHash.id})`);
          }
          // File completely unchanged — track and skip
          seenFqcIds.add(dbRowByHash.id);
          logger.debug(`scan: file unchanged: ${relativePath} (fqc_id=${dbRowByHash.id})`);
          continue;
        }

        // Path differs — check whether original path still exists
        const originalAbsPath = `${vaultRoot}/${dbRowByHash.path}`;
        const originalStillExists = existsSync(originalAbsPath);

        if (originalStillExists) {
          // DUPLICATE: original still at old path, this is a copy at a new path
          // TSA-01: No vault write — deferred to targeted pre-scan
          // TSA-02: Flag for pre-scan to handle frontmatter
          const oldFqcId = dbRowByHash.id;
          const newFqcId = uuidv4();
          await supabase.from('fqc_documents').insert({
            id: newFqcId,
            instance_id: instanceId,
            path: relativePath,
            title,
            status: (frontmatter[FM.STATUS] as string) || 'active',
            content_hash: H,  // pre-write hash (file as-is on disk)
            created_at: (frontmatter[FM.CREATED] as string) || now,
            updated_at: now,
            needs_frontmatter_repair: true,
            ownership_plugin_id: fqcOwner,
            ownership_type: fqcType,
          });
          seenFqcIds.add(newFqcId);
          newFiles++;
          logger.info(
            `[SCAN-01] duplicate detected: "${dbRowByHash.path}" copied to "${relativePath}" — assigning new fqc_id=${newFqcId}`
          );

          // PLG-03: Propagate old fqc_id change for duplicate detection
          // When a file is duplicated, update plugin table references that pointed to oldFqcId
          try {
            logger.debug(
              `[PLG-03] DUPLICATE branch: propagating fqc_id change from ${oldFqcId} to ${newFqcId}`
            );
            await propagateFqcIdChange(
              supabase,
              oldFqcId,  // The original ID that was duplicated
              newFqcId,  // Newly generated UUID for the duplicate
              relativePath,
              pathToRow,
              logger,
              config.supabase.databaseUrl
            );
          } catch (propError) {
            logger.warn(
              `[PLG-03] Failed to propagate fqc_id during duplicate detection: ${
                propError instanceof Error ? propError.message : String(propError)
              }`
            );
          }

          // Collect embed promise for the duplicate (drained by force_file_scan before returning)
          embedPromises.push(
            embeddingProvider
              .embed(`${title}\n\n${content}`)
              .then((vector) =>
                supabase
                  .from('fqc_documents')
                  .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                  .eq('id', newFqcId)
                  .then(() => undefined)
              )
              .catch((err: unknown) => {
                logger.warn(
                  `[SCAN-EMBED] background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
                );
              })
          );
        } else {
          // MOVE: original path is gone, file relocated to new path
          // OBS-03: Add path-comparison annotation to determine move type (rename vs directory move)
          const oldPath = dbRowByHash.path;
          const newPath = relativePath;
          const sameDirectory = dirname(oldPath) === dirname(newPath);
          const moveType = sameDirectory ? 'rename in same directory' : 'directory changed';

          await supabase
            .from('fqc_documents')
            .update({
              path: relativePath,
              updated_at: now,
              status: dbRowByHash.status === 'missing' ? 'active' : dbRowByHash.status,
            })
            .eq('id', dbRowByHash.id);
          seenFqcIds.add(dbRowByHash.id);
          movedFiles++;

          // OBS-03: Enhanced logging with move type annotation
          logger.info(
            `Document moved: ${oldPath} → ${newPath} (${moveType})`
          );

          // PLG-03: Propagate fqc_id change (MOVED branch)
          // In MOVED, fqc_id stays the same (content unchanged, path changed)
          // Propagation is a no-op when oldFqcId === newFqcId, but call for consistency
          try {
            logger.debug(
              `[PLG-03] MOVED branch: propagating fqc_id (same ID before/after): fqc_id=${dbRowByHash.id}`
            );
            await propagateFqcIdChange(
              supabase,
              dbRowByHash.id,  // oldFqcId — same as moving file's fqc_id
              dbRowByHash.id,  // newFqcId — path changed, but ID unchanged
              newPath,
              pathToRow,
              logger,
              config.supabase.databaseUrl
            );
          } catch (propError) {
            logger.warn(
              `[PLG-03] Failed to propagate fqc_id in MOVED branch: ${
                propError instanceof Error ? propError.message : String(propError)
              }`
            );
          }
        }
      } else {
        // ── Hash not found: content is new or has changed ───────────────────

        const dbRowById = Y ? idToRow.get(Y) : undefined;

        if (dbRowById) {
          // CONTENT CHANGED: known file (by fqc_id), new content
          const updates: Record<string, unknown> = {
            content_hash: H,
            updated_at: now,
            ownership_plugin_id: fqcOwner,
            ownership_type: fqcType,
          };
          if (dbRowById.path !== relativePath) {
            const originalAbsPath = `${vaultRoot}/${dbRowById.path}`;
            if (existsSync(originalAbsPath)) {
              // DCP-01: DUPLICATE in CONTENT CHANGED — original still exists, this is a copy
              // with same fqc_id but different content. Reassign a new UUID to the copy.
              // TSA-01: No vault write — deferred to targeted pre-scan
              // TSA-02: Flag for pre-scan to handle frontmatter
              logger.warn(`[DCP-01] duplicate fqc_id in CONTENT CHANGED: "${relativePath}" has fqc_id=${Y} but "${dbRowById.path}" still exists — reassigning new UUID to copy`);
              const newFqcId = uuidv4();
              await supabase.from('fqc_documents').insert({
                id: newFqcId,
                instance_id: instanceId,
                path: relativePath,
                title,
                status: (frontmatter[FM.STATUS] as string) || 'active',
                content_hash: H,  // pre-write hash (file as-is on disk)
                created_at: (frontmatter[FM.CREATED] as string) || now,
                updated_at: now,
                needs_frontmatter_repair: true,
                ownership_plugin_id: fqcOwner,
                ownership_type: fqcType,
              });
              seenFqcIds.add(newFqcId);
              newFiles++;
              // Collect embed promise for the duplicate (drained by force_file_scan before returning)
              embedPromises.push(
                embeddingProvider
                  .embed(`${title}\n\n${content}`)
                  .then((vector) =>
                    supabase
                      .from('fqc_documents')
                      .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                      .eq('id', newFqcId)
                      .then(() => undefined)
                  )
                  .catch((err: unknown) => {
                    logger.warn(`[SCAN-EMBED] background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
                  })
              );
              continue; // CRITICAL: skip the normal CONTENT CHANGED update (Pitfall 4)
            } else {
              // MOVE: safe to update path (original is gone)
              updates.path = relativePath;
            }
          }
          // IDC-02: Restore missing → active for modified file that reappeared
          if (dbRowById.status === 'missing') {
            updates.status = 'active';
            logger.info(`[IDC-02] restored missing -> active: "${relativePath}" (fqc_id=${Y})`);
          }
          await supabase
            .from('fqc_documents')
            .update(updates)
            .eq('id', Y);
          seenFqcIds.add(Y as string);
          hashMismatches++;
          logger.info(
            `[SCAN-02] content changed: "${relativePath}" (fqc_id=${Y}) — hash updated`
          );

          // PLG-03: Propagate fqc_id change if needed (CONTENT CHANGED branch)
          // In CONTENT CHANGED, oldFqcId === newFqcId (content changed but identity same)
          // Propagation is a no-op when IDs match, but call for consistency
          try {
            logger.debug(
              `[PLG-03] CONTENT CHANGED branch: propagating fqc_id (same ID before/after): fqc_id=${Y}`
            );
            await propagateFqcIdChange(
              supabase,
              Y as string,  // oldFqcId — same as file's fqc_id
              Y as string,  // newFqcId — content changed, but ID unchanged
              relativePath,
              pathToRow,
              logger,
              config.supabase.databaseUrl
            );
          } catch (propError) {
            logger.warn(
              `[PLG-03] Failed to propagate fqc_id in CONTENT CHANGED branch: ${
                propError instanceof Error ? propError.message : String(propError)
              }`
            );
          }

          // Collect re-embed promise (drained by force_file_scan before returning)
          embedPromises.push(
            embeddingProvider
              .embed(`${title}\n\n${content}`)
              .then((vector) =>
                supabase
                  .from('fqc_documents')
                  .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                  .eq('id', Y as string)
                  .then(() => undefined)
              )
              .catch((err: unknown) => {
                logger.warn(
                  `[SCAN-EMBED] re-embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
                );
              })
          );
        } else {
          // ── NEW FILE or path-based fallback branch ──────────────────────────
          //
          // Priority order (Phase 37 identity chain tiers 2-4):
          //   Tier 2b: Valid Y not in idToRow → could be foreign UUID (IDC-04)
          //   Tier 3:  Path-based fallback (INF-04) — reconnect via pathToRow
          //   Tier 4:  Generate new UUID

          // Tier 2b: IDC-04 — Foreign UUID adoption
          // Y is only non-undefined when isValidUuid(rawY) already passed (line 281)
          // UUID validation already occurred above — only uniqueness check needed here
          if (Y !== undefined && !idToRow.has(Y)) {
            // D-01: Insert new DB row with file's existing foreign UUID, no frontmatter rewrite
            await supabase.from('fqc_documents').insert({
              id: Y,
              instance_id: instanceId,
              path: relativePath,
              title,
              status: (frontmatter[FM.STATUS] as string) || 'active',
              content_hash: H,
              created_at: (frontmatter[FM.CREATED] as string) || now,
              updated_at: now,
              ownership_plugin_id: fqcOwner,
              ownership_type: fqcType,
            });
            seenFqcIds.add(Y);
            newFiles++;
            logger.info(`[IDC-04] adopted foreign UUID: "${relativePath}" (fqc_id=${Y})`);

            // Collect embed promise (drained by force_file_scan before returning)
            embedPromises.push(
              embeddingProvider
                .embed(`${title}\n\n${content}`)
                .then((vector) =>
                  supabase
                    .from('fqc_documents')
                    .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                    .eq('id', Y)
                    .then(() => undefined)
                )
                .catch((err: unknown) => {
                  logger.warn(
                    `[SCAN-EMBED] background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
                  );
                })
            );
            continue;
          }

          // Tier 3: INF-04 — Path-based fallback
          // hash miss + fqc_id miss (or absent/malformed) → check pathToRow map
          const dbRowByPath = pathToRow.get(relativePath);
          if (dbRowByPath) {
            // Reconnect: update DB row's hash + write existing fqc_id back to frontmatter
            // TSA-01: No vault write — deferred to targeted pre-scan
            // TSA-02: Flag for pre-scan to handle frontmatter
            const reconnectedId = dbRowByPath.id;
            await supabase
              .from('fqc_documents')
              .update({
                content_hash: H,  // pre-write hash (file as-is on disk)
                updated_at: now,
                status: (frontmatter[FM.STATUS] as string) || dbRowByPath.status,
                needs_frontmatter_repair: true,
                ownership_plugin_id: fqcOwner,
                ownership_type: fqcType,
              })
              .eq('id', reconnectedId);
            seenFqcIds.add(reconnectedId);
            hashMismatches++;
            logger.info(
              `[INF-04] path-based reconnect: "${relativePath}" reconnected to fqc_id=${reconnectedId}`
            );

            // Collect re-embed promise (drained by force_file_scan before returning)
            embedPromises.push(
              embeddingProvider
                .embed(`${title}\n\n${content}`)
                .then((vector) =>
                  supabase
                    .from('fqc_documents')
                    .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                    .eq('id', reconnectedId)
                    .then(() => undefined)
                )
                .catch((err: unknown) => {
                  logger.warn(
                    `[SCAN-EMBED] re-embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
                  );
                })
            );
            continue;
          }

          // Tier 4: Generate new UUID — truly new file with no identity in DB
          // TSA-01: No vault write — deferred to targeted pre-scan
          // TSA-02: Flag for pre-scan to handle frontmatter
          const newFqcId = uuidv4();
          await supabase.from('fqc_documents').insert({
            id: newFqcId,
            instance_id: instanceId,
            path: relativePath,
            title,
            status: (frontmatter[FM.STATUS] as string) || 'active',
            content_hash: H,  // pre-write hash (file as-is on disk)
            created_at: (frontmatter[FM.CREATED] as string) || now,
            updated_at: now,
            needs_frontmatter_repair: true,
            ownership_plugin_id: fqcOwner,
            ownership_type: fqcType,
          });
          seenFqcIds.add(newFqcId);
          newFiles++;
          logger.info(`[SCAN-01] discovered new file: "${relativePath}" (fqc_id=${newFqcId})`);

          // Collect embed promise (drained by force_file_scan before returning)
          embedPromises.push(
            embeddingProvider
              .embed(`${title}\n\n${content}`)
              .then((vector) =>
                supabase
                  .from('fqc_documents')
                  .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                  .eq('id', newFqcId)
                  .then(() => undefined)
              )
              .catch((err: unknown) => {
                logger.warn(
                  `[SCAN-EMBED] background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
                );
              })
          );
        }
      }
    } catch (err) {
      logger.warn(
        `scan: error processing file ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── SCAN-04: deletion tracking ────────────────────────────────────────────
  // Any DB row (active) whose fqc_id was not encountered during the main pass
  // means the file has gone missing from the vault.
  if (!dbDocsError && allDbDocs) {
    for (const row of allDbDocs) {
      const fqcId = row.id;
      const rowPath = row.path;
      const rowStatus = row.status;

      if (!seenFqcIds.has(fqcId) && !archivedDuplicateIds.has(fqcId) && rowStatus === 'active') {
        // ERR-05: Verify file is genuinely gone before marking missing
        const absolutePath = `${vaultRoot}/${rowPath}`;
        const fileExists = existsSync(absolutePath);

        logger.debug(`[SCAN-04] verifying file missing: "${rowPath}" — existsSync=${fileExists}`);

        if (!fileExists) {
          // OBS-02: Query plugin tables to count references before marking missing
          let totalRefCount = 0;
          try {
            const databaseUrl = process.env.DATABASE_URL;
            if (databaseUrl) {
              const pgClient = createPgClientIPv4(databaseUrl);
              await pgClient.connect();
              try {
                // Discover all plugin tables with fqc_id column
                const tablesResult = await pgClient.query<{ table_name: string }>(`
                  SELECT DISTINCT table_name
                  FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name LIKE 'fqcp_%'
                    AND column_name = 'fqc_id'
                  ORDER BY table_name
                `);

                // Count references in each table
                for (const tableRow of tablesResult.rows) {
                  const tableName = tableRow.table_name;
                  const countResult = await pgClient.query<{ count: string }>(
                    `SELECT COUNT(*) as count FROM ${pg.escapeIdentifier(tableName)} WHERE fqc_id = $1`,
                    [fqcId]
                  );
                  if (countResult.rows.length > 0) {
                    const count = parseInt(countResult.rows[0].count, 10);
                    totalRefCount += count;
                  }
                }
              } finally {
                await pgClient.end();
              }
            }
          } catch (err) {
            // Fail-safe: if plugin ref query fails, log it but continue with marking missing
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.debug(`[SCAN-04] plugin ref count query failed: ${errMsg}`);
          }

          // Log plugin reference count (OBS-02)
          if (totalRefCount > 0) {
            logger.warn(
              `[SCAN-04] Document ${fqcId} marked missing with ${totalRefCount} plugin references still pointing to it`
            );
          } else {
            logger.debug(
              `[SCAN-04] Document ${fqcId} marked missing with no plugin references`
            );
          }

          // File is truly gone — safe to mark missing
          await supabase
            .from('fqc_documents')
            .update({ status: 'missing', updated_at: now })
            .eq('id', fqcId);

          deletedFiles++;
          logger.info(
            `[SCAN-04] file missing from vault: "${rowPath}" (fqc_id=${fqcId}) — marking as missing`
          );

        } else {
          // File still exists but not in seenFqcIds — likely skipped due to read/parse error
          logger.debug(`[SCAN-04] file exists but was skipped: "${rowPath}" (fqc_id=${fqcId}) — will retry next scan`);
        }
      }
    }
  }

  // TSA-02: Repair frontmatter for all flagged files after scan completes
  // Must happen INSIDE the function so tests get synchronized results
  try {
    await repairFrontmatter(config);
  } catch (repairErr: unknown) {
    logger.warn(
      `scan: frontmatter repair phase failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`
    );
  }

  // ── EMBED-DRAIN: await all in-flight embed promises before returning ─────────
  //
  // Phase 1: The scan loop already collected embed promises for every file it
  // processed (new, changed, duplicate, reconnect). These cover scanner-triggered
  // embeds only.
  //
  // Phase 2: create_document and update_document fire their own background embeds
  // that the scanner has no reference to. We detect those by querying the DB for
  // active documents whose embedding column is still NULL and spawning fresh embed
  // calls for them. This ensures force_file_scan is a true synchronization point.
  //
  // Both phases use Promise.allSettled so individual embed failures never abort
  // the drain. A 30s hard timeout prevents indefinite blocking on API outages.

  try {
    // Phase 2: find docs with NULL embedding (from create_document background embeds)
    const { data: unembeddedDocs, error: unembeddedErr } = await supabase
      .from('fqc_documents')
      .select('id, path, title')
      .eq('instance_id', instanceId)
      .eq('status', 'active')
      .is('embedding', null);

    if (unembeddedErr) {
      logger.warn(`[EMBED-DRAIN] failed to query unembedded docs: ${unembeddedErr.message}`);
    } else if (unembeddedDocs && unembeddedDocs.length > 0) {
      logger.info(`[EMBED-DRAIN] found ${unembeddedDocs.length} doc(s) with no embedding — draining`);
      for (const doc of unembeddedDocs) {
        const docId = doc.id as string;
        const docPath = doc.path as string;
        const docTitle = (doc.title as string) || titleFromFilename(docPath);

        // Read the file content for embedding text
        let embedText = docTitle;
        try {
          const raw = await readFile(`${vaultRoot}/${docPath}`, 'utf-8');
          const { content: body } = matter(raw);
          embedText = `${docTitle}\n\n${body}`;
        } catch {
          // File unreadable — embed title only (better than nothing)
          logger.debug(`[EMBED-DRAIN] could not read "${docPath}" for embed text — using title only`);
        }

        embedPromises.push(
          embeddingProvider
            .embed(embedText)
            .then((vector) =>
              supabase
                .from('fqc_documents')
                .update({ embedding: JSON.stringify(vector) })
                .eq('id', docId)
                .then(() => undefined)
            )
            .catch((err: unknown) => {
              logger.warn(
                `[EMBED-DRAIN] embed failed for "${docPath}": ${err instanceof Error ? err.message : String(err)}`
              );
            })
        );
      }
    }
  } catch (drainQueryErr: unknown) {
    logger.warn(
      `[EMBED-DRAIN] unembedded-doc query threw: ${drainQueryErr instanceof Error ? drainQueryErr.message : String(drainQueryErr)}`
    );
  }

  // Await all embed promises with a 30s timeout
  const EMBED_DRAIN_TIMEOUT_MS = 30_000;
  const embedsAwaited = embedPromises.length;
  let embeddingStatus: ScanResult['embeddingStatus'] = 'skipped';

  if (embedsAwaited > 0) {
    logger.info(`[EMBED-DRAIN] awaiting ${embedsAwaited} embed promise(s) (timeout=${EMBED_DRAIN_TIMEOUT_MS}ms)`);

    let timedOut = false;
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, EMBED_DRAIN_TIMEOUT_MS);
    });

    await Promise.race([
      Promise.allSettled(embedPromises).then(() => undefined),
      timeoutPromise,
    ]);

    if (timedOut) {
      logger.warn(`[EMBED-DRAIN] timed out after ${EMBED_DRAIN_TIMEOUT_MS}ms — some embeds may still be in-flight`);
      embeddingStatus = 'timed_out';
    } else {
      // Check if any settled as rejected (errors are caught inside each promise,
      // so allSettled always sees 'fulfilled' — failures are logged, not thrown)
      embeddingStatus = 'complete';
      logger.info(`[EMBED-DRAIN] all ${embedsAwaited} embed promise(s) settled`);
    }
  } else {
    embeddingStatus = 'complete'; // Nothing to drain — all docs already have embeddings
  }

  return {
    hashMismatches,
    statusMismatches,
    newFiles,
    movedFiles,
    deletedFiles,
    embeddingStatus,
    embedsAwaited,
  };
  } finally {
    release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// repairFrontmatter — separate function to write frontmatter for flagged files
//
// TSA-02: Write frontmatter for all files marked with needs_frontmatter_repair
// This ensures new/duplicate/reconnected files have proper fqc_id in vault
// CRITICAL: This runs AFTER runScanOnce, outside the mutex lock.
// ─────────────────────────────────────────────────────────────────────────────

export async function repairFrontmatter(config: FlashQueryConfig): Promise<void> {
  const { supabaseManager } = await import('../storage/supabase.js');
  const supabase = supabaseManager.getClient();
  const vaultRoot = config.instance.vault.path;
  const instanceId = config.instance.id;

  try {
    const { data: repairFiles } = await supabase
      .from('fqc_documents')
      .select('id, path, content_hash, created_at, status')
      .eq('instance_id', instanceId)
      .eq('needs_frontmatter_repair', true);

    if (repairFiles && repairFiles.length > 0) {
      for (const row of repairFiles) {
        const filePath = row.path as string;
        const fqcId = row.id as string;
        const createdAt = (row.created_at as string) || new Date().toISOString();
        const status = (row.status as string) || 'active';

        try {
          // Read file to extract existing content and frontmatter
          let fileContent = '';
          let existingFrontmatter: Record<string, unknown> = {};
          try {
            const raw = await readFile(`${vaultRoot}/${filePath}`, 'utf-8');
            const parsed = matter(raw);
            fileContent = parsed.content;
            existingFrontmatter = parsed.data;
          } catch {
            // If file is unreadable, write empty body with frontmatter
            fileContent = '';
          }

          // Merge FQC identity fields into existing frontmatter — user-defined fields survive
          const frontmatter = {
            ...existingFrontmatter,
            [FM.ID]:       fqcId,
            [FM.TITLE]:    (existingFrontmatter[FM.TITLE] as string | undefined) ?? titleFromFilename(filePath),
            [FM.CREATED]:  createdAt,
            [FM.STATUS]:   status,
            [FM.INSTANCE]: instanceId,
          };

          await vaultManager.writeMarkdown(filePath, frontmatter, fileContent);

          // Compute and store new content_hash after frontmatter is written
          const updatedRaw = await readFile(`${vaultRoot}/${filePath}`, 'utf-8');
          const updatedHash = computeHash(updatedRaw);

          // Mark as repaired and update content_hash to match the file with frontmatter
          await supabase
            .from('fqc_documents')
            .update({
              needs_frontmatter_repair: false,
              content_hash: updatedHash,
              updated_at: new Date().toISOString(),
            })
            .eq('id', fqcId);

          logger.debug(`[TSA-02] frontmatter repaired: "${filePath}" (fqc_id=${fqcId}) — hash updated to ${updatedHash}`);
        } catch (writeErr: unknown) {
          // WR-02: Log write error with [WRITE_ERROR] tag to distinguish from other scanner errors
          const err = writeErr instanceof Error ? writeErr : new Error(String(writeErr));
          logger.warn(
            `[WRITE_ERROR] frontmatter repair failed for "${filePath}": ${err.message}`
          );
          // WR-03: Delete the DB row to prevent orphaned records when write fails
          // The file still exists unchanged (without frontmatter), so the DB row should not exist
          const { error: deleteError } = await supabase
            .from('fqc_documents')
            .delete()
            .eq('id', fqcId);

          if (deleteError) {
            logger.warn(
              `[WRITE_ERROR] failed to delete orphaned row for "${filePath}" after write failure: ${deleteError.message}`
            );
          }
        }
      }
    }
  } catch (err) {
    logger.warn(
      `[TSA-02] frontmatter repair phase failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

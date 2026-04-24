/**
 * Shared path validation utilities for vault filesystem operations
 * Used by create_directory, list_vault, and remove_directory
 *
 * Pattern (Phase 91):
 * - resolve+relative traversal check (standard Node.js safe path confinement)
 * - lstat-based symlink detection on existing path segments
 * - sanitizeDirectorySegment extends vault.ts sanitizeFolderName without modifying it
 */

import { join, resolve, relative } from 'node:path';
import { lstat } from 'node:fs/promises';

export interface PathValidationResult {
  valid: boolean;
  absPath: string; // Fully resolved absolute path
  relativePath: string; // Vault-relative path (no leading slash)
  error?: string; // Human-readable error message if invalid
}

/**
 * Validate a user-supplied path to ensure it stays within the vault root.
 * Checks for path traversal, symlinks on existing segments, and vault-root targeting.
 *
 * @param vaultRoot - The absolute path to the vault root directory
 * @param userPath  - The user-supplied relative path (may contain slashes)
 * @returns PathValidationResult — valid=true if safe, valid=false with error message otherwise
 *
 * @example
 * await validateVaultPath('/vault', 'Projects/CRM') → { valid: true, absPath: '/vault/Projects/CRM', relativePath: 'Projects/CRM' }
 * await validateVaultPath('/vault', '../etc')        → { valid: false, error: 'Path traversal...' }
 */
export async function validateVaultPath(
  vaultRoot: string,
  userPath: string,
): Promise<PathValidationResult> {
  const normalized = normalizePath(userPath);

  const resolvedVault = resolve(vaultRoot);
  const resolvedAbs = resolve(join(vaultRoot, normalized));

  // Reject vault root itself (empty string, '.', '/' all normalize to '')
  if (resolvedAbs === resolvedVault) {
    return {
      valid: false,
      absPath: resolvedAbs,
      relativePath: normalized,
      error: 'Path cannot target the vault root itself.',
    };
  }

  // Reject path traversal
  const rel = relative(resolvedVault, resolvedAbs);
  if (rel.startsWith('..') || rel === '..') {
    return {
      valid: false,
      absPath: resolvedAbs,
      relativePath: normalized,
      error: 'Path traversal detected — path must be within the vault root.',
    };
  }

  // Check total path length (4096-byte limit)
  if (Buffer.byteLength(normalized, 'utf8') > 4096) {
    return {
      valid: false,
      absPath: resolvedAbs,
      relativePath: normalized,
      error: 'Path is too long — exceeds 4096-byte limit.',
    };
  }

  // Walk each segment of the normalized path, check existing segments for symlinks
  const segments = normalized.split('/');
  let currentPath = resolvedVault;
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      const stat = await lstat(currentPath);
      if (stat.isSymbolicLink()) {
        return {
          valid: false,
          absPath: resolvedAbs,
          relativePath: normalized,
          error: `Path contains a symlink at '${segment}' — symlinks are not permitted.`,
        };
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT means the segment doesn't exist yet — skip it
      // ENAMETOOLONG means the combined absolute path is too long for the OS to stat
      if (code !== 'ENOENT' && code !== 'ENAMETOOLONG') {
        throw err;
      }
    }
  }

  return {
    valid: true,
    absPath: resolvedAbs,
    relativePath: normalized,
  };
}

/**
 * Normalize a user-supplied path by stripping leading/trailing slashes
 * and collapsing consecutive slashes.
 *
 * @example
 * normalizePath('/CRM')        → 'CRM'
 * normalizePath('CRM/')        → 'CRM'
 * normalizePath('CRM//Contacts') → 'CRM/Contacts'
 */
export function normalizePath(userPath: string): string {
  return userPath
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/\/+/g, '/');
}

/**
 * Join a root path and a child path, normalizing both before joining.
 *
 * @example
 * joinWithRoot('Projects', 'CRM')    → 'Projects/CRM'
 * joinWithRoot('/Projects/', '/CRM/') → 'Projects/CRM'
 */
export function joinWithRoot(rootPath: string, childPath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedChild = normalizePath(childPath);
  if (!normalizedRoot) return normalizedChild;
  if (!normalizedChild) return normalizedRoot;
  return `${normalizedRoot}/${normalizedChild}`;
}

/**
 * Sanitize a single directory segment for use in a filesystem path.
 * Extends vault.ts sanitizeFolderName by adding NUL bytes, control chars (0x01-0x1f),
 * and double quotes to the replacement set. Returns metadata about what was changed.
 *
 * Does NOT import from vault.ts — logic re-implemented inline per D-04.
 *
 * @example
 * sanitizeDirectorySegment('Work:Projects') → { sanitized: 'Work Projects', changed: true, replacedChars: [':'] }
 * sanitizeDirectorySegment('CleanName')     → { sanitized: 'CleanName', changed: false, replacedChars: [] }
 */
export function sanitizeDirectorySegment(name: string): {
  sanitized: string;
  changed: boolean;
  replacedChars: string[];
} {
  const replacedChars: string[] = [];
  const seen = new Set<string>();

  // eslint-disable-next-line no-control-regex -- intentionally matches NUL and ASCII control chars 1-31
  const illegalCharsRe = /[:/\\?*|<>"'\0\x01-\x1f]/g;
  const sanitized = name
    .replace(illegalCharsRe, (ch) => {
      if (!seen.has(ch)) {
        seen.add(ch);
        replacedChars.push(ch);
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  return {
    sanitized,
    changed: sanitized !== name,
    replacedChars,
  };
}

/**
 * Validate a single path segment for use in a filesystem path.
 * Returns null if valid, or an error message string if invalid.
 *
 * Checks:
 * - Empty or whitespace-only segments are rejected
 * - Byte length must not exceed 255 (UTF-8 bytes, not character count)
 *
 * @example
 * validateSegment('CRM', 0)          → null (valid)
 * validateSegment('   ', 0)          → 'Path segment at position 0 is empty or whitespace-only.'
 * validateSegment('a'.repeat(256), 0) → 'Path segment "aaa..." exceeds 255-byte limit.'
 */
export function validateSegment(segment: string, index: number): string | null {
  if (segment.trim() === '') {
    return `Path segment at position ${index} is empty or whitespace-only.`;
  }
  if (Buffer.byteLength(segment, 'utf8') > 255) {
    return `Path segment "${segment.slice(0, 20)}..." exceeds 255-byte limit.`;
  }
  return null;
}

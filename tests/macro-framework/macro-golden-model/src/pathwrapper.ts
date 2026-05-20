// Vault-jail wrapper for shell-verb path arguments (per OQ #25, 2026-05-12).
//
// Inside a macro, the vault IS the filesystem. `/` means vault root, not host
// root. `ls /` lists the vault's top level. `cat /Notes/scratch.md` reads
// `<vault_root>/Notes/scratch.md` on the host. Macro authors think in
// vault-rooted terms and never need to know about the host filesystem layout.
//
// The wrapper does three things before any shell verb dispatches:
//   1. Strips a leading `/` from the macro-supplied path (vault-rooted form).
//   2. Joins onto the vault root on the host.
//   3. Normalizes (resolving `.` and `..` segments) and verifies that the
//      result is still under the vault root — paths that escape are
//      refused via ForbiddenPathError.
//
// Plus a single `shelljs.cd(vaultRoot)` at evaluator start so bare relative
// paths (`Specs/`, `./foo`) resolve to the vault root by default.

import { resolve as pathResolve, normalize as pathNormalize, join as pathJoin, sep } from "node:path";
import { ForbiddenPathError } from "./evaluator.ts";

/**
 * Resolve a macro-supplied path against the configured vault root. Paths
 * starting with `/` are treated as vault-rooted (leading slash stripped,
 * then joined to vaultRoot). Relative paths are joined to vaultRoot.
 *
 * After resolution + normalization the result must still live under
 * vaultRoot, otherwise throws ForbiddenPathError.
 */
export function resolveMacroPath(macroPath: string, vaultRoot: string): string {
  // Strip leading slash if present (vault-rooted form).
  const pathInVault = macroPath.startsWith("/") ? macroPath.slice(1) : macroPath;
  // Join with vault root on the host.
  const hostPath = pathJoin(vaultRoot, pathInVault);
  // Normalize (resolves `..` and `.` segments).
  const normalized = pathNormalize(pathResolve(hostPath));
  // Verify still under vault root. Use resolve() on vaultRoot to ensure
  // any symlinks / `..` in the configured vault path are also normalized.
  const normalizedRoot = pathNormalize(pathResolve(vaultRoot));
  // The contained-under check: the normalized path must equal the root or
  // start with `root + path.sep`. Using `startsWith(root + sep)` rules out
  // false positives like `/foo` matching `/foobar`.
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (normalized !== normalizedRoot && !normalized.startsWith(rootWithSep)) {
    // GG-013-equivalent fix (2026-05-20): use spec-canonical snake_case
    // reason. Production uses `resolves_outside_vault`; the previous free-
    // text "resolves outside vault root" wasn't a stable identifier per
    // REQ-018 ac2's "stable snake_case identifiers" rule (the rule applies
    // to parse-error reasons; runtime / forbidden-path reasons should
    // follow the same convention for consistency with REQ-054 / spec
    // taxonomy).
    throw new ForbiddenPathError(macroPath, "resolves_outside_vault");
  }
  return normalized;
}

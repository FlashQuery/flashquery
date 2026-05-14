import {
  normalize as pathNormalize,
  relative as pathRelative,
  resolve as pathResolve,
  sep,
} from 'node:path';
import { MacroExpectedError } from './evaluator.js';

function normalizedVaultRoot(vaultRoot: string): string {
  return pathNormalize(pathResolve(vaultRoot));
}

function assertInsideVault(hostPath: string, vaultRoot: string, originalPath: string): string {
  const normalized = pathNormalize(pathResolve(hostPath));
  const normalizedRoot = normalizedVaultRoot(vaultRoot);
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;

  if (normalized !== normalizedRoot && !normalized.startsWith(rootWithSep)) {
    throw new MacroExpectedError(
      'forbidden_path',
      'Macro shell path resolves outside the vault root.',
      { path: originalPath, reason: 'resolves_outside_vault' }
    );
  }

  return normalized;
}

export function resolveMacroPath(macroPath: string, vaultRoot: string): string {
  const normalizedRoot = normalizedVaultRoot(vaultRoot);
  const pathInVault = macroPath.startsWith('/') ? macroPath.slice(1) : macroPath;
  const hostPath = pathResolve(normalizedRoot, pathInVault);

  return assertInsideVault(hostPath, normalizedRoot, macroPath);
}

export function toMacroPath(hostPath: string, vaultRoot: string): string {
  const normalizedRoot = normalizedVaultRoot(vaultRoot);
  const normalized = assertInsideVault(hostPath, normalizedRoot, hostPath);

  if (normalized === normalizedRoot) {
    return '/';
  }

  return `/${pathRelative(normalizedRoot, normalized).split(sep).join('/')}`;
}

import { basename } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import fastGlob from 'fast-glob';
import shelljs from 'shelljs';
import {
  MacroRuntimeError,
} from './runtime-errors.js';
import type {
  MacroBuiltin,
  MacroInvocationContext,
  MacroNamedArgs,
  MacroValue,
} from './runtime-types.js';
import { assertRealPathInsideVault, resolveMacroPath, toMacroPath } from './path-wrapper.js';

const sh = shelljs;
sh.config.silent = true;
sh.config.fatal = false;

function isMacroValueArray(value: MacroValue): value is MacroValue[] {
  return Array.isArray(value);
}

export const shellBuiltins: Record<string, MacroBuiltin> = {
  grep: (positional, named, context) => grepBuiltin(positional, named, context),
  find: (positional, named, context) => findBuiltin(positional, named, context),
  sed: (positional, _named, context) => sedBuiltin(positional, context),
  cat: (positional, named, context) => catBuiltin(positional, named, context),
  wc: (positional, named, context) => wcBuiltin(positional, named, context),
  head: (positional, named, context) => headBuiltin(positional, named, context),
  tail: (positional, named, context) => tailBuiltin(positional, named, context),
  ls: (positional, named, context) => lsBuiltin(positional, named, context),
};

function grepBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  requireArgCount('grep', positional, 1, Number.POSITIVE_INFINITY);
  const pattern = requireString(positional[0], 'grep_pattern_type');
  const sourceLines =
    context.stdin === undefined
      ? readLinesFromPaths(positional.slice(1), context)
      : valueToLines(context.stdin);
  const matcher = buildMatcher(pattern, hasFlag(named, 'i'));
  const inverted = hasFlag(named, 'v');
  const numbered = hasFlag(named, 'n');
  const matches = sourceLines.filter((line) => matcher(line.text) !== inverted);

  if (hasFlag(named, 'c')) return matches.length;
  if (hasFlag(named, 'l')) {
    return [...new Set(matches.map((line) => line.source).filter((source) => source !== null))];
  }
  return matches.map((line) => (numbered ? `${line.lineNumber}:${line.text}` : line.text));
}

function findBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  requireArgCount('find', positional, 1, 1);
  const vaultRoot = requireVaultRoot(context);
  const macroRoot = requireString(positional[0], 'find_path_type');
  const root = resolveMacroPath(macroRoot, vaultRoot);
  requireExistingPath(root, macroRoot, 'find');
  assertRealPathInsideVault(root, vaultRoot, macroRoot);
  let results = [root, ...listHostPaths(root, true, true)];
  const namePattern = optionalString(named['name'], 'find_name_type');
  const type = optionalString(named['type'], 'find_type_type');

  if (namePattern !== undefined) {
    const pattern = globToRegex(namePattern);
    results = results.filter((path) => pattern.test(basename(path)));
  }
  if (type !== undefined) {
    if (type !== 'f' && type !== 'd') {
      throw new MacroRuntimeError('find --type expects "f" or "d".', undefined, {
        reason: 'find_type_value',
      });
    }
    results = results.filter((path) => {
      const info = lstatSync(path);
      return type === 'f' ? info.isFile() : info.isDirectory();
    });
  }

  return results.map((path) => toMacroPath(path, vaultRoot)).sort();
}

function sedBuiltin(positional: MacroValue[], context: MacroInvocationContext): MacroValue {
  requireArgCount('sed', positional, 1, Number.POSITIVE_INFINITY);
  const expression = requireString(positional[0], 'sed_expression_type');
  const input =
    context.stdin === undefined
      ? readTextFromPaths(positional.slice(1), context)
      : linesToText(valueToLines(context.stdin).map((line) => line.text));
  const { pattern, replacement, flags } = parseSedExpression(expression);
  return input.replace(new RegExp(pattern, flags), replacement);
}

function catBuiltin(
  positional: MacroValue[],
  _named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  requireArgCount('cat', positional, 1, Number.POSITIVE_INFINITY);
  return readTextFromPaths(positional, context);
}

function wcBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  const mode = wcMode(named);
  const input =
    context.stdin === undefined
      ? readTextFromPaths(positional, context)
      : linesToText(valueToLines(context.stdin).map((line) => line.text));

  if (mode === 'l') return countLines(input);
  if (mode === 'w') return input.trim().length === 0 ? 0 : input.trim().split(/\s+/).length;
  return Buffer.byteLength(input);
}

function headBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  const { count, rest } = extractLineCount('head', positional, named);
  const lines =
    context.stdin === undefined ? readLinesFromPaths(rest, context) : valueToLines(context.stdin);
  return lines.slice(0, count).map((line) => line.text);
}

function tailBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  const { count, rest } = extractLineCount('tail', positional, named);
  const lines =
    context.stdin === undefined ? readLinesFromPaths(rest, context) : valueToLines(context.stdin);
  return lines.slice(-count).map((line) => line.text);
}

function lsBuiltin(
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
): MacroValue {
  requireArgCount('ls', positional, 1, 1);
  const vaultRoot = requireVaultRoot(context);
  const macroPath = requireString(positional[0], 'ls_path_type');
  const hostPath = resolveMacroPath(macroPath, vaultRoot);
  requireExistingPath(hostPath, macroPath, 'ls');
  assertRealPathInsideVault(hostPath, vaultRoot, macroPath);

  if (hasFlag(named, 'd')) {
    return [toMacroPath(hostPath, vaultRoot)];
  }

  const includeDot = hasFlag(named, 'A');
  const recursive = hasFlag(named, 'R');
  if (hasFlag(named, 'l')) {
    const paths = listHostPaths(hostPath, includeDot, recursive);
    return paths.map((entry) => {
      const info = lstatSync(entry);
      return {
        name: recursive ? toMacroPath(entry, vaultRoot) : basename(entry),
        size: info.size,
        mtime: info.mtime.toISOString(),
      };
    });
  }

  if (recursive) {
    return listHostPaths(hostPath, includeDot, true).map((entry) => toMacroPath(entry, vaultRoot));
  }
  return listHostPaths(hostPath, includeDot, false).map((entry) => basename(entry));
}

interface SourceLine {
  text: string;
  lineNumber: number;
  source: string | null;
}

function readLinesFromPaths(paths: MacroValue[], context: MacroInvocationContext): SourceLine[] {
  return readTextEntries(paths, context).flatMap((entry) =>
    splitLines(entry.text).map((text, index) => ({
      text,
      lineNumber: index + 1,
      source: entry.macroPath,
    }))
  );
}

function readTextFromPaths(paths: MacroValue[], context: MacroInvocationContext): string {
  return readTextEntries(paths, context)
    .map((entry) => entry.text)
    .join('');
}

function readTextEntries(
  paths: MacroValue[],
  context: MacroInvocationContext
): Array<{ text: string; macroPath: string }> {
  if (paths.length === 0) {
    throw new MacroRuntimeError('Shell command requires at least one path.', undefined, {
      reason: 'path_argument_required',
    });
  }
  const vaultRoot = requireVaultRoot(context);
  return expandPaths(paths, vaultRoot).map(({ hostPath, macroPath }) => ({
    text: String(sh.cat(hostPath).stdout),
    macroPath,
  }));
}

function expandPaths(
  paths: MacroValue[],
  vaultRoot: string
): Array<{ hostPath: string; macroPath: string }> {
  const output: Array<{ hostPath: string; macroPath: string }> = [];
  for (const pathValue of paths) {
    const macroPath = requireString(pathValue, 'path_argument_type');
    if (hasGlob(macroPath)) {
      const hostPattern = resolveMacroPath(macroPath, vaultRoot);
      const matches = fastGlob
        .sync(hostPattern, { dot: false, followSymbolicLinks: false, onlyFiles: true })
        .sort();
      if (matches.length === 0) {
        throw new MacroRuntimeError('Shell glob matched no files.', undefined, {
          reason: 'glob_no_matches',
          pattern: macroPath,
        });
      }
      for (const hostPath of matches) {
        requireExistingPath(hostPath, macroPath, 'read');
        assertRealPathInsideVault(hostPath, vaultRoot, macroPath);
        output.push({ hostPath, macroPath: toMacroPath(hostPath, vaultRoot) });
      }
    } else {
      const hostPath = resolveMacroPath(macroPath, vaultRoot);
      requireExistingPath(hostPath, macroPath, 'read');
      assertRealPathInsideVault(hostPath, vaultRoot, macroPath);
      output.push({ hostPath, macroPath: toMacroPath(hostPath, vaultRoot) });
    }
  }
  return output;
}

function listHostPaths(hostPath: string, includeDot: boolean, recursive: boolean): string[] {
  const globPattern = recursive ? '**/*' : '*';
  return fastGlob
    .sync(globPattern, {
      absolute: true,
      cwd: hostPath,
      dot: includeDot,
      followSymbolicLinks: false,
      onlyFiles: false,
    })
    .map(String)
    .sort();
}

function valueToLines(value: MacroValue): SourceLine[] {
  if (typeof value === 'string') {
    return splitLines(value).map((text, index) => ({ text, lineNumber: index + 1, source: null }));
  }
  if (isMacroValueArray(value)) {
    return value.map((item, index) => ({
      text: macroValueToText(item),
      lineNumber: index + 1,
      source: null,
    }));
  }
  throw new MacroRuntimeError('Piped shell input must be text or a list.', undefined, {
    reason: 'stdin_type_mismatch',
  });
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function linesToText(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function buildMatcher(pattern: string, ignoreCase: boolean): (line: string) => boolean {
  const regex = new RegExp(escapeRegExp(pattern), ignoreCase ? 'i' : '');
  return (line) => regex.test(line);
}

function parseSedExpression(expression: string): {
  pattern: string;
  replacement: string;
  flags: string;
} {
  const match = /^s(.)(.*)\1(.*)\1([gim]*)$/.exec(expression);
  if (!match) {
    throw new MacroRuntimeError('sed expects an s/old/new/[gim] expression.', undefined, {
      reason: 'sed_expression_invalid',
    });
  }
  return {
    pattern: match[2] ?? '',
    replacement: match[3] ?? '',
    flags: match[4] ?? '',
  };
}

function wcMode(named: MacroNamedArgs): 'l' | 'w' | 'c' {
  const enabled = ['l', 'w', 'c'].filter((flag) => hasFlag(named, flag));
  if (enabled.length > 1) {
    throw new MacroRuntimeError('wc accepts only one count mode.', undefined, {
      reason: 'wc_mode_count',
    });
  }
  return (enabled[0] as 'l' | 'w' | 'c' | undefined) ?? 'c';
}

function extractLineCount(
  builtin: 'head' | 'tail',
  positional: MacroValue[],
  named: MacroNamedArgs
): { count: number; rest: MacroValue[] } {
  if (!hasFlag(named, 'n')) return { count: 10, rest: positional };
  requireArgCount(builtin, positional, 1, Number.POSITIVE_INFINITY);
  const count = requirePositiveInteger(positional[0], `${builtin}_line_count_type`);
  return { count, rest: positional.slice(1) };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.split(/\r?\n/).length - 1 : text.split(/\r?\n/).length;
}

function requireVaultRoot(context: MacroInvocationContext): string {
  if (!context.vaultRoot) {
    throw new MacroRuntimeError('Macro shell command requires a vault root.', undefined, {
      reason: 'vault_root_required',
    });
  }
  return context.vaultRoot;
}

function requireExistingPath(hostPath: string, macroPath: string, builtin: string): void {
  if (!existsSync(hostPath)) {
    throw new MacroRuntimeError('Shell path does not exist.', undefined, {
      reason: 'path_not_found',
      path: macroPath,
      builtin,
    });
  }
}

function macroValueToText(value: MacroValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function requireArgCount(
  builtin: string,
  positional: MacroValue[],
  min: number,
  max: number
): void {
  if (positional.length < min || positional.length > max) {
    throw new MacroRuntimeError(`${builtin} received an invalid number of arguments.`, undefined, {
      reason: `${builtin}_argument_count`,
    });
  }
}

function requireString(value: MacroValue, reason: string): string {
  if (typeof value !== 'string') {
    throw new MacroRuntimeError('Shell argument must be a string.', undefined, { reason });
  }
  return value;
}

function optionalString(value: MacroValue | undefined, reason: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, reason);
}

function requirePositiveInteger(value: MacroValue, reason: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MacroRuntimeError('Shell line count must be a non-negative integer.', undefined, {
      reason,
    });
  }
  return value;
}

function hasFlag(named: MacroNamedArgs, flag: string): boolean {
  return named[flag] !== undefined && named[flag] !== null && named[flag] !== false;
}

function hasGlob(pathValue: string): boolean {
  return /[*?[\]{}]/.test(pathValue);
}

function globToRegex(glob: string): RegExp {
  return new RegExp(`^${glob.split('').map(globCharToRegex).join('')}$`);
}

function globCharToRegex(char: string): string {
  if (char === '*') return '.*';
  if (char === '?') return '.';
  return escapeRegExp(char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

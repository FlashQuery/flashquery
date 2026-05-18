// Shell-shaped builtins backed by ShellJS.
//
// These wrap a curated subset of common Unix verbs (grep, find, sed, cat,
// wc, head, tail, ls) so macro authors can write them in a Bash-aligned
// form. They participate in pipelines: when the call is on the RHS of a
// pipe, ctx.stdin holds the LHS's output value (typically a list of lines
// or a string).
//
// File-position string args are auto-glob-expanded — passing "*.md" hits
// every matching file under the vault root (after the vault-jail wrapper
// resolves the path), the way Bash would.
//
// Vault-jail wrapper (per OQ #25, 2026-05-12). Every path argument to a
// shell verb is run through resolveMacroPath(macroPath, vaultRoot) before
// ShellJS sees it. Paths that escape the vault root via `..` segments are
// refused with ForbiddenPathError. Plus ShellJS's cwd is set to the vault
// root at the start of each shell-verb dispatch.
//
// Flag-level rejections (per OQ #25, 2026-05-12). Three flags are refused
// at dispatch time via MacroForbiddenFlagError:
//   - `sed -i` (in-place file modification)
//   - `find -exec` (arbitrary command execution)
//   - `find -delete` (file mutation)
//
// Restrictions vs. real shell:
//   - No subshells, no $(...), no redirects.
//   - No exit codes / $?. Errors throw MacroRuntimeError.
//   - sed expects the s/old/new/g mini-language as a string arg.

import shImport from "shelljs";
import fastGlob from "fast-glob";
import { resolveMacroPath } from "./pathwrapper.ts";
import type { CallContext } from "./types.ts";

// shelljs is a CJS module. With esModuleInterop, the default import gives us
// the module's exports object (cat, grep, sed, find, etc.). Some bundlers
// place those under .default; handle both.
const sh = (
  (shImport as unknown as { default?: unknown }).default ?? shImport
) as typeof shImport;
import type { BuiltinFn } from "./types.ts";
import type { Value } from "./types.ts";

// ----- helpers -----

// Convert a Value to a list of lines for stdin-style consumption.
//   string             -> split on newlines, drop trailing empty
//   string[]           -> as-is
//   anything else      -> error
function valueToLines(v: Value): string[] {
  if (typeof v === "string") {
    const lines = v.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return v as string[];
    // Allow lists of objects with .id (e.g. doc_a) — let them through stringified.
    return v.map((x) => String(x));
  }
  throw new Error(`expected lines, got ${describe(v)}`);
}

function linesToText(lines: string[]): string {
  return lines.join("\n");
}

// Glob-expand a list of string args, jailed to the vault root. Each path
// first goes through resolveMacroPath() (per OQ #25 vault-jail), then any
// remaining glob characters are expanded against the resolved root.
// Args without glob characters resolve to a single host path; args with
// `*`, `?`, `[`, or `{` resolve to zero-or-more matches under the vault.
function globExpandFiles(args: Value[], vaultRoot: string | undefined): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (typeof a !== "string") {
      throw new Error(`expected file path, got ${describe(a)}`);
    }
    const root = vaultRoot ?? process.cwd();
    if (/[*?\[\{]/.test(a)) {
      // Glob pattern: resolve the directory part of the pattern through
      // the vault-jail wrapper, then fast-glob the glob portion.
      // resolveMacroPath on the full glob string is fine because path
      // normalization preserves glob characters as ordinary chars.
      const resolved = resolveMacroPath(a, root);
      const matches = fastGlob.sync(resolved, { dot: false, onlyFiles: false });
      if (matches.length === 0) {
        // Bash with `nullglob` off would pass the literal pattern; bash with
        // `failglob` on would error. We choose the explicit-error path to make
        // model-authored macros fail loudly rather than silently mis-running.
        throw new Error(`glob "${a}" matched no files`);
      }
      for (const m of matches) out.push(m);
    } else {
      out.push(resolveMacroPath(a, root));
    }
  }
  return out;
}

// Return the vault root from the call context. Golden patch item 4:
// previously this also called `sh.cd(vaultRoot)`, mutating ShellJS's
// process-global cwd. That has been removed — `resolveMacroPath` already
// returns absolute host paths so no cwd change is needed. (REQ-042 / row 5.)
function ensureVaultCwd(ctx: CallContext): string | undefined {
  return ctx.vaultRoot;
}

// Build a ShellJS option-bundle string from named flags.
// Short flags (single-letter keys) get bundled into one "-xyz" string.
// Long flags get rendered as "--name" tokens in their own slot. Returned as
// an array so callers can spread into ShellJS calls.
function flagsToShellArgs(named: Record<string, Value>, allowed: string[]): string[] {
  const shorts: string[] = [];
  const longs: string[] = [];
  for (const [k, v] of Object.entries(named)) {
    if (!allowed.includes(k)) continue; // ignore flags not relevant to this command
    if (k.length === 1 && v === true) {
      shorts.push(k);
    } else if (k.length > 1 && v === true) {
      longs.push(`--${k}`);
    } else if (typeof v === "string") {
      // Long flag with value, e.g. --color=auto. Not used by our v0 builtins.
      longs.push(`--${k}=${v}`);
    }
  }
  const out: string[] = [];
  if (shorts.length > 0) out.push("-" + shorts.join(""));
  out.push(...longs);
  return out;
}

function describe(v: Value): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v;
}

// Set ShellJS to silent so we don't print its own messages to stderr.
sh.config.silent = true;
sh.config.fatal = false;

// ----- grep -----
// Bash:  grep [-i] [-v] [-c] [-l] [-n] PATTERN file...
// DSL:   grep [-i] [-v] [-c] [-l] [-n] PATTERN file_or_glob...
//        echo "..." | grep [-i] [-v] PATTERN
// Returns: list of matching lines (string[]).

const grep: BuiltinFn = (positional, named, ctx) => {
  if (positional.length < 1) {
    throw new Error("grep: missing PATTERN");
  }
  const root = ensureVaultCwd(ctx);
  const pattern = String(positional[0]);
  const fileArgs = positional.slice(1);
  const flagArgs = flagsToShellArgs(named, ["i", "v", "c", "l", "n"]);

  let outputText = "";
  if (ctx.stdin !== undefined) {
    // Pipe input. Build a ShellString and call .grep on it.
    const text = linesToText(valueToLines(ctx.stdin));
    const ss = new sh.ShellString(text);
    const result =
      flagArgs.length > 0
        ? (ss.grep as (...a: unknown[]) => { stdout: string })(...flagArgs, pattern)
        : ss.grep(pattern);
    outputText = result.stdout;
  } else {
    if (fileArgs.length === 0) {
      throw new Error("grep: missing file argument (and nothing piped in)");
    }
    const files = globExpandFiles(fileArgs, root);
    const result =
      flagArgs.length > 0
        ? (sh.grep as (...a: unknown[]) => { stdout: string })(...flagArgs, pattern, ...files)
        : sh.grep(pattern, ...files);
    outputText = result.stdout;
  }

  // Split into lines, drop trailing blank.
  const lines = outputText.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

// ----- find -----
// Bash:  find PATH [-name PATTERN] [-type f|d]
// DSL:   find PATH [--name PATTERN] [--type f|d]
// Returns: list of paths (string[]).

const find: BuiltinFn = (positional, named, ctx) => {
  if (positional.length < 1) {
    throw new Error("find: missing PATH");
  }
  // Flag-level rejections (OQ #25 `find -exec` / `find -delete`) are
  // enforced by the pre-scan in evaluator.ts before this dispatcher is
  // ever called.
  const root = ensureVaultCwd(ctx);
  const effectiveRoot = root ?? process.cwd();
  const hostPath = resolveMacroPath(String(positional[0]), effectiveRoot);
  let results = sh.find(hostPath).map((s) => String(s));
  if (named.name && typeof named.name === "string") {
    // Convert glob to regex for filename matching (basename only).
    const re = globToRegex(named.name);
    results = results.filter((p) => {
      const base = p.split("/").pop() ?? p;
      return re.test(base);
    });
  }
  if (named.type && typeof named.type === "string") {
    if (named.type === "f") {
      results = results.filter((p) => sh.test("-f", p));
    } else if (named.type === "d") {
      results = results.filter((p) => sh.test("-d", p));
    }
  }
  // Translate host paths back to vault-rooted form so the results are
  // re-usable as inputs to other shell verbs in the same macro. Without
  // this, `for f in $files; cat $f; done` would double-jail the host
  // path and miss the file.
  if (root) {
    const sepLen = root.endsWith("/") ? root.length : root.length + 1;
    results = results.map((p) => {
      if (p === root) return "/";
      if (p.startsWith(root + "/")) return "/" + p.slice(sepLen);
      return p;
    });
  }
  return results;
};

function globToRegex(glob: string): RegExp {
  // Minimal: handle * and ?. Anchored to whole string.
  let re = "^";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (/[.+^$(){}|\\]/.test(ch)) re += "\\" + ch;
    else re += ch;
  }
  re += "$";
  return new RegExp(re);
}

// ----- sed -----
// Bash:  sed [-i.bak] 's/old/new/flags' file...
// DSL:   sed [-i] "s/OLD/NEW/FLAGS" file_or_glob...
//        echo "..." | sed "s/OLD/NEW/FLAGS"
// Returns: replaced text (string) for stdin-mode, or list of lines for file-mode.

const sedExpr = /^s(.)((?:\\.|(?!\1).)+)\1((?:\\.|(?!\1).)*)\1([gim]*)$/;

const sed: BuiltinFn = (positional, _named, ctx) => {
  if (positional.length < 1) {
    throw new Error("sed: missing s/.../.../ expression");
  }
  // Flag-level rejection of `sed -i` (in-place file modification, per
  // OQ #25) is enforced by the pre-scan in evaluator.ts before this
  // dispatcher is called. sed in macros is therefore strictly read-only
  // (pipeline-mode and file-mode return new text without mutating files).
  const root = ensureVaultCwd(ctx);
  const expr = String(positional[0]);
  const m = expr.match(sedExpr);
  if (!m) {
    throw new Error(
      `sed: expected s/OLD/NEW/[FLAGS] form, got ${JSON.stringify(expr)}`,
    );
  }
  const [, , oldRaw, newRaw, sedFlags] = m;
  const flagsForRegex = sedFlags.includes("i") ? "gi" : sedFlags.includes("g") ? "g" : "";
  // Default to global replace on each line if "g" not specified — mirrors common
  // expectation. To replace only once per line, omit "g" (we'd need different default).
  // For v0, we honor whatever flags the user wrote.
  const regex = new RegExp(oldRaw, flagsForRegex);
  const replacement = newRaw;

  if (ctx.stdin !== undefined) {
    const text = linesToText(valueToLines(ctx.stdin));
    return text.replace(regex, replacement);
  }

  const fileArgs = positional.slice(1);
  if (fileArgs.length === 0) {
    throw new Error("sed: missing file argument (and nothing piped in)");
  }
  const files = globExpandFiles(fileArgs, root);
  const out: string[] = [];
  for (const f of files) {
    const text = sh.cat(f).stdout;
    const replaced = text.replace(regex, replacement);
    out.push(replaced);
  }
  return out.join("");
};

// ----- cat -----
// Bash:  cat file...
// DSL:   cat file_or_glob...
//        (acts as identity when used after a pipe)
// Returns: concatenated text (string).

const cat: BuiltinFn = (positional, _named, ctx) => {
  if (ctx.stdin !== undefined && positional.length === 0) {
    return linesToText(valueToLines(ctx.stdin));
  }
  if (positional.length === 0) {
    throw new Error("cat: missing file argument (and nothing piped in)");
  }
  const root = ensureVaultCwd(ctx);
  const files = globExpandFiles(positional, root);
  return sh.cat(...files).stdout;
};

// ----- wc -----
// Bash:  wc [-l] [-w] [-c] [file...]
// DSL:   wc [-l] [-w] [-c] file_or_glob...
//        echo "..." | wc -l
// Returns: number (default = lines if -l, words if -w, chars if -c, else lines).

const wc: BuiltinFn = (positional, named, ctx) => {
  let text: string;
  if (ctx.stdin !== undefined) {
    text = linesToText(valueToLines(ctx.stdin));
  } else {
    if (positional.length === 0) {
      throw new Error("wc: missing file argument (and nothing piped in)");
    }
    const root = ensureVaultCwd(ctx);
    const files = globExpandFiles(positional, root);
    text = sh.cat(...files).stdout;
  }
  if (named.w === true) {
    return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
  }
  if (named.c === true) {
    return text.length;
  }
  // default = -l
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
};

// ----- head -----
// Bash:  head [-n N] file...
// DSL:   head [-n N] file_or_glob...
//        echo "..." | head [-n N]
// Returns: first N lines (default N = 10) joined as a string.

// Resolve the "-n N" count flag for head/tail. In our short-flag grammar,
// `-n` is parsed as a boolean (`named.n === true`) and the count `5` becomes
// positional[0]. We detect this and consume that leading number. Also
// accept the long-form `--n 5` (named.n === number) — and, defensively, a
// positional-only form `head 5 file.md` is NOT supported (would be
// indistinguishable from a file path called "5").
function resolveCountFlag(
  positional: Value[],
  named: Record<string, Value>,
  defaultN: number,
): { count: number; rest: Value[] } {
  if (typeof named.n === "number") {
    return { count: named.n, rest: positional };
  }
  if (named.n === true && positional.length > 0 && typeof positional[0] === "number") {
    return { count: positional[0] as number, rest: positional.slice(1) };
  }
  return { count: defaultN, rest: positional };
}

const head: BuiltinFn = (positional, named, ctx) => {
  const root = ensureVaultCwd(ctx);
  const { count, rest } = resolveCountFlag(positional, named, 10);
  let text: string;
  if (ctx.stdin !== undefined && rest.length === 0) {
    text = linesToText(valueToLines(ctx.stdin));
  } else {
    if (rest.length === 0) {
      throw new Error("head: missing file argument (and nothing piped in)");
    }
    const files = globExpandFiles(rest, root);
    text = sh.head({ "-n": count }, ...files).stdout;
    // Trim trailing newline that ShellJS appends, then return as-is.
    if (text.endsWith("\n")) text = text.slice(0, -1);
    return text;
  }
  // stdin path: slice manually.
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return linesToText(lines.slice(0, count));
};

// ----- tail -----
// Bash:  tail [-n N] file...
// DSL:   tail [-n N] file_or_glob...
//        echo "..." | tail [-n N]
// Returns: last N lines (default N = 10) joined as a string.

const tail: BuiltinFn = (positional, named, ctx) => {
  const root = ensureVaultCwd(ctx);
  const { count, rest } = resolveCountFlag(positional, named, 10);
  let text: string;
  if (ctx.stdin !== undefined && rest.length === 0) {
    text = linesToText(valueToLines(ctx.stdin));
  } else {
    if (rest.length === 0) {
      throw new Error("tail: missing file argument (and nothing piped in)");
    }
    const files = globExpandFiles(rest, root);
    text = sh.tail({ "-n": count }, ...files).stdout;
    if (text.endsWith("\n")) text = text.slice(0, -1);
    return text;
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return linesToText(lines.slice(Math.max(0, lines.length - count)));
};

// ----- ls -----
// Bash:  ls [-A] [-d] [-l] [-R] [PATH...]
// DSL:   ls [-A] [-d] [-l] [-R] [path_or_glob...]
// Returns:
//   - default / -A / -R: list of strings (names)
//   - -d: list with the directory name(s) themselves
//   - -l: list of objects { name, size, mtime } (ShellJS's long-format
//         metadata; mtime as ISO string).

const ls: BuiltinFn = (positional, named, ctx) => {
  const root = ensureVaultCwd(ctx);
  // Build ShellJS options bundle from boolean flags.
  const flagLetters: string[] = [];
  if (named.A === true) flagLetters.push("A");
  if (named.d === true) flagLetters.push("d");
  if (named.l === true) flagLetters.push("l");
  if (named.R === true) flagLetters.push("R");
  const flagArg = flagLetters.length > 0 ? "-" + flagLetters.join("") : null;

  // Default to listing the vault root if no paths given.
  const targets =
    positional.length === 0
      ? [root ?? process.cwd()]
      : globExpandFiles(positional, root);

  // ShellJS's ls returns a ShellArray (string[]) by default, but with `-l`
  // each entry also has metadata properties (name, size, mtime, mode).
  const result = flagArg ? sh.ls(flagArg, ...targets) : sh.ls(...targets);

  if (named.l === true) {
    // Long-format: return objects with metadata.
    return (result as unknown as Array<{
      name: string;
      size: number;
      mtime: Date;
    }>).map((entry) => ({
      name: entry.name,
      size: entry.size,
      mtime: entry.mtime instanceof Date ? entry.mtime.toISOString() : String(entry.mtime),
    }));
  }
  return result.map((s) => String(s));
};

// ----- exports -----

export const shellBuiltins: Record<string, BuiltinFn> = {
  grep,
  find,
  sed,
  cat,
  wc,
  head,
  tail,
  ls,
};

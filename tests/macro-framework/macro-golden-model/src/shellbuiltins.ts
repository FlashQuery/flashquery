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
// Flag-level rejections. Two flags are refused by the pre-scan in
// evaluator.ts:
//   - `find -exec` (arbitrary command execution)
//   - `find -delete` (file mutation)
// REQ-066/068 (8-Jun-2026): `sed -i` is NO LONGER forbidden — it is the single
// permitted, vault-jailed, scope-guarded shell mutation. Default `--scope body`
// keeps frontmatter byte-preserved; see the `--scope` helpers below.
//
// Restrictions vs. real shell:
//   - No subshells, no $(...), no redirects.
//   - No exit codes / $?. Errors throw MacroRuntimeError.
//   - sed expects the s/old/new/g mini-language as a string arg.

import shImport from "shelljs";
import fastGlob from "fast-glob";
import { resolveMacroPath } from "./pathwrapper.ts";
import { MacroRuntimeError } from "./evaluator.ts";
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
      const resolved = resolveMacroPath(a, root);
      // GG-018: non-glob file paths MUST exist. ShellJS's `cat` (with
      // `fatal: false`) silently returns "" for a missing file; the golden
      // previously inherited that silent-success behavior, where production
      // raises `tool_call_failed / path_not_found`. Check existence here so
      // every file-consuming verb (cat, grep, sed, wc, head, tail) errors
      // consistently on a missing path.
      if (!sh.test("-e", resolved)) {
        throw new MacroRuntimeError("Shell path does not exist.", undefined, {
          reason: "path_not_found",
          path: a,
        });
      }
      out.push(resolved);
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

// GG-018 (2026-05-20): translate absolute host paths back to vault-relative
// form (leading-slash, vault-rooted). Shell verbs MUST NOT leak the host
// filesystem layout (e.g. the temp-dir path the vault was materialized to)
// into macro-visible values — the contract is vault-relative paths so the
// result is portable and re-usable as input to other shell verbs. Extracted
// from `find`'s previously-inline translation block so `ls`/`grep -l` can
// share it.
function toVaultRelative(paths: string[], root: string | undefined): string[] {
  if (!root) return paths;
  const sepLen = root.endsWith("/") ? root.length : root.length + 1;
  return paths.map((p) => {
    if (p === root) return "/";
    if (p.startsWith(root + "/")) return "/" + p.slice(sepLen);
    return p;
  });
}

// Set ShellJS to silent so we don't print its own messages to stderr.
sh.config.silent = true;
sh.config.fatal = false;

// ----- REQ-065 / REQ-066 (8-Jun-2026): --scope region selection -----
//
// Content-reading verbs (cat, grep, sed, wc, head, tail) operate on a REGION
// of a vault Markdown document selected by `--scope`:
//   "body"        (default) — content after the YAML frontmatter block
//   "both"        — the whole raw file
//   "frontmatter" — the YAML mapping text between the `---` fences
// Files without frontmatter: body == both == whole content; frontmatter == "".
// `find` / `ls` do not read content and reject `--scope`.

type Scope = "body" | "both" | "frontmatter";

// Leading YAML frontmatter: a `---` fence, the mapping, a closing `---` fence,
// all at the very start of the file.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

interface FrontmatterSplit {
  hasFm: boolean;
  prefix: string; // the full `---\n...\n---\n` block ("" when no frontmatter)
  fmText: string; // the YAML mapping text between the fences
  body: string;   // everything after the frontmatter block
}

function splitFrontmatter(raw: string): FrontmatterSplit {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { hasFm: false, prefix: "", fmText: "", body: raw };
  return { hasFm: true, prefix: m[0], fmText: m[1], body: raw.slice(m[0].length) };
}

// Parse `--scope` for a content verb (default "body"); throw invalid_input on a
// bad value.
function parseScope(named: Record<string, Value>, verb: string): Scope {
  const s = named.scope;
  if (s === undefined) return "body";
  if (s === "body" || s === "both" || s === "frontmatter") return s;
  throw new MacroRuntimeError(
    `${verb}: invalid --scope ${JSON.stringify(s)}; expected "body", "both", or "frontmatter".`,
    undefined,
    { reason: "invalid_scope" },
  );
}

// find / ls do not read content — reject `--scope`.
function rejectScope(named: Record<string, Value>, verb: string): void {
  if (named.scope !== undefined) {
    throw new MacroRuntimeError(
      `${verb} does not support --scope (it matches paths/entries, not content).`,
      undefined,
      { reason: "invalid_scope" },
    );
  }
}

// Apply a scope to raw file text, returning the selected region.
function applyScope(raw: string, scope: Scope): string {
  const fm = splitFrontmatter(raw);
  if (!fm.hasFm) return scope === "frontmatter" ? "" : raw;
  if (scope === "both") return raw;
  if (scope === "frontmatter") return fm.fmText;
  return fm.body;
}

// Read file args (glob-expanded, vault-jailed) and return the scoped text,
// concatenated. Replaces prior `sh.cat(...files).stdout` reads so every content
// verb honors --scope uniformly.
function scopedFileText(fileArgs: Value[], root: string | undefined, scope: Scope): string {
  const files = globExpandFiles(fileArgs, root);
  return files.map((f) => applyScope(sh.cat(f).stdout, scope)).join("");
}

// Pull a top-level `key: value` out of YAML-ish frontmatter text (first match).
function fmField(fmText: string, key: string): string | undefined {
  const m = fmText.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : undefined;
}

// REQ-066 ac4: a `sed -i --scope frontmatter` write MUST NOT alter/remove an
// FQ-managed reserved field (fq_id) and MUST remain structurally valid
// frontmatter. The golden has no YAML parser, so it does a lightweight check;
// production re-parses with js-yaml.
const FQ_RESERVED_FIELDS = ["fq_id"];
function guardFrontmatterEdit(before: string, after: string, verb: string): void {
  for (const key of FQ_RESERVED_FIELDS) {
    if (fmField(before, key) !== fmField(after, key)) {
      throw new MacroRuntimeError(
        `${verb}: --scope frontmatter edit would alter the FQ-managed field "${key}", which is immutable.`,
        undefined,
        { reason: "fq_managed_field_mutation" },
      );
    }
  }
  for (const line of after.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (/^[ \t]/.test(line)) continue; // nested / continuation
    if (/^- /.test(line)) continue; // list item
    if (/^[A-Za-z0-9_.-]+:/.test(line)) continue; // mapping entry
    throw new MacroRuntimeError(
      `${verb}: --scope frontmatter edit produced invalid frontmatter near ${JSON.stringify(line)}.`,
      undefined,
      { reason: "invalid_frontmatter_yaml" },
    );
  }
}

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
  const scope = parseScope(named, "grep"); // REQ-065: default body
  // `-c`/`-n`/`-l` are computed here; only `-i`/`-v` go to ShellJS's grep.
  const flagArgs = flagsToShellArgs(named, ["i", "v"]);
  const wantCount = named.c === true;
  const wantLineNumbers = named.n === true;
  const wantFilenames = named.l === true;

  const grepText = (text: string): string[] => {
    const ss = new sh.ShellString(text);
    const result =
      flagArgs.length > 0
        ? (ss.grep as (...a: unknown[]) => { stdout: string })(...flagArgs, pattern)
        : ss.grep(pattern);
    const ls = result.stdout.split(/\r?\n/);
    while (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
    return ls;
  };

  // `-l` returns matching FILE paths; evaluate per-file so the scope applies
  // and the filename attribution survives.
  if (wantFilenames && ctx.stdin === undefined) {
    if (fileArgs.length === 0) {
      throw new Error("grep: missing file argument (and nothing piped in)");
    }
    const files = globExpandFiles(fileArgs, root);
    const matched = files.filter((f) => grepText(applyScope(sh.cat(f).stdout, scope)).length > 0);
    return toVaultRelative(matched, root);
  }

  // Build the source text: stdin as-is; files read through the scope.
  let sourceText: string;
  if (ctx.stdin !== undefined) {
    sourceText = linesToText(valueToLines(ctx.stdin));
  } else {
    if (fileArgs.length === 0) {
      throw new Error("grep: missing file argument (and nothing piped in)");
    }
    sourceText = scopedFileText(fileArgs, root, scope);
  }

  const lines = grepText(sourceText);

  if (wantCount) {
    return lines.length;
  }
  if (wantLineNumbers) {
    // Line numbers are relative to the (scoped) source text.
    const sourceLines = sourceText.split(/\r?\n/);
    const matchSet = new Set(lines);
    const numbered: string[] = [];
    sourceLines.forEach((line, idx) => {
      if (matchSet.has(line)) numbered.push(`${idx + 1}:${line}`);
    });
    return numbered;
  }
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
  rejectScope(named, "find"); // REQ-065: find matches paths, not content
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
  results = toVaultRelative(results, root);
  // GG-018: alphabetize for stability. Production sorts find results;
  // ShellJS's `find` returns traversal order, which is non-deterministic
  // across platforms. A sorted result is the spec-stable contract.
  results.sort();
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

const sed: BuiltinFn = (positional, named, ctx) => {
  if (positional.length < 1) {
    throw new Error("sed: missing s/.../.../ expression");
  }
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
  const replacement = newRaw;
  // Fresh regex per use — a global regex carries lastIndex state across calls.
  const makeRegex = () => new RegExp(oldRaw, flagsForRegex);

  // Pipeline (stdin) mode: --scope and -i do not apply (no file to scope/write).
  if (ctx.stdin !== undefined) {
    const text =
      typeof ctx.stdin === "string"
        ? ctx.stdin
        : linesToText(valueToLines(ctx.stdin));
    return text.replace(makeRegex(), replacement);
  }

  const scope = parseScope(named, "sed"); // REQ-065: default body
  const fileArgs = positional.slice(1);
  if (fileArgs.length === 0) {
    throw new Error("sed: missing file argument (and nothing piped in)");
  }
  const files = globExpandFiles(fileArgs, root);
  // REQ-066: `-i` (short flag) requests an in-place write. Default body scope
  // keeps frontmatter byte-preserved.
  const inPlace = named.i !== undefined && named.i !== false && named.i !== null;

  if (inPlace) {
    for (const f of files) {
      const raw = sh.cat(f).stdout;
      const fm = splitFrontmatter(raw);
      let next: string;
      if (!fm.hasFm || scope === "both") {
        next = raw.replace(makeRegex(), replacement);
      } else if (scope === "frontmatter") {
        const newFm = fm.fmText.replace(makeRegex(), replacement);
        guardFrontmatterEdit(fm.fmText, newFm, "sed");
        next = fm.prefix.replace(fm.fmText, newFm) + fm.body;
      } else {
        // body (default): substitute the body only; frontmatter prefix preserved.
        next = fm.prefix + fm.body.replace(makeRegex(), replacement);
      }
      new sh.ShellString(next).to(f);
    }
    return null; // in-place write is a side effect; no value
  }

  // Read mode: return the transformed scoped text per file (never mutates).
  const out: string[] = [];
  for (const f of files) {
    const text = applyScope(sh.cat(f).stdout, scope);
    out.push(text.replace(makeRegex(), replacement));
  }
  return out.join("");
};

// ----- cat -----
// Bash:  cat file...
// DSL:   cat file_or_glob...
//        (acts as identity when used after a pipe)
// Returns: concatenated text (string).

const cat: BuiltinFn = (positional, named, ctx) => {
  if (ctx.stdin !== undefined && positional.length === 0) {
    return linesToText(valueToLines(ctx.stdin));
  }
  if (positional.length === 0) {
    throw new Error("cat: missing file argument (and nothing piped in)");
  }
  const scope = parseScope(named, "cat"); // REQ-065: default body
  const root = ensureVaultCwd(ctx);
  return scopedFileText(positional, root, scope);
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
    const scope = parseScope(named, "wc"); // REQ-065: default body
    const root = ensureVaultCwd(ctx);
    text = scopedFileText(positional, root, scope);
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
// Returns: first N lines (default N = 10) as a list of strings.

// Resolve the `-n N` count flag for head/tail. Per REQ-112f, `-n` lexes as
// a boolean short flag (macro short flags are boolean-only) and the count N
// is a SEPARATE positional integer literal immediately after it. There is
// NO long-form `--lines N` / `--n N` count flag. This mirrors production's
// `extractLineCount` (src/macro/shell-verbs.ts) exactly:
//   - flag absent  → default count, positional untouched
//   - flag present → positional[0] is the count (must be a non-negative
//                    integer); the remaining positionals are the file args
// GG-019: an earlier GG-018 pass had this honor `--lines N` / `--n N`,
// which the spec never defined and production never supported — `--lines`
// is silently ignored by production and `--n` is rejected. Both branches
// are removed here so the golden tracks production and REQ-112f.
// A bare positional-only `head 5 file.md` is NOT supported (would be
// indistinguishable from a file path called "5").
function resolveCountFlag(
  builtin: "head" | "tail",
  positional: Value[],
  named: Record<string, Value>,
  defaultN: number,
): { count: number; rest: Value[] } {
  // `-n` counts as present when named.n is anything truthy: `-n` yields
  // `true`; the non-spec long form `--n` yields a number — both trip the
  // count-flag path, matching production's hasFlag().
  const flagPresent =
    named.n !== undefined && named.n !== null && named.n !== false;
  if (!flagPresent) return { count: defaultN, rest: positional };
  if (positional.length < 1) {
    throw new MacroRuntimeError(
      `${builtin} received an invalid number of arguments.`,
      undefined,
      { reason: `${builtin}_argument_count` },
    );
  }
  const n = positional[0];
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new MacroRuntimeError(
      "Shell line count must be a non-negative integer.",
      undefined,
      { reason: `${builtin}_line_count_type` },
    );
  }
  return { count: n, rest: positional.slice(1) };
}

// GG-018: head/tail return a LIST of lines (one string per line), not a
// joined string. This matches production and is consistent with the other
// line-oriented verbs (grep, ls, find all return lists). The previous
// joined-string return was the lone inconsistency.
const head: BuiltinFn = (positional, named, ctx) => {
  const root = ensureVaultCwd(ctx);
  const { count, rest } = resolveCountFlag("head", positional, named, 10);
  if (ctx.stdin !== undefined && rest.length === 0) {
    const lines = valueToLines(ctx.stdin);
    return lines.slice(0, count);
  }
  if (rest.length === 0) {
    throw new Error("head: missing file argument (and nothing piped in)");
  }
  const scope = parseScope(named, "head"); // REQ-065: default body
  const text = scopedFileText(rest, root, scope);
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(0, count);
};

// ----- tail -----
// Bash:  tail [-n N] file...
// DSL:   tail [-n N] file_or_glob...
//        echo "..." | tail [-n N]
// Returns: last N lines (default N = 10) as a list of strings.

// GG-018: see head — tail likewise returns a list of lines.
const tail: BuiltinFn = (positional, named, ctx) => {
  const root = ensureVaultCwd(ctx);
  const { count, rest } = resolveCountFlag("tail", positional, named, 10);
  if (ctx.stdin !== undefined && rest.length === 0) {
    const lines = valueToLines(ctx.stdin);
    return lines.slice(Math.max(0, lines.length - count));
  }
  if (rest.length === 0) {
    throw new Error("tail: missing file argument (and nothing piped in)");
  }
  const scope = parseScope(named, "tail"); // REQ-065: default body
  const text = scopedFileText(rest, root, scope);
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(Math.max(0, lines.length - count));
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
  rejectScope(named, "ls"); // REQ-065: ls lists entries, not content
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

  const names = result.map((s) => String(s));

  // GG-018: `-d` returns the directory ITSELF. ShellJS emits the absolute
  // host path; translate to vault-relative so the host layout doesn't leak.
  if (named.d === true) {
    return toVaultRelative(names, root);
  }

  // GG-018: `-R` (recursive) returns entries relative to the listed
  // directory with no leading slash and in traversal order. The contract
  // (matching production) is vault-relative full paths, alphabetized. We
  // prefix each entry with the vault-relative form of its target and sort.
  if (named.R === true) {
    const out: string[] = [];
    for (const target of targets) {
      const vaultRelTarget = toVaultRelative([target], root)[0];
      const base = vaultRelTarget === "/" ? "" : vaultRelTarget;
      // The first chunk of ShellJS -R output for a single target is the
      // target's own entries; nested entries carry their sub-path.
      const targetEntries = (flagArg ? sh.ls(flagArg, target) : sh.ls(target)).map((s) => String(s));
      for (const entry of targetEntries) {
        out.push(`${base}/${entry}`);
      }
    }
    out.sort();
    return out;
  }

  return names;
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

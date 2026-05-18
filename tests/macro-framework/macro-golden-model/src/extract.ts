// Fence-attribute parser + `::name` selector for macro source extraction
// (REQ-005 / REQ-006, golden patch item 16). Extracts macro source from a
// markdown document containing one or more fenced code blocks tagged with
// `fqm` and optional attributes.
//
// Example source:
//
//   Some narrative...
//
//   ```fqm name=archive-drafts
//   for d in $drafts do
//     fq.archive({...})
//   done
//   ```
//
// Error matrix (doc-level): `no_macro_blocks`, `ambiguous_macro_block`,
// `block_not_found`, `duplicate_block_name`, `malformed_fence_attributes`.

export type FenceBlock = {
  name?: string;
  attrs: Record<string, string>;
  source: string;
  startLine: number;
};

export type FenceExtractError = {
  reason:
    | "no_macro_blocks"
    | "ambiguous_macro_block"
    | "block_not_found"
    | "duplicate_block_name"
    | "malformed_fence_attributes";
  message: string;
  details?: Record<string, string | number | string[]>;
};

export class MacroExtractError extends Error {
  constructor(public readonly detail: FenceExtractError) {
    super(detail.message);
    this.name = "MacroExtractError";
  }
}

// REQ-005 ac1: macro fence name regex. First character MUST be a letter
// (case-insensitive); subsequent characters letters/digits/`_`/`-`. Length
// capped at 64 characters.
const FENCE_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FENCE_NAME_MAX_LEN = 64;

// Parse a fence info string like `fqm name=foo other="bar baz"`.
// Returns the attrs map. Throws if malformed.
function parseFenceAttrs(info: string, line: number): Record<string, string> {
  // Skip the leading "fqm" token (callers pre-check).
  const rest = info.replace(/^fqm\s*/, "").trim();
  if (rest === "") return {};
  const attrs: Record<string, string> = {};
  // Tokenize key=value pairs; support quoted values.
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(rest)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
    consumed += m[0].length;
  }
  // If we couldn't consume the rest entirely, the attrs are malformed.
  const remainder = rest.replace(re, "").trim();
  if (remainder.length > 0) {
    throw new MacroExtractError({
      reason: "malformed_fence_attributes",
      message: `Malformed fence attributes near line ${line}: '${remainder}'`,
      details: { at_line: line, remainder },
    });
  }
  // REQ-005 ac1: enforce name regex (must start with a letter, ≤64 chars).
  if (attrs.name !== undefined) {
    if (attrs.name.length > FENCE_NAME_MAX_LEN) {
      throw new MacroExtractError({
        reason: "malformed_fence_attributes",
        message: `Macro block name '${attrs.name}' exceeds ${FENCE_NAME_MAX_LEN}-char max (REQ-005 ac1)`,
        details: { at_line: line, name: attrs.name, max_length: FENCE_NAME_MAX_LEN },
      });
    }
    if (!FENCE_NAME_REGEX.test(attrs.name)) {
      throw new MacroExtractError({
        reason: "malformed_fence_attributes",
        message: `Macro block name '${attrs.name}' must match [A-Za-z][A-Za-z0-9_-]* (REQ-005 ac1)`,
        details: { at_line: line, name: attrs.name },
      });
    }
  }
  return attrs;
}

// REQ-005 ac1: fence info-string MUST match `fqm` followed by either end-
// of-string or whitespace (so it's a standalone token, not a prefix of
// some other word). Used by the detection pass below.
function isFqmFence(info: string): boolean {
  return info === "fqm" || /^fqm\s/.test(info);
}

// Extract all `fqm` fences from a document.
export function extractFenceBlocks(source: string): FenceBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: FenceBlock[] = [];
  let inBlock = false;
  let blockLines: string[] = [];
  let attrs: Record<string, string> = {};
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^```\s*(.*?)\s*$/);
    if (m && !inBlock) {
      const info = m[1].trim();
      if (isFqmFence(info)) {
        attrs = parseFenceAttrs(info, i + 1);
        inBlock = true;
        blockLines = [];
        startLine = i + 2; // first content line is i+2 (1-indexed)
      }
      // Other code blocks: ignore (treat as opaque).
      continue;
    }
    if (line.match(/^```\s*$/) && inBlock) {
      blocks.push({
        name: attrs.name,
        attrs,
        source: blockLines.join("\n"),
        startLine,
      });
      inBlock = false;
      blockLines = [];
      attrs = {};
      continue;
    }
    if (inBlock) {
      blockLines.push(line);
    }
  }
  return blocks;
}

// Select a macro from a source per the optional `::name` selector. Throws
// the doc-level errors per the matrix.
//
//   source is treated as a document if it contains ``` fences with the
//   `fqm` info string. Otherwise the source is returned as-is (legacy
//   bare-`.fqm` mode).
//
//   selector === undefined: requires exactly one block (else ambiguous).
//   selector === "name":    requires a block with attrs.name === "name".
export function selectMacroSource(source: string, selector?: string): string {
  const blocks = extractFenceBlocks(source);
  if (blocks.length === 0) {
    // Legacy/bare mode — treat the whole source as the macro.
    if (selector !== undefined) {
      throw new MacroExtractError({
        reason: "no_macro_blocks",
        message: `Document has no \`fqm\` fenced blocks; cannot select '::${selector}'`,
      });
    }
    return source;
  }
  // Detect duplicate names.
  const names = blocks.map((b) => b.name).filter((n): n is string => !!n);
  const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
  if (dupes.length > 0) {
    throw new MacroExtractError({
      reason: "duplicate_block_name",
      message: `Duplicate macro block name(s): ${[...new Set(dupes)].join(", ")}`,
      details: { duplicates: [...new Set(dupes)] },
    });
  }
  // REQ-006 ac8: `available_names` MUST include the literal string
  // "unnamed" once if any unnamed blocks exist in the doc, and a sibling
  // `unnamed_block_count: N` field when N > 1. We compute these here so
  // the error envelopes below can include them.
  const unnamedCount = blocks.filter((b) => !b.name).length;
  const availableNames: string[] = [...names];
  if (unnamedCount > 0) availableNames.push("unnamed");

  if (selector !== undefined) {
    const match = blocks.find((b) => b.name === selector);
    if (!match) {
      const details: Record<string, string | number | string[]> = {
        selector,
        available: names,
        available_names: availableNames,
        requested: selector,
      };
      if (unnamedCount > 1) details.unnamed_block_count = unnamedCount;
      throw new MacroExtractError({
        reason: "block_not_found",
        message: `Macro block '${selector}' not found. Available: ${availableNames.join(", ") || "(none)"}`,
        details,
      });
    }
    return match.source;
  }
  if (blocks.length > 1) {
    const details: Record<string, string | number | string[]> = {
      count: blocks.length,
      available: names,
      available_names: availableNames,
    };
    if (unnamedCount > 1) details.unnamed_block_count = unnamedCount;
    throw new MacroExtractError({
      reason: "ambiguous_macro_block",
      message: `Document has ${blocks.length} macro blocks; use a '::name' selector. Available: ${availableNames.join(", ")}`,
      details,
    });
  }
  return blocks[0].source;
}

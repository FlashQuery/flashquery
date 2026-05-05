/**
 * Reference resolver for call_model — Phase 109.
 *
 * Scans MCP message content strings for `{{ref:...}}` and `{{id:...}}` placeholders,
 * resolves each via `resolveAndBuildDocument` (from document-output.ts), and produces
 * hydrated messages plus injection metadata. Used by the `call_model` handler at Step 1.5.
 *
 * Implements: REFS-01 (detection), REFS-02 (# / -> mutual exclusion), REFS-03 (hydration),
 * REFS-04 (injected_references shape), REFS-05 (prompt_chars), REFS-07 (no-op empty).
 */

import type { FlashQueryConfig } from '../config/loader.js';
import { resolveAndBuildDocument, DocumentRequestError } from '../mcp/utils/document-output.js';
import type { logger } from '../logging/logger.js';
import type { supabaseManager } from '../storage/supabase.js';
import type { embeddingProvider } from '../embedding/provider.js';
import {
  isReferenceFailureReason,
  type ReferenceFailureReason,
} from '../constants/reference-failures.js';
import {
  AmbiguousDocumentIdentifierError,
  DocumentNotFoundError,
  DocumentReadError,
} from '../mcp/utils/resolve-document.js';

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedRef {
  placeholder: string;       // full match WITH delimiters: "{{ref:Research/doc.md#Open Questions}}"
  ref: string;               // WITH delimiters (identical to placeholder): "{{ref:Research/doc.md#Open Questions}}"
  identifierType: 'ref';
  identifier: string;        // path or uuid — everything before # or -> (or end)
  alias?: string;
  section?: string;          // present only when # operator used
  pointer?: string;          // present only when -> operator used
  messageIndex: number;      // 0-based index of source message in the messages array
  start?: number;
  end?: number;
  literalPrefix?: string;
}

export interface ParseRefError {
  error: 'invalid_reference_syntax';
  ref: string;     // WITH {{ }} delimiters: "{{ref:doc.md#Sec->pointer}}"
  reason: string;  // exact string: "invalid reference syntax: # and -> are mutually exclusive"
  detail?: string;
}

export interface ResolvedRef {
  kind: 'resolved';          // discriminant — guards against misclassification as FailedRef
  placeholder: string;       // original full placeholder for hydrateMessages string-replace
  ref: string;               // WITH delimiters (for injected_references[].ref): "{{ref:Research/doc.md#Open Questions}}"
  content: string;           // body text to inject (may be empty string)
  chars: number;             // content.length
  identifier?: string;
  resolvedTo?: string;       // target vault-relative path when it diverges from the supplied ref, or for -> dereferences
  messageIndex: number;      // 0-based index for hydrateMessages filtering
  start?: number;
  end?: number;
  literalPrefix?: string;
}

export interface FailedRef {
  kind: 'failed';            // discriminant — enables reliable type guard without duck-typing
  ref: string;               // WITH delimiters (for failed_references[].ref): "{{ref:missing.md}}"
  reason: ReferenceFailureReason;
  detail: string;
}

export interface InjectionMetadata {
  injectedReferences: Array<{ ref: string; chars: number; resolved_to?: string }>;
  promptChars: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseReferences — pure-logic regex scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan all message content strings for active {{ref:...}} placeholders.
 *
 * Returns a flat ParsedRef[] (one entry per match, duplicates preserved).
 * Returns ParseRefError immediately when active placeholder grammar is invalid.
 * Returns empty array when no patterns are found (REFS-07 enabling no-op).
 */
export function parseReferences(
  messages: Array<{ role: string; content: string }>
): ParsedRef[] | ParseRefError {
  const results: ParsedRef[] = [];
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const content = messages[msgIdx].content;
    for (const span of scanReferenceSpans(content)) {
      if (span.kind === 'escaped') continue;
      const parsed = parseActiveSpan(span, msgIdx);
      if ('error' in parsed) return parsed;
      results.push(parsed);
    }
  }
  return results;
}

interface ReferenceSpan {
  kind: 'active' | 'escaped';
  placeholder: string;
  inner: string;
  start: number;
  openerStart: number;
  end: number;
  literalPrefix: string;
}

function scanReferenceSpans(content: string): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];
  let searchFrom = 0;
  while (searchFrom < content.length) {
    const openerStart = content.indexOf('{{ref:', searchFrom);
    if (openerStart === -1) break;

    let slashStart = openerStart;
    while (slashStart > 0 && content[slashStart - 1] === '\\') {
      slashStart--;
    }
    const slashCount = openerStart - slashStart;
    const close = content.indexOf('}}', openerStart + 6);
    if (close === -1) {
      searchFrom = openerStart + 6;
      continue;
    }

    const placeholder = content.slice(openerStart, close + 2);
    const inner = content.slice(openerStart + 6, close);
    if (inner.includes('{{')) {
      searchFrom = close + 2;
      continue;
    }
    const isEscaped = slashCount % 2 === 1;
    spans.push({
      kind: isEscaped ? 'escaped' : 'active',
      placeholder,
      inner,
      start: slashStart,
      openerStart,
      end: close + 2,
      literalPrefix: '\\'.repeat(isEscaped ? Math.floor(slashCount / 2) : slashCount / 2),
    });
    searchFrom = close + 2;
  }
  return spans;
}

function parseActiveSpan(span: ReferenceSpan, messageIndex: number): ParsedRef | ParseRefError {
  const placeholder = span.placeholder;
  const inner = span.inner;

  const invalid = (detail: string): ParseRefError => ({
    error: 'invalid_reference_syntax',
    ref: placeholder,
    reason: detail === '# and -> are mutually exclusive'
      ? 'invalid reference syntax: # and -> are mutually exclusive'
      : detail,
    detail,
  });

  if (inner.startsWith('@')) {
    const alias = inner.slice(1);
    if (!alias) return invalid('alias key is empty');
    if (alias.includes('#')) return invalid('alias references cannot use #');
    if (alias.includes('->')) return invalid('alias references cannot use ->');
    return {
      placeholder,
      ref: placeholder,
      identifierType: 'ref',
      identifier: alias,
      alias,
      messageIndex,
      start: span.start,
      end: span.end,
      literalPrefix: span.literalPrefix,
    };
  }

  const arrowIdx = inner.indexOf('->');
  const hashIdx = inner.indexOf('#');
  if (arrowIdx !== -1 && hashIdx !== -1) {
    return invalid('# and -> are mutually exclusive');
  }
  if (hashIdx !== -1 && (inner[hashIdx - 1] === ' ' || inner[hashIdx + 1] === ' ')) {
    return invalid('whitespace around # is not permitted');
  }
  if (arrowIdx !== -1 && (inner[arrowIdx - 1] === ' ' || inner[arrowIdx + 2] === ' ')) {
    return invalid('whitespace around -> is not permitted');
  }

  let identifier = inner;
  let section: string | undefined;
  let pointer: string | undefined;
  if (arrowIdx !== -1) {
    identifier = inner.slice(0, arrowIdx);
    pointer = inner.slice(arrowIdx + 2);
    if (!pointer) return invalid('pointer is empty');
  } else if (hashIdx !== -1) {
    identifier = inner.slice(0, hashIdx);
    section = inner.slice(hashIdx + 1);
    if (!section) return invalid('section is empty');
  }
  if (!identifier) return invalid('identifier is empty');

  return {
    placeholder,
    ref: placeholder,
    identifierType: 'ref',
    identifier,
    section,
    pointer,
    messageIndex,
    start: span.start,
    end: span.end,
    literalPrefix: span.literalPrefix,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveReferences — async Promise.all resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve each ParsedRef via resolveAndBuildDocument in parallel (Promise.all).
 *
 * Returns a mixed array of ResolvedRef (success) and FailedRef (error) entries.
 * DocumentRequestError maps to FailedRef using err.envelope.message.
 * Generic Error maps to FailedRef using err.message.
 */
export async function resolveReferences(
  parsed: ParsedRef[],
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<Array<ResolvedRef | FailedRef>> {
  return Promise.all(parsed.map(async (p): Promise<ResolvedRef | FailedRef> => {
    try {
      const result = await resolveAndBuildDocument(
        p.identifier,
        {
          effectiveInclude: ['body'],
          sectionsList: p.section ? [p.section] : [],
          effectiveIncludeNested: true,
          occurrence: 1,
          effectiveMaxDepth: 6,
          followRef: p.pointer,
        },
        { config, supabaseManager: sm, embeddingProvider: ep, logger: log }
      );
      let content: string;
      let resolvedTo: string | undefined;
      if (p.pointer) {
        const fr = result.followed_ref as Record<string, unknown> | undefined;
        content = (fr?.body as string | undefined) ?? '';
        resolvedTo = fr?.resolved_to as string | undefined;
      } else {
        content = (result.body as string | undefined) ?? '';
        const resultPath = typeof result.path === 'string' ? result.path : undefined;
        if (resultPath !== undefined && normalizedReferencePath(resultPath) !== normalizedReferencePath(p.identifier)) {
          resolvedTo = resultPath;
        }
      }
      const out: ResolvedRef = {
        kind: 'resolved',
        placeholder: p.placeholder,
        ref: p.ref,
        content,
        chars: content.length,
        identifier: p.identifier,
        messageIndex: p.messageIndex,
        start: p.start,
        end: p.end,
        literalPrefix: p.literalPrefix,
      };
      if (resolvedTo !== undefined) {
        out.resolvedTo = resolvedTo;
      }
      return out;
    } catch (err) {
      const mapped = mapReferenceFailure(err, p.ref, log);
      return { kind: 'failed' as const, ref: p.ref, reason: mapped.reason, detail: mapped.detail };
    }
	  }));
}

function normalizedReferencePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function mapReferenceFailure(
  err: unknown,
  ref: string,
  log: typeof logger
): { reason: ReferenceFailureReason; detail: string } {
  const fallbackDetail = err instanceof Error ? err.message : String(err);
  if (err instanceof DocumentRequestError) {
    const envelopeError = typeof err.envelope.error === 'string' ? err.envelope.error : '';
    const detail = (err.envelope.message as string | undefined) ?? fallbackDetail;
    const mapped: Record<string, ReferenceFailureReason> = {
      follow_ref_path_not_found: 'reference_path_not_found',
      follow_ref_invalid_type: 'reference_path_not_string',
      follow_ref_target_not_found: 'pointer_target_not_found',
      section_not_found: 'section_not_found',
      occurrence_out_of_range: 'occurrence_out_of_range',
    };
    if (envelopeError in mapped) {
      return { reason: mapped[envelopeError], detail };
    }
    if (isReferenceFailureReason(envelopeError)) {
      return { reason: envelopeError, detail };
    }
  }

  if (err instanceof AmbiguousDocumentIdentifierError) {
    return { reason: 'ambiguous_document_identifier', detail: fallbackDetail };
  }
  if (err instanceof DocumentNotFoundError) {
    return { reason: 'document_not_found', detail: fallbackDetail };
  }
  if (err instanceof DocumentReadError || isNodeReadError(err)) {
    return { reason: 'read_error', detail: fallbackDetail };
  }

  log.warn(`reference_failure_unclassified ref=${ref} detail=${fallbackDetail}`);
  return { reason: 'unknown_reference_error', detail: fallbackDetail };
}

function isNodeReadError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EISDIR';
}

// ─────────────────────────────────────────────────────────────────────────────
// hydrateMessages — single-pass placeholder replacement (REFS-03)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace each placeholder in the messages array with its resolved content.
 *
 * Produces a NEW messages array (never mutates the input).
 * Single-pass replacement using position-aware substitution: for each message,
 * locate all placeholder positions in the ORIGINAL content string before any
 * replacement occurs, then apply them right-to-left. This ensures that content
 * injected for one placeholder cannot introduce a spurious match for another
 * placeholder (Pitfall 7, T-109-08). Each ResolvedRef replaces its own original
 * occurrence; duplicate placeholders each get their own occurrence resolved
 * left-to-right.
 */
export function hydrateMessages<T extends { role: string; content?: string | null }>(
  messages: T[],
  resolved: ResolvedRef[]
): T[] {
  const byMsgIdx = new Map<number, ResolvedRef[]>();
  for (const r of resolved) {
    const arr = byMsgIdx.get(r.messageIndex) ?? [];
    arr.push(r);
    byMsgIdx.set(r.messageIndex, arr);
  }
  return messages.map((msg, idx) => {
    if (typeof msg.content !== 'string') {
      return { ...msg };
    }
    const refs = byMsgIdx.get(idx);
    const original = msg.content;
    const replacements: Array<{ start: number; end: number; content: string }> = [];
    for (const r of refs ?? []) {
      if (r.start !== undefined && r.end !== undefined) {
        replacements.push({
          start: r.start,
          end: r.end,
          content: `${r.literalPrefix ?? ''}${r.content}`,
        });
        continue;
      }
      const i = findNextPlaceholder(original, replacements, r.ref);
      if (i !== -1) {
        replacements.push({ start: i, end: i + r.placeholder.length, content: r.content });
      }
    }
    for (const span of scanReferenceSpans(original)) {
      if (span.kind === 'escaped') {
        replacements.push({
          start: span.start,
          end: span.end,
          content: `${span.literalPrefix}${span.placeholder}`,
        });
      }
    }
    if (replacements.length === 0) {
      return { ...msg }; // shallow copy — never return same reference
    }
    // Sort right-to-left so applying by position doesn't shift earlier indices
    replacements.sort((a, b) => b.start - a.start);
    let content = original;
    for (const rep of replacements) {
      content = content.slice(0, rep.start) + rep.content + content.slice(rep.end);
    }
    return { ...msg, content };
  });
}

function findNextPlaceholder(
  original: string,
  replacements: Array<{ start: number; end: number; content: string }>,
  placeholder: string
): number {
  let cursor = 0;
  while (cursor < original.length) {
    const i = original.indexOf(placeholder, cursor);
    if (i === -1) return -1;
    const occupied = replacements.some((r) => i >= r.start && i < r.end);
    if (!occupied) return i;
    cursor = i + placeholder.length;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildInjectedReferences — response metadata builder (REFS-04)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the injected_references[] metadata array from resolved references.
 *
 * Each entry has { ref, chars } always present.
 * resolved_to is ONLY present (as a key) for -> dereferences — it is omitted
 * entirely (not set to undefined) when not applicable (U-RR-14).
 */
export function buildInjectedReferences(
  resolved: ResolvedRef[]
): Array<{ ref: string; chars: number; resolved_to?: string }> {
  return resolved.map((r) => {
    const entry: { ref: string; chars: number; resolved_to?: string } = {
      ref: r.ref,
      chars: r.chars,
    };
    if (r.resolvedTo !== undefined) {
      entry.resolved_to = r.resolvedTo;
    }
    return entry;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// computePromptChars — total post-hydration character count (REFS-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum content.length across all messages after hydration.
 * Called on the hydrated messages array (not the original).
 */
export function computePromptChars(
  messages: Array<{ content?: string | null }>
): number {
  return messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
}

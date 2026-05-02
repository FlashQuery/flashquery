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

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedRef {
  placeholder: string;       // full match WITH delimiters: "{{ref:Research/doc.md#Open Questions}}"
  ref: string;               // WITH delimiters (identical to placeholder): "{{ref:Research/doc.md#Open Questions}}"
  identifierType: 'ref' | 'id';
  identifier: string;        // path or uuid — everything before # or -> (or end)
  section?: string;          // present only when # operator used
  pointer?: string;          // present only when -> operator used
  messageIndex: number;      // 0-based index of source message in the messages array
}

export interface ParseRefError {
  error: 'invalid_reference_syntax';
  ref: string;     // WITH {{ }} delimiters: "{{ref:doc.md#Sec->pointer}}"
  reason: string;  // exact string: "invalid reference syntax: # and -> are mutually exclusive"
}

export interface ResolvedRef {
  kind: 'resolved';          // discriminant — guards against misclassification as FailedRef
  placeholder: string;       // original full placeholder for hydrateMessages string-replace
  ref: string;               // WITH delimiters (for injected_references[].ref): "{{ref:Research/doc.md#Open Questions}}"
  content: string;           // body text to inject (may be empty string)
  chars: number;             // content.length
  resolvedTo?: string;       // target vault-relative path; ONLY for -> dereferences
  messageIndex: number;      // 0-based index for hydrateMessages filtering
}

export interface FailedRef {
  kind: 'failed';            // discriminant — enables reliable type guard without duck-typing
  ref: string;               // WITH delimiters (for failed_references[].ref): "{{ref:missing.md}}"
  reason: string;            // human-readable error from resolveAndBuildDocument
}

export interface InjectionMetadata {
  injectedReferences: Array<{ ref: string; chars: number; resolved_to?: string }>;
  promptChars: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseReferences — pure-logic regex scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan all message content strings for {{ref:...}} and {{id:...}} placeholders.
 *
 * Returns a flat ParsedRef[] (one entry per match, duplicates preserved).
 * Returns ParseRefError immediately when a placeholder contains both # and -> (REFS-02).
 * Returns empty array when no patterns are found (REFS-07 enabling no-op).
 *
 * CRITICAL: The regex is created INSIDE this function body (not at module scope)
 * to prevent /g lastIndex state from leaking between calls (RESEARCH.md Pitfall 4).
 */
export function parseReferences(
  messages: Array<{ role: string; content: string }>
): ParsedRef[] | ParseRefError {
  const results: ParsedRef[] = [];
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const content = messages[msgIdx].content;
    // Regex created fresh per-call to prevent lastIndex state leak (Pitfall 4)
    const REFERENCE_RE = /\{\{(ref|id):([^}]*?)\}\}/g;
    for (const match of content.matchAll(REFERENCE_RE)) {
      const placeholder = match[0];
      const identifierType = match[1] as 'ref' | 'id';
      const inner = match[2];
      const ref = placeholder; // WITH {{...}} delimiters, identical to placeholder
      const arrowIdx = inner.indexOf('->');
      const hashIdx = inner.indexOf('#');
      // REFS-02: # and -> are mutually exclusive in one placeholder
      if (arrowIdx !== -1 && hashIdx !== -1) {
        return {
          error: 'invalid_reference_syntax',
          ref: placeholder, // WITH {{...}} delimiters
          reason: 'invalid reference syntax: # and -> are mutually exclusive',
        };
      }
      let identifier: string;
      let section: string | undefined;
      let pointer: string | undefined;
      if (arrowIdx !== -1) {
        identifier = inner.slice(0, arrowIdx);
        pointer = inner.slice(arrowIdx + 2);
      } else if (hashIdx !== -1) {
        identifier = inner.slice(0, hashIdx);
        section = inner.slice(hashIdx + 1);
      } else {
        identifier = inner;
      }
      results.push({ placeholder, ref, identifierType, identifier, section, pointer, messageIndex: msgIdx });
    }
  }
  return results;
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
      }
      const out: ResolvedRef = {
        kind: 'resolved',
        placeholder: p.placeholder,
        ref: p.ref,
        content,
        chars: content.length,
        messageIndex: p.messageIndex,
      };
      if (resolvedTo !== undefined) {
        out.resolvedTo = resolvedTo;
      }
      return out;
    } catch (err) {
      let reason: string;
      if (err instanceof DocumentRequestError) {
        reason = (err.envelope.message as string | undefined) ?? err.message;
      } else if (err instanceof Error) {
        reason = err.message;
      } else {
        reason = String(err);
      }
      return { kind: 'failed' as const, ref: p.ref, reason };
    }
  }));
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
export function hydrateMessages(
  messages: Array<{ role: string; content: string }>,
  resolved: ResolvedRef[]
): Array<{ role: string; content: string }> {
  const byMsgIdx = new Map<number, ResolvedRef[]>();
  for (const r of resolved) {
    const arr = byMsgIdx.get(r.messageIndex) ?? [];
    arr.push(r);
    byMsgIdx.set(r.messageIndex, arr);
  }
  return messages.map((msg, idx) => {
    const refs = byMsgIdx.get(idx);
    if (!refs || refs.length === 0) {
      return { ...msg }; // shallow copy — never return same reference
    }
    // Locate each placeholder's position in the ORIGINAL content before any replacement.
    // For duplicate placeholders, track a search cursor per placeholder so each
    // occurrence maps to its own ResolvedRef (left-to-right order).
    const original = msg.content;
    const cursors = new Map<string, number>(); // placeholder -> next search start
    const replacements: Array<{ start: number; end: number; content: string }> = [];
    for (const r of refs) {
      const cursor = cursors.get(r.placeholder) ?? 0;
      const i = original.indexOf(r.placeholder, cursor);
      if (i !== -1) {
        replacements.push({ start: i, end: i + r.placeholder.length, content: r.content });
        cursors.set(r.placeholder, i + r.placeholder.length);
      }
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
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

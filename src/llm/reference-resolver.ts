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
import type { TemplateWarning } from '../constants/template-warnings.js';
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
  template?: boolean;
  templatePath?: string;
  templateParamsUsed?: Record<string, TemplateParamUsage>;
  templateWarnings?: TemplateWarning[];
  resolvedToCount?: number;
  items?: TemplateItemMetadata[];
}

export interface FailedRef {
  kind: 'failed';            // discriminant — enables reliable type guard without duck-typing
  ref: string;               // WITH delimiters (for failed_references[].ref): "{{ref:missing.md}}"
  reason: ReferenceFailureReason;
  detail: string;
}

export interface TemplateParamsInput {
  [key: string]: Record<string, unknown>;
}

export interface TemplateParamDeclaration {
  type: 'string' | 'document';
  required?: boolean;
  default?: unknown;
}

export interface TemplateParamUsage {
  type: 'string' | 'document';
  chars: number;
  input?: string;
  resolved_to?: string;
}

export interface TemplateItemMetadata {
  input: string;
  chars: number;
  resolved_to?: string;
  template?: boolean;
  template_path?: string;
  template_params_used?: Record<string, TemplateParamUsage>;
  template_warnings?: TemplateWarning[];
}

export interface InjectedReferenceMetadata {
  ref: string;
  chars: number;
  resolved_to?: string;
  template?: boolean;
  template_path?: string;
  template_params_used?: Record<string, TemplateParamUsage>;
  template_warnings?: TemplateWarning[];
  resolved_to_count?: number;
  items?: TemplateItemMetadata[];
}

export interface InjectionMetadata {
  injectedReferences: InjectedReferenceMetadata[];
  promptChars: number;
}

export interface RenderTemplateDocumentSuccess {
  ok: true;
  content: string;
  paramsUsed: Record<string, TemplateParamUsage>;
  warnings: TemplateWarning[];
}

export interface RenderTemplateDocumentFailure {
  ok: false;
  reason: ReferenceFailureReason;
  detail: string;
}

export type RenderTemplateDocumentResult = RenderTemplateDocumentSuccess | RenderTemplateDocumentFailure;

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
  log: typeof logger,
  templateParams?: TemplateParamsInput
): Promise<Array<ResolvedRef | FailedRef>> {
  return Promise.all(parsed.map(async (p): Promise<ResolvedRef | FailedRef> => {
    try {
      if (p.alias) {
        return await resolveAliasReference(p, config, sm, ep, log, templateParams);
      }
      const result = await resolveAndBuildDocument(
        p.identifier,
        {
          effectiveInclude: ['body', 'frontmatter'],
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
        if (fr !== undefined && isTemplateDocument(fr)) {
          const templatePath = resolvedTo ?? p.identifier;
          const rendered = await renderTemplateReference(
            content,
            fr,
            getTemplateEntryForPath(templateParams, p.identifier, templatePath),
            config,
            sm,
            ep,
            log
          );
          content = rendered.content;
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
            template: true,
            templatePath,
            templateParamsUsed: rendered.paramsUsed,
          };
          if (rendered.warnings.length > 0) {
            out.templateWarnings = rendered.warnings;
          }
          if (resolvedTo !== undefined) {
            out.resolvedTo = resolvedTo;
          }
          return out;
        }
      } else {
        content = (result.body as string | undefined) ?? '';
        const resultPath = typeof result.path === 'string' ? result.path : undefined;
        if (resultPath !== undefined && normalizedReferencePath(resultPath) !== normalizedReferencePath(p.identifier)) {
          resolvedTo = resultPath;
        }
        if (isTemplateDocument(result)) {
          const templatePath = resultPath ?? p.identifier;
          const rendered = await renderTemplateReference(
            content,
            result,
            getTemplateEntryForPath(templateParams, p.identifier, templatePath),
            config,
            sm,
            ep,
            log
          );
          content = rendered.content;
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
            template: true,
            templatePath,
            templateParamsUsed: rendered.paramsUsed,
          };
          if (rendered.warnings.length > 0) {
            out.templateWarnings = rendered.warnings;
          }
          if (resolvedTo !== undefined) {
            out.resolvedTo = resolvedTo;
          }
          return out;
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
      if (err instanceof TemplateReferenceError) {
        return { kind: 'failed' as const, ref: p.ref, reason: err.reason, detail: err.message };
      }
      const mapped = mapReferenceFailure(err, p.ref, log);
      return { kind: 'failed' as const, ref: p.ref, reason: mapped.reason, detail: mapped.detail };
    }
	  }));
}

class TemplateReferenceError extends Error {
  constructor(public reason: ReferenceFailureReason, message: string) {
    super(message);
    this.name = 'TemplateReferenceError';
  }
}

const RESERVED_TEMPLATE_PARAM_KEYS = new Set(['_template', '_items', '_separator']);

export function isTemplateDocument(result: Record<string, unknown>): boolean {
  const frontmatter = result.frontmatter;
  return typeof frontmatter === 'object' &&
    frontmatter !== null &&
    (frontmatter as Record<string, unknown>).fq_template === true;
}

export function getTemplateEntryForPath(
  templateParams: TemplateParamsInput | undefined,
  identifier: string,
  resolvedPath?: string
): Record<string, unknown> {
  if (!templateParams) return {};
  const direct = templateParams[identifier];
  if (direct) return direct;
  if (resolvedPath) {
    return templateParams[resolvedPath] ?? templateParams[normalizedReferencePath(resolvedPath)] ?? {};
  }
  return {};
}

export function normalizeTemplateParamDeclarations(
  raw: unknown
): Record<string, TemplateParamDeclaration> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const declarations: Record<string, TemplateParamDeclaration> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (record.type !== 'string' && record.type !== 'document') continue;
    const declaration: TemplateParamDeclaration = { type: record.type };
    if (typeof record.required === 'boolean') {
      declaration.required = record.required;
    }
    if (Object.prototype.hasOwnProperty.call(record, 'default')) {
      declaration.default = record.default;
    }
    declarations[name] = declaration;
  }
  return declarations;
}

export function buildTemplateMetadata(r: ResolvedRef): InjectedReferenceMetadata {
  const entry: InjectedReferenceMetadata = {
    ref: r.ref,
    chars: r.chars,
  };
  if (r.resolvedTo !== undefined) {
    entry.resolved_to = r.resolvedTo;
  }
  if (r.template === true) {
    entry.template = true;
  }
  if (r.templatePath !== undefined) {
    entry.template_path = r.templatePath;
  }
  if (r.templateParamsUsed !== undefined) {
    entry.template_params_used = r.templateParamsUsed;
  }
  if (r.templateWarnings !== undefined && r.templateWarnings.length > 0) {
    entry.template_warnings = r.templateWarnings;
  }
  if (r.resolvedToCount !== undefined) {
    entry.resolved_to_count = r.resolvedToCount;
  }
  if (r.items !== undefined) {
    entry.items = r.items;
  }
  return entry;
}

async function resolveAliasReference(
  p: ParsedRef,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger,
  templateParams?: TemplateParamsInput
): Promise<ResolvedRef | FailedRef> {
  const alias = p.alias ?? p.identifier;
  const entry = templateParams?.[alias];
  if (!entry) {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'alias_key_not_found',
      detail: `Alias '${alias}' not found in template_params`,
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(entry, '_items') &&
    Object.prototype.hasOwnProperty.call(entry, '_template')
  ) {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'multi_ref_invalid_value',
      detail: `Alias '${alias}' cannot specify both _items and _template`,
    };
  }

  if (Object.prototype.hasOwnProperty.call(entry, '_items')) {
    return await resolveAliasItems(p, alias, entry, config, sm, ep, log);
  }

  const templateIdentifier = entry._template;
  if (typeof templateIdentifier !== 'string' || templateIdentifier.length === 0) {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'alias_missing_template_field',
      detail: `Alias '${alias}' is missing required _template field`,
    };
  }
  if (templateIdentifier.startsWith('@')) {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'alias_template_not_found',
      detail: `Alias '${alias}' _template cannot reference another alias`,
    };
  }

  try {
    const result = await resolveTemplateSource(templateIdentifier, config, sm, ep, log);
    const body = (result.body as string | undefined) ?? '';
    const templatePath = typeof result.path === 'string' ? result.path : templateIdentifier;
    if (!isTemplateDocument(result)) {
      return {
        kind: 'resolved',
        placeholder: p.placeholder,
        ref: p.ref,
        content: body,
        chars: body.length,
        identifier: templateIdentifier,
        messageIndex: p.messageIndex,
        start: p.start,
        end: p.end,
        literalPrefix: p.literalPrefix,
        resolvedTo: templatePath,
      };
    }
    const rendered = await renderTemplateReference(body, result, entry, config, sm, ep, log);
    const out: ResolvedRef = {
      kind: 'resolved',
      placeholder: p.placeholder,
      ref: p.ref,
      content: rendered.content,
      chars: rendered.content.length,
      identifier: templateIdentifier,
      messageIndex: p.messageIndex,
      start: p.start,
      end: p.end,
      literalPrefix: p.literalPrefix,
      resolvedTo: templatePath,
      template: true,
      templatePath,
      templateParamsUsed: rendered.paramsUsed,
    };
    if (rendered.warnings.length > 0) {
      out.templateWarnings = rendered.warnings;
    }
    return out;
  } catch (err) {
    if (err instanceof TemplateReferenceError) {
      return { kind: 'failed', ref: p.ref, reason: err.reason, detail: err.message };
    }
    const mapped = mapReferenceFailure(err, p.ref, log);
    return { kind: 'failed', ref: p.ref, reason: 'alias_template_not_found', detail: mapped.detail };
  }
}

async function resolveAliasItems(
  p: ParsedRef,
  alias: string,
  entry: Record<string, unknown>,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<ResolvedRef | FailedRef> {
  const rawItems = entry._items;
  if (!Array.isArray(rawItems)) {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'multi_ref_invalid_value',
      detail: `Alias '${alias}' _items must be an array`,
    };
  }
  const hasSeparator = Object.prototype.hasOwnProperty.call(entry, '_separator');
  if (hasSeparator && typeof entry._separator !== 'string') {
    return {
      kind: 'failed',
      ref: p.ref,
      reason: 'multi_ref_invalid_value',
      detail: `Alias '${alias}' _separator must be a string`,
    };
  }
  const separator = hasSeparator ? (entry._separator as string) : '\n\n';
  const contents: string[] = [];
  const items: NonNullable<ResolvedRef['items']> = [];
  for (let index = 0; index < rawItems.length; index++) {
    const item: unknown = rawItems[index];
    try {
      if (typeof item === 'string') {
        const result = await resolveItemStringContent(item, config, sm, ep, log);
        contents.push(result.content);
        const metadata: NonNullable<ResolvedRef['items']>[number] = {
          input: item,
          chars: result.content.length,
        };
        if (result.path !== undefined) {
          metadata.resolved_to = result.path;
        }
        if (result.template === true) {
          metadata.template = true;
        }
        if (result.templatePath !== undefined) {
          metadata.template_path = result.templatePath;
        }
        if (result.templateParamsUsed !== undefined) {
          metadata.template_params_used = result.templateParamsUsed;
        }
        if (result.templateWarnings !== undefined && result.templateWarnings.length > 0) {
          metadata.template_warnings = result.templateWarnings;
        }
        items.push(metadata);
        continue;
      }
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const itemEntry = item as Record<string, unknown>;
        const templateIdentifier = itemEntry._template;
        if (typeof templateIdentifier !== 'string' || templateIdentifier.length === 0) {
          throw new TemplateReferenceError('alias_missing_template_field', `Alias '${alias}' item ${index} is missing _template`);
        }
        const result = await resolveTemplateSource(templateIdentifier, config, sm, ep, log);
        const body = (result.body as string | undefined) ?? '';
        const templatePath = typeof result.path === 'string' ? result.path : templateIdentifier;
        if (!isTemplateDocument(result)) {
          contents.push(body);
          items.push({
            input: templateIdentifier,
            resolved_to: templatePath,
            chars: body.length,
          });
          continue;
        }
        const rendered = await renderTemplateReference(body, result, itemEntry, config, sm, ep, log);
        contents.push(rendered.content);
        const itemMetadata: TemplateItemMetadata = {
          input: templateIdentifier,
          resolved_to: templatePath,
          chars: rendered.content.length,
          template: true,
          template_path: templatePath,
          template_params_used: rendered.paramsUsed,
        };
        if (rendered.warnings.length > 0) {
          itemMetadata.template_warnings = rendered.warnings;
        }
        items.push(itemMetadata);
        continue;
      }
      throw new TemplateReferenceError('multi_ref_invalid_value', `Alias '${alias}' item ${index} must be a string or template object`);
    } catch (err) {
      if (err instanceof TemplateReferenceError && err.reason === 'multi_ref_invalid_value') {
        return {
          kind: 'failed',
          ref: p.ref,
          reason: 'multi_ref_invalid_value',
          detail: `alias=${alias} index=${index}: ${err.message}`,
        };
      }
      if (err instanceof TemplateReferenceError && err.reason === 'alias_missing_template_field') {
        return {
          kind: 'failed',
          ref: p.ref,
          reason: 'multi_ref_invalid_value',
          detail: `alias=${alias} index=${index}: item object lacks _template`,
        };
      }
      const reason = err instanceof TemplateReferenceError
        ? err.reason
        : mapItemResolutionFailure(err, log).reason;
      const detail = err instanceof Error ? err.message : String(err);
      return {
        kind: 'failed',
        ref: p.ref,
        reason: 'multi_ref_item_failed',
        detail: `alias=${alias} index=${index} item ${index} failed with ${reason}: ${detail}`,
      };
    }
  }
  const content = contents.join(separator);
  return {
    kind: 'resolved',
    placeholder: p.placeholder,
    ref: p.ref,
    content,
    chars: content.length,
    identifier: alias,
    messageIndex: p.messageIndex,
    start: p.start,
    end: p.end,
    literalPrefix: p.literalPrefix,
    resolvedToCount: items.length,
    items,
    templateParamsUsed: {},
  };
}

async function resolveTemplateSource(
  identifier: string,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<Record<string, unknown>> {
  return await resolveAndBuildDocument(
    identifier,
    {
      effectiveInclude: ['body', 'frontmatter'],
      sectionsList: [],
      effectiveIncludeNested: true,
      occurrence: 1,
      effectiveMaxDepth: 6,
      followRef: undefined,
    },
    { config, supabaseManager: sm, embeddingProvider: ep, logger: log }
  );
}

async function resolvePlainDocumentContent(
  identifier: string,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<{ content: string; path?: string }> {
  const result = await resolveAndBuildDocument(
    identifier,
    {
      effectiveInclude: ['body'],
      sectionsList: [],
      effectiveIncludeNested: true,
      occurrence: 1,
      effectiveMaxDepth: 6,
      followRef: undefined,
    },
    { config, supabaseManager: sm, embeddingProvider: ep, logger: log }
  );
  return {
    content: (result.body as string | undefined) ?? '',
    path: typeof result.path === 'string' ? result.path : identifier,
  };
}

async function resolveItemStringContent(
  item: string,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<{
  content: string;
  path?: string;
  template?: boolean;
  templatePath?: string;
  templateParamsUsed?: Record<string, TemplateParamUsage>;
  templateWarnings?: TemplateWarning[];
}> {
  const parsed = parseNonAliasItemReference(item);
  const result = await resolveAndBuildDocument(
    parsed.identifier,
    {
      effectiveInclude: ['body', 'frontmatter'],
      sectionsList: parsed.section ? [parsed.section] : [],
      effectiveIncludeNested: true,
      occurrence: 1,
      effectiveMaxDepth: 6,
      followRef: parsed.pointer,
    },
    { config, supabaseManager: sm, embeddingProvider: ep, logger: log }
  );

  if (parsed.pointer) {
    const followedRef = result.followed_ref as Record<string, unknown> | undefined;
    const content = (followedRef?.body as string | undefined) ?? '';
    const path = (followedRef?.resolved_to as string | undefined) ?? (typeof result.path === 'string' ? result.path : parsed.identifier);
    if (followedRef !== undefined && isTemplateDocument(followedRef)) {
      const rendered = await renderTemplateReference(content, followedRef, {}, config, sm, ep, log);
      return {
        content: rendered.content,
        path,
        template: true,
        templatePath: path,
        templateParamsUsed: rendered.paramsUsed,
        templateWarnings: rendered.warnings,
      };
    }
    return {
      content,
      path,
    };
  }

  const body = (result.body as string | undefined) ?? '';
  const resultPath = typeof result.path === 'string' ? result.path : parsed.identifier;
  if (isTemplateDocument(result)) {
    const rendered = await renderTemplateReference(body, result, {}, config, sm, ep, log);
    return {
      content: rendered.content,
      path: resultPath,
      template: true,
      templatePath: resultPath,
      templateParamsUsed: rendered.paramsUsed,
      templateWarnings: rendered.warnings,
    };
  }

  return {
    content: body,
    path: resultPath,
  };
}

function parseNonAliasItemReference(item: string): Pick<ParsedRef, 'identifier' | 'section' | 'pointer'> {
  const parsed = parseActiveSpan(
    {
      kind: 'active',
      placeholder: `{{ref:${item}}}`,
      inner: item,
      start: 0,
      openerStart: 0,
      end: item.length + 8,
      literalPrefix: '',
    },
    0
  );
  if ('error' in parsed) {
    throw new TemplateReferenceError('multi_ref_invalid_value', parsed.detail ?? parsed.reason);
  }
  if (parsed.alias) {
    throw new TemplateReferenceError('multi_ref_invalid_value', '_items string entries cannot reference aliases');
  }
  return {
    identifier: parsed.identifier,
    section: parsed.section,
    pointer: parsed.pointer,
  };
}

async function renderTemplateReference(
  body: string,
  result: Record<string, unknown>,
  rawParams: Record<string, unknown>,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<{
  content: string;
  paramsUsed: Record<string, TemplateParamUsage>;
  warnings: TemplateWarning[];
}> {
  const frontmatter = result.frontmatter as Record<string, unknown> | undefined;
  const declarations = normalizeTemplateParamDeclarations(frontmatter?.fq_params);
  const values: Record<string, string> = {};
  const paramsUsed: Record<string, TemplateParamUsage> = {};
  const warnings: TemplateWarning[] = [];
  const cleanParams = stripReservedTemplateParams(rawParams);

  for (const key of Object.keys(cleanParams)) {
    if (!(key in declarations)) {
      warnings.push({ type: 'unknown_param_ignored', param: key });
    }
  }

  for (const [name, declaration] of Object.entries(declarations)) {
    const hasSupplied = Object.prototype.hasOwnProperty.call(cleanParams, name);
    const hasDefault = Object.prototype.hasOwnProperty.call(declaration, 'default');
    let rawValue = hasSupplied ? cleanParams[name] : declaration.default;

    if (hasSupplied && rawValue === null && declaration.required !== true) {
      if (hasDefault) {
        rawValue = declaration.default;
      } else {
        values[name] = '';
        paramsUsed[name] = { type: declaration.type, chars: 0 };
        warnings.push({ type: 'optional_param_missing_no_default', param: name });
        continue;
      }
    }

    if (!hasSupplied && !hasDefault) {
      if (declaration.required === true) {
        throw new TemplateReferenceError(
          'template_missing_required_param',
          `Required template parameter '${name}' is missing`
        );
      }
      values[name] = '';
      paramsUsed[name] = { type: declaration.type, chars: 0 };
      warnings.push({ type: 'optional_param_missing_no_default', param: name });
      continue;
    }

    if (declaration.type === 'string') {
      if (typeof rawValue !== 'string') {
        throw new TemplateReferenceError(
          'template_param_invalid_type',
          `Template parameter '${name}' must be a string`
        );
      }
      values[name] = rawValue;
      paramsUsed[name] = { type: 'string', chars: rawValue.length };
      continue;
    }

    if (declaration.type === 'document') {
      if (typeof rawValue !== 'string') {
        throw new TemplateReferenceError(
          'template_param_invalid_type',
          `Template parameter '${name}' must be a document identifier string`
        );
      }
      try {
        const doc = await resolvePlainDocumentContent(rawValue, config, sm, ep, log);
        values[name] = doc.content;
        paramsUsed[name] = {
          type: 'document',
          input: rawValue,
          chars: doc.content.length,
          resolved_to: doc.path,
        };
      } catch (err) {
        const mapped = mapTemplateDocumentParamFailure(err, log);
        throw new TemplateReferenceError(
          'template_param_doc_not_found',
          `Document template parameter '${name}' failed to resolve '${rawValue}': ${mapped.detail}`
        );
      }
    }
  }

  const rendered = renderTemplateContent(body, values, declarations, warnings);
  return { content: rendered, paramsUsed, warnings };
}

export async function renderTemplateDocument(
  templateDocument: Record<string, unknown>,
  rawParams: Record<string, unknown>,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<RenderTemplateDocumentResult> {
  try {
    const rendered = await renderTemplateReference(
      (templateDocument.body as string | undefined) ?? '',
      templateDocument,
      rawParams,
      config,
      sm,
      ep,
      log
    );
    return {
      ok: true,
      content: rendered.content,
      paramsUsed: rendered.paramsUsed,
      warnings: rendered.warnings,
    };
  } catch (err) {
    if (err instanceof TemplateReferenceError) {
      return { ok: false, reason: err.reason, detail: err.message };
    }
    const mapped = mapReferenceFailure(err, '{{template-tool}}', log);
    return { ok: false, reason: mapped.reason, detail: mapped.detail };
  }
}

function stripReservedTemplateParams(params: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED_TEMPLATE_PARAM_KEYS.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function mapTemplateDocumentParamFailure(
  err: unknown,
  log: typeof logger
): { reason: ReferenceFailureReason; detail: string } {
  const mapped = mapReferenceFailure(err, '{{template-param}}', log);
  return { reason: 'template_param_doc_not_found', detail: mapped.detail };
}

function mapItemResolutionFailure(
  err: unknown,
  log: typeof logger
): { reason: ReferenceFailureReason; detail: string } {
  return mapReferenceFailure(err, '{{multi-ref-item}}', log);
}

interface TemplatePlaceholderSpan {
  kind: 'active' | 'escaped';
  name: string;
  placeholder: string;
  start: number;
  end: number;
  literalPrefix: string;
}

function scanTemplatePlaceholderSpans(content: string): TemplatePlaceholderSpan[] {
  const spans: TemplatePlaceholderSpan[] = [];
  const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  for (const match of content.matchAll(pattern)) {
    const openerStart = match.index ?? 0;
    let slashStart = openerStart;
    while (slashStart > 0 && content[slashStart - 1] === '\\') {
      slashStart--;
    }
    const slashCount = openerStart - slashStart;
    const isEscaped = slashCount % 2 === 1;
    spans.push({
      kind: isEscaped ? 'escaped' : 'active',
      name: match[1],
      placeholder: match[0],
      start: slashStart,
      end: openerStart + match[0].length,
      literalPrefix: '\\'.repeat(isEscaped ? Math.floor(slashCount / 2) : slashCount / 2),
    });
  }
  return spans;
}

export function renderTemplateContent(
  body: string,
  values: Record<string, string>,
  declarations: Record<string, TemplateParamDeclaration>,
  warnings: TemplateWarning[] = []
): string {
  const replacements: Array<{ start: number; end: number; content: string }> = [];
  for (const span of scanTemplatePlaceholderSpans(body)) {
    if (span.kind === 'escaped') {
      replacements.push({
        start: span.start,
        end: span.end,
        content: `${span.literalPrefix}${span.placeholder}`,
      });
      continue;
    }
    if (!(span.name in declarations)) {
      warnings.push({ type: 'undeclared_placeholder_left_literal', placeholder: span.name });
      continue;
    }
    replacements.push({
      start: span.start,
      end: span.end,
      content: `${span.literalPrefix}${values[span.name] ?? ''}`,
    });
  }
  replacements.sort((a, b) => b.start - a.start);
  let content = body;
  for (const rep of replacements) {
    content = content.slice(0, rep.start) + rep.content + content.slice(rep.end);
  }
  return content;
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
      if (
        r.start !== undefined &&
        r.end !== undefined &&
        original.slice(r.end - r.placeholder.length, r.end) === r.placeholder
      ) {
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
): InjectedReferenceMetadata[] {
  return resolved.map((r) => buildTemplateMetadata(r));
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

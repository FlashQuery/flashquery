import { basename, extname } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

import type { ParsedChunk } from '../embedding/chunks/types.js';

interface PositionedNode {
  type: string;
  url?: string;
  children?: PositionedNode[];
}

export interface LinkResolverDocument {
  documentId: string;
  path: string;
  title: string;
  chunks: ParsedChunk[];
}

export interface LinkResolutionDiagnostic {
  type: 'unresolved_target' | 'unresolved_anchor';
  source_chunk_id: string;
  target: string;
  anchor?: string;
  lint_warning: true;
}

export interface LinkResolvedGraphEdgeDraft {
  source_chunk_id: string;
  target_chunk_id: string;
  relation: 'references';
  confidence: 'EXTRACTED';
  confidence_score: 1;
  metadata: Record<string, unknown>;
}

export interface ResolvedChunkReferences {
  edges: LinkResolvedGraphEdgeDraft[];
  diagnostics: LinkResolutionDiagnostic[];
}

interface LinkCandidate {
  target: string;
  anchor?: string;
}

export function resolveChunkReferences(options: {
  sourceChunk: ParsedChunk;
  documents: LinkResolverDocument[];
}): ResolvedChunkReferences {
  const candidates = extractLinkCandidates(options.sourceChunk.content);
  const edges: LinkResolvedGraphEdgeDraft[] = [];
  const diagnostics: LinkResolutionDiagnostic[] = [];

  for (const candidate of candidates) {
    const document = resolveTargetDocument(candidate.target, options.documents);
    if (!document) {
      diagnostics.push({
        type: 'unresolved_target',
        source_chunk_id: options.sourceChunk.id,
        target: candidate.target,
        anchor: candidate.anchor,
        lint_warning: true,
      });
      continue;
    }

    const targetChunk = candidate.anchor
      ? resolveAnchorChunk(document.chunks, candidate.anchor)
      : rootChunk(document.chunks);
    if (!targetChunk) {
      diagnostics.push({
        type: 'unresolved_anchor',
        source_chunk_id: options.sourceChunk.id,
        target: candidate.target,
        anchor: candidate.anchor,
        lint_warning: true,
      });
      continue;
    }

    if (targetChunk.id === options.sourceChunk.id) {
      continue;
    }

    edges.push({
      source_chunk_id: options.sourceChunk.id,
      target_chunk_id: targetChunk.id,
      relation: 'references',
      confidence: 'EXTRACTED',
      confidence_score: 1,
      metadata: {},
    });
  }

  return { edges, diagnostics };
}

function extractLinkCandidates(markdown: string): LinkCandidate[] {
  return [
    ...extractMarkdownLinks(markdown),
    ...extractWikilinksOutsideFences(markdown),
  ].filter((candidate) => candidate.target.length > 0);
}

function extractMarkdownLinks(markdown: string): LinkCandidate[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as PositionedNode;
  const links: LinkCandidate[] = [];

  const visit = (node: PositionedNode): void => {
    if (node.type === 'link' && node.url) {
      const parsed = parseLinkTarget(node.url);
      if (parsed) {
        links.push(parsed);
      }
      return;
    }
    if (node.type === 'code' || node.type === 'inlineCode') {
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(tree);
  return links;
}

function extractWikilinksOutsideFences(markdown: string): LinkCandidate[] {
  const withoutFencedCode = stripFencedCodeBlocks(markdown);
  const links: LinkCandidate[] = [];
  const regex = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(withoutFencedCode)) !== null) {
    const parsed = parseLinkTarget(match[1] ?? '');
    if (parsed) {
      links.push(parsed);
    }
  }
  return links;
}

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let activeFence: { marker: '`' | '~'; length: number } | null = null;

  for (const line of lines) {
    if (activeFence) {
      const closeRegex = new RegExp(`^ {0,3}\\${activeFence.marker}{${activeFence.length},}[ \\t]*$`);
      if (closeRegex.test(line)) {
        activeFence = null;
      }
      output.push('');
      continue;
    }

    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[2] ?? '';
      activeFence = { marker: fence[0] as '`' | '~', length: fence.length };
      output.push('');
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function parseLinkTarget(rawTarget: string): LinkCandidate | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
    return null;
  }
  const withoutAlias = rawTarget.split('|')[0]?.trim() ?? '';
  if (!withoutAlias || withoutAlias.startsWith('#')) {
    return null;
  }
  const [target, anchor] = withoutAlias.split('#', 2);
  return {
    target: normalizeTargetName(target),
    ...(anchor ? { anchor: decodeURIComponent(anchor.trim()) } : {}),
  };
}

function normalizeTargetName(target: string): string {
  const trimmed = decodeURIComponent(target.trim()).replace(/\\/g, '/');
  const base = basename(trimmed);
  const extension = extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function resolveTargetDocument(
  target: string,
  documents: LinkResolverDocument[]
): LinkResolverDocument | null {
  const normalizedTarget = normalizeLookupValue(target);
  return (
    documents.find((document) => {
      const normalizedPath = normalizeLookupValue(normalizeTargetName(document.path));
      const normalizedFullPath = normalizeLookupValue(document.path.replace(/^\//, '').replace(/\.[^.]+$/, ''));
      const normalizedTitle = normalizeLookupValue(document.title);
      return (
        normalizedTarget === normalizedPath ||
        normalizedTarget === normalizedFullPath ||
        normalizedTarget === normalizedTitle
      );
    }) ?? null
  );
}

function resolveAnchorChunk(chunks: ParsedChunk[], anchor: string): ParsedChunk | null {
  const normalizedAnchor = slugify(anchor);
  return (
    chunks.find((chunk) => {
      const headingParts = chunk.heading_path.split(' > ');
      const leafHeading = headingParts[headingParts.length - 1] ?? chunk.heading_path;
      return slugify(leafHeading) === normalizedAnchor || slugify(chunk.heading_path) === normalizedAnchor;
    }) ?? null
  );
}

function rootChunk(chunks: ParsedChunk[]): ParsedChunk | null {
  return [...chunks].sort((left, right) => left.chunk_index - right.chunk_index)[0] ?? null;
}

function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

import { chunkEmbedText, chunkContentHash, normalizeChunkContent } from './normalize.js';
import { deriveChunkId, deriveParentChunkId } from './identity.js';
import { splitContentPreservingAtomicBlocks } from './atomic-blocks.js';
import { DEFAULT_CHUNK_PARSER_PARAMS, type ChunkParserInput, type ChunkParserParams, type ParsedChunk } from './types.js';

interface Section {
  heading: string;
  level: number;
  path: string;
  bodyLines: string[];
  children: Section[];
  parent: Section | null;
  startLine: number;
  endLine: number;
  synthetic: boolean;
  mergedHeadingPaths: string[];
}

interface PendingChunk {
  section: Section;
  headingPath: string;
  headingLevel: number;
  breadcrumb: string;
  content: string;
  startLine: number;
  endLine: number;
  mergedHeadingPaths: string[];
}

const HEADING_REGEX = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;
const FENCE_OPEN_REGEX = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export function parseDocumentChunks(input: ChunkParserInput): ParsedChunk[] {
  const params = resolveParserParams(input.params);
  const root = buildSectionTree(input.title, input.body);
  const pending = collectPendingChunks(root, params);
  const chunks: ParsedChunk[] = [];

  for (const pendingChunk of pending) {
    const splitContents = splitContentForBudget(pendingChunk.content, pendingChunk.breadcrumb, params);
    splitContents.forEach((content, chunkIndex) => {
      const identityInput = {
        instanceId: input.instanceId,
        documentId: input.documentId,
        headingPath: pendingChunk.headingPath,
        chunkIndex,
      };
      chunks.push({
        id: deriveChunkId(identityInput),
        document_id: input.documentId,
        heading_path: pendingChunk.headingPath,
        heading_level: pendingChunk.headingLevel,
        breadcrumb: pendingChunk.breadcrumb,
        content,
        content_hash: chunkContentHash(content),
        chunk_index: chunkIndex,
        parent_chunk_id: deriveParentChunkId(identityInput),
        embed_text: chunkEmbedText(pendingChunk.breadcrumb, content),
        source_section_heading_path: pendingChunk.section.path,
        source_start_line: pendingChunk.startLine,
        source_end_line: pendingChunk.endLine,
        merged_heading_paths: pendingChunk.mergedHeadingPaths,
      });
    });
  }

  return chunks;
}

function resolveParserParams(params?: Partial<ChunkParserParams>): ChunkParserParams {
  return {
    ...DEFAULT_CHUNK_PARSER_PARAMS,
    ...params,
    minChunkTokens: Math.max(1, params?.minChunkTokens ?? DEFAULT_CHUNK_PARSER_PARAMS.minChunkTokens),
    maxChunkTokens: Math.max(1, params?.maxChunkTokens ?? DEFAULT_CHUNK_PARSER_PARAMS.maxChunkTokens),
    overlapRatio: Math.max(0, params?.overlapRatio ?? DEFAULT_CHUNK_PARSER_PARAMS.overlapRatio),
  };
}

function buildSectionTree(title: string, body: string): Section {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const headings = findHeadings(lines);
  const firstHeading = headings[0];
  const useSyntheticRoot = !firstHeading || firstHeading.level !== 1;
  const root = createSection(useSyntheticRoot ? title : '__root__', 0, useSyntheticRoot ? title : '', null, 1, true);
  const stack: Section[] = [root];
  let current = root;

  for (let index = 0; index < lines.length; index++) {
    const heading = headings.find((candidate) => candidate.lineIndex === index);
    if (!heading) {
      current.bodyLines.push(lines[index] ?? '');
      current.endLine = index + 1;
      continue;
    }

    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1] ?? root;
    const path = parent.path ? `${parent.path} > ${heading.text}` : heading.text;
    const section = createSection(heading.text, heading.level, path, parent, index + 1, false);
    parent.children.push(section);
    stack.push(section);
    current = section;
  }

  return root;
}

function createSection(
  heading: string,
  level: number,
  path: string,
  parent: Section | null,
  startLine: number,
  synthetic: boolean
): Section {
  return {
    heading,
    level,
    path,
    bodyLines: [],
    children: [],
    parent,
    startLine,
    endLine: startLine,
    synthetic,
    mergedHeadingPaths: [],
  };
}

function findHeadings(lines: string[]): Array<{ lineIndex: number; level: number; text: string }> {
  const headings: Array<{ lineIndex: number; level: number; text: string }> = [];
  let activeFence: { marker: '`' | '~'; length: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    if (activeFence) {
      const closeRegex = new RegExp(`^ {0,3}\\${activeFence.marker}{${activeFence.length},}[ \\t]*$`);
      if (closeRegex.test(line)) {
        activeFence = null;
      }
      continue;
    }

    const fenceMatch = FENCE_OPEN_REGEX.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[2] ?? '';
      const marker = fence[0] as '`' | '~';
      const info = fenceMatch[3] ?? '';
      if (marker === '~' || !info.includes('`')) {
        activeFence = { marker, length: fence.length };
        continue;
      }
    }

    const headingMatch = HEADING_REGEX.exec(line);
    if (headingMatch) {
      headings.push({
        lineIndex,
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
    }
  }

  return headings;
}

function collectPendingChunks(root: Section, params: ChunkParserParams): PendingChunk[] {
  const output: PendingChunk[] = [];
  const visit = (section: Section): void => {
    const body = normalizeChunkContent(section.bodyLines.join('\n'));
    const bodyTokens = countTokens(body);

    if (body && bodyTokens < params.minChunkTokens) {
      const firstChild = section.children[0];
      const nextSibling = findNextSibling(section);
      if (firstChild) {
        firstChild.bodyLines = [...section.bodyLines, '', ...firstChild.bodyLines];
        firstChild.mergedHeadingPaths.push(section.path);
      } else if (nextSibling && nextSibling.parent === section.parent) {
        nextSibling.bodyLines = [...section.bodyLines, '', ...nextSibling.bodyLines];
        nextSibling.mergedHeadingPaths.push(section.path);
      } else if (!section.synthetic) {
        output.push(toPendingChunk(section, body));
      }
    } else if (body) {
      output.push(toPendingChunk(section, body));
    }

    for (const child of section.children) {
      visit(child);
    }
  };

  if (root.children.length === 0) {
    const body = normalizeChunkContent(root.bodyLines.join('\n'));
    if (body) {
      output.push(toPendingChunk(root, body));
    }
    return output;
  }

  for (const child of root.children) {
    visit(child);
  }

  return output;
}

function findNextSibling(section: Section): Section | null {
  const siblings = section.parent?.children ?? [];
  const index = siblings.indexOf(section);
  return index >= 0 ? siblings[index + 1] ?? null : null;
}

function toPendingChunk(section: Section, content: string): PendingChunk {
  return {
    section,
    headingPath: section.path,
    headingLevel: section.level,
    breadcrumb: section.path || section.heading,
    content,
    startLine: section.startLine,
    endLine: section.endLine,
    mergedHeadingPaths: [...section.mergedHeadingPaths],
  };
}

function splitContentForBudget(content: string, breadcrumb: string, params: ChunkParserParams): string[] {
  return splitContentPreservingAtomicBlocks(content, breadcrumb, params);
}

function countTokens(content: string): number {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}

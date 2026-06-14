import { createHash } from 'node:crypto';

export function normalizeChunkContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

export function chunkContentHash(content: string): string {
  return createHash('sha256').update(normalizeChunkContent(content), 'utf8').digest('hex');
}

export function chunkEmbedText(breadcrumb: string, content: string): string {
  return `${breadcrumb}\n\n${content}`;
}

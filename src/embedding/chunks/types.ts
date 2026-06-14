export interface ChunkParserParams {
  minChunkTokens: number;
  maxChunkTokens: number;
  overlapRatio: number;
}

export interface ChunkParserInput {
  instanceId: string;
  documentId: string;
  title: string;
  body: string;
  params?: Partial<ChunkParserParams>;
}

export interface ParsedChunk {
  id: string;
  document_id: string;
  heading_path: string;
  heading_level: number;
  breadcrumb: string;
  content: string;
  content_hash: string;
  chunk_index: number;
  parent_chunk_id: string | null;
  embed_text: string;
  source_section_heading_path: string;
  source_start_line: number;
  source_end_line: number;
}

export interface ChunkIdentityInput {
  instanceId: string;
  documentId: string;
  headingPath: string;
  chunkIndex: number;
}

export const DEFAULT_CHUNK_PARSER_PARAMS: ChunkParserParams = {
  minChunkTokens: 120,
  maxChunkTokens: 700,
  overlapRatio: 0.12,
};

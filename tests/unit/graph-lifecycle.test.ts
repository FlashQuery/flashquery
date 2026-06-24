import { describe, expect, it } from 'vitest';

import { FM } from '../../src/constants/frontmatter-fields.js';
import { parseGraphProcessingLevel } from '../../src/embedding/chunks/scheduler.js';
import {
  removeDocumentChunkProcessingState,
  removeDocumentGraphState,
} from '../../src/graph/lifecycle.js';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createClient() {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    client: {
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        return { rows: [] };
      },
    },
  };
}

function normalizedSql(query: RecordedQuery): string {
  return query.sql.replace(/\s+/g, ' ').trim();
}

describe('graph lifecycle cleanup', () => {
  it('removes chunk embeddings, pending graph jobs, chunks, and graph state for fq_processing none', async () => {
    const { client, queries } = createClient();

    await removeDocumentChunkProcessingState(client, {
      instanceId: 'test-instance',
      documentId: '00000000-0000-4000-8000-000000000001',
    });

    expect(queries).toHaveLength(3);
    expect(normalizedSql(queries[0]!)).toContain('DELETE FROM fqc_pending_edges');
    expect(normalizedSql(queries[0]!)).toContain('source_chunk_id IN');
    expect(normalizedSql(queries[0]!)).toContain('target_chunk_id IN');
    expect(normalizedSql(queries[1]!)).toContain('DELETE FROM fqc_pending_embeds');
    expect(normalizedSql(queries[2]!)).toContain('DELETE FROM fqc_chunks');
  });

  it('removes graph state only for fq_processing embedded', async () => {
    const { client, queries } = createClient();

    await removeDocumentGraphState(client, {
      instanceId: 'test-instance',
      documentId: '00000000-0000-4000-8000-000000000002',
    });

    expect(queries).toHaveLength(1);
    expect(normalizedSql(queries[0]!)).toContain('DELETE FROM fqc_graph_nodes');
    expect(normalizedSql(queries[0]!)).not.toContain('DELETE FROM fqc_chunks');
    expect(normalizedSql(queries[0]!)).not.toContain('DELETE FROM fqc_pending_embeds');
    expect(normalizedSql(queries[0]!)).not.toContain('DELETE FROM fqc_pending_edges');
  });

  it('invalid fq_processing remains a diagnostic-only stop before lifecycle mutation', () => {
    const parsed = parseGraphProcessingLevel({ [FM.PROCESSING]: 'graph-only' });

    expect(parsed.level).toBeNull();
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.code).toBe('invalid_fq_processing');
  });
});

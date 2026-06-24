import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { createPgGraphQueryStore, queryGraph } from '../../graph/queries.js';
import { graphRuntimeError } from '../../graph/response.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../graph/vocabulary.js';
import { withPgClient } from '../../utils/pg-client.js';
import { jsonExpectedError } from '../utils/response-formats.js';

const graphActionSchema = z.enum([
  'node',
  'edges',
  'neighbors',
  'path',
  'subgraph',
  'stats',
  'schema',
  'provenance_chain',
  'impact',
  'contradictions',
  'weak_paths',
  'ungrounded_edges',
  'community_for',
  'community_members',
  'list_communities',
]);

const graphDirectionSchema = z.enum(['in', 'out', 'both']);

function graphUnsupportedResult() {
  return jsonExpectedError({
    error: 'unsupported',
    message: 'Graph queries are unavailable because graph.enabled is false or absent.',
    details: {
      code: 'graph_disabled',
      remediation: 'Enable graph.enabled:true in flashquery.yml and run schema initialization before calling query_graph.',
    },
  });
}

export function registerGraphTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'query_graph',
    {
      description:
        'Read the document graph through bounded primitive, compound, provenance, diagnostic, and community-oriented actions. Pass {help:true} for full help.',
      inputSchema: {
        action: graphActionSchema.describe('Graph read action to execute.'),
        chunk_id: z.string().uuid().optional().describe('Chunk/node id for node, edges, neighbors, subgraph, impact, provenance_chain, and community_for.'),
        from: z.string().uuid().optional().describe('Start chunk id for path queries.'),
        to: z.string().uuid().optional().describe('Target chunk id for path queries.'),
        relations: z.array(z.string().min(1)).optional().describe('Optional relation filter.'),
        direction: graphDirectionSchema.optional().describe('Traversal direction: in, out, or both. Default: both.'),
        max_depth: z.number().int().min(0).max(5).optional().describe('Traversal depth cap. Default: 1, max: 5.'),
        max_hops: z.number().int().min(0).max(5).optional().describe('Path hop cap. Default follows max_depth, max: 5.'),
        include_stale: z.boolean().optional().describe('Include stale graph edges. Default: false.'),
        include_resolved: z.boolean().optional().describe('For contradictions, include stale/resolved edges. Default: false.'),
        document_status: z.string().optional().describe('Optional document status filter such as active, archived, missing, or deleted.'),
        limit: z.number().int().min(0).max(250).optional().describe('Maximum nodes/edges/items returned. Default: 50, max: 250.'),
        confidence_threshold: z.number().min(0).max(1).optional().describe('Threshold used by weak_paths. Default: 0.7.'),
        community_id: z.string().min(1).optional().describe('Community id for community_members.'),
        min_members: z.number().int().min(1).optional().describe('Minimum members for list_communities. Default: 1.'),
      },
    },
    async (input) => {
      if (config.graph?.enabled !== true) {
        return graphUnsupportedResult();
      }
      const graphConfig = config.graph;

      try {
        return await withPgClient(config.supabase.databaseUrl, async (client) => {
          const store = createPgGraphQueryStore(client);
          return await queryGraph(
            store,
            {
              instance_id: config.instance.id,
              action: input.action,
              chunk_id: input.chunk_id,
              from: input.from,
              to: input.to,
              relations: input.relations,
              direction: input.direction,
              max_depth: input.max_depth,
              max_hops: input.max_hops,
              include_stale: input.include_stale,
              include_resolved: input.include_resolved,
              document_status: input.document_status,
              limit: input.limit,
              confidence_threshold: input.confidence_threshold,
              community_id: input.community_id,
              min_members: input.min_members,
            },
            {
              relations: graphConfig.resolvedRelations ?? DEFAULT_GRAPH_RELATIONS,
              graph: {
                enabled: true,
                similarity_mode: graphConfig.similarityMode ?? 'threshold',
                similarity_threshold: graphConfig.similarityThreshold ?? 0.78,
                similarity_percentile: graphConfig.similarityPercentile ?? 95,
                classification_enabled:
                  graphConfig.classificationPurpose !== undefined ||
                  graphConfig.classificationModel !== undefined,
                classification_resolver:
                  graphConfig.classificationPurpose ??
                  (graphConfig.classificationModel ? `model:${graphConfig.classificationModel}` : 'disabled'),
              },
            }
          );
        });
      } catch {
        return graphRuntimeError({
          action: input.action,
          message: 'Graph query failed at runtime.',
          details: {
            code: 'graph_runtime_error',
          },
        });
      }
    }
  );
}

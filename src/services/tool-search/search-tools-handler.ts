import { z } from 'zod';
import type { ConsumerContext } from '../mcp-broker/index.js';
import { recordBrokerAuditEvent } from '../mcp-broker/trace.js';
import type { NativeToolHandler } from '../../llm/tool-registry.js';
import type { ToolSearchService } from './tool-search-service.js';

const searchToolsInputSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(50).optional().default(8),
});

export interface CreateSearchToolsHandlerOptions {
  service: ToolSearchService;
  consumerContext: ConsumerContext;
  now?: () => bigint;
}

function auditConsumer(ctx: ConsumerContext): { kind: 'host' } | { kind: 'purpose'; purpose_id: string } {
  if (ctx.kind === 'host') return { kind: 'host' };
  return { kind: 'purpose', purpose_id: ctx.purposeId };
}

function elapsedMicros(start: bigint, now: () => bigint): number {
  return Number((now() - start) / 1000n);
}

export function createSearchToolsHandler(options: CreateSearchToolsHandlerOptions): NativeToolHandler {
  return async (args, context) => {
    await Promise.resolve();
    const now = options.now ?? (() => process.hrtime.bigint());
    const start = now();
    const parsed = searchToolsInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: `search_tools invalid input: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const results = options.service.search(parsed.data.query, parsed.data.limit);
    recordBrokerAuditEvent({
      type: 'mcp_broker_search_tools',
      consumer: auditConsumer(options.consumerContext),
      query: parsed.data.query,
      result_count: results.length,
      latency_us: elapsedMicros(start, now),
      trace_id: context.traceId ?? options.consumerContext.traceId,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
    };
  };
}

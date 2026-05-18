import type { Broker, BrokeredTool, ConsumerContext } from '../mcp-broker/index.js';
import type { NativeToolDefinition } from '../../llm/tool-registry.js';
import { PureBM25Indexer, type ToolArgSummary, type ToolSearchDocument } from './indexer.js';
import { DEFAULT_HELP_HINT, type ToolMeta } from './tool-meta.js';

const FQ_SEARCH_SERVER = 'flashquery';

export interface SearchResult {
  server: string;
  tool: string;
  registry_key: string;
  description: string;
  arg_summary: ToolArgSummary[];
  score: number;
  normalizedScore: number;
  has_help?: boolean;
  help_hint?: string;
}

export interface ToolSearchBuildInput {
  nativeToolCatalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames: readonly string[];
  consumerContext: ConsumerContext;
  broker?: Broker;
  toolMeta?: ReadonlyMap<string, ToolMeta>;
}

type PresentationMetadata =
  | { kind: 'native'; helpHint: string; argSummary: ToolArgSummary[] }
  | { kind: 'brokered'; argSummary: ToolArgSummary[] };

function catalogMap(catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>): Map<string, NativeToolDefinition> {
  return catalog instanceof Map ? catalog : new Map(catalog.map((tool) => [tool.name, tool]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeMetaArgs(args: unknown): ToolArgSummary[] {
  if (!isRecord(args)) return [];
  return Object.entries(args).map(([name, value]) => ({
    name,
    ...(typeof value === 'string' ? { description: value } : {}),
  }));
}

function summarizeJsonSchema(schema: unknown): ToolArgSummary[] {
  if (!isRecord(schema)) return [];
  const properties = isRecord(schema['properties']) ? schema['properties'] : schema;
  const required = new Set(Array.isArray(schema['required']) ? schema['required'].filter((key): key is string => typeof key === 'string') : []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    ...(isRecord(property) && typeof property['description'] === 'string' ? { description: property['description'] } : {}),
    ...(required.has(name) ? { required: true } : {}),
  }));
}

function nativeDocument(tool: NativeToolDefinition, meta: ToolMeta | undefined): ToolSearchDocument {
  const argSummary = meta ? summarizeMetaArgs(meta.args) : summarizeJsonSchema(tool.inputSchema);
  return {
    server: FQ_SEARCH_SERVER,
    tool: tool.name,
    registry_key: tool.name,
    description: meta?.description ?? tool.description,
    argNames: argSummary.map((arg) => arg.name),
    arg_summary: argSummary,
  };
}

function brokeredDocument(tool: BrokeredTool): ToolSearchDocument {
  const argSummary = summarizeJsonSchema(tool.inputSchema);
  return {
    server: tool.serverId,
    tool: tool.toolName,
    registry_key: tool.registryKey,
    description: tool.description ?? tool.upstreamDescription ?? '',
    argNames: argSummary.map((arg) => arg.name),
    arg_summary: argSummary,
  };
}

export class ToolSearchService {
  readonly #indexer = new PureBM25Indexer(undefined, undefined, true);
  readonly #metadata = new Map<string, PresentationMetadata>();

  private constructor(documents: ToolSearchDocument[], metadata: Map<string, PresentationMetadata>) {
    this.#metadata = metadata;
    this.#indexer.build(documents);
  }

  static async buildForConsumer(input: ToolSearchBuildInput): Promise<ToolSearchService> {
    const catalog = catalogMap(input.nativeToolCatalog);
    const documents: ToolSearchDocument[] = [];
    const metadata = new Map<string, PresentationMetadata>();

    for (const name of input.nativeToolNames) {
      const tool = catalog.get(name);
      if (tool === undefined) continue;
      const meta = input.toolMeta?.get(name);
      const document = nativeDocument(tool, meta);
      documents.push(document);
      metadata.set(document.registry_key, {
        kind: 'native',
        helpHint: meta?.helpHint ?? DEFAULT_HELP_HINT,
        argSummary: document.arg_summary ?? [],
      });
    }

    const brokeredTools = input.broker === undefined
      ? []
      : await input.broker.listToolsForConsumer(input.consumerContext);
    for (const tool of brokeredTools) {
      const document = brokeredDocument(tool);
      documents.push(document);
      metadata.set(document.registry_key, {
        kind: 'brokered',
        argSummary: document.arg_summary ?? [],
      });
    }

    return new ToolSearchService(documents, metadata);
  }

  search(query: string, limit = 8): SearchResult[] {
    const boundedLimit = Math.max(0, Math.min(50, Math.floor(limit)));
    return this.#indexer.search(query, boundedLimit).map((result) => {
      const metadata = this.#metadata.get(result.registry_key);
      const base = {
        server: result.server,
        tool: result.tool,
        registry_key: result.registry_key,
        description: result.description,
        arg_summary: metadata?.argSummary ?? result.arg_summary ?? [],
        score: result.score,
        normalizedScore: result.normalizedScore,
      };
      if (metadata?.kind === 'native') {
        return {
          ...base,
          has_help: true,
          help_hint: metadata.helpHint,
        };
      }
      return {
        ...base,
        has_help: false,
      };
    });
  }
}

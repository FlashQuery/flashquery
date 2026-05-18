import type { Broker, BrokeredTool, ConsumerContext, RegistryKey, ToolIndexSink } from '../mcp-broker/index.js';
import type { NativeToolDefinition } from '../../llm/tool-registry.js';
import { PureBM25Indexer, type ToolArgSummary, type ToolSearchDocument, type ToolSearchStats } from './indexer.js';
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

export interface HostToolSearchBuildInput extends Omit<ToolSearchBuildInput, 'consumerContext'> {
  traceId?: string;
}

type PresentationMetadata =
  | { kind: 'native'; helpHint: string; argSummary: ToolArgSummary[] }
  | { kind: 'brokered'; argSummary: ToolArgSummary[] };

interface BuildArtifacts {
  documents: ToolSearchDocument[];
  metadata: Map<string, PresentationMetadata>;
}

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
    description: typeof value === 'string' ? value : '',
    required: false,
  }));
}

function summarizeJsonSchema(schema: unknown): ToolArgSummary[] {
  if (!isRecord(schema)) return [];
  const properties = isRecord(schema['properties']) ? schema['properties'] : schema;
  const required = new Set(Array.isArray(schema['required']) ? schema['required'].filter((key): key is string => typeof key === 'string') : []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    description: isRecord(property) && typeof property['description'] === 'string' ? property['description'] : '',
    required: required.has(name),
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
  readonly #metadata: Map<string, PresentationMetadata>;
  #built = false;

  private constructor(documents: ToolSearchDocument[] = [], metadata: Map<string, PresentationMetadata> = new Map()) {
    this.#metadata = metadata;
    void this.#indexer.build(documents);
    this.#built = documents.length > 0;
  }

  static createEmpty(): ToolSearchService {
    return new ToolSearchService();
  }

  static async buildForConsumer(input: ToolSearchBuildInput): Promise<ToolSearchService> {
    const { documents, metadata } = await buildArtifacts(input);
    const service = new ToolSearchService();
    service.#replaceIndex(documents, metadata);
    return service;
  }

  async buildForHost(input: HostToolSearchBuildInput): Promise<void> {
    await this.#buildInto({
      ...input,
      consumerContext: {
        kind: 'host',
        traceId: input.traceId ?? 'host-tool-search-startup',
        interactive: true,
      },
    });
  }

  createHostIndexSink(hostServerIds: ReadonlySet<string> | readonly string[]): ToolIndexSink {
    const visibleServerIds = hostServerIds instanceof Set ? hostServerIds : new Set(hostServerIds);
    return {
      addTools: (tools) => {
        const visibleTools = tools.filter((tool) => visibleServerIds.has(tool.serverId));
        this.addBrokeredTools(visibleTools);
      },
      removeTools: (keys) => {
        const visibleKeys = keys.filter((key) => isHostVisibleRegistryKey(key, visibleServerIds));
        this.removeBrokeredTools(visibleKeys);
      },
    };
  }

  addBrokeredTools(tools: BrokeredTool[]): void {
    if (tools.length === 0) return;
    const documents: ToolSearchDocument[] = [];
    for (const tool of tools) {
      const document = brokeredDocument(tool);
      documents.push(document);
      this.#metadata.set(document.registry_key, {
        kind: 'brokered',
        argSummary: document.arg_summary ?? [],
      });
    }
    void this.#indexer.addTools(documents);
    this.#built = true;
  }

  removeBrokeredTools(keys: RegistryKey[]): void {
    if (keys.length === 0) return;
    for (const key of keys) {
      this.#metadata.delete(key);
    }
    void this.#indexer.removeTools(keys);
  }

  getStats(): ToolSearchStats {
    return this.#indexer.getStats();
  }

  isBuilt(): boolean {
    return this.#built;
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

  async #buildInto(input: ToolSearchBuildInput): Promise<void> {
    const { documents, metadata } = await buildArtifacts(input);
    this.#replaceIndex(documents, metadata);
  }

  #replaceIndex(documents: ToolSearchDocument[], metadata: Map<string, PresentationMetadata>): void {
    this.#metadata.clear();
    for (const [key, value] of metadata) {
      this.#metadata.set(key, value);
    }
    void this.#indexer.build(documents);
    this.#built = true;
  }
}

async function buildArtifacts(input: ToolSearchBuildInput): Promise<BuildArtifacts> {
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

    return { documents, metadata };
}

function isHostVisibleRegistryKey(key: RegistryKey, visibleServerIds: ReadonlySet<string>): boolean {
  const delimiterIndex = key.indexOf('__');
  if (delimiterIndex <= 0) return false;
  return visibleServerIds.has(key.slice(0, delimiterIndex));
}

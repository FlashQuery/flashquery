import type { FlashQueryConfig } from '../config/loader.js';
import { buildModelCapabilityDiagnostics, modelCapabilitiesWithDefaults } from './capabilities.js';
import { CALL_MODEL_RESOLVERS } from './help-content.js';
import {
  assembleNativeToolRegistry,
  mergeModelVisibleToolRegistries,
  type NativeToolDefinition,
  type ToolRegistryDiagnostics,
} from './tool-registry.js';
import {
  assembleTemplateToolRegistry,
  type TemplateToolDiagnostics,
  type TemplateToolRuntimeBinding,
} from './template-tools.js';

type LlmConfig = NonNullable<FlashQueryConfig['llm']>;
type LlmModel = LlmConfig['models'][number];
type LlmPurpose = LlmConfig['purposes'][number];
type LlmProvider = LlmConfig['providers'][number];

interface DiscoveryBuildOptions {
  config: FlashQueryConfig;
  nativeToolCatalog: NativeToolDefinition[];
  runtimeTemplateBindings: TemplateToolRuntimeBinding[];
}

const EMPTY_NATIVE_DIAGNOSTICS = {
  expanded_tiers: [],
  explicit_tools: [],
  excluded: [],
  hard_excluded: [],
  unknown: [],
} as const;

const HELP_SEARCH_TERMS = [
  'help',
  'summary',
  'reference_syntax',
  'template_bindings',
  'modes',
  'envelope',
  'errors',
  'discovery',
  'examples',
  ...CALL_MODEL_RESOLVERS,
];

function providerLookup(config: FlashQueryConfig): Map<string, LlmProvider> {
  return new Map((config.llm?.providers ?? []).map((provider) => [provider.name, provider]));
}

function modelLookup(config: FlashQueryConfig): Map<string, LlmModel> {
  return new Map((config.llm?.models ?? []).map((model) => [model.name, model]));
}

function toNativeToolDiagnostics(diagnostics: ToolRegistryDiagnostics): Record<string, unknown[]> {
  return {
    expanded_tiers: diagnostics.expandedTiers,
    explicit_tools: diagnostics.explicitTools,
    excluded: diagnostics.excluded,
    hard_excluded: diagnostics.hardExcluded,
    unknown: diagnostics.unknown,
  };
}

function strictToolsForPurpose(config: FlashQueryConfig, purpose: LlmPurpose, modelsByName: Map<string, LlmModel>): boolean {
  const primaryModelName = purpose.models[0];
  const primaryModel = primaryModelName ? modelsByName.get(primaryModelName) : undefined;
  const selectedProvider = primaryModel
    ? config.llm?.providers.find((provider) => provider.name === primaryModel.providerName)
    : undefined;
  const capabilities = primaryModel && selectedProvider
    ? modelCapabilitiesWithDefaults(primaryModel, selectedProvider)
    : {};
  return capabilities.strict_tools === true;
}

function modelToResponse(config: FlashQueryConfig, model: LlmModel, providersByName: Map<string, LlmProvider>): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: model.name,
    type: model.type,
    provider: model.providerName,
    model_id: model.model,
    input_cost_per_million: model.costPerMillion.input,
    output_cost_per_million: model.costPerMillion.output,
  };
  if (model.description !== undefined) entry['description'] = model.description;
  if (model.contextWindow !== undefined) entry['context_window'] = model.contextWindow;
  if (model.tags !== undefined) entry['tags'] = model.tags;
  if (model.capabilities !== undefined) entry['capabilities'] = model.capabilities;
  const provider = providersByName.get(model.providerName);
  if (provider !== undefined) {
    entry['capability_diagnostics'] = buildModelCapabilityDiagnostics(model, provider);
  } else {
    entry['capability_diagnostics'] = [];
  }
  if (provider?.local === true) {
    entry['local'] = true;
  } else if (provider?.type === 'ollama') {
    entry['local'] = true;
  }
  return entry;
}

async function purposeToResponse(options: DiscoveryBuildOptions, purpose: LlmPurpose): Promise<Record<string, unknown>> {
  const modelsByName = modelLookup(options.config);
  const primaryName = purpose.models[0];
  const primary = primaryName ? modelsByName.get(primaryName) : undefined;
  const strictTools = strictToolsForPurpose(options.config, purpose, modelsByName);
  const nativeRegistry = assembleNativeToolRegistry(
    options.config,
    purpose.name,
    options.nativeToolCatalog,
    { strictTools }
  );
  const templateRegistry = await assembleTemplateToolRegistry({
    config: options.config,
    purposeName: purpose.name,
    runtimeBindings: options.runtimeTemplateBindings,
    nativeToolNames: nativeRegistry.nativeToolNames,
    strictTools,
  });
  const mergedRegistry = mergeModelVisibleToolRegistries({
    native: nativeRegistry,
    template: templateRegistry,
  });
  const templateDiagnostics = mergedRegistry.diagnostics as Partial<TemplateToolDiagnostics>;
  const entry: Record<string, unknown> = {
    name: purpose.name,
    description: purpose.description,
    models: purpose.models,
    input_cost_per_million: primary?.costPerMillion.input ?? 0,
    output_cost_per_million: primary?.costPerMillion.output ?? 0,
    native_tools: mergedRegistry.nativeToolNames,
    native_tool_diagnostics: toNativeToolDiagnostics(nativeRegistry.diagnostics),
    template_tools: templateDiagnostics.template_tools ?? [],
    template_tool_warnings: templateDiagnostics.template_tool_warnings ?? [],
    template_tool_conflicts: templateDiagnostics.template_tool_conflicts ?? [],
    dangling_template_paths: templateDiagnostics.dangling_template_paths ?? [],
  };
  if (purpose.defaults !== undefined) entry['defaults'] = purpose.defaults;
  return entry;
}

export function buildListModelsContent(config: FlashQueryConfig): Record<string, unknown> {
  const providersByName = providerLookup(config);
  const models = (config.llm?.models ?? []).map((model) => modelToResponse(config, model, providersByName));
  return { models };
}

export async function buildListPurposesContent(options: DiscoveryBuildOptions): Promise<Record<string, unknown>> {
  const purposes = await Promise.all((options.config.llm?.purposes ?? []).map((purpose) => purposeToResponse(options, purpose)));
  return { purposes };
}

function lowerSearchText(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function modelSearchText(model: Record<string, unknown>): string {
  return lowerSearchText({
    name: model['name'],
    description: model['description'],
    tags: model['tags'],
    capability_diagnostics: model['capability_diagnostics'],
    capability_keys: [
      'tool_calling',
      'usage_on_tool_calls',
      'strict_tools',
      'parallel_tool_calls',
      'structured_outputs_with_tools',
      'supported',
      'unknown_declaration',
      'declared_unsupported',
    ],
    resolvers: CALL_MODEL_RESOLVERS,
    help: HELP_SEARCH_TERMS,
  });
}

function purposeSearchText(purpose: Record<string, unknown>): string {
  return lowerSearchText({
    name: purpose['name'],
    description: purpose['description'],
    native_tool_diagnostics: purpose['native_tool_diagnostics'] ?? EMPTY_NATIVE_DIAGNOSTICS,
    template_tools: purpose['template_tools'],
    template_tool_warnings: purpose['template_tool_warnings'],
    template_tool_conflicts: purpose['template_tool_conflicts'],
    dangling_template_paths: purpose['dangling_template_paths'],
    diagnostic_keys: [
      'native_tools',
      'native_tool_diagnostics',
      'template_tools',
      'template_tool_warnings',
      'template_tool_conflicts',
      'dangling_template_paths',
    ],
    resolvers: CALL_MODEL_RESOLVERS,
    help: HELP_SEARCH_TERMS,
  });
}

export async function buildSearchContent(
  options: DiscoveryBuildOptions & { query: string }
): Promise<Record<string, unknown>> {
  const q = options.query.toLowerCase();
  const models = (buildListModelsContent(options.config).models as Array<Record<string, unknown>>)
    .filter((model) => modelSearchText(model).includes(q));
  const purposes = (await buildListPurposesContent(options)).purposes as Array<Record<string, unknown>>;
  return {
    query: options.query,
    results: {
      purposes: purposes.filter((purpose) => purposeSearchText(purpose).includes(q)),
      models,
    },
  };
}

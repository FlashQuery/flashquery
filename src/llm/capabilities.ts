import type { FlashQueryConfig } from '../config/loader.js';

export type StructuredModelCapabilities = {
  tool_calling?: boolean;
  usage_on_tool_calls?: boolean;
  strict_tools?: boolean;
  parallel_tool_calls?: boolean;
  structured_outputs_with_tools?: boolean;
};

export type CapabilityAdmissionResult =
  | { ok: true }
  | { ok: false; message: string };
export type CapabilityDiagnosticState = 'supported' | 'unknown_declaration' | 'declared_unsupported';
export interface ModelCapabilityDiagnostic {
  capability: keyof StructuredModelCapabilities;
  state: CapabilityDiagnosticState;
  message: string;
  remediation?: string;
}
type CapabilityAdmissionFailure = Extract<CapabilityAdmissionResult, { ok: false }>;

type LlmConfig = NonNullable<FlashQueryConfig['llm']>;
type LlmModel = LlmConfig['models'][number];
type LlmProvider = LlmConfig['providers'][number] | { name: string; type: 'openai-compatible' | 'ollama' };
type LlmPurpose = LlmConfig['purposes'][number];

const ALL_TRUE_CAPABILITIES: Required<StructuredModelCapabilities> = {
  tool_calling: true,
  usage_on_tool_calls: true,
  strict_tools: true,
  parallel_tool_calls: true,
  structured_outputs_with_tools: true,
};

export function modelCapabilitiesWithDefaults(
  model: Pick<LlmModel, 'capabilities'>,
  provider: LlmProvider
): StructuredModelCapabilities {
  const declared = model.capabilities ?? {};
  if (provider.name === 'openai' && provider.type === 'openai-compatible') {
    return { ...ALL_TRUE_CAPABILITIES, ...declared };
  }
  return { ...declared };
}

function purposeHasModelVisibleExposure(config: FlashQueryConfig, purpose: LlmPurpose): boolean {
  return (
    (purpose.tools?.length ?? 0) > 0 ||
    (purpose.templates?.length ?? 0) > 0 ||
    (config.templates?.defaultAccess ?? 'permissive') === 'permissive'
  );
}

function diagnosticForCapability(
  capability: keyof StructuredModelCapabilities,
  value: boolean | undefined,
  modelName: string
): string | null {
  if (value === true) return null;
  const state = value === false ? 'declared unsupported' : 'unknown declaration';
  const remediation = value === undefined
    ? ` — declare 'capabilities.${capability}: true|false' on this model`
    : '';
  return `${state}: model '${modelName}' lacks ${capability}${remediation}`;
}

export function buildModelCapabilityDiagnostics(
  model: Pick<LlmModel, 'name' | 'capabilities'>,
  provider: LlmProvider
): ModelCapabilityDiagnostic[] {
  const caps = modelCapabilitiesWithDefaults(model, provider);
  return ([
    'tool_calling',
    'usage_on_tool_calls',
    'strict_tools',
    'parallel_tool_calls',
    'structured_outputs_with_tools',
  ] as const).map((capability) => {
    const value = caps[capability];
    if (value === true) {
      return {
        capability,
        state: 'supported',
        message: `model '${model.name}' declares ${capability} support`,
      };
    }
    if (value === false) {
      return {
        capability,
        state: 'declared_unsupported',
        message: `model '${model.name}' declares ${capability} unsupported`,
      };
    }
    return {
      capability,
      state: 'unknown_declaration',
      message: `model '${model.name}' has no ${capability} declaration`,
      remediation: `declare 'capabilities.${capability}: true|false' on this model`,
    };
  });
}

export function validatePurposeMode2Admission(
  config: FlashQueryConfig,
  purposeName: string
): CapabilityAdmissionResult {
  const llm = config.llm;
  if (!llm) return { ok: true };
  const purpose = llm.purposes.find((p) => p.name === purposeName);
  if (!purpose || !purposeHasModelVisibleExposure(config, purpose)) return { ok: true };

  const providers = new Map(llm.providers.map((p) => [p.name, p]));
  const models = new Map(llm.models.map((m) => [m.name, m]));
  const diagnostics: string[] = [];

  for (const modelName of purpose.models) {
    const model = models.get(modelName);
    if (!model) continue;
    if (model.type === 'embedding') continue;
    const provider = providers.get(model.providerName);
    if (!provider) continue;
    const caps = modelCapabilitiesWithDefaults(model, provider);
    for (const required of ['tool_calling', 'usage_on_tool_calls'] as const) {
      const diagnostic = diagnosticForCapability(required, caps[required], model.name);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }

  if (diagnostics.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Capability admission failed for purpose '${purpose.name}': ${diagnostics.join('; ')}`,
  };
}

export function validateAllPurposeMode2Admissions(config: FlashQueryConfig): CapabilityAdmissionFailure[] {
  return (config.llm?.purposes ?? [])
    .map((purpose) => validatePurposeMode2Admission(config, purpose.name))
    .filter((result): result is Extract<CapabilityAdmissionResult, { ok: false }> => !result.ok);
}

export function assertResponseFormatAllowedWithTools(
  config: FlashQueryConfig,
  purposeName: string,
  modelName: string,
  parameters?: Record<string, unknown>
): CapabilityAdmissionResult {
  const llm = config.llm;
  if (!llm) return { ok: true };
  const purpose = llm.purposes.find((p) => p.name === purposeName);
  if (!purpose || !purposeHasModelVisibleExposure(config, purpose)) return { ok: true };
  const responseFormat = parameters?.['response_format'] ?? purpose.defaults?.['response_format'];
  if (responseFormat === undefined) return { ok: true };

  const model = llm.models.find((m) => m.name === modelName);
  if (!model) return { ok: true };
  const provider = llm.providers.find((p) => p.name === model.providerName);
  if (!provider) return { ok: true };
  const caps = modelCapabilitiesWithDefaults(model, provider);
  const diagnostic = diagnosticForCapability(
    'structured_outputs_with_tools',
    caps.structured_outputs_with_tools,
    model.name
  );
  if (!diagnostic) return { ok: true };
  return {
    ok: false,
    message: `response_format with model-visible tools is not allowed: ${diagnostic}; structured_outputs_with_tools is required`,
  };
}

# Phase 154: Residual Import Cycle Cleanup - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 24 likely new/modified files across 3 cycle families
**Analogs found:** 24 / 24

## Planning Inputs

Downstream implementation agents must read these documents before touching source:

- `.planning/phases/154-residual-import-cycle-cleanup/154-CONTEXT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

Research is intentionally not rerun for Phase 154. The supplied planning docs already contain the scope, findings, phasing, validation strategy, and the promoted note from "Follow-Up 2: residual baseline import cycles remain outside FQ-AUDIT-0005 - promoted to GSD Phase 154".

Current baseline command:

```bash
npx --yes madge@8.0.0 src --extensions ts --circular
```

Current baseline output reports 18 circular dependencies in the same three families named in `154-CONTEXT.md`: config/LLM policy, LLM runtime/template/reference/embedding/storage/logging, and MCP server/shutdown lifecycle.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/config/loader.ts` | config | transform | `src/config/loader.ts` current validation/runtime metadata sections | exact |
| `src/config/types.ts` | config/type leaf | transform | `src/config/loader.ts` `FlashQueryConfig` interface | exact-source-extract |
| `src/llm/config-policy.ts` or `src/config/llm-policy.ts` | utility/policy | transform | `src/llm/capabilities.ts` and `src/config/loader.ts` LLM validation helpers | exact-source-extract |
| `src/llm/tool-policy.ts` or equivalent leaf constants module | utility/policy | transform | `src/llm/tool-registry.ts` tier/hard-exclusion constants | exact-source-extract |
| `src/llm/capabilities.ts` | utility/policy | transform | existing same file, with config type import made leaf-only | exact |
| `src/llm/tool-registry.ts` | service/registry | transform | existing same file | exact |
| `src/llm/template-tools.ts` | service/registry | file-I/O + transform | existing same file | exact |
| `src/llm/client.ts` | service/client | request-response | existing same file | exact |
| `src/llm/runtime-types.ts` | type leaf | request-response | `src/llm/types.ts`, `src/macro/runtime-types.ts`, `src/services/mcp-broker/types.ts` | role-match |
| `src/llm/errors.ts` | utility/error leaf | request-response | `src/llm/client.ts`, `src/llm/resolver.ts`, `src/services/mcp-broker/errors.ts` | exact-source-extract |
| `src/llm/resolver.ts` | service/resolver | request-response | existing same file | exact |
| `src/llm/config-sync.ts` | service/sync | CRUD | existing same file | exact |
| `src/llm/config-sync-types.ts` | type leaf | CRUD | `src/llm/config-sync.ts` `ConfigSyncAdapter`; `src/services/mcp-broker/types.ts` | exact-source-extract |
| `src/llm/purpose-template-bindings.ts` | service/sync | CRUD | existing same file | exact |
| `src/llm/reference-resolver.ts` | service/resolver | file-I/O + transform | existing same file | exact |
| `src/llm/reference-metadata.ts` or `src/llm/template-reference-types.ts` | type leaf | transform | `src/llm/reference-resolver.ts` metadata interfaces | exact-source-extract |
| `src/llm/types.ts` | type leaf | request-response | existing same file and `src/constants/llm.ts` | exact |
| `src/embedding/provider.ts` | service/provider | request-response | existing same file | exact |
| `src/embedding/dimensions.ts` or `src/embedding/config.ts` | utility/config leaf | transform | `src/embedding/provider.ts` `getEmbeddingDimensions`; `src/constants/llm.ts` | exact-source-extract |
| `src/embedding/background-embed.ts` | service/scheduler | batch + CRUD | existing same file | exact |
| `src/storage/supabase.ts` | service/storage | CRUD | existing same file | exact |
| `src/logging/logger.ts` | utility/logging | event-driven | existing same file | exact |
| `src/mcp/request-lifecycle-registry.ts` or `src/server/mcp-lifecycle-registry.ts` | registry | event-driven | `src/mcp/request-lifecycle.ts`, `src/mcp/server.ts`, `src/server/shutdown.ts` | exact-source-extract |
| `src/mcp/server.ts` | route/server | request-response | existing same file | exact |
| `src/server/shutdown.ts` | service/lifecycle | event-driven | existing same file | exact |
| `tests/unit/circular-deps.test.ts` or `tests/unit/residual-import-cycles.test.ts` | test/static | batch | existing `tests/unit/circular-deps.test.ts` | exact |
| LLM/config regression tests | test/unit | transform + request-response | `tests/unit/llm-config.test.ts`, `tests/unit/llm-tool-registry.test.ts` | exact |
| MCP lifecycle regression tests | test/unit + integration | event-driven | `tests/unit/mcp-request-drain.test.ts`, `tests/unit/mcp-server-correlation.test.ts`, `tests/integration/server/shutdown-mcp-drain.test.ts` | exact |

## Pattern Assignments

### `src/config/types.ts` (config/type leaf, transform)

**Analog:** `src/config/loader.ts`

**Extract source interface** (`src/config/loader.ts` lines 299-370):

```typescript
export interface FlashQueryConfig {
  instance: {
    name: string;
    id: string;
    vault: {
      path: string;
      markdownExtensions: string[];
    };
  };
  server: { host: string; port: number; url?: string };
  supabase: { url: string; serviceRoleKey: string; databaseUrl: string; skipDdl: boolean };
  git: { autoCommit: boolean; autoPush: boolean; remote: string; branch: string };
  mcp: { transport: 'stdio' | 'streamable-http'; host?: string; port?: number; authSecret?: string; tokenLifetime?: number };
  // ...
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; output: 'stdout' | 'file'; file?: string };
}
```

**Leaf module pattern** (`src/services/mcp-broker/types.ts` lines 1-3, 33-37, 165-177):

```typescript
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type BrokerTransport = 'stdio';

export type ConsumerContext =
  | { kind: 'host'; traceId: string; interactive?: boolean }
  | { kind: 'purpose'; purposeId: string; traceId: string; interactive?: boolean };

export interface Broker {
  ensureConnected(serverId: string, options?: ToolListSnapshotOptions): Promise<void>;
  callTool(ref: BrokerToolRef, args: unknown, ctx: ConsumerContext): Promise<CallToolResult>;
  shutdown(graceMs?: number): Promise<void>;
}
```

**Planner guidance:** Move only public config types to the leaf. Keep YAML parsing, Zod schemas, runtime metadata WeakMap, and exported metadata accessors in `loader.ts` unless moving them is required for acyclicity.

---

### `src/config/loader.ts` (config, transform)

**Analog:** existing `src/config/loader.ts`

**Current imports to break** (`src/config/loader.ts` lines 1-13):

```typescript
import { z } from 'zod';
import * as yaml from 'js-yaml';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { validateAllPurposeMode2Admissions } from '../llm/capabilities.js';
import { HARD_EXCLUDED_NATIVE_TOOLS, TOOL_TIERS } from '../llm/tool-registry.js';
import { getLegacyToolSuggestion, getToolMetadata } from '../mcp/tool-metadata.js';
import { logger } from '../logging/logger.js';
```

**Config validation pattern to preserve** (`src/config/loader.ts` lines 573-674):

```typescript
function validateLlmConfig(llm: RawLlm): LlmValidationError[] {
  const errors: LlmValidationError[] = [];
  const namePattern = /^[a-z0-9][a-z0-9_-]*$/;
  const toolTierNames = new Set<string>(Object.keys(TOOL_TIERS));
  const nativeToolNames = new Set<string>([
    ...Object.values(TOOL_TIERS).flat(),
    ...HARD_EXCLUDED_NATIVE_TOOLS,
  ]);

  // name uniqueness, provider/model/purpose cross refs, and tool selector checks
  return errors;
}
```

**Load-time behavior to preserve** (`src/config/loader.ts` lines 911-923, 980-990):

```typescript
if (result.data.llm) {
  normalizeLlmNames(result.data.llm);
  const llmErrors = validateLlmConfig(result.data.llm);
  if (llmErrors.length > 0) {
    const message = llmErrors
      .map((e) => `Config error: [${e.layer}] ${e.message}`)
      .join('\n');
    throw new Error(message);
  }
  warnHardExcludedPurposeTools(result.data.llm);
}

setConfigRuntimeMetadata(config, {
  deprecationWarnings: [...(extensionWarning ? [extensionWarning] : [])],
  startupWarnings: resolvedHostToolExposure.warnings,
  resolvedHostToolExposure,
  rawLlmApiKeyRefs,
});

const capabilityErrors = validateAllPurposeMode2Admissions(config);
if (capabilityErrors.length > 0) {
  throw new Error(capabilityErrors.map((e) => `Config error: [capability] ${e.message}`).join('\n'));
}
```

**Planner guidance:** After extraction, `loader.ts` may import `FlashQueryConfig` from `src/config/types.ts` and policy helpers from a dependency-light module. It must not import `src/llm/tool-registry.ts`, `src/llm/template-tools.ts`, `src/llm/client.ts`, or modules that create a runtime path back to `loader.ts`.

---

### `src/llm/config-policy.ts` or `src/config/llm-policy.ts` (utility/policy, transform)

**Analogs:** `src/llm/capabilities.ts`, `src/config/loader.ts`

**Capability policy source** (`src/llm/capabilities.ts` lines 28-45, 104-140):

```typescript
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

export function validatePurposeMode2Admission(
  config: FlashQueryConfig,
  purposeName: string
): CapabilityAdmissionResult {
  const llm = config.llm;
  if (!llm) return { ok: true };
  const purpose = llm.purposes.find((p) => p.name === purposeName);
  if (!purpose || !purposeHasModelVisibleExposure(config, purpose)) return { ok: true };
  // ...
}

export function validateAllPurposeMode2Admissions(config: FlashQueryConfig): CapabilityAdmissionFailure[] {
  return (config.llm?.purposes ?? [])
    .map((purpose) => validatePurposeMode2Admission(config, purpose.name))
    .filter((result): result is Extract<CapabilityAdmissionResult, { ok: false }> => !result.ok);
}
```

**Import pattern to fix** (`src/llm/capabilities.ts` lines 1, 23-26):

```typescript
import type { FlashQueryConfig } from '../config/loader.js';

type LlmConfig = NonNullable<FlashQueryConfig['llm']>;
type LlmModel = LlmConfig['models'][number];
type LlmProvider = LlmConfig['providers'][number] | { name: string; type: 'openai-compatible' | 'ollama' };
type LlmPurpose = LlmConfig['purposes'][number];
```

**Planner guidance:** Keep this module pure: type imports from `src/config/types.ts` only, no storage, logger, template-tools, or client imports. Config-facing validation should operate on raw/parsed config shapes and return typed error objects, not throw unless matching existing caller behavior requires it.

---

### `src/llm/tool-policy.ts` or equivalent leaf constants (utility/policy, transform)

**Analog:** `src/llm/tool-registry.ts`

**Tier and exclusion constants source** (`src/llm/tool-registry.ts` lines 88-105):

```typescript
export const TOOL_TIERS = {
  'tier:read-only': getToolNamesByTier('tier:read-only'),
  'tier:read-write': getToolNamesByTier('tier:read-write'),
} as const satisfies Record<string, readonly string[]>;

export type ToolTierName = keyof typeof TOOL_TIERS;

const DELEGATED_HARD_EXCLUDED_TOOLS = getDelegatedHardExcludedTools();

export const HARD_EXCLUDED_NATIVE_TOOLS = DELEGATED_HARD_EXCLUDED_TOOLS.map((entry) => entry.tool);

function isToolTierName(tool: string): tool is ToolTierName {
  return Object.prototype.hasOwnProperty.call(TOOL_TIERS, tool);
}
```

**Registry behavior that should remain in `tool-registry.ts`** (`src/llm/tool-registry.ts` lines 169-195, 325-396):

```typescript
export function toOpenAiToolDefinition(
  tool: NativeToolDefinition,
  options: OpenAiToolDefinitionOptions
): OpenAiToolDefinition {
  const zodSchema = toZodObjectSchema(tool.inputSchema);
  const parameters = normalizeToolJsonSchema(z.toJSONSchema(zodSchema), options);
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
      ...(options.strict ? { strict: true as const } : {}),
    },
  };
}

export function mergeModelVisibleToolRegistries(input: {
  native?: ToolRegistryAssembly;
  template?: TemplateToolRegistryAssembly | { /* ... */ };
}): ToolRegistryAssembly {
  // merges native and template provider tools, diagnostics, and collisions
}
```

**Regression test analog** (`tests/unit/llm-tool-registry.test.ts` lines 239-260):

```typescript
it('defines the exact tier:read-only native tool allowlist', () => {
  expect(TOOL_TIERS['tier:read-only']).toEqual(READ_ONLY_TOOLS);
  expect(TOOL_TIERS['tier:read-only']).toContain('list_vault');
});

it('defines tier:read-write as read-only plus write-capable native tools', () => {
  expect(TOOL_TIERS['tier:read-write']).toEqual(READ_WRITE_TOOLS);
  expect(TOOL_TIERS['tier:read-write']).toEqual(expect.arrayContaining([
    'copy_document',
    'insert_in_doc',
    'replace_doc_section',
  ]));
});
```

**Planner guidance:** If the constants still depend on `mcp/tool-metadata.ts`, verify that importing the new constants from `loader.ts` does not introduce a new config-to-MCP-to-config cycle. If it does, split pure selector data from tool metadata helpers.

---

### `src/llm/runtime-types.ts` and `src/llm/errors.ts` (type/error leaves, request-response)

**Analogs:** `src/llm/client.ts`, `src/llm/resolver.ts`, `src/services/mcp-broker/errors.ts`

**Error classes to extract** (`src/llm/client.ts` lines 21-38; `src/llm/resolver.ts` lines 19-36):

```typescript
export class LlmHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class LlmNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmNetworkError';
  }
}

export class LlmFallbackError extends Error {
  readonly purposeName: string;
  readonly attempts: Array<{ modelName: string; providerName: string; error: Error }>;
}
```

**Runtime type source** (`src/llm/client.ts` lines 44-97):

```typescript
export type ChatMessage = LlmChatMessage;

export interface LlmCompletionResult {
  text: string;
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LlmClient {
  chat(modelName: string, messages: LlmChatMessage[], parameters?: Record<string, unknown>, traceId?: string | null): Promise<LlmChatResult>;
  complete(modelName: string, messages: ChatMessage[], parameters?: Record<string, unknown>, traceId?: string | null): Promise<LlmCompletionResult>;
  getModelForPurpose(purposeName: string): { modelName: string; providerName: string; config: NonNullable<FlashQueryConfig['llm']>['models'][number] } | null;
}
```

**Error utility analog** (`src/services/mcp-broker/errors.ts` lines 13-31, 83-99):

```typescript
export class NormalizedToolErrorObject extends Error implements NormalizedToolError {
  readonly kind: ToolErrorKind;

  constructor(error: NormalizedToolError) {
    super(error.message);
    this.name = 'NormalizedToolError';
    this.kind = error.kind;
  }
}

export function toThrowableToolError(error: NormalizedToolError): NormalizedToolErrorObject {
  return new NormalizedToolErrorObject(error);
}
```

**Planner guidance:** `resolver.ts` should import errors and runtime interfaces from leaf modules, not from `client.ts`. `client.ts` may import `PurposeResolver`, but `resolver.ts` must not import `client.ts`.

---

### `src/llm/client.ts` and `src/llm/resolver.ts` (service/client + resolver, request-response)

**Analogs:** existing same files

**Client constructs resolver** (`src/llm/client.ts` lines 220-233):

```typescript
export class OpenAICompatibleLlmClient implements LlmClient {
  private config: NonNullable<FlashQueryConfig['llm']>;
  private resolver: PurposeResolver;
  private instanceId: string;

  constructor(config: NonNullable<FlashQueryConfig['llm']>, instanceId: string) {
    this.config = config;
    this.instanceId = instanceId;
    this.resolver = new PurposeResolver(config, this.chatHttpOnly.bind(this));
  }
}
```

**Resolver fallback behavior** (`src/llm/resolver.ts` lines 80-130):

```typescript
private async resolveByPurpose<T>(
  purposeName: string,
  messages: LlmChatMessage[],
  parameters: Record<string, unknown> | undefined,
  fn: (modelName: string, messages: LlmChatMessage[], parameters?: Record<string, unknown>) => Promise<T>
): Promise<T & { purposeName: string; fallbackPosition: number }> {
  const normalizedName = purposeName.toLowerCase();
  const purpose = this.config.purposes.find((p) => p.name === normalizedName);
  if (!purpose) {
    throw new Error(`LLM error: Purpose '${normalizedName}' not found in configuration.`);
  }
  // attempts, permanent HTTP status handling, 429 backoff, transient fallback
}
```

**Planner guidance:** Preserve model fallback, 429 delay cap, permanent 400/401/403 stop behavior, and cost recording in `client.ts` lines 592-615. The import cleanup should be structural only.

---

### `src/llm/config-sync-types.ts`, `src/llm/config-sync.ts`, `src/llm/purpose-template-bindings.ts` (type leaf + CRUD sync)

**Analogs:** existing `config-sync.ts` and `purpose-template-bindings.ts`

**Adapter type to extract** (`src/llm/config-sync.ts` lines 7-20):

```typescript
export interface ConfigSyncAdapter<T> {
  table: string;
  runtimeSources: Array<'api' | 'webapp'>;
  parseYaml(config: FlashQueryConfig): Promise<T[]> | T[];
  identity(item: T): Record<string, string>;
  toRow(item: T): Record<string, unknown>;
  describeIdentity(item: T): string;
  runtimeOwnershipWarning?: (item: T, source: 'api' | 'webapp') => string;
}

export interface ConfigSyncResult {
  inserted: number;
  skipped: number;
}
```

**Generic CRUD sync behavior** (`src/llm/config-sync.ts` lines 22-79):

```typescript
export async function syncConfigAdapter<T>(
  config: FlashQueryConfig,
  adapter: ConfigSyncAdapter<T>
): Promise<ConfigSyncResult> {
  const items = await adapter.parseYaml(config);
  const client = supabaseManager.getClient();
  const instanceId = config.instance.id;

  const { error: deleteErr } = await client
    .from(adapter.table)
    .delete()
    .eq('instance_id', instanceId)
    .eq('source', 'yaml');
  if (deleteErr) {
    throw new Error(`LLM sync: delete ${adapter.table} (source=yaml) failed: ${deleteErr.message}`);
  }
  // lookup runtime-owned rows, skip with warning, insert YAML rows
}
```

**Binding adapter behavior** (`src/llm/purpose-template-bindings.ts` lines 58-77):

```typescript
export function createPurposeTemplateSyncAdapter(_config: FlashQueryConfig): ConfigSyncAdapter<PurposeTemplateBinding> {
  return {
    table: 'fqc_purpose_templates',
    runtimeSources: ['api', 'webapp'],
    parseYaml: parsePurposeTemplateBindings,
    identity: (binding) => ({
      purpose_name: binding.purposeName,
      template_path: binding.templatePath,
    }),
    toRow: (binding) => ({
      instance_id: binding.instanceId,
      purpose_name: binding.purposeName,
      template_path: binding.templatePath,
      source: 'yaml',
    }),
  };
}
```

**Planner guidance:** Move `ConfigSyncAdapter` and `ConfigSyncResult` to a leaf so `purpose-template-bindings.ts` imports the type leaf, not `config-sync.ts`. Keep `syncConfigAdapter` and `syncLlmConfigToDb` in `config-sync.ts`.

---

### `src/llm/reference-metadata.ts` and `src/llm/reference-resolver.ts` (type leaf + resolver, file-I/O transform)

**Analog:** existing `reference-resolver.ts`

**Metadata types to extract** (`src/llm/reference-resolver.ts` lines 123-176):

```typescript
export interface TemplateParamDeclaration {
  type: 'string' | 'document';
  required?: boolean;
  default?: unknown;
}

export interface TemplateParamUsage {
  type: 'string' | 'document';
  chars: number;
  input?: string;
  resolved_to?: string;
}

export interface InjectedReferenceMetadata {
  ref: string;
  chars: number;
  resolved_to?: string;
  template?: boolean;
  template_path?: string;
  template_params_used?: Record<string, TemplateParamUsage>;
  template_warnings?: TemplateWarning[];
  resolved_to_count?: number;
  items?: TemplateItemMetadata[];
}
```

**Resolver dependency pattern to preserve** (`src/llm/reference-resolver.ts` lines 36-65):

```typescript
async function scheduleDocumentEmbedding({
  instanceId,
  id,
  label,
  embedText,
  provider,
  supabase,
}: ScheduleDocumentEmbeddingInput): Promise<void> {
  await scheduleBackgroundEmbedding({
    target: documentEmbeddingTarget({ instanceId, id, label }),
    embedText,
    provider,
    supabase,
  });
}

function documentResolutionDeps(config: FlashQueryConfig, sm: typeof supabaseManager, ep: typeof embeddingProvider, log: typeof logger) {
  return { config, supabaseManager: sm, embeddingProvider: ep, logger: log, scheduleDocumentEmbedding };
}
```

**Hydration metadata builder** (`src/llm/reference-resolver.ts` lines 1291-1305):

```typescript
export function buildInjectedReferences(
  resolved: ResolvedRef[]
): InjectedReferenceMetadata[] {
  return resolved.map((r) => buildTemplateMetadata(r));
}
```

**Planner guidance:** `src/llm/types.ts` currently imports `InjectedReferenceMetadata` from `reference-resolver.ts`. Move only metadata interfaces to a leaf and make both `types.ts` and `reference-resolver.ts` import from that leaf.

---

### `src/embedding/dimensions.ts`, `src/embedding/provider.ts`, `src/storage/supabase.ts` (utility leaf + provider/storage, CRUD)

**Analogs:** `src/embedding/provider.ts`, `src/constants/llm.ts`, `src/storage/supabase.ts`

**Dimension helper to extract** (`src/embedding/provider.ts` lines 238-251):

```typescript
export function getEmbeddingDimensions(config: FlashQueryConfig): number {
  if (config.llm?.purposes) {
    const embeddingPurpose = config.llm.purposes.find(p => p.name === 'embedding');
    if (embeddingPurpose?.models[0]) {
      const modelEntry = config.llm.models?.find(m => m.name === embeddingPurpose.models[0]);
      if (modelEntry?.dimensions) return modelEntry.dimensions;
    }
  }
  return config.embedding?.dimensions ?? 1536;
}
```

**Constants leaf analog** (`src/constants/llm.ts` lines 1-20):

```typescript
export const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'] as const;
export type FinishReason = typeof FINISH_REASONS[number];

export function isFinishReason(value: string): value is FinishReason {
  return FINISH_REASONS.includes(value as FinishReason);
}
```

**Storage import to break** (`src/storage/supabase.ts` lines 1-9):

```typescript
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { verifySchema } from './schema-verify.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { getEmbeddingDimensions } from '../embedding/provider.js';
```

**Planner guidance:** Move dimension resolution to a dependency-light module that imports only config types. Then `storage/supabase.ts` can import dimensions without importing provider implementation, and `provider.ts` can also reuse the helper.

---

### `src/logging/logger.ts` (utility/logging, event-driven)

**Analog:** existing same file

**Current import to break** (`src/logging/logger.ts` lines 1-5):

```typescript
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FlashQueryConfig } from '../config/loader.js';
import { getCurrentCorrelationId } from './context.js';
```

**Constructor behavior to preserve** (`src/logging/logger.ts` lines 25-36, 91-96):

```typescript
export class Logger {
  constructor(logging: FlashQueryConfig['logging'], writeOverride?: (line: string) => void) {
    this.minLevel = LEVEL_RANK[logging.level];
    this.output = logging.output;
    this.filePath = logging.file;
    this._write = writeOverride ?? ((line: string) => this._defaultWrite(line));
  }
}

export let logger: Logger;

export function initLogger(config: FlashQueryConfig | FlashQueryConfig['logging'], writeOverride?: (line: string) => void): void {
  const loggingConfig = 'logging' in config ? config.logging : config;
  logger = new Logger(loggingConfig, writeOverride);
}
```

**Planner guidance:** Import `FlashQueryConfig` from `src/config/types.ts`, or introduce a narrower `LoggerConfig` type in the same file. Do not change log line format.

---

### `src/mcp/request-lifecycle-registry.ts`, `src/mcp/server.ts`, `src/server/shutdown.ts` (registry + server lifecycle, event-driven)

**Analogs:** `src/mcp/request-lifecycle.ts`, `src/mcp/server.ts`, `src/server/shutdown.ts`

**Lifecycle primitive** (`src/mcp/request-lifecycle.ts` lines 1-17, 42-57, 96-107):

```typescript
export interface McpRequestLifecycle {
  trackHandler<Args extends unknown[], Result>(
    handler: (...args: Args) => Result | Promise<Result>
  ): (...args: Args) => Promise<Awaited<Result>>;
  waitForIdle(timeoutMs: number): Promise<McpDrainResult>;
  getInFlightCount(): number;
}

export function createMcpRequestLifecycle(): McpRequestLifecycle {
  let inFlightCount = 0;
  // ...
  return {
    trackHandler(handler) { /* increment/decrement in finally */ },
    async waitForIdle(timeoutMs: number): Promise<McpDrainResult> { /* timeout metadata */ },
    getInFlightCount(): number { return inFlightCount; },
  };
}
```

**Current server-owned registry to move** (`src/mcp/server.ts` lines 476-488, 611-616, 802-810):

```typescript
const mcpRequestLifecycles = new WeakMap<McpServer, McpRequestLifecycle>();

export function getMcpRequestLifecycleForServer(server: McpServer): McpRequestLifecycle {
  const lifecycle = mcpRequestLifecycles.get(server);
  if (!lifecycle) {
    throw new Error('MCP request lifecycle has not been initialized for this server');
  }
  return lifecycle;
}

const requestLifecycle = createMcpRequestLifecycle();
mcpRequestLifecycles.set(server, requestLifecycle);
registerMcpServerForShutdown(server);
wrapServerWithRequestLifecycleAndCorrelation(server, requestLifecycle);

transport.onclose = () => {
  unregisterMcpServerForShutdown(server);
  mcpRequestLifecycles.delete(server);
};
```

**Current shutdown-owned server set and dynamic import to replace** (`src/server/shutdown.ts` lines 30-38, 130-153):

```typescript
const shutdownMcpServers = new Set<McpServer>();

export function registerMcpServerForShutdown(server: McpServer): void {
  shutdownMcpServers.add(server);
}

export function unregisterMcpServerForShutdown(server: McpServer): void {
  shutdownMcpServers.delete(server);
}

private async drainMcpRequests(): Promise<void> {
  this.logInfo('MCP requests draining (timeout=15s)');
  const servers = this.mcpServer ? [this.mcpServer] : [...shutdownMcpServers];
  const { getMcpRequestLifecycleForServer } = await import('../mcp/server.js');
  const results = await Promise.all(
    servers.map(async (server) =>
      await getMcpRequestLifecycleForServer(server).waitForIdle(MCP_REQUEST_DRAIN_TIMEOUT_MS)
    )
  );
}
```

**Planner guidance:** Put registration, unregister, lookup, delete, and active-server listing in one dependency-light registry. Both `mcp/server.ts` and `server/shutdown.ts` import that registry. Preserve the error message for uninitialized lifecycle unless tests are updated intentionally.

---

### `tests/unit/circular-deps.test.ts` or `tests/unit/residual-import-cycles.test.ts` (test/static, batch)

**Analog:** `tests/unit/circular-deps.test.ts`

**Existing madge runner and line parser** (`tests/unit/circular-deps.test.ts` lines 4-31):

```typescript
function runMadgeCircular(): SpawnSyncReturns<string> {
  return spawnSync(
    'npx',
    ['--yes', 'madge@8.0.0', 'src', '--extensions', 'ts', '--circular'],
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
}

function expectNoForbiddenFragment(output: string, label: string, fragments: string[]): void {
  const matchingLines = output
    .split(/\r?\n/)
    .filter((line) => fragments.every((fragment) => line.includes(fragment)));

  expect(
    matchingLines,
    `${label} forbidden circular dependency fragment still present:\n${matchingLines.join('\n') || output}`
  ).toEqual([]);
}
```

**Existing targeted-cycle style** (`tests/unit/circular-deps.test.ts` lines 40-63):

```typescript
it('T-U-022 keeps REQ-010 document/plugin target cycles absent from madge output', () => {
  expectNoForbiddenFragment(output, 'REQ-010 document resolver to MCP document tools', [
    'mcp/utils/resolve-document.ts',
    'mcp/tools/documents.ts',
  ]);
});
```

**Planner guidance:** Extend this file if readable; otherwise create `tests/unit/residual-import-cycles.test.ts`. Add T-U-031 final zero-cycle assertion plus T-U-032, T-U-033, and T-U-034 targeted guards. The final zero-cycle assertion should expect madge exit code 0 unless Matt explicitly approves documented residuals.

---

### LLM/config regression tests (test/unit + integration, transform/request-response)

**Analogs:** `tests/unit/llm-config.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/integration/reference-resolver.integration.test.ts`

**Config test style** (`tests/unit/llm-config.test.ts` lines 1-12, 43-87):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { loadConfig } from '../../src/config/loader.js';
import { modelCapabilitiesWithDefaults } from '../../src/llm/capabilities.js';

it('[U-01] parses a valid three-layer llm config with one provider, one model, one purpose', () => {
  const tmpFile = join(tmpdir(), `fqc-llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
  writeFileSync(tmpFile, yaml);
  try {
    const config = loadConfig(tmpFile);
    expect(config.llm?.providers).toHaveLength(1);
  } finally {
    unlinkSync(tmpFile);
  }
});
```

**Tool registry test style** (`tests/unit/llm-tool-registry.test.ts` lines 1-12, 96-124):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  HARD_EXCLUDED_NATIVE_TOOLS,
  TOOL_TIERS,
  assembleNativeToolRegistry,
  normalizeToolJsonSchema,
  toOpenAiToolDefinition,
  validateAndCacheNativeToolSchemas,
  type NativeToolDefinition,
} from '../../src/llm/tool-registry.js';

const noopNativeHandler: NativeToolDefinition['handler'] = async () => ({
  content: [{ type: 'text', text: 'ok' }],
});
```

**Reference metadata integration style** (`tests/integration/reference-resolver.integration.test.ts` references from search):

```typescript
import { parseReferences, resolveReferences, hydrateMessages, buildInjectedReferences } from '../../src/llm/reference-resolver.js';

const metadata = buildInjectedReferences(successes);
expect(buildInjectedReferences([resolvedById])[0].template_params_used?.source).toEqual(/* ... */);
```

**Planner guidance:** Add narrow direct tests only for newly extracted pure helpers/constants not already covered. Update imports from `config/loader.ts` to `config/types.ts` only where type-only imports moved.

---

### MCP lifecycle regression tests (test/unit + integration, event-driven)

**Analogs:** `tests/unit/mcp-request-drain.test.ts`, `tests/unit/mcp-server-correlation.test.ts`, `tests/integration/server/shutdown-mcp-drain.test.ts`

**Lifecycle unit pattern** (`tests/unit/mcp-request-drain.test.ts` lines 18-33, 63-82):

```typescript
it('T-U-019 increments while a successful handler runs and decrements after completion', async () => {
  const lifecycle = createMcpRequestLifecycle();
  const handler = lifecycle.trackHandler(async () => {
    observedCounts.push(lifecycle.getInFlightCount());
    return okResult;
  });

  await expect(handler()).resolves.toEqual(okResult);
  expect(observedCounts).toEqual([1]);
  expect(lifecycle.getInFlightCount()).toBe(0);
});

it('T-U-020 returns timeout metadata without clearing hung in-flight work', async () => {
  const lifecycle = createMcpRequestLifecycle();
  const handler = lifecycle.trackHandler(async () => new Promise<McpTextResult>(() => undefined));
  void handler();
  const drainResult = await lifecycle.waitForIdle(25);
  expect(drainResult).toMatchObject({ timedOut: true, remaining: 1 });
});
```

**Server registration/correlation test pattern** (`tests/unit/mcp-server-correlation.test.ts` lines 138-174):

```typescript
it('REQ-009 tracks registerTool handler invocations in the MCP lifecycle tracker', async () => {
  const { server, registerSpy, toolSpy } = createServerWithCapturedRegistrations();
  const lifecycle = getMcpRequestLifecycleForServer(server);

  server.registerTool('lifecycle_probe', { description: 'Lifecycle probe', inputSchema: {} }, async () => {
    await new Promise<void>((resolve) => { releaseHandler = resolve; });
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  } as never);

  expect(lifecycle.getInFlightCount()).toBe(1);
  releaseHandler?.();
  expect(lifecycle.getInFlightCount()).toBe(0);
});
```

**Shutdown integration pattern** (`tests/integration/server/shutdown-mcp-drain.test.ts` lines 114-116, 148-203, 205-232):

```typescript
async function drainMcpRequests(coordinator: ShutdownCoordinator): Promise<void> {
  await (coordinator as unknown as { drainMcpRequests(): Promise<void> }).drainMcpRequests();
}

it('T-I-010 waits for an already-running tracked handler before continuing', async () => {
  const server = createRegisteredTestMcpServer();
  const lifecycle = getMcpRequestLifecycleForServer(server);
  const coordinator = new ShutdownCoordinator(makeConfig());
  // run handler, start drain, release handler, assert drain settled
});

it('T-I-011 warns with the remaining in-flight count when the MCP drain deadline expires', async () => {
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(MCP_REQUEST_DRAIN_TIMEOUT_MS);
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 in-flight'));
});
```

**Planner guidance:** If a registry module is introduced, add one narrow unit test that register -> lookup returns the same lifecycle, unregister excludes from global drain, and delete/cleanup removes lookup state. Preserve existing integration tests.

## Shared Patterns

### Leaf Module Imports

**Source:** `src/constants/llm.ts`, `src/services/mcp-broker/types.ts`, `src/macro/runtime-types.ts`

Use `import type` for type-only dependencies and keep leaf modules free of runtime imports that point back into their callers.

```typescript
export const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'] as const;
export type FinishReason = typeof FINISH_REASONS[number];
```

### Error Handling

**Source:** `src/llm/config-sync.ts`, `src/llm/purpose-template-bindings.ts`, `src/services/mcp-broker/errors.ts`

Throw precise `Error` messages inside internal services; MCP tool handlers own `isError: true` response envelopes.

```typescript
if (lookupErr) {
  throw new Error(
    `LLM sync: ${source} lookup for ${adapter.describeIdentity(item)} failed: ${lookupErr.message}`
  );
}
```

### Logging

**Source:** `src/logging/logger.ts`

Do not change the log format or credential-safety behavior while moving imports.

```typescript
this._write(`[${this._timestamp()} REQ:${cid}] ${LEVEL_LABEL[level]}  ${msg}`);
```

### Static Cycle Testing

**Source:** `tests/unit/circular-deps.test.ts`

Parse madge output by line and include matching cycle lines in assertion messages. For T-U-031, assert zero production `src/` cycles unless Matt approves a residual in writing.

```typescript
const matchingLines = output
  .split(/\r?\n/)
  .filter((line) => fragments.every((fragment) => line.includes(fragment)));
```

### MCP Shutdown Registry

**Source:** `src/mcp/request-lifecycle.ts`, `src/mcp/server.ts`, `src/server/shutdown.ts`

Keep request tracking in `finally`, drain with the 15-second deadline, and unregister closed HTTP sessions.

```typescript
try {
  return await handler(...args);
} finally {
  decrement();
}
```

## No Analog Found

All likely Phase 154 files have close analogs in the existing codebase. New files should be extractions from current modules or small registry/type leaves following existing `constants`, `types`, and lifecycle helper patterns.

## Metadata

**Analog search scope:** `src/config`, `src/llm`, `src/embedding`, `src/storage`, `src/logging`, `src/mcp`, `src/server`, `tests/unit`, `tests/integration/server`
**Files scanned:** 134 production `src` files via madge, plus targeted unit/integration tests
**Pattern extraction date:** 2026-05-25
**Baseline cycles:** 18 current `madge@8.0.0` cycles

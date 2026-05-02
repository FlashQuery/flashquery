import { z } from 'zod';
import * as yaml from 'js-yaml';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas (snake_case — matches YAML structure)
// ─────────────────────────────────────────────────────────────────────────────

// VaultSchema: nested under instance (v1.7+ structure)
const VaultSchema = z
  .object({
    path: z.string(),
    markdown_extensions: z.array(z.string()).default(['.md']),
  })
  .strip();

// InstanceSchema: includes nested vault (v1.7+ structure)
const InstanceSchema = z
  .object({
    name: z.string().default('FlashQuery'),
    id: z.string(),
    vault: VaultSchema,
  })
  .strip();


const ServerSchema = z
  .object({
    host: z.string().default('localhost'),
    port: z.number().default(3100),
    url: z.string().optional(),
  })
  .strip()
  .prefault({});

const SupabaseSchema = z
  .object({
    url: z.string(),
    service_role_key: z.string(),
    database_url: z.string(),
    skip_ddl: z.boolean().default(false),
  })
  .strip();

const GitSchema = z
  .object({
    auto_commit: z.boolean().default(false),
    auto_push: z.boolean().default(false),
    remote: z.string().default('origin'),
    branch: z.string().default('main'),
  })
  .strip()
  .prefault({});

const McpSchema = z
  .object({
    transport: z.enum(['stdio', 'streamable-http']).default('stdio'),
    host: z.string().optional(),
    port: z.number().min(1).max(65535).optional(),
    auth_secret: z.string().optional(),
    token_lifetime: z
      .number()
      .min(1, 'Token lifetime must be at least 1 hour')
      .max(8760, 'Token lifetime must not exceed 1 year')
      .default(24)
      .describe('Token lifetime in hours (1-8760, default 24)'),
  })
  .strip()
  .prefault({});

const LockingSchema = z
  .object({
    enabled: z.boolean().default(true),
    ttl_seconds: z.number().default(30),
  })
  .strip()
  .prefault({});

// LLM provider/model/purpose schemas (v3.0 — three-layer)
const ProviderSchema = z
  .object({
    name: z.string(),
    type: z.enum(['openai-compatible', 'ollama']),
    endpoint: z.string().url('endpoint must be a valid URL'),
    api_key: z.string().optional(),
  })
  .strip();

const ModelCostSchema = z
  .object({
    input: z.number().min(0),
    output: z.number().min(0),
  })
  .strip();

const ModelSchema = z
  .object({
    name: z.string(),
    provider_name: z.string(),
    model: z.string(),
    type: z.enum(['language', 'reasoning', 'embedding', 'vision', 'code', 'audio', 'guardian']),
    dimensions: z.number().optional(),
    cost_per_million: ModelCostSchema,
    description: z.string().optional(),
    context_window: z.number().int().positive().optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strip();

// PurposeDefaultsSchema is intentionally permissive — values are LLM provider params
// (temperature, max_tokens, etc.) and we don't constrain their shape.
const PurposeDefaultsSchema = z.record(z.string(), z.unknown());

const PurposeSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    models: z.array(z.string()),
    defaults: PurposeDefaultsSchema.optional(),
  })
  .strip();

const LlmSchema = z
  .object({
    providers: z.array(ProviderSchema),
    models: z.array(ModelSchema),
    purposes: z.array(PurposeSchema),
  })
  .strip()
  .optional();

const EmbeddingSchema = z
  .object({
    provider: z.enum(['openai', 'openrouter', 'ollama', 'none']),
    model: z.string().default(''),
    api_key: z.string().optional(),
    endpoint: z.string().optional(),
    dimensions: z.number().default(1536),
  })
  .strip();

const LoggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    output: z.enum(['stdout', 'file']).default('stdout'),
    file: z.string().optional(),
  })
  .strip()
  .prefault({});

// ConfigSchema: strict schema — only known v1.7 fields accepted
// Note: legacy field rejection (projects, defaults, vault) is enforced in loadConfig()
// before this schema runs, providing clear actionable error messages.
const ConfigSchema = z
  .object({
    instance: InstanceSchema,
    server: ServerSchema,
    supabase: SupabaseSchema,
    git: GitSchema,
    mcp: McpSchema,
    llm: LlmSchema,
    embedding: EmbeddingSchema.optional(),
    logging: LoggingSchema,
    locking: LockingSchema,
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Exported TypeScript interface (camelCase)
// ─────────────────────────────────────────────────────────────────────────────

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
  locking: { enabled: boolean; ttlSeconds: number };
  llm?: {
    providers: Array<{ name: string; type: 'openai-compatible' | 'ollama'; endpoint: string; apiKey?: string }>;
    models: Array<{
      name: string;
      providerName: string;
      model: string;
      type: 'language' | 'reasoning' | 'embedding' | 'vision' | 'code' | 'audio' | 'guardian';
      dimensions?: number;
      costPerMillion: { input: number; output: number };
      description?: string;
      contextWindow?: number;
      capabilities?: string[];
    }>;
    purposes: Array<{ name: string; description: string; models: string[]; defaults?: Record<string, unknown> }>;
  };
  embedding?: {
    provider: string;
    model: string;
    apiKey?: string;
    endpoint?: string;
    dimensions: number;
  };
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; output: 'stdout' | 'file'; file?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment variable expansion
// ─────────────────────────────────────────────────────────────────────────────

function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      const value = process.env[varName];
      return value !== undefined ? value : match;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Silent .env file loader — parses key=value pairs and injects into process.env
// without any console output. Required for stdio MCP mode: dotenv v17+ writes
// informational messages to stdout, which corrupts the JSON-RPC protocol channel.
// ─────────────────────────────────────────────────────────────────────────────

function loadEnvFileSilently(envPath: string): void {
  const contents = readFileSync(envPath, 'utf-8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// snake_case to camelCase conversion
// ─────────────────────────────────────────────────────────────────────────────

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function snakeToCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[toCamelCase(key)] = snakeToCamel(value);
    }
    return result;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error formatting
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_HINTS: Record<string, string> = {
  'supabase.url': 'Add your Supabase project URL (e.g., https://xxx.supabase.co).',
  'supabase.service_role_key': 'Add the service_role key from your Supabase dashboard.',
  'supabase.database_url': 'Add the Postgres connection string from your Supabase dashboard.',
  'instance.id': 'Add a unique identifier for this FlashQuery instance (e.g., "i-abc123").',
  'instance.name': 'Add a human-readable name for this instance (e.g., "My Knowledge Base").',
  'instance.vault.path': 'Add the path to your vault directory (e.g., "/Users/name/vault").',
  'instance.vault.markdown_extensions': 'Optional: array of file extensions to index (default: [".md"]).',
  'llm.providers': 'LLM providers must be an array of {name, type, endpoint} objects.',
  'llm.models': 'LLM models must be an array of {name, provider_name, model, type, cost_per_million} objects.',
  'llm.purposes': 'LLM purposes must be an array of {name, description, models} objects.',
};

interface ZodIssue {
  code: string;
  path: (string | number)[];
  message: string;
  expected?: string;
}

function formatZodErrors(issues: ZodIssue[]): string {
  const messages = issues.map((issue) => {
    const path = issue.path.join('.');
    const hint = FIELD_HINTS[path] ? ` ${FIELD_HINTS[path]}` : '';

    if (issue.code === 'invalid_type' && issue.message.includes('undefined')) {
      return `Config error: Missing required field '${path}' — expected ${issue.expected ?? 'value'}, got undefined.${hint}`;
    }

    if (issue.code === 'invalid_type') {
      return `Config error: '${path}' must be a ${issue.expected ?? 'valid value'}, got an invalid value.`;
    }

    return `Config error: '${path}' — ${issue.message}`;
  });

  return messages.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM config normalization & validation (v3.0)
// ─────────────────────────────────────────────────────────────────────────────

type RawLlmProvider = { name: string; type: 'openai-compatible' | 'ollama'; endpoint: string; api_key?: string };
type RawLlmModel = {
  name: string;
  provider_name: string;
  model: string;
  type: 'language' | 'reasoning' | 'embedding' | 'vision' | 'code' | 'audio' | 'guardian';
  cost_per_million: { input: number; output: number };
};
type RawLlmPurpose = { name: string; description: string; models: string[]; defaults?: Record<string, unknown> };
type RawLlm = { providers: RawLlmProvider[]; models: RawLlmModel[]; purposes: RawLlmPurpose[] };

/**
 * Normalizes all provider/model/purpose names and cross-references to lowercase.
 * MUST run BEFORE validateLlmConfig so cross-ref checks compare lowercase names.
 * Mutates the raw Zod-parsed data in place.
 */
function normalizeLlmNames(llm: RawLlm): void {
  for (const p of llm.providers) p.name = p.name.toLowerCase();
  for (const m of llm.models) {
    m.name = m.name.toLowerCase();
    m.provider_name = m.provider_name.toLowerCase();
  }
  for (const pu of llm.purposes) {
    pu.name = pu.name.toLowerCase();
    pu.models = pu.models.map((n) => n.toLowerCase());
  }
}

type LlmValidationError = { layer: 'provider' | 'model' | 'purpose' | 'cross-ref'; name: string; message: string };

/**
 * Validates LLM config after normalization. Returns an array of errors (empty = valid).
 * Implements CONF-01 (name format), CONF-02 (uniqueness), CONF-03 (model→provider),
 * CONF-04 (purpose→model) checks in order.
 */
function validateLlmConfig(llm: RawLlm): LlmValidationError[] {
  const errors: LlmValidationError[] = [];
  const namePattern = /^[a-z0-9][a-z0-9_-]*$/;

  // CONF-01: name format validation
  for (const p of llm.providers) {
    if (!namePattern.test(p.name)) {
      errors.push({ layer: 'provider', name: p.name, message: `Provider name '${p.name}' must match [a-z0-9][a-z0-9_-]*` });
    }
  }
  for (const m of llm.models) {
    if (!namePattern.test(m.name)) {
      errors.push({ layer: 'model', name: m.name, message: `Model name '${m.name}' must match [a-z0-9][a-z0-9_-]*` });
    }
  }
  for (const pu of llm.purposes) {
    if (!namePattern.test(pu.name)) {
      errors.push({ layer: 'purpose', name: pu.name, message: `Purpose name '${pu.name}' must match [a-z0-9][a-z0-9_-]*` });
    }
  }

  // CONF-02: uniqueness within each list (post-normalization)
  const providerCount = new Map<string, number>();
  for (const p of llm.providers) providerCount.set(p.name, (providerCount.get(p.name) ?? 0) + 1);
  for (const [name, count] of providerCount) {
    if (count > 1) errors.push({ layer: 'provider', name, message: `Duplicate provider name '${name}' appears ${count} times (case-insensitive)` });
  }

  const modelCount = new Map<string, number>();
  for (const m of llm.models) modelCount.set(m.name, (modelCount.get(m.name) ?? 0) + 1);
  for (const [name, count] of modelCount) {
    if (count > 1) errors.push({ layer: 'model', name, message: `Duplicate model name '${name}' appears ${count} times (case-insensitive)` });
  }

  const purposeCount = new Map<string, number>();
  for (const pu of llm.purposes) purposeCount.set(pu.name, (purposeCount.get(pu.name) ?? 0) + 1);
  for (const [name, count] of purposeCount) {
    if (count > 1) errors.push({ layer: 'purpose', name, message: `Duplicate purpose name '${name}' appears ${count} times (case-insensitive)` });
  }

  // CONF-03: every model.provider_name must resolve to a defined provider name
  const providerNames = new Set(llm.providers.map((p) => p.name));
  for (const m of llm.models) {
    if (!providerNames.has(m.provider_name)) {
      errors.push({
        layer: 'cross-ref',
        name: m.name,
        message: `model '${m.name}' references unknown provider '${m.provider_name}' — defined providers: [${[...providerNames].join(', ') || '(none)'}]`,
      });
    }
  }

  // CONF-04: every name in purpose.models must resolve to a defined model name
  const modelNames = new Set(llm.models.map((m) => m.name));
  for (const pu of llm.purposes) {
    for (const ref of pu.models) {
      if (!modelNames.has(ref)) {
        errors.push({
          layer: 'cross-ref',
          name: pu.name,
          message: `purpose '${pu.name}' references unknown model '${ref}' — defined models: [${[...modelNames].join(', ') || '(none)'}]`,
        });
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveConfigPath
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the config file path using a three-tier search order:
 *   0. Explicit --config flag (highest priority)
 *   1. FQC_HOME env var: check flashquery.yml first, then flashquery.yaml
 *   2. CWD: check ./flashquery.yml first, then ./flashquery.yaml
 *   3. User home: check ~/.config/flashquery/flashquery.yml, then .yaml
 *
 * .yml is preferred over .yaml (deprecated) in each tier.
 * Throws with an actionable error message if no config is found.
 */
export function resolveConfigPath(explicitPath?: string): string {
  // Tier 0: explicit --config flag takes precedence (D-09)
  if (explicitPath) {
    return explicitPath;
  }

  // Tier 1: FQC_HOME environment variable (D-06)
  const fqcHome = process.env['FQC_HOME'];
  if (fqcHome) {
    const fqcHomeYml = join(fqcHome, 'flashquery.yml');
    const fqcHomeYaml = join(fqcHome, 'flashquery.yaml');
    if (existsSync(fqcHomeYml)) return fqcHomeYml;
    if (existsSync(fqcHomeYaml)) return fqcHomeYaml;
    // FQC_HOME set but no file found — throw immediately (don't silently fall through)
    throw new Error(
      `Config error: FQC_HOME is set to '${fqcHome}' but neither 'flashquery.yml' nor 'flashquery.yaml' was found there.`
    );
  }

  // Tier 2: ./flashquery.yml or ./flashquery.yaml in current working directory (D-06)
  const cwdYml = join(process.cwd(), 'flashquery.yml');
  const cwdYaml = join(process.cwd(), 'flashquery.yaml');
  if (existsSync(cwdYml)) return cwdYml;
  if (existsSync(cwdYaml)) return cwdYaml;

  // Tier 3: ~/.config/flashquery/flashquery.yml or .yaml (D-06)
  const userHomeYml = join(homedir(), '.config', 'flashquery', 'flashquery.yml');
  const userHomeYaml = join(homedir(), '.config', 'flashquery', 'flashquery.yaml');
  if (existsSync(userHomeYml)) return userHomeYml;
  if (existsSync(userHomeYaml)) return userHomeYaml;

  throw new Error(
    `Config error: No config file found. Searched:\n` +
      `  1. ${cwdYml} (or .yaml)\n` +
      `  2. ${userHomeYml} (or .yaml)\n` +
      `Set FQC_HOME environment variable or use --config <path> to specify a config file.\n` +
      `Run 'npm run setup' to generate a new config file.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// rejectLegacyFields — detect and reject old config formats with clear messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check for removed v1.6 config fields and throw clear, actionable errors.
 * Called before Zod validation to provide better error messages than strict() alone.
 */
function rejectLegacyFields(raw: unknown): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;

  const obj = raw as Record<string, unknown>;

  if ('projects' in obj) {
    throw new Error(
      "Config error: 'projects' configuration removed in v1.7. " +
        "Scoping is now path-based (file location) + tag-based (characteristics). " +
        "Remove the 'projects:' section from your config file."
    );
  }

  if ('defaults' in obj) {
    const defaults = obj['defaults'] as Record<string, unknown>;
    if (defaults && typeof defaults === 'object' && 'project' in defaults) {
      throw new Error(
        "Config error: 'defaults.project' concept eliminated in v1.7. " +
          "Use tags for categorization instead. " +
          "Remove the 'defaults:' section from your config file."
      );
    }
  }

  if ('vault' in obj && obj['vault'] !== undefined) {
    throw new Error(
      "Config error: Top-level 'vault:' section removed in v1.7. " +
        "Move vault configuration under 'instance.vault:' instead. " +
        "See the migration guide for details."
    );
  }

  // CONF-06: detect pre-v3.0 flat llm: { provider, model } shape
  if ('llm' in obj && obj['llm'] !== null && typeof obj['llm'] === 'object' && !Array.isArray(obj['llm'])) {
    const llm = obj['llm'] as Record<string, unknown>;
    if ('provider' in llm || 'model' in llm) {
      throw new Error(
        "Config error: The 'llm:' section uses the pre-v3.0 flat format (provider/model keys). " +
        "Migrate to the three-layer format with providers:, models:, and purposes: arrays. " +
        "See flashquery.example.yml for the new format."
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// loadConfig
// ─────────────────────────────────────────────────────────────────────────────

export function loadConfig(configPath: string): FlashQueryConfig {
  // 1. Check file exists
  if (!existsSync(configPath)) {
    throw new Error(
      `Config error: File not found at '${configPath}'. Provide a valid config path with --config.`
    );
  }

  // 2. Detect file extension and emit deprecation warning for .yaml
  const isYamlExtension = configPath.toLowerCase().endsWith('.yaml');
  const extensionWarning = isYamlExtension
    ? `Config loaded from '${configPath}': Using flashquery.yaml — rename to flashquery.yml before v1.8.`
    : undefined;

  // 3. Read and parse YAML
  let raw: unknown;
  try {
    const contents = readFileSync(configPath, 'utf-8');
    raw = yaml.load(contents);
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
      const line = err.mark ? err.mark.line + 1 : '?';
      throw new Error(`Config error: Invalid YAML syntax at line ${line}: ${err.reason}`, {
        cause: err,
      });
    }
    throw err;
  }

  // 4. Reject old config formats with clear error messages (v1.7 breaking change)
  rejectLegacyFields(raw);

  // 5b. LLM v3.0: capture raw api_key reference strings BEFORE env expansion so
  // syncLlmConfigToDb() can store the ${ENV_VAR} literal in api_key_ref (T-98-01:
  // never persist resolved secrets to Supabase). The map keys are lowercased
  // provider names to match post-normalization comparisons.
  const rawLlmApiKeyRefs = new Map<string, string>();
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'llm' in (raw as Record<string, unknown>)
  ) {
    const rawLlm = (raw as Record<string, unknown>)['llm'];
    if (rawLlm !== null && typeof rawLlm === 'object' && 'providers' in (rawLlm as Record<string, unknown>)) {
      const providers = (rawLlm as { providers?: unknown }).providers;
      if (Array.isArray(providers)) {
        for (const p of providers) {
          if (
            p !== null &&
            typeof p === 'object' &&
            'name' in (p as Record<string, unknown>) &&
            'api_key' in (p as Record<string, unknown>)
          ) {
            const name = (p as { name?: unknown }).name;
            const apiKey = (p as { api_key?: unknown }).api_key;
            if (typeof name === 'string' && typeof apiKey === 'string') {
              rawLlmApiKeyRefs.set(name.toLowerCase(), apiKey);
            }
          }
        }
      }
    }
  }

  // 5. Load .env from the config file's directory (supplements CWD .env already loaded by
  //    dotenv/config in index.ts — required when the process is spawned by a host like
  //    Claude Desktop that has a different CWD than the config file's location)
  const configDir = dirname(resolve(configPath));
  const sidecarEnvPath = join(configDir, '.env');
  if (existsSync(sidecarEnvPath)) {
    loadEnvFileSilently(sidecarEnvPath);
  }

  // 6. Expand env vars
  const expanded = expandEnvVars(raw);

  // 7. Validate with Zod
  const result = ConfigSchema.safeParse(expanded);
  if (!result.success) {
    const message = formatZodErrors(result.error.issues as ZodIssue[]);
    throw new Error(message);
  }

  // 7a. LLM v3.0 — normalize names to lowercase, then run validation that depends on
  // post-normalization name comparisons (CONF-01..CONF-04, CONF-07).
  if (result.data.llm) {
    normalizeLlmNames(result.data.llm);
    const llmErrors = validateLlmConfig(result.data.llm);
    if (llmErrors.length > 0) {
      const message = llmErrors
        .map((e) => `Config error: [${e.layer}] ${e.message}`)
        .join('\n');
      throw new Error(message);
    }
  }

  // 8. Convert snake_case to camelCase
  const camel = snakeToCamel(result.data) as Record<string, unknown>;

  // 8a. Restore purpose defaults verbatim — these are LLM provider params (temperature,
  // max_tokens, etc.) whose key naming is governed by the LLM provider, not by FlashQuery's
  // snake_case-to-camelCase convention. Without this, snakeToCamel would silently rename
  // `max_tokens` -> `maxTokens` and break provider compatibility.
  if (result.data.llm?.purposes && Array.isArray((camel['llm'] as { purposes?: unknown })?.purposes)) {
    const camelLlm = camel['llm'] as { purposes: Array<{ defaults?: Record<string, unknown> }> };
    for (let i = 0; i < camelLlm.purposes.length; i++) {
      const rawDefaults = result.data.llm.purposes[i]?.defaults;
      if (rawDefaults !== undefined) {
        camelLlm.purposes[i].defaults = JSON.parse(JSON.stringify(rawDefaults)) as Record<string, unknown>;
      } else {
        delete camelLlm.purposes[i].defaults;
      }
    }
  }

  // 9. Build final config
  const instanceData = camel['instance'] as { name: string; id: string; vault: { path: string; markdownExtensions: string[] } };

  const config: FlashQueryConfig = {
    ...(camel as unknown as FlashQueryConfig),
    instance: instanceData,
  };

  // 9.5. Resolve relative vault path to absolute path (relative to config file directory)
  if (!isAbsolute(config.instance.vault.path)) {
    config.instance.vault.path = resolve(configDir, config.instance.vault.path);
  }

  // 10. Emit warnings (deferred until after validation — caller logs them)
  (config as unknown as Record<string, unknown>)['_deprecationWarnings'] = [
    ...(extensionWarning ? [extensionWarning] : []),
  ];

  // Attach raw LLM api_key refs (used by syncLlmConfigToDb in src/llm/config-sync.ts).
  // Stored as a runtime-only Map alongside `_deprecationWarnings`. Not part of the
  // public FlashQueryConfig type — consumers use getLlmApiKeyRefs(config) below.
  (config as unknown as Record<string, unknown>)['_rawLlmApiKeyRefs'] = rawLlmApiKeyRefs;

  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// getDeprecationWarnings — retrieve warnings attached to config
// ─────────────────────────────────────────────────────────────────────────────

export function getDeprecationWarnings(config: FlashQueryConfig): string[] {
  return ((config as unknown as Record<string, unknown>)['_deprecationWarnings'] as string[]) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// getLlmApiKeyRefs — exposes the raw ${ENV_VAR} reference map captured during loadConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a map from lowercased provider name -> raw api_key reference string
 * (e.g., '${OPENAI_API_KEY}'). Used by syncLlmConfigToDb to populate the
 * api_key_ref column without leaking resolved secrets to the database.
 *
 * Returns an empty Map when no llm: section is configured.
 */
export function getLlmApiKeyRefs(config: FlashQueryConfig): Map<string, string> {
  const map = (config as unknown as Record<string, unknown>)['_rawLlmApiKeyRefs'];
  if (map instanceof Map) return map as Map<string, string>;
  return new Map<string, string>();
}

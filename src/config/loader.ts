import { z } from 'zod';
import * as yaml from 'js-yaml';
import { config as dotenvConfig } from 'dotenv';
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

const LlmSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    api_key: z.string().optional(),
    endpoint: z.string().optional(),
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
    embedding: EmbeddingSchema,
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
  llm?: { provider: string; model: string; apiKey?: string; endpoint?: string };
  embedding: {
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
  'embedding.provider': 'Set to "openai", "openrouter", or "ollama".',
  'embedding.model': 'Set the embedding model name (e.g., "text-embedding-3-small").',
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

  // 5. Load .env from the config file's directory (supplements CWD .env already loaded by
  //    dotenv/config in index.ts — required when the process is spawned by a host like
  //    Claude Desktop that has a different CWD than the config file's location)
  const configDir = dirname(resolve(configPath));
  const sidecarEnvPath = join(configDir, '.env');
  if (existsSync(sidecarEnvPath)) {
    dotenvConfig({ path: sidecarEnvPath, override: false });
  }

  // 6. Expand env vars
  const expanded = expandEnvVars(raw);

  // 7. Validate with Zod
  const result = ConfigSchema.safeParse(expanded);
  if (!result.success) {
    const message = formatZodErrors(result.error.issues as ZodIssue[]);
    throw new Error(message);
  }

  // 7. Convert snake_case to camelCase
  const camel = snakeToCamel(result.data) as Record<string, unknown>;

  // 8. Build final config
  const instanceData = camel['instance'] as { name: string; id: string; vault: { path: string; markdownExtensions: string[] } };

  const config: FlashQueryConfig = {
    ...(camel as unknown as FlashQueryConfig),
    instance: instanceData,
  };

  // 8.5. Resolve relative vault path to absolute path (relative to config file directory)
  if (!isAbsolute(config.instance.vault.path)) {
    config.instance.vault.path = resolve(configDir, config.instance.vault.path);
  }

  // 9. Emit warnings (deferred until after validation — caller logs them)
  // Store warnings on the config object so the caller (index.ts) can log them
  (config as unknown as Record<string, unknown>)['_deprecationWarnings'] = [
    ...(extensionWarning ? [extensionWarning] : []),
  ];

  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// getDeprecationWarnings — retrieve warnings attached to config
// ─────────────────────────────────────────────────────────────────────────────

export function getDeprecationWarnings(config: FlashQueryConfig): string[] {
  return ((config as unknown as Record<string, unknown>)['_deprecationWarnings'] as string[]) ?? [];
}

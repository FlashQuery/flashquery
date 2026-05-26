# Phase 151: Quick Localized Cleanup - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 13 new/modified/remove targets
**Analogs found:** 13 / 13

## Authoritative Docs Gate

Downstream implementation agents MUST read these before implementation or verification:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - read global invariants and Spec Section 6.1 / REQ-001 through REQ-005.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - read Section 4.1 / T-U-001 through T-U-015 and T-I-001.

Local summaries confirm the same boundary: `.planning/phases/151-quick-localized-cleanup/151-CONTEXT.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/embedding/provider.ts` | service/utility | transform, request-response | `src/embedding/provider.ts` current factory and `tests/unit/embedding.test.ts` | exact |
| `src/storage/vault.ts` | service/utility | file-I/O | `src/storage/vault.ts` existing `resolvePath`, `writeMarkdown`, `readMarkdown` | exact |
| `src/services/plugin-reconciliation.ts` | service | batch, file-I/O, CRUD | `src/services/plugin-reconciliation.ts` `readFrontmatterFromDisk` and action execution | exact |
| `src/projects/seeder.ts` | service removal | batch, CRUD | `src/projects/seeder.ts` and stale tests/import mocks | exact |
| `src/git/manager.ts` | service | batch, file-I/O, cleanup | `src/git/manager.ts` `dumpDatabase` and existing logger/error patterns | exact |
| `tsup.config.ts` | config | build transform | `tsup.config.ts` existing esbuild plugin type usage | exact |
| `package.json` | config | package metadata | `package.json` devDependencies/scripts | exact |
| `package-lock.json` | config | package metadata | `package-lock.json` root package and dependency entries | exact |
| `tests/unit/embedding.test.ts` | test | request-response, transform | existing `createEmbeddingProvider` tests | exact |
| `tests/unit/vault.test.ts` or `tests/unit/vault-path-resolution.test.ts` | test | file-I/O | existing `resolvePath` and file roundtrip tests | exact |
| `tests/unit/git-manager.test.ts` | test | batch cleanup | existing `dumpDatabase` pg mock tests | exact |
| `tests/unit/codebase-audit-remaining-remediation.test.ts` | test | static structural guard | `tests/unit/scanner.test.ts`, `tests/unit/document-output.test.ts`, `tests/unit/package-manifest.test.ts` source-reading guards | role-match |
| `tests/integration/plugin-reconciliation.integration.test.ts` | test | integration, file-I/O, CRUD | existing plugin reconciliation integration setup | exact |

## Pattern Assignments

### `src/embedding/provider.ts` (service/utility, transform)

**Analog:** `src/embedding/provider.ts`

**Imports pattern** (lines 1-3):
```typescript
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import type { LlmClient } from '../llm/client.js';
```

**Provider constructor contract** (lines 26-40):
```typescript
constructor(
  baseUrl: string,
  model: string,
  apiKey: string,
  dimensions: number,
  providerName: string,
  includeDimensions = false
) {
  this.baseUrl = baseUrl.replace(/\/$/, '');
  this.model = model;
  this.apiKey = apiKey;
  this.dimensions = dimensions;
  this.providerName = providerName;
  this.includeDimensions = includeDimensions;
}
```

**Current factory branch to replace** (lines 195-220):
```typescript
export function createEmbeddingProvider(config: NonNullable<FlashQueryConfig['embedding']>): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://api.openai.com',
        config.model,
        config.apiKey!,
        config.dimensions,
        'OpenAI',
        config.dimensions !== 1536
      );
    case 'openrouter':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://openrouter.ai/api',
        config.model,
        config.apiKey!,
        config.dimensions,
        'OpenRouter',
        config.dimensions !== 1536
      );
    case 'ollama':
      return new OllamaProvider(
        config.endpoint ?? 'http://localhost:11434',
        config.model,
        config.dimensions
      );
```

**Implementation guidance:** add a small local helper such as `requireApiKey(config, 'openai')` or inline branch validation before `OpenAICompatibleProvider`. It must reject `undefined`, missing, and empty/whitespace-only keys synchronously with an error naming the provider and `apiKey`. Do not add API-key validation to the `ollama` branch.

**Test pattern:** `tests/unit/embedding.test.ts`

Factory tests use direct synchronous expectations and provider dimension checks (lines 48-86):
```typescript
describe('createEmbeddingProvider', () => {
  it('creates OpenAI provider with getDimensions() === 1536', () => {
    const provider = createEmbeddingProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
    expect(provider.getDimensions()).toBe(1536);
  });

  it('creates Ollama provider with getDimensions() === 768', () => {
    const provider = createEmbeddingProvider({
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    expect(provider.getDimensions()).toBe(768);
  });
});
```

Add T-U-001 through T-U-003 here.

---

### `src/storage/vault.ts` (service/utility, file-I/O)

**Analog:** `src/storage/vault.ts`

**Interface extension location** (lines 118-162):
```typescript
export interface VaultManager {
  writeMarkdown(
    relativePath: string,
    frontmatter: Record<string, unknown>,
    content: string,
    options?: WriteMarkdownOptions
  ): Promise<void>;

  readMarkdown(relativePath: string): Promise<{ data: Record<string, unknown>; content: string }>;

  resolvePath(area: string, project: string | null | undefined, filename: string): string;
}
```

**Existing vault-root join pattern** (lines 234-247):
```typescript
async readMarkdown(
  relativePath: string
): Promise<{ data: Record<string, unknown>; content: string }> {
  const absolutePath = join(this.rootPath, relativePath);
  const startTime = performance.now();
  const raw = await readFile(absolutePath, 'utf-8');
  const parsed = matter(raw);
  const duration = Math.round(performance.now() - startTime);
  logger.debug(`Vault: read ${relativePath} (${duration}ms) — frontmatter extracted and validated`);
  return {
    data: parsed.data,
    content: parsed.content,
  };
}
```

**Existing path containment helper** (lines 307-315):
```typescript
private relativePathIfInVault(absPath: string): string | null {
  const resolvedRoot = resolve(this.rootPath);
  const resolvedPath = resolve(absPath);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith(`..${'\\'}`)) {
    return null;
  }
  return rel.replace(/\\/g, '/');
}
```

**Current public resolver style** (lines 317-322):
```typescript
resolvePath(area: string, project: string | null | undefined, filename: string): string {
  if (!project) {
    return join(this.rootPath, '_global', filename);
  }
  return join(this.rootPath, sanitizeFolderName(area), sanitizeFolderName(project), filename);
}
```

**Implementation guidance:** add a public `VaultManager` method for vault-relative paths, for example `resolveVaultPath(relativePath: string): string`. Preserve current behavior by joining with the same `rootPath`; if adding traversal checks, base them on existing `resolve`/`relative` containment style instead of ad hoc string checks.

**Test pattern:** `tests/unit/vault.test.ts`

Current path tests live under `describe('resolvePath')` (lines 511-535):
```typescript
describe('resolvePath', () => {
  beforeEach(async () => {
    const config = makeConfig(testDir);
    await initVault(config);
  });

  it('returns area/project path when project is provided', () => {
    const resolved = vaultManager.resolvePath('MyArea', 'MyProject', 'test.md');
    expect(resolved).toBe(join(testDir, 'MyArea', 'MyProject', 'test.md'));
  });

  it('sanitizes area and project names in resolved path', () => {
    const resolved = vaultManager.resolvePath('Work: Stuff', 'Client: A', 'note.md');
    expect(resolved).toBe(join(testDir, 'Work Stuff', 'Client A', 'note.md'));
  });
});
```

Add T-U-005 and T-U-006 adjacent to this block or in `tests/unit/vault-path-resolution.test.ts` with the same temp-dir/init pattern from lines 31-74.

---

### `src/services/plugin-reconciliation.ts` (service, batch/file-I/O/CRUD)

**Analog:** `src/services/plugin-reconciliation.ts`

**Imports pattern** (lines 7-20):
```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import matter from 'gray-matter';
import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { atomicWriteFrontmatter } from '../utils/frontmatter.js';
import { computeHash } from '../storage/document-primitives.js';
import { vaultManager } from '../storage/vault.js';
```

**Private-field cast to remove** (lines 241-246):
```typescript
function toAbsolutePath(relativePath: string): string {
  // VaultManagerImpl.rootPath is private on the interface — access via cast.
  // vaultManager is always the concrete VaultManagerImpl at runtime.
  const mgr = vaultManager as unknown as { rootPath: string };
  return join(mgr.rootPath, relativePath);
}
```

**File read/error pattern to preserve** (lines 248-257):
```typescript
async function readFrontmatterFromDisk(relativePath: string): Promise<Record<string, unknown>> {
  try {
    const absPath = toAbsolutePath(relativePath);
    const raw = await readFile(absPath, 'utf-8');
    const parsed = matter(raw);
    return (parsed.data ?? {});
  } catch (err) {
    logger.debug(`[RECON] Failed to read frontmatter for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
```

**Implementation guidance:** change `toAbsolutePath` to call the new `vaultManager` public method. Keep the existing `readFrontmatterFromDisk` behavior: debug log, no thrown error, empty object fallback. Remove unused `join` import if the helper no longer needs it.

**Unit mock pattern to update:** `tests/unit/plugin-reconciliation.test.ts` currently mocks a private shape (lines 27-29):
```typescript
vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: { rootPath: '/vault' },
}));
```

Replace with the public method, for example:
```typescript
vi.mock('../../src/storage/vault.js', () => ({
  vaultManager: { resolveVaultPath: (relativePath: string) => `/vault/${relativePath}` },
}));
```

**Integration regression pattern:** `tests/integration/plugin-reconciliation.integration.test.ts`

The integration suite initializes real vault/plugin/storage wiring (lines 15-24, 39-58):
```typescript
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { invalidateReconciliationCache } from '../../src/services/plugin-reconciliation.js';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'reconciliation-integration-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
  } as unknown as FlashQueryConfig;
}
```

Use this existing suite for T-I-001; do not change public MCP behavior.

---

### `src/projects/seeder.ts` (service removal, batch/CRUD)

**Analog:** `src/projects/seeder.ts`

**Dead export to remove** (lines 1-6):
```typescript
import { logger } from '../logging/logger.js';
import { supabaseManager } from '../storage/supabase.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

export async function initProjects(config: FlashQueryConfig): Promise<void> {
```

**Stale direct test reference:** `tests/unit/projects-seeder.test.ts` imports `initProjects` at line 2 and describes it at line 78.

**Stale mock reference:** `tests/unit/backup-command.test.ts` lines 80-85:
```typescript
vi.mock('../../src/storage/vault.js', () => ({
  initVault: vi.fn(),
  vaultManager: { readMarkdown: vi.fn().mockResolvedValue({ data: {}, content: '' }) },
}));
vi.mock('../../src/projects/seeder.js', () => ({ initProjects: vi.fn() }));
```

**Implementation guidance:** delete `src/projects/seeder.ts`; delete `tests/unit/projects-seeder.test.ts` or replace with absence/static guard coverage in the new remediation guard test. Remove any mocks/imports that only exist for this seeder. Verify `rg "initProjects|projects/seeder" src tests` has no live production dependency other than an intentional static guard.

---

### `src/git/manager.ts` (service, batch cleanup)

**Analog:** `src/git/manager.ts`

**Imports/logger pattern** (lines 1-9):
```typescript
import { simpleGit, type SimpleGit } from 'simple-git';
import { Mutex } from 'async-mutex';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';
```

**Current cleanup swallow to replace** (lines 80-114):
```typescript
async dumpDatabase(): Promise<string> {
  const dumpRelPath = '.fqc/backup.json';
  const dumpAbsDir = join(this.vaultPath, '.fqc');
  const dumpAbsPath = join(this.vaultPath, dumpRelPath);

  const pgClient = createPgClientIPv4(this.supabaseConfig.databaseUrl);
  try {
    await pgClient.connect();
    // query/write backup
    logger.info(`Git: backup written to ${dumpRelPath} (${tablesResult.rows.length} tables)`);
    return dumpRelPath;
  } finally {
    await pgClient.end().catch(() => {});
  }
}
```

**Error logging style in same class** (lines 187-193):
```typescript
} catch (err) {
  logger.warn(
    `Git: commit failed for '${title}' — ${err instanceof Error ? err.message : String(err)}`
  );
} finally {
  release();
}
```

**Shutdown non-throwing error pattern** (lines 250-265):
```typescript
async gracefulShutdown(): Promise<void> {
  try {
    logger.debug('Git: attempting graceful mutex release');
    const release = await Promise.race([
      this.mutex.acquire(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mutex release timeout')), 3_000)
      ),
    ]);
    release();
    logger.info('Git: mutex released gracefully');
  } catch (err: unknown) {
    logger.warn(`Git: mutex release timeout or error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

**Implementation guidance:** use an explicit `try/catch` in `finally` or a small helper. Preferred behavior for this phase: debug-log cleanup rejection without including `this.supabaseConfig.databaseUrl`, and avoid masking a primary `dumpDatabase` error. Do not leave `.catch(() => {})`.

**Test pattern:** `tests/unit/git-manager.test.ts`

Mocks expose `mockPgEnd` and logger methods (lines 30-35, 59-65, 98-104):
```typescript
const mockPgEnd = vi.fn().mockResolvedValue(undefined);
const MockPgClient = vi.fn().mockImplementation(function () {
  return { connect: mockPgConnect, query: mockPgQuery, end: mockPgEnd };
});

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
```

Existing dump tests live at lines 403-446:
```typescript
it('calls pgClient.end() even when query throws', async () => {
  mocks.mockPgConnect.mockResolvedValue(undefined);
  mocks.mockPgQuery.mockRejectedValueOnce(new Error('query failed'));

  const manager = makeManager();
  await manager.initialize(testConfig());

  await expect(manager.dumpDatabase()).rejects.toThrow('query failed');
  expect(mocks.mockPgEnd).toHaveBeenCalled();
});
```

Add T-U-010 here. Include both cases: cleanup-only rejection is visible according to chosen behavior, and primary query failure remains the observed error when `mockPgQuery` and `mockPgEnd` both reject.

---

### `tsup.config.ts`, `package.json`, `package-lock.json` (config, package metadata)

**Analog:** current metadata files.

**Direct type import that drives REQ-005** (`tsup.config.ts` lines 1-13):
```typescript
import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

const externalPluginImports: Plugin = {
  name: 'external-plugin-imports',
  setup(build) {
    build.onResolve({ filter: /plugins\/.*\/skills\// }, (args) => {
      return { path: args.path, external: true };
    });
  },
};
```

**Current package metadata drift** (`package.json` lines 67-85):
```json
"devDependencies": {
  "@eslint/js": "^10.0.1",
  "@types/node": "^25.5.0",
  "@types/pg": "^8.20.0",
  "@types/shelljs": "^0.10.0",
  "@types/uuid": "^10.0.0",
  "eslint": "^10.1.0",
  "knip": "^6.14.2",
  "tsup": "^8.5.1",
  "tsx": "^4.21.0",
  "typescript": "^6.0.2",
  "vitest": "^4.1.1"
}
```

**Lockfile root entry to update** (`package-lock.json` lines 31-45):
```json
"devDependencies": {
  "@eslint/js": "^10.0.1",
  "@types/node": "^25.5.0",
  "@types/pg": "^8.20.0",
  "@types/shelljs": "^0.10.0",
  "@types/uuid": "^10.0.0",
  "eslint": "^10.1.0",
  "knip": "^6.14.2",
  "tsup": "^8.5.1"
}
```

**Redundant type package entry to remove** (`package-lock.json` lines 2455-2460):
```json
"node_modules/@types/uuid": {
  "version": "10.0.0",
  "resolved": "https://registry.npmjs.org/@types/uuid/-/uuid-10.0.0.tgz",
  "integrity": "sha512-7gqG38EyHgyP1S+7+xomFtL+ZNHcKv6DwNaCZmJmo1vgMugyF3TCnXVg4t1uk89mLNwnLtnY3TpOpCOyp1/xHQ==",
  "dev": true,
  "license": "MIT"
}
```

**Implementation guidance:** either add `esbuild` as a direct `devDependency` matching the lockfile-resolved compatible version, or remove the direct `Plugin` import and type the plugin through `tsup`/local structural typing. Remove `@types/uuid` from `package.json` and refresh `package-lock.json` with `npm install --package-lock-only` or equivalent.

**Test/static pattern:** `tests/unit/package-manifest.test.ts` reads `package.json` through `readFile` and asserts manifest fields (lines 1-18):
```typescript
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function readPackageManifest(): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'package.json'), 'utf-8')
  ) as PackageManifest;
}
```

Use this style in `tests/unit/codebase-audit-remaining-remediation.test.ts` for T-U-012 and T-U-013.

---

### `tests/unit/codebase-audit-remaining-remediation.test.ts` (test, static structural guards)

**Analog:** source-reading tests in `tests/unit/document-output.test.ts`, `tests/unit/package-manifest.test.ts`, and `tests/unit/knip-config.test.ts`.

**Source-reading pattern** (`tests/unit/document-output.test.ts` lines 1-3 and 160 pattern found by search):
```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/mcp/tools/documents.ts', 'utf8');
```

**Async manifest/config pattern** (`tests/unit/knip-config.test.ts` lines 30-49):
```typescript
it('[T-U-015] runs the default reporter set with explicit export/type ignore entries', async () => {
  const configPath = resolve(process.cwd(), 'knip.ts');
  const { default: config } = await import(pathToFileURL(configPath).href) as { default: KnipConfig };
  const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts?.knip).toBe('knip --no-config-hints');
});
```

**Implementation guidance:** create one guard file for T-U-004, T-U-007, T-U-008, T-U-009, T-U-011, T-U-012, and T-U-013. Keep guards exact to the spec:

- `src/embedding/provider.ts` must not contain `config.apiKey!`.
- `src/services/plugin-reconciliation.ts` must not contain `vaultManager as unknown as { rootPath: string }`.
- `src/projects/seeder.ts` must be absent.
- `rg`-equivalent source scanning must not find live `initProjects` or `projects/seeder` imports/calls, except the guard test text itself if unavoidable.
- `src/git/manager.ts` must not contain `.catch(() => {})`.
- `tsup.config.ts` direct `esbuild` import must be matched by direct `package.json` metadata, or the import must be absent.
- `package.json` must not contain `@types/uuid`.

Use narrow exact assertions rather than broad repository bans.

## Shared Patterns

### Typed ESM Imports

**Source:** `src/embedding/provider.ts` lines 1-3 and `tsup.config.ts` lines 1-2.

Apply `.js` suffixes for source-relative TypeScript imports and `import type` for type-only imports:
```typescript
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import type { Plugin } from 'esbuild';
```

### Logging Without Secret Leakage

**Source:** `src/git/manager.ts` lines 187-193 and `src/services/plugin-reconciliation.ts` lines 254-257.

Use safe error messages only. Do not include database URLs, credentials, API keys, document contents, record payloads, or embedding vectors:
```typescript
logger.warn(
  `Git: commit failed for '${title}' — ${err instanceof Error ? err.message : String(err)}`
);

logger.debug(`[RECON] Failed to read frontmatter for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
```

For REQ-004 cleanup logging, prefer a fixed message plus the cleanup error message; never interpolate `this.supabaseConfig.databaseUrl`.

### MCP Contract Preservation

REQ-001 through REQ-005 are internal cleanup. Do not change MCP response envelopes. AGENTS.md requires all MCP tools to keep returning:
```typescript
{ content: [{ type: "text", text: "..." }] }
```

On errors, preserve existing `isError: true` behavior where applicable. None of these requirements call for public MCP text changes.

### Vitest Module Mock Pattern

**Source:** `tests/unit/git-manager.test.ts` lines 12-53 and 59-105.

Use `vi.hoisted` for mocks consumed by hoisted `vi.mock` calls:
```typescript
const mocks = vi.hoisted(() => {
  const mockPgEnd = vi.fn().mockResolvedValue(undefined);
  return { mockPgEnd };
});

vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    end: mocks.mockPgEnd,
  })),
}));
```

### Integration Environment Gating

**Source:** `tests/integration/plugin-reconciliation.integration.test.ts` lines 27-33.

Integration tests use `tests/helpers/test-env.ts` and skip when credentials are missing:
```typescript
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL } from '../helpers/test-env.js';

const SKIP_DB = !TEST_SUPABASE_KEY;
```

Use existing gating; do not make Phase 151 integration tests require new environment variables.

## No Analog Found

All Phase 151 files have direct same-file or adjacent-test analogs. No file requires planner fallback to external examples.

## Validation Targets

Required by Test Plan Section 4.1:

| ID | Target |
|---|---|
| T-U-001 | `tests/unit/embedding.test.ts`: OpenAI missing `apiKey` throws synchronously with helpful provider/apiKey message. |
| T-U-002 | `tests/unit/embedding.test.ts`: OpenRouter missing `apiKey` throws synchronously with helpful provider/apiKey message. |
| T-U-003 | `tests/unit/embedding.test.ts`: Ollama works without `apiKey`. |
| T-U-004 | Static guard: no `config.apiKey!` in `src/embedding/provider.ts`. |
| T-U-005 | Vault absolute-path API resolves nested vault-relative path under vault root. |
| T-U-006 | Vault absolute-path API preserves existing normalization/unsafe-input behavior. |
| T-U-007 | Static guard: no private `rootPath` cast in plugin reconciliation. |
| T-U-008 | Static guard: `src/projects/seeder.ts` absent. |
| T-U-009 | Static guard: no production `initProjects` import/call. |
| T-U-010 | `tests/unit/git-manager.test.ts`: pg cleanup failure handling is visible and primary error is preserved. |
| T-U-011 | Static guard: no `.catch(() => {})` in `src/git/manager.ts` cleanup code. |
| T-U-012 | Static guard: direct `esbuild` import has direct metadata or import is removed. |
| T-U-013 | Static guard: `@types/uuid` absent from `package.json`. |
| T-U-014 | Run `npm run knip`. |
| T-U-015 | Run `npm audit`. |
| T-I-001 | Run `tests/integration/plugin-reconciliation.integration.test.ts` per local environment gate. |

## Metadata

**Analog search scope:** `src/`, `tests/unit/`, `tests/integration/`, `package.json`, `package-lock.json`, `tsup.config.ts`
**Files scanned:** 382
**Pattern extraction date:** 2026-05-25

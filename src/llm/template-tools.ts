import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { posix as pathPosix } from 'node:path';
import matter from 'gray-matter';
import type { FlashQueryConfig } from '../config/types.js';
import {
  normalizeTemplateParamDeclarations,
  renderTemplateDocument,
} from './reference-resolver.js';
import type {
  TemplateParamDeclaration,
  TemplateParamUsage,
} from './reference-metadata.js';
import {
  mergeModelVisibleToolRegistries,
  normalizeToolJsonSchema,
  type OpenAiToolDefinition,
} from './tool-registry.js';
import type { LlmChatToolCall, LlmToolMessage } from './types.js';
import type { TemplateWarning } from '../constants/template-warnings.js';
import { supabaseManager } from '../storage/supabase.js';
import { embeddingProvider } from '../embedding/provider.js';
import { logger } from '../logging/logger.js';

const FALLBACK_MARKDOWN_EXTENSIONS: string[] = ['.md'];

export interface TemplateToolDefinition {
  name: string;
  templatePath: string;
  description: string;
  namespace: string;
  slug: string;
  parameters: Record<string, unknown>;
  frontmatter: Record<string, unknown>;
}

export type TemplateToolReverseMap = Map<string, string>;

export interface TemplateToolDiagnostics {
  template_tools: Array<{
    name: string;
    template_path: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  template_tool_warnings: Array<{
    template_path: string;
    code: string;
    message: string;
    source?: string;
  }>;
  dangling_template_paths: Array<{ template_path: string; source?: string }>;
  template_tool_conflicts: Array<{
    name: string;
    template_paths: string[];
    sources: Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }>;
  }>;
}

export interface TemplateToolRegistryAssembly {
  templateTools: TemplateToolDefinition[];
  templateReverseMap: TemplateToolReverseMap;
  diagnostics: TemplateToolDiagnostics;
  providerTools?: OpenAiToolDefinition[];
}

export { mergeModelVisibleToolRegistries };

export interface TemplateToolRuntimeBinding {
  purpose_name?: string;
  purposeName?: string;
  template_path?: string;
  templatePath?: string;
  source?: string;
}

export interface AssembleTemplateToolRegistryOptions {
  config: FlashQueryConfig;
  purposeName: string;
  runtimeBindings?: TemplateToolRuntimeBinding[];
  nativeToolNames?: readonly string[];
  strictTools?: boolean;
  templateCandidates?: TemplateDocumentCandidate[];
}

export interface DispatchTemplateToolCallOptions {
  toolCall: LlmChatToolCall;
  templateReverseMap: TemplateToolReverseMap;
  config?: FlashQueryConfig;
  supabaseManager?: typeof supabaseManager;
  embeddingProvider?: typeof embeddingProvider;
  logger?: typeof logger;
  templateDocuments?: Map<string, { body: string; frontmatter: Record<string, unknown> }>;
}

export interface TemplateToolCallLogEntry {
  kind: 'template';
  tool_call_id: string;
  tool_name: string;
  template_path?: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
  ok: boolean;
  error_code?: string;
  result_summary: string;
}

export interface DispatchTemplateToolCallResult {
  message: LlmToolMessage;
  logEntry: TemplateToolCallLogEntry;
}

export interface TemplateDocumentCandidate {
  templatePath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  source?: string;
}

export interface TemplateCandidateBinding {
  templatePath: string;
  source: string;
}

const TEMPLATE_TOOL_PREFIX = 'flashquery';
const DEFAULT_NAMESPACE = 'template';
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Contract markers: generated tools are `flashquery_${namespace}_${slug}` and
// resolver-backed dispatch reads templates with effectiveInclude: ['body', 'frontmatter'].

function warn(message: string): void {
  logger?.warn(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTemplatePath(templateIdentifier: string): string {
  const raw = templateIdentifier.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  return pathPosix.normalize(raw);
}

function isSafeTemplatePath(templatePath: string): boolean {
  return (
    templatePath !== '.' &&
    templatePath !== '' &&
    !templatePath.startsWith('/') &&
    !templatePath.startsWith('../') &&
    templatePath !== '..' &&
    !templatePath.endsWith('/')
  );
}

export function generateTemplateSlug(filenameStem: string): string | null {
  const slug = filenameStem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : null;
}

export function generateTemplateToolName(input: { namespace?: string; path: string }): string | null {
  const namespace = input.namespace ?? DEFAULT_NAMESPACE;
  if (!NAMESPACE_PATTERN.test(namespace)) return null;
  const slug = generateTemplateSlug(basename(input.path, extname(input.path)));
  if (slug === null) return null;
  const name = `${TEMPLATE_TOOL_PREFIX}_${namespace}_${slug}`;
  return TOOL_NAME_PATTERN.test(name) ? name : null;
}

export function buildTemplateToolName(input: {
  templatePath: string;
  frontmatter: Record<string, unknown>;
}): string | null {
  const namespace = typeof input.frontmatter.fq_namespace === 'string'
    ? input.frontmatter.fq_namespace
    : DEFAULT_NAMESPACE;
  return generateTemplateToolName({ namespace, path: input.templatePath });
}

function emptyDiagnostics(): TemplateToolDiagnostics {
  return {
    template_tools: [],
    template_tool_warnings: [],
    dangling_template_paths: [],
    template_tool_conflicts: [],
  };
}

async function discoverMarkdownFiles(root: string, markdownExtensions: string[]): Promise<string[]> {
  async function walk(dir: string): Promise<string[]> {
    let entries: Array<Dirent<string>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = await Promise.all(entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return await walk(full);
      if (!entry.isFile()) return [];
      return markdownExtensions.includes(extname(entry.name)) ? [full] : [];
    }));
    return files.flat();
  }
  return await walk(root);
}

function escapesBase(relativePath: string): boolean {
  return (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  );
}

async function isContainedNonSymlink(vaultRoot: string, fullPath: string, normalizedPath: string): Promise<boolean> {
  try {
    const realVaultRoot = await realpath(vaultRoot);
    let cursor = realVaultRoot;
    for (const segment of normalizedPath.split('/').filter(Boolean)) {
      cursor = resolvePath(cursor, segment);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) return false;
    }
    const realFullPath = await realpath(fullPath);
    return !escapesBase(relative(realVaultRoot, realFullPath));
  } catch {
    return false;
  }
}

async function readTemplateCandidate(
  config: FlashQueryConfig,
  templatePath: string,
  source?: string
): Promise<TemplateDocumentCandidate | null> {
  const normalized = normalizeTemplatePath(templatePath);
  if (!isSafeTemplatePath(normalized)) return null;
  const vaultRoot = resolvePath(config.instance.vault.path);
  const fullPath = resolvePath(vaultRoot, normalized);
  const relativePath = relative(vaultRoot, fullPath);
  if (escapesBase(relativePath)) {
    return null;
  }
  try {
    if (!await isContainedNonSymlink(vaultRoot, fullPath, normalized)) return null;
    const raw = await readFile(fullPath, 'utf8');
    const parsed = matter(raw);
    return {
      templatePath: normalized,
      body: parsed.content,
      frontmatter: parsed.data,
      source,
    };
  } catch {
    return null;
  }
}

async function discoverAllTemplateCandidates(config: FlashQueryConfig): Promise<TemplateDocumentCandidate[]> {
  const markdownExtensions = config.instance.vault.markdownExtensions;
  const files = await discoverMarkdownFiles(config.instance.vault.path, markdownExtensions);
  const candidates = await Promise.all(files.map(async (file) => {
    const templatePath = relative(config.instance.vault.path, file).replaceAll('\\', '/');
    return await readTemplateCandidate(config, templatePath);
  }));
  return candidates.filter((candidate): candidate is TemplateDocumentCandidate => candidate !== null);
}

async function loadIndexedTemplateCandidates(
  config: FlashQueryConfig,
  options: { access: 'permissive' | 'restrictive'; bound: Array<{ templatePath: string; source: string }> }
): Promise<TemplateDocumentCandidate[]> {
  let supabase: ReturnType<typeof supabaseManager.getClient>;
  try {
    supabase = supabaseManager.getClient();
  } catch (error) {
    warn(`template discovery index unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  let query = supabase
    .from('fqc_documents')
    .select('path, template_meta')
    .eq('instance_id', config.instance.id)
    .eq('status', 'active');

  if (options.access === 'permissive') {
    query = query.filter('template_meta->>fq_template', 'eq', 'true');
  } else {
    const paths = options.bound.map((entry) => entry.templatePath);
    if (paths.length === 0) return [];
    query = query.in('path', paths);
  }

  const { data, error } = await query;
  if (error) {
    warn(`template discovery index query failed: ${error.message}`);
    return [];
  }

  const sourceByPath = new Map(options.bound.map((entry) => [entry.templatePath, entry.source]));
  return (data ?? []).flatMap((row: { path?: unknown; template_meta?: unknown }) => {
    if (typeof row.path !== 'string' || !isRecord(row.template_meta)) return [];
    return [{
      templatePath: normalizeTemplatePath(row.path),
      body: '',
      frontmatter: row.template_meta,
      source: sourceByPath.get(normalizeTemplatePath(row.path)),
    }];
  });
}

function bindingPath(binding: TemplateToolRuntimeBinding): string | null {
  const raw = binding.template_path ?? binding.templatePath;
  return typeof raw === 'string' ? normalizeTemplatePath(raw) : null;
}

function bindingPurpose(binding: TemplateToolRuntimeBinding): string | null {
  const raw = binding.purpose_name ?? binding.purposeName;
  return typeof raw === 'string' ? raw : null;
}

export function collectTemplateRegistryBoundPaths(input: {
  config: FlashQueryConfig;
  purposeName: string;
  runtimeBindings?: TemplateToolRuntimeBinding[];
}): TemplateCandidateBinding[] {
  const purpose = input.config.llm?.purposes.find((candidate) =>
    candidate.name.toLowerCase() === input.purposeName.toLowerCase()
  );
  const byPath = new Map<string, string>();
  for (const path of purpose?.templates ?? []) {
    byPath.set(normalizeTemplatePath(path), 'yaml');
  }
  for (const binding of input.runtimeBindings ?? []) {
    if (bindingPurpose(binding)?.toLowerCase() !== input.purposeName.toLowerCase()) continue;
    const templatePath = bindingPath(binding);
    if (templatePath === null) continue;
    byPath.set(templatePath, binding.source ?? 'api');
  }
  return [...byPath.entries()].map(([templatePath, source]) => ({ templatePath, source }));
}

export async function loadTemplateCandidatesForRegistry(input: {
  config: FlashQueryConfig;
  access: 'permissive' | 'restrictive';
  bound: TemplateCandidateBinding[];
}): Promise<TemplateDocumentCandidate[]> {
  if ('supabase' in input.config) {
    return await loadIndexedTemplateCandidates(input.config, {
      access: input.access,
      bound: input.bound,
    });
  }
  if (input.access === 'permissive') {
    return await discoverAllTemplateCandidates(input.config);
  }
  return (await Promise.all(input.bound.map(async (entry) =>
    await readTemplateCandidate(input.config, entry.templatePath, entry.source)
  ))).filter((candidate): candidate is TemplateDocumentCandidate => candidate !== null);
}

function templateParamSchema(
  rawParams: unknown
): { schema: Record<string, unknown>; declarations: Record<string, TemplateParamDeclaration>; error?: string } {
  const raw = isRecord(rawParams) ? rawParams : {};
  const declarations = normalizeTemplateParamDeclarations(rawParams);
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value) || (value.type !== 'string' && value.type !== 'document')) {
      return {
        schema: {},
        declarations,
        error: `unsupported_template_param_schema: '${name}' uses an unsupported parameter declaration`,
      };
    }
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, declaration] of Object.entries(declarations)) {
    properties[name] = declaration.type === 'document'
      ? { type: 'string', description: 'Vault document identifier' }
      : { type: 'string' };
    if (declaration.required === true) required.push(name);
  }

  const schema = normalizeToolJsonSchema({
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }, { strict: false });
  return { schema, declarations };
}

function templateProviderSchema(
  declarations: Record<string, TemplateParamDeclaration>,
  strict: boolean
): Record<string, unknown> {
  if (!strict) {
    return templateParamSchema(Object.fromEntries(
      Object.entries(declarations).map(([name, declaration]) => [name, declaration])
    )).schema;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, declaration] of Object.entries(declarations)) {
    const base = declaration.type === 'document'
      ? { type: 'string', description: 'Vault document identifier' }
      : { type: 'string' };
    properties[name] = declaration.required === true
      ? base
      : { anyOf: [base, { type: 'null' }] };
    required.push(name);
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function validateTemplateCandidate(
  candidate: TemplateDocumentCandidate
): (
  | { kind: 'skip' }
  | { kind: 'warning'; warning: { code: string; message: string } }
  | { kind: 'tool'; toolName: string; schema: Record<string, unknown> }
) {
  const frontmatter = candidate.frontmatter;
  if (frontmatter.fq_template !== true) {
    return { kind: 'skip' };
  }
  if (frontmatter.fq_expose_as_tool !== true) {
    return { kind: 'warning', warning: { code: 'not_exposed', message: 'Template is missing fq_expose_as_tool: true' } };
  }
  const namespace = typeof frontmatter.fq_namespace === 'string' ? frontmatter.fq_namespace : DEFAULT_NAMESPACE;
  if (!NAMESPACE_PATTERN.test(namespace)) {
    return { kind: 'warning', warning: { code: 'invalid_namespace', message: `Invalid fq_namespace '${namespace}'` } };
  }
  const description = frontmatter.fq_desc;
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { kind: 'warning', warning: { code: 'missing_description', message: 'Template is missing fq_desc' } };
  }
  const toolName = generateTemplateToolName({ namespace, path: candidate.templatePath });
  if (toolName === null) {
    return { kind: 'warning', warning: { code: 'invalid_tool_name', message: 'Template filename produced an invalid provider tool name' } };
  }
  const params = templateParamSchema(frontmatter.fq_params);
  if (params.error !== undefined) {
    return { kind: 'warning', warning: { code: 'unsupported_template_param_schema', message: params.error } };
  }
  return { kind: 'tool', toolName, schema: params.schema };
}

function addConflict(
  diagnostics: TemplateToolDiagnostics,
  name: string,
  sources: Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }>
): void {
  const templatePaths = sources
    .map((source) => source.template_path)
    .filter((path): path is string => path !== undefined);
  diagnostics.template_tool_conflicts.push({
    name,
    template_paths: Array.from(new Set(templatePaths)),
    sources,
  });
}

export async function assembleTemplateToolRegistry(
  optionsOrConfig: AssembleTemplateToolRegistryOptions | FlashQueryConfig,
  purposeName?: string,
  maybeOptions?: Omit<AssembleTemplateToolRegistryOptions, 'config' | 'purposeName'>
): Promise<TemplateToolRegistryAssembly> {
  const options: AssembleTemplateToolRegistryOptions = isRecord(optionsOrConfig) && 'config' in optionsOrConfig
    ? optionsOrConfig as AssembleTemplateToolRegistryOptions
    : { ...(maybeOptions ?? {}), config: optionsOrConfig as FlashQueryConfig, purposeName: purposeName ?? '' };
  const diagnostics = emptyDiagnostics();
  const access = options.config.templates?.defaultAccess ?? 'permissive';
  const bound = collectTemplateRegistryBoundPaths(options);
  const boundByPath = new Map(bound.map((entry) => [entry.templatePath, entry.source]));
  const candidates = options.templateCandidates ?? await loadTemplateCandidatesForRegistry({
    config: options.config,
    access,
    bound,
  });

  for (const binding of bound) {
    if (!candidates.some((candidate) => candidate.templatePath === binding.templatePath)) {
      diagnostics.dangling_template_paths.push({ template_path: binding.templatePath, source: binding.source });
      diagnostics.template_tool_warnings.push({
        template_path: binding.templatePath,
        code: 'dangling_template_path',
        message: `Template binding '${binding.templatePath}' is dangling`,
        source: binding.source,
      });
    }
  }

  const byName = new Map<string, TemplateToolDefinition[]>();
  for (const candidate of candidates) {
    const source = candidate.source ?? boundByPath.get(candidate.templatePath);
    const validation = validateTemplateCandidate(candidate);
    if (validation.kind === 'skip') {
      continue;
    }
    if (validation.kind === 'warning') {
      diagnostics.template_tool_warnings.push({
        template_path: candidate.templatePath,
        code: validation.warning.code,
        message: validation.warning.message,
        ...(source === undefined ? {} : { source }),
      });
      continue;
    }
    const description = candidate.frontmatter.fq_desc as string;
    const namespace = typeof candidate.frontmatter.fq_namespace === 'string'
      ? candidate.frontmatter.fq_namespace
      : DEFAULT_NAMESPACE;
    const slug = generateTemplateSlug(basename(candidate.templatePath, extname(candidate.templatePath))) ?? '';
    const tool: TemplateToolDefinition = {
      name: validation.toolName,
      templatePath: candidate.templatePath,
      description,
      namespace,
      slug,
      parameters: validation.schema,
      frontmatter: candidate.frontmatter,
    };
    const tools = byName.get(tool.name) ?? [];
    tools.push(tool);
    byName.set(tool.name, tools);
  }

  const nativeNames = new Set(options.nativeToolNames ?? []);
  const providerTools: OpenAiToolDefinition[] = [];
  const templateTools: TemplateToolDefinition[] = [];
  const templateReverseMap: TemplateToolReverseMap = new Map();

  for (const [name, tools] of byName.entries()) {
    const conflictSources: Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }> = [
      ...tools.map((tool) => ({ kind: 'template' as const, template_path: tool.templatePath })),
      ...(nativeNames.has(name) ? [{ kind: 'native' as const, name }] : []),
    ];
    if (conflictSources.length > 1) {
      addConflict(diagnostics, name, conflictSources);
      continue;
    }
    const tool = tools[0];
    templateTools.push(tool);
    templateReverseMap.set(tool.name, tool.templatePath);
    diagnostics.template_tools.push({
      name: tool.name,
      template_path: tool.templatePath,
      description: tool.description,
      parameters: tool.parameters,
    });
    providerTools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: templateProviderSchema(
          normalizeTemplateParamDeclarations(tool.frontmatter.fq_params),
          options.strictTools === true
        ),
        ...(options.strictTools === true ? { strict: true as const } : {}),
      },
    });
  }

  return {
    templateTools,
    templateReverseMap,
    diagnostics,
    ...(providerTools.length > 0 ? { providerTools } : {}),
  };
}

function makeToolMessage(toolCall: LlmChatToolCall, content: string): LlmToolMessage {
  return { role: 'tool', tool_call_id: toolCall.id, content };
}

function summarize(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

function successResult(
  toolCall: LlmChatToolCall,
  templatePath: string,
  args: Record<string, unknown>,
  content: string,
  paramsUsed: Record<string, TemplateParamUsage> = {},
  warnings: TemplateWarning[] = []
): DispatchTemplateToolCallResult {
  const payload = {
    ok: true,
    result: {
      template_path: templatePath,
      content,
      template_params_used: paramsUsed,
      ...(warnings.length > 0 ? { template_warnings: warnings } : {}),
    },
  };
  const text = JSON.stringify(payload);
  return {
    message: makeToolMessage(toolCall, text),
    logEntry: {
      kind: 'template',
      tool_call_id: toolCall.id,
      tool_name: toolCall.function.name,
      template_path: templatePath,
      arguments: args,
      status: 'success',
      ok: true,
      result_summary: summarize(text),
    },
  };
}

function errorResult(
  toolCall: LlmChatToolCall,
  args: Record<string, unknown>,
  code: string,
  message: string,
  templatePath?: string,
  details?: unknown
): DispatchTemplateToolCallResult {
  const payload = {
    ok: false,
    error: {
      code,
      message,
      recoverable: true,
      ...(details === undefined ? {} : { details }),
    },
  };
  const text = JSON.stringify(payload);
  return {
    message: makeToolMessage(toolCall, text),
    logEntry: {
      kind: 'template',
      tool_call_id: toolCall.id,
      tool_name: toolCall.function.name,
      ...(templatePath === undefined ? {} : { template_path: templatePath }),
      arguments: args,
      status: 'error',
      ok: false,
      error_code: code,
      result_summary: summarize(text),
    },
  };
}

function parseToolArguments(args: unknown): Record<string, unknown> | null {
  return isRecord(args) ? args : null;
}

export async function dispatchTemplateToolCall(
  options: DispatchTemplateToolCallOptions
): Promise<DispatchTemplateToolCallResult> {
  const toolName = options.toolCall.function.name;
  const templatePath = options.templateReverseMap.get(toolName);
  const args = parseToolArguments(options.toolCall.function.arguments);
  if (args === null) {
    return errorResult(options.toolCall, {}, 'invalid_tool_arguments', `Arguments for template tool '${toolName}' must be an object.`);
  }
  if (templatePath === undefined) {
    return errorResult(options.toolCall, args, 'tool_not_in_registry', `Tool '${toolName}' is not available in the template reverse map.`);
  }

  const providedCandidate = options.templateDocuments?.get(templatePath);
  const candidate = providedCandidate === undefined && options.config !== undefined
    ? await readTemplateCandidate(options.config, templatePath)
    : providedCandidate === undefined
      ? null
      : { templatePath, body: providedCandidate.body, frontmatter: providedCandidate.frontmatter };
  if (candidate === null) {
    return errorResult(
      options.toolCall,
      args,
      'template_not_found',
      `Template tool '${toolName}' could not read template '${templatePath}'.`,
      templatePath
    );
  }

  const schema = templateParamSchema(candidate.frontmatter.fq_params);
  if (schema.error !== undefined) {
    return errorResult(options.toolCall, args, 'unsupported_template_param_schema', schema.error, templatePath);
  }

  const rendered = await renderTemplateDocument(
    {
      body: candidate.body,
      path: templatePath,
      frontmatter: candidate.frontmatter,
    },
    args,
    options.config ?? {
      instance: {
        id: 'template-dispatch',
        vault: { path: process.cwd(), markdownExtensions: FALLBACK_MARKDOWN_EXTENSIONS },
      },
    } as FlashQueryConfig,
    options.supabaseManager ?? supabaseManager,
    options.embeddingProvider ?? embeddingProvider,
    options.logger ?? logger
  );
  if (!rendered.ok) {
    return errorResult(options.toolCall, args, rendered.reason, rendered.detail, templatePath);
  }
  return successResult(
    options.toolCall,
    templatePath,
    args,
    rendered.content,
    rendered.paramsUsed,
    rendered.warnings
  );

}

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

export const TOOL_META_GLOB = 'src/mcp/tools/*.tool.md';
export const DEFAULT_HELP_HINT =
  "FlashQuery-native tool. Pass `{help: true}` for full documentation, examples, and common patterns before composing your call if you're uncertain about parameters.";

const DESCRIPTION_HELP_SUFFIX = /help\s*[`:{]?\s*true[`}]?[^.]*\.\s*$/i;
const SHORT_DESCRIPTION_THRESHOLD = 40;
const MIN_HELP_BODY_WORDS = 500;
const MAX_HELP_BODY_WORDS = 1500;
const VALID_TIERS = new Set(['read-only', 'read-write', 'admin']);

export interface ToolMeta {
  name: string;
  description: string;
  helpHint: string;
  helpPageBody: string;
  tier: 'read-only' | 'read-write' | 'admin';
  args: unknown;
  filePath: string;
}

export interface ToolMetaSource {
  filePath: string;
  raw: string;
}

export interface ToolMetaDiagnostic {
  level: 'error' | 'warning';
  filePath: string;
  message: string;
}

export interface ToolMetaValidationResult {
  ok: boolean;
  meta: Map<string, ToolMeta>;
  diagnostics: ToolMetaDiagnostic[];
}

export async function loadToolMeta(): Promise<Map<string, ToolMeta>> {
  const filePaths = await fg(TOOL_META_GLOB, { onlyFiles: true, unique: true });
  const sources = await Promise.all(filePaths.sort().map(async (filePath) => ({
    filePath,
    raw: await readFile(filePath, 'utf8'),
  })));
  const result = validateToolMeta(sources);

  if (!result.ok) {
    const errors = result.diagnostics
      .filter((diagnostic) => diagnostic.level === 'error')
      .map((diagnostic) => `${diagnostic.filePath}: ${diagnostic.message}`)
      .join('\n');
    throw new Error(`Invalid .tool.md metadata:\n${errors}`);
  }

  return result.meta;
}

export function loadToolMetaSync(): Map<string, ToolMeta> {
  const filePaths = fg.sync(TOOL_META_GLOB, { onlyFiles: true, unique: true });
  const sources = filePaths.sort().map((filePath) => ({
    filePath,
    raw: readFileSync(filePath, 'utf8'),
  }));
  const result = validateToolMeta(sources);

  if (!result.ok) {
    const errors = result.diagnostics
      .filter((diagnostic) => diagnostic.level === 'error')
      .map((diagnostic) => `${diagnostic.filePath}: ${diagnostic.message}`)
      .join('\n');
    throw new Error(`Invalid .tool.md metadata:\n${errors}`);
  }

  return result.meta;
}

export function assertRegisteredToolsHaveToolMeta(
  catalog: Array<{ name: string }>,
  meta: ReadonlyMap<string, ToolMeta>
): void {
  const missing = catalog
    .map((tool) => tool.name)
    .filter((name) => meta.get(name) === undefined);

  if (missing.length > 0) {
    throw new Error(`Missing .tool.md metadata for registered tools: ${missing.sort().join(', ')}`);
  }
}

export function validateToolMeta(sources: readonly ToolMetaSource[]): ToolMetaValidationResult {
  const diagnostics: ToolMetaDiagnostic[] = [];
  const parsedRecords: Array<{
    source: ToolMetaSource;
    data: Record<string, unknown>;
    body: string;
    fileToolName: string;
  }> = [];

  for (const source of sources) {
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(source.raw);
    } catch (error) {
      diagnostics.push(errorDiagnostic(source.filePath, `failed to parse frontmatter: ${formatError(error)}`));
      continue;
    }

    const data = parsed.data as Record<string, unknown>;
    const fileToolName = basename(source.filePath, '.tool.md');
    parsedRecords.push({
      source,
      data,
      body: parsed.content,
      fileToolName,
    });

    validateRequiredStringField(data, 'name', source.filePath, diagnostics);
    validateRequiredStringField(data, 'description', source.filePath, diagnostics);
    validateRequiredStringField(data, 'tier', source.filePath, diagnostics);

    if (!Object.hasOwn(data, 'args') || data['args'] === null || data['args'] === undefined) {
      diagnostics.push(errorDiagnostic(source.filePath, "missing required frontmatter field 'args'"));
    }

    if (Object.hasOwn(data, 'help_hint') && typeof data['help_hint'] !== 'string') {
      diagnostics.push(errorDiagnostic(source.filePath, "frontmatter field 'help_hint' must be a string when provided"));
    }

    const name = typeof data['name'] === 'string' ? data['name'].trim() : undefined;
    const description = typeof data['description'] === 'string' ? data['description'].trim() : undefined;
    const tier = typeof data['tier'] === 'string' ? data['tier'].trim() : undefined;

    if (name && name !== fileToolName) {
      diagnostics.push(errorDiagnostic(source.filePath, `frontmatter name '${name}' must match file basename '${fileToolName}'`));
    }

    if (description && !DESCRIPTION_HELP_SUFFIX.test(description)) {
      diagnostics.push(errorDiagnostic(
        source.filePath,
        'description must end with a sentence containing help and true, such as {help: true}.'
      ));
    }

    if (description && description.length < SHORT_DESCRIPTION_THRESHOLD) {
      diagnostics.push(warningDiagnostic(
        source.filePath,
        `description is shorter than ${SHORT_DESCRIPTION_THRESHOLD} characters`
      ));
    }

    if (tier && !VALID_TIERS.has(tier)) {
      diagnostics.push(errorDiagnostic(source.filePath, "frontmatter field 'tier' must be one of read-only, read-write, admin"));
    }

    const bodyWordCount = countWords(parsed.content);
    if (bodyWordCount === 0) {
      diagnostics.push(warningDiagnostic(source.filePath, 'help page body is empty'));
    } else if (bodyWordCount < MIN_HELP_BODY_WORDS || bodyWordCount > MAX_HELP_BODY_WORDS) {
      diagnostics.push(warningDiagnostic(
        source.filePath,
        `help page body length is ${bodyWordCount} words; target is ${MIN_HELP_BODY_WORDS}-${MAX_HELP_BODY_WORDS}`
      ));
    }
  }

  const nameToFiles = new Map<string, string[]>();
  for (const record of parsedRecords) {
    const name = typeof record.data['name'] === 'string' ? record.data['name'].trim() : '';
    if (!name) continue;
    const files = nameToFiles.get(name) ?? [];
    files.push(record.source.filePath);
    nameToFiles.set(name, files);
  }

  for (const [name, files] of nameToFiles) {
    if (files.length <= 1) continue;
    for (const filePath of files) {
      diagnostics.push(errorDiagnostic(filePath, `duplicate frontmatter name '${name}'`));
    }
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.level === 'error');
  const meta = new Map<string, ToolMeta>();
  if (!hasErrors) {
    for (const record of parsedRecords) {
      const name = (record.data['name'] as string).trim();
      meta.set(name, {
        name,
        description: (record.data['description'] as string).trim(),
        helpHint: typeof record.data['help_hint'] === 'string' && record.data['help_hint'].trim()
          ? record.data['help_hint'].trim()
          : DEFAULT_HELP_HINT,
        helpPageBody: record.body,
        tier: (record.data['tier'] as ToolMeta['tier']).trim() as ToolMeta['tier'],
        args: record.data['args'],
        filePath: record.source.filePath,
      });
    }
  }

  return {
    ok: !hasErrors,
    meta,
    diagnostics,
  };
}

function validateRequiredStringField(
  data: Record<string, unknown>,
  field: string,
  filePath: string,
  diagnostics: ToolMetaDiagnostic[]
): void {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') {
    diagnostics.push(errorDiagnostic(filePath, `missing required frontmatter field '${field}'`));
  }
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorDiagnostic(filePath: string, message: string): ToolMetaDiagnostic {
  return { level: 'error', filePath, message };
}

function warningDiagnostic(filePath: string, message: string): ToolMetaDiagnostic {
  return { level: 'warning', filePath, message };
}

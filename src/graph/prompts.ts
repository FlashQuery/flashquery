import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

export interface GraphPromptDefinition {
  id: string;
  version: string;
  template: string;
  requiredVariables: string[];
  overridable: boolean;
}

const PromptSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    template: z.string().min(1),
    required_variables: z.array(z.string().min(1)),
    overridable: z.boolean(),
  })
  .strict();

const PromptFileSchema = z
  .object({
    prompts: z.array(PromptSchema).min(1),
  })
  .strict();

export const DEFAULT_GRAPH_PROMPTS: GraphPromptDefinition[] = [
  {
    id: 'classify_edge',
    version: '1',
    template:
      'Classify the relationship between two document chunks using these graph types:\n{{graph:classified_types}}\n\nSource:\n{{source_chunk}}\n\nTarget:\n{{target_chunk}}',
    requiredVariables: ['graph:classified_types', 'source_chunk', 'target_chunk'],
    overridable: true,
  },
];

function promptFromYaml(raw: z.infer<typeof PromptSchema>): GraphPromptDefinition {
  return {
    id: raw.id,
    version: raw.version,
    template: raw.template,
    requiredVariables: raw.required_variables,
    overridable: raw.overridable,
  };
}

export function validateGraphPrompts(
  prompts: GraphPromptDefinition[],
  overrides?: Record<string, unknown>
): GraphPromptDefinition[] {
  const errors: string[] = [];
  const ids = new Map<string, GraphPromptDefinition>();

  for (const prompt of prompts) {
    if (ids.has(prompt.id)) {
      errors.push(`Duplicate graph prompt '${prompt.id}'`);
    }
    ids.set(prompt.id, prompt);

    for (const variable of prompt.requiredVariables) {
      const token = `{{${variable}}}`;
      if (!prompt.template.includes(token)) {
        errors.push(`Graph prompt '${prompt.id}' is missing required variable token ${token}`);
      }
    }
  }

  for (const overrideId of Object.keys(overrides ?? {})) {
    const prompt = ids.get(overrideId);
    if (!prompt) {
      errors.push(`Graph prompt override '${overrideId}' does not match a known prompt`);
      continue;
    }
    if (!prompt.overridable) {
      errors.push(`Graph prompt '${overrideId}' is not overridable`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return prompts;
}

export function loadGraphPrompts(options?: {
  vaultPath?: string;
  promptsPath?: string;
  overrides?: Record<string, unknown>;
}): GraphPromptDefinition[] {
  const promptsPath = options?.promptsPath;
  if (!promptsPath) {
    return validateGraphPrompts(DEFAULT_GRAPH_PROMPTS, options?.overrides);
  }

  const resolvedPath = isAbsolute(promptsPath)
    ? promptsPath
    : join(options?.vaultPath ?? process.cwd(), promptsPath);

  if (!existsSync(resolvedPath)) {
    return validateGraphPrompts(DEFAULT_GRAPH_PROMPTS, options?.overrides);
  }

  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(resolvedPath, 'utf-8'));
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
      const line = err.mark ? err.mark.line + 1 : '?';
      throw new Error(`Graph prompts error: Invalid YAML syntax at line ${line}: ${err.reason}`, {
        cause: err,
      });
    }
    throw err;
  }

  const result = PromptFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => `Graph prompts error: ${issue.path.join('.')} ${issue.message}`)
        .join('\n')
    );
  }

  return validateGraphPrompts(result.data.prompts.map(promptFromYaml), options?.overrides);
}

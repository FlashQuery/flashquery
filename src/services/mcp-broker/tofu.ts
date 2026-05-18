import { createHash } from 'node:crypto';

export interface ToolSchemaHashInput {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
      const child = objectValue[key];
      if (child !== undefined) {
        result[key] = canonicalize(child);
      }
    }
    return result;
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashToolSchema(tool: ToolSchemaHashInput): string {
  const hashInput = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };

  return createHash('sha256').update(canonicalJson(hashInput)).digest('hex');
}

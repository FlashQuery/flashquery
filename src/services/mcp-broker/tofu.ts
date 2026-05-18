import { createHash } from 'node:crypto';
import type { TofuDriftPayload, TofuEntry, TofuObservationResult, TofuToolSchemaSnapshot } from './types.js';

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

export interface TofuObservationInput {
  serverId: string;
  toolName: string;
  description?: string;
  inputSchema?: unknown;
}

export class InMemoryTofuStore {
  readonly #entries = new Map<string, TofuEntry>();

  observe(input: TofuObservationInput): TofuObservationResult {
    const key = tofuKey(input.serverId, input.toolName);
    const schema = schemaSnapshot(input);
    const hash = hashToolSchema({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.inputSchema,
    });
    const existing = this.#entries.get(key);

    if (existing === undefined) {
      const entry: TofuEntry = {
        serverId: input.serverId,
        toolName: input.toolName,
        trustedHash: hash,
        trustedSchema: schema,
        blocked: false,
        removed: false,
      };
      this.#entries.set(key, entry);
      return { status: 'trusted', key, entry: cloneEntry(entry) };
    }

    if (existing.trustedHash === hash) {
      const entry: TofuEntry = {
        ...existing,
        trustedSchema: schema,
        blocked: false,
        removed: false,
        pendingHash: undefined,
        pendingSchema: undefined,
      };
      this.#entries.set(key, entry);
      return { status: 'trusted', key, entry: cloneEntry(entry) };
    }

    const entry: TofuEntry = {
      ...existing,
      pendingHash: hash,
      pendingSchema: schema,
      blocked: true,
      removed: false,
    };
    this.#entries.set(key, entry);
    return {
      status: 'pending_re_approval',
      key,
      entry: cloneEntry(entry),
      drift: buildDriftPayload(input.serverId, input.toolName, existing.trustedSchema, schema),
    };
  }

  approve(serverId: string, toolName: string): { key: string; entry: TofuEntry } {
    const key = tofuKey(serverId, toolName);
    const entry = this.#requireEntry(key);
    if (entry.pendingHash === undefined || entry.pendingSchema === undefined) {
      return { key, entry: cloneEntry(entry) };
    }

    const approved: TofuEntry = {
      ...entry,
      trustedHash: entry.pendingHash,
      trustedSchema: entry.pendingSchema,
      pendingHash: undefined,
      pendingSchema: undefined,
      blocked: false,
      removed: false,
    };
    this.#entries.set(key, approved);
    return { key, entry: cloneEntry(approved) };
  }

  reject(serverId: string, toolName: string): { key: string; entry: TofuEntry } {
    const key = tofuKey(serverId, toolName);
    const entry = this.#requireEntry(key);
    const rejected: TofuEntry = {
      ...entry,
      pendingHash: undefined,
      pendingSchema: undefined,
      blocked: true,
      removed: false,
    };
    this.#entries.set(key, rejected);
    return { key, entry: cloneEntry(rejected) };
  }

  markRemoved(serverId: string, toolName: string): TofuEntry | undefined {
    const key = tofuKey(serverId, toolName);
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;

    const removed: TofuEntry = {
      ...entry,
      pendingHash: undefined,
      pendingSchema: undefined,
      blocked: true,
      removed: true,
    };
    this.#entries.set(key, removed);
    return cloneEntry(removed);
  }

  get(serverId: string, toolName: string): TofuEntry | undefined {
    const entry = this.#entries.get(tofuKey(serverId, toolName));
    return entry === undefined ? undefined : cloneEntry(entry);
  }

  #requireEntry(key: string): TofuEntry {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      throw new Error(`Unknown TOFU entry '${key}'.`);
    }
    return entry;
  }
}

export function tofuKey(serverId: string, toolName: string): string {
  return `${serverId}:${toolName}`;
}

function schemaSnapshot(input: TofuObservationInput): TofuToolSchemaSnapshot {
  return {
    name: input.toolName,
    ...(input.description === undefined ? {} : { description: input.description }),
    inputSchema: cloneUnknown(input.inputSchema),
  };
}

function buildDriftPayload(
  serverId: string,
  toolName: string,
  oldSchema: TofuToolSchemaSnapshot,
  newSchema: TofuToolSchemaSnapshot
): TofuDriftPayload {
  return {
    event: 'schema_drift_detected',
    server: serverId,
    tool: toolName,
    question:
      'The schema for this tool changed since it was first trusted. Review the differences and decide whether to accept the new version.',
    old_schema: cloneSnapshot(oldSchema),
    new_schema: cloneSnapshot(newSchema),
    diff_summary: summarizeSchemaDiff(oldSchema, newSchema),
    options: ['approve', 'reject'],
    answer_shape: `frontmatter.user_decisions.${serverId}__${toolName}.tofu_decision`,
  };
}

function summarizeSchemaDiff(oldSchema: TofuToolSchemaSnapshot, newSchema: TofuToolSchemaSnapshot): string {
  const lines: string[] = [];
  if ((oldSchema.description ?? '') !== (newSchema.description ?? '')) {
    lines.push(`Description changed: ${JSON.stringify(oldSchema.description ?? '')} -> ${JSON.stringify(newSchema.description ?? '')}`);
  }

  const oldRequired = new Set(requiredFields(oldSchema.inputSchema));
  const newRequired = new Set(requiredFields(newSchema.inputSchema));
  for (const name of [...newRequired].filter((field) => !oldRequired.has(field)).sort()) {
    lines.push(`Added required parameter: ${name}${propertyTypeSuffix(newSchema.inputSchema, name)}`);
  }
  for (const name of [...oldRequired].filter((field) => !newRequired.has(field)).sort()) {
    lines.push(`Removed required parameter: ${name}${propertyTypeSuffix(oldSchema.inputSchema, name)}`);
  }

  const oldProperties = new Set(propertyNames(oldSchema.inputSchema));
  const newProperties = new Set(propertyNames(newSchema.inputSchema));
  for (const name of [...newProperties].filter((field) => !oldProperties.has(field) && !newRequired.has(field)).sort()) {
    lines.push(`Added optional parameter: ${name}${propertyTypeSuffix(newSchema.inputSchema, name)}`);
  }
  for (const name of [...oldProperties].filter((field) => !newProperties.has(field) && !oldRequired.has(field)).sort()) {
    lines.push(`Removed optional parameter: ${name}${propertyTypeSuffix(oldSchema.inputSchema, name)}`);
  }

  if (canonicalJson(oldSchema.inputSchema) !== canonicalJson(newSchema.inputSchema) && lines.length === 0) {
    lines.push('Input schema changed.');
  }

  return lines.length === 0 ? 'Schema hash changed.' : lines.join('\n');
}

function requiredFields(inputSchema: unknown): string[] {
  if (!isRecord(inputSchema) || !Array.isArray(inputSchema.required)) return [];
  return inputSchema.required.filter((field): field is string => typeof field === 'string');
}

function propertyNames(inputSchema: unknown): string[] {
  if (!isRecord(inputSchema) || !isRecord(inputSchema.properties)) return [];
  return Object.keys(inputSchema.properties);
}

function propertyTypeSuffix(inputSchema: unknown, name: string): string {
  if (!isRecord(inputSchema) || !isRecord(inputSchema.properties)) return '';
  const property = inputSchema.properties[name];
  if (!isRecord(property) || typeof property.type !== 'string') return '';
  return ` (${property.type})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneEntry(entry: TofuEntry): TofuEntry {
  return {
    ...entry,
    trustedSchema: cloneSnapshot(entry.trustedSchema),
    ...(entry.pendingSchema === undefined ? {} : { pendingSchema: cloneSnapshot(entry.pendingSchema) }),
  };
}

function cloneSnapshot(snapshot: TofuToolSchemaSnapshot): TofuToolSchemaSnapshot {
  return {
    name: snapshot.name,
    ...(snapshot.description === undefined ? {} : { description: snapshot.description }),
    inputSchema: cloneUnknown(snapshot.inputSchema),
  };
}

function cloneUnknown<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

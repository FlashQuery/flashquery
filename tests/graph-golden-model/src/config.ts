// Runtime settings for the graph golden-model workbench.
//
// Resolution order (highest first): CLI flag > .env file > process env > default.
// The two things Matt asked to be configurable — the OpenAI-compatible base URL
// and the model — live here and nowhere else.

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

const DEFAULT_BASE_URL = 'http://192.168.15.12:11434/v1';
const DEFAULT_MODEL = 'granite4';

export interface Settings {
  /** OpenAI-compatible base URL, e.g. http://host:11434/v1 (no trailing /chat/completions). */
  baseUrl: string;
  /** One or more model tags to run, in order (`ollama list`). Comma-separated on the CLI/env. */
  models: string[];
  /** Optional bearer token; omitted for Ollama. */
  apiKey?: string;
  /** Inject the relation vocabulary into the edge prompt (A/B vs. the as-wired prompt). */
  injectVocabulary: boolean;
  /** Inject a JSON schema hint into the node/edge prompts (A/B vs. the as-wired prompt). */
  injectSchema: boolean;
  /** Ask the model to reason/evaluate first (node: into a leading reasoning field;
   *  edge: per-edge reasoning before the relation) — chain-of-thought A/B. */
  reasoning: boolean;
  /** Load the unmodified production prompt YAML (as-wired) instead of the local refined
   *  copies — for A/B comparison. */
  baseline: boolean;
  /** Use canned LLM responses instead of hitting the server (offline self-test). */
  mock: boolean;
  /** Only run cases whose name includes this substring. */
  only?: string;
  /** temperature passed to the model (production graph calls use 0). */
  temperature: number;
  /** OpenAI-compat `reasoning_effort`. Default "none" disables thinking on reasoning
   *  models (Ollama maps it to the internal Think switch) and is ignored by plain
   *  models — so these runs stay fast and match the non-reasoning production path.
   *  Override with --reasoning-effort <none|low|medium|high>; set empty/"unset" to omit. */
  reasoningEffort?: string;
  /** Extra JSON merged into every request body (overrides reasoning_effort). From
   *  GRAPH_GOLDEN_EXTRA_BODY or --extra-body '<json>'. */
  extraBody: Record<string, unknown>;
}

/** Minimal KEY=VALUE .env reader — no dependency, ignores comments/blank lines. */
function readDotEnv(): Record<string, string> {
  const path = join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

function boolFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

export function resolveSettings(argv: string[]): Settings {
  const env = { ...readDotEnv(), ...process.env } as Record<string, string | undefined>;
  const modelSpec = flag(argv, 'model') ?? env.GRAPH_GOLDEN_MODEL ?? DEFAULT_MODEL;
  const models = modelSpec
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    baseUrl: flag(argv, 'base-url') ?? env.GRAPH_GOLDEN_BASE_URL ?? DEFAULT_BASE_URL,
    models: models.length ? models : [DEFAULT_MODEL],
    apiKey: flag(argv, 'api-key') ?? env.GRAPH_GOLDEN_API_KEY,
    injectVocabulary: boolFlag(argv, 'inject-vocabulary'),
    injectSchema: boolFlag(argv, 'inject-schema'),
    reasoning: boolFlag(argv, 'reasoning'),
    baseline: boolFlag(argv, 'baseline'),
    mock: boolFlag(argv, 'mock'),
    only: flag(argv, 'only'),
    temperature: Number(flag(argv, 'temperature') ?? '0'),
    reasoningEffort: resolveReasoningEffort(flag(argv, 'reasoning-effort') ?? env.GRAPH_GOLDEN_REASONING_EFFORT),
    extraBody: parseJsonObject(flag(argv, 'extra-body') ?? env.GRAPH_GOLDEN_EXTRA_BODY),
  };
}

function resolveReasoningEffort(raw: string | undefined): string | undefined {
  if (raw === undefined) return 'none'; // default: thinking off
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'unset') return undefined; // omit the field entirely
  return v;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error(`GRAPH_GOLDEN_EXTRA_BODY / --extra-body is not valid JSON: ${raw}`);
  }
}

export const PATHS = { PROJECT_ROOT };

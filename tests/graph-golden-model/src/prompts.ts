// Prompt construction now renders from EDITABLE LOCAL YAML copies of the production
// prompt files (prompts/graph-prompts.yml + prompts/edge-types.yml), loaded through the
// REAL src/graph loaders. Refine those YAML files; when the suite is green they are what
// gets pushed back to src/graph/defaults. Pass --baseline to instead load the unmodified
// production files (the as-wired prompts) for an A/B comparison.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraphPrompts, type GraphPromptDefinition } from '../../../src/graph/prompts.js';
import { loadGraphVocabulary, renderClassifiedGraphTypes } from '../../../src/graph/vocabulary.js';
import type { Settings } from './config.ts';
import type { ChatMessage } from './llm-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = join(HERE, '..', 'prompts');
const PROD_DIR = join(HERE, '..', '..', '..', 'src', 'graph', 'defaults');

export interface NodeInput {
  content: string;
  contentHash?: string;
}

export interface ChunkRef {
  chunk_id: string;
  key_claims: string[];
}

function sourceDir(settings: Settings): string {
  return settings.baseline ? PROD_DIR : LOCAL_DIR;
}

function loadPromptMap(settings: Settings): Map<string, GraphPromptDefinition> {
  const prompts = loadGraphPrompts({ promptsPath: join(sourceDir(settings), 'graph-prompts.yml') });
  return new Map(prompts.map((p) => [p.id, p]));
}

function classifiedTypes(settings: Settings): string {
  const relations = loadGraphVocabulary({ relationsPath: join(sourceDir(settings), 'edge-types.yml') });
  return renderClassifiedGraphTypes(relations);
}

function render(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

function requireTemplate(settings: Settings, id: string): string {
  const def = loadPromptMap(settings).get(id);
  if (!def) throw new Error(`Prompt '${id}' not found in ${sourceDir(settings)}/graph-prompts.yml`);
  return def.template;
}

export function buildNodeMessages(input: NodeInput, settings: Settings): ChatMessage[] {
  const template = requireTemplate(settings, 'analyze_node');
  const content = render(template, { chunk_content: input.content });
  return [{ role: 'user', content }];
}

export function buildEdgeMessages(source: ChunkRef, target: ChunkRef, settings: Settings): ChatMessage[] {
  const template = requireTemplate(settings, 'classify_edge');
  const content = render(template, {
    'graph:classified_types': classifiedTypes(settings),
    source_chunk: JSON.stringify({ chunk_id: source.chunk_id, key_claims: source.key_claims }),
    target_chunk: JSON.stringify({ chunk_id: target.chunk_id, key_claims: target.key_claims }),
  });
  return [{ role: 'user', content }];
}

// LLM-as-judge: a TESTING tool (not a production prompt). For natural-language outputs
// the graph generates — key_claims, chunk_summary, edge reasoning — there's no exact
// answer to assert. Instead we feed the SOURCE TEXT and the EXTRACTED output back to the
// model with a rubric of content-independent criteria and have it return a per-criterion
// pass/fail verdict. The same model (gemma4) does extraction and judging.
//
// The judge is itself an LLM, so it must be validated: negative-control cases feed
// deliberately bad output and assert the judge marks the right criterion "fail".

import { z } from 'zod';
import { parseLlmJson } from '../../../src/llm/json-repair.js';
import type { LlmTransport } from './llm-client.ts';

// ── Content-independent criteria library ────────────────────────────────────
export const CRITERIA: Record<string, string> = {
  grounded:
    'Every part of the output is directly supported by the source text; nothing is invented, added, or overstated.',
  atomic:
    'Each item states exactly one fact; no item bundles multiple independent facts together.',
  complete:
    "The output captures the source's main factual points; no major point is omitted.",
  faithful:
    'The output does not distort, exaggerate, or misrepresent the source.',
  representative:
    'The summary conveys the single main point of the source.',
  concise:
    'The summary is brief (one or two sentences) and is not a verbatim copy of the source.',
};

export const DEFAULT_CRITERIA: Record<string, string[]> = {
  key_claims: ['grounded', 'atomic', 'complete'],
  chunk_summary: ['grounded', 'representative', 'concise'],
  reasoning: ['grounded', 'faithful'],
};

// ── Verdict schema (local; parsed via the real corrector) ───────────────────
// `verdict` is accepted as a free string and normalized in scoring (anything that isn't
// "pass" counts as fail — a skeptical default). `overall` is intentionally not required:
// scoring derives pass/fail from the per-criterion verdicts, and models sometimes emit an
// out-of-enum overall ("partial", etc.) which should not break parsing.
const VerdictSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            name: z.string().min(1),
            verdict: z.string(),
            reason: z.string().default(''),
          })
          .strip()
      )
      .default([]),
  })
  .strip();

export type JudgeVerdict = z.infer<typeof VerdictSchema>;

export interface JudgeCriterion {
  name: string;
  definition: string;
}

export interface JudgeResult {
  ok: boolean;
  raw: string;
  failure?: 'syntax' | 'schema';
  summary?: string;
  verdict?: JudgeVerdict;
  prompt: string;
}

/** Build the criteria list for a field: named library criteria + any must_capture facts. */
export function resolveCriteria(
  field: string,
  names: string[] | undefined,
  mustCapture: string[] | undefined
): JudgeCriterion[] {
  const chosen = names && names.length ? names : DEFAULT_CRITERIA[field] ?? ['grounded'];
  const criteria: JudgeCriterion[] = chosen.map((n) => ({
    name: n,
    definition: CRITERIA[n] ?? `(custom) ${n}`,
  }));
  for (const fact of mustCapture ?? []) {
    criteria.push({
      name: `captures: ${fact}`,
      definition: `The output includes or clearly represents this specific fact: "${fact}".`,
    });
  }
  return criteria;
}

function buildJudgePrompt(input: string, field: string, output: unknown, criteria: JudgeCriterion[]): string {
  const criteriaBlock = criteria
    .map((c) => `- ${c.name}: ${c.definition}`)
    .join('\n');
  return [
    'You are a STRICT evaluator. Judge whether an extracted output meets each criterion,',
    'using ONLY the source text it was derived from. Be skeptical: mark a criterion "fail"',
    'if it is not clearly met. Return ONLY JSON — no prose, no code fences.',
    '',
    'SOURCE TEXT:',
    input,
    '',
    `EXTRACTED OUTPUT (${field}):`,
    JSON.stringify(output),
    '',
    'CRITERIA (judge each independently):',
    criteriaBlock,
    '',
    'Return exactly:',
    '{"criteria":[{"name":"<name>","verdict":"pass"|"fail","reason":"<one sentence>"}],"overall":"pass"|"fail"}',
    'Set overall to "pass" only if every criterion passes.',
  ].join('\n');
}

export async function runJudge(options: {
  transport: LlmTransport;
  input: string;
  field: string;
  output: unknown;
  criteria: JudgeCriterion[];
}): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(options.input, options.field, options.output, options.criteria);
  const completion = await options.transport.complete([{ role: 'user', content: prompt }]);
  const parsed = parseLlmJson(completion.text, VerdictSchema);
  if (parsed.ok) {
    return { ok: true, raw: completion.text, verdict: parsed.data, prompt };
  }
  return { ok: false, raw: completion.text, failure: parsed.failure, summary: parsed.summary, prompt };
}

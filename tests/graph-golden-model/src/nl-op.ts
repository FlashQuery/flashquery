// Natural-language operation: obtain the NL output (extract via the real node op, or
// use a provided `given` value for judge-calibration), then run the LLM judge over it.

import type { NlCase } from './cases.ts';
import type { Settings } from './config.ts';
import type { LlmTransport } from './llm-client.ts';
import { runNodeOp, type ParseInfo } from './node-op.ts';
import { resolveCriteria, runJudge, type JudgeCriterion, type JudgeResult } from './judge.ts';

export interface NlOpResult {
  field: string;
  /** The NL value that was judged. */
  output: unknown;
  /** true if extracted from node analysis; false if a provided `given` value. */
  extracted: boolean;
  /** Node-analysis parse status when extracted. */
  extractParse?: ParseInfo;
  extractRaw?: string;
  criteria: JudgeCriterion[];
  judge: JudgeResult;
  latencyMs: number;
}

export async function runNlOp(c: NlCase, transport: LlmTransport, settings: Settings): Promise<NlOpResult> {
  const criteria = resolveCriteria(c.field, c.criteria, c.must_capture);
  let output: unknown = c.given;
  let extracted = false;
  let extractParse: ParseInfo | undefined;
  let extractRaw: string | undefined;
  let extractMs = 0;
  let payload: Record<string, unknown> | undefined;

  if (c.given === undefined) {
    const node = await runNodeOp({ content: c.input }, transport, settings);
    extracted = true;
    extractParse = node.parse;
    extractRaw = node.raw;
    extractMs = node.latencyMs;
    payload = node.payload as Record<string, unknown> | undefined;
    output = payload ? payload[c.field] : undefined;
  }

  // Cross-output consistency: judge `field` against the model's OWN key_claims rather than
  // the source text. (Only meaningful in extract mode.)
  const reference =
    c.against === 'key_claims' && payload ? JSON.stringify(payload.key_claims) : c.input;

  // Only judge if we actually have an output to judge.
  const judge =
    output === undefined
      ? ({ ok: false, raw: '', summary: 'no output to judge (extraction failed or field missing)', prompt: '' } as JudgeResult)
      : await runJudge({ transport, input: reference, field: c.field, output, criteria });

  return {
    field: c.field,
    output,
    extracted,
    extractParse,
    extractRaw,
    criteria,
    judge,
    latencyMs: extractMs + 0,
  };
}

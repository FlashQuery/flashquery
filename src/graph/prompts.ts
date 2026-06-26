import * as fs from 'node:fs';
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

export const DEFAULT_GRAPH_PROMPTS_PATH = 'src/graph/defaults/graph-prompts.yml';

const FALLBACK_GRAPH_PROMPTS: GraphPromptDefinition[] = [
  {
    "id": "analyze_node",
    "version": "2",
    "template": "You analyze ONE document chunk for a knowledge graph. Return ONLY a JSON object\nmatching the schema below — no prose, no markdown, no code fences. Output exactly ONE\nwell-formed JSON object: close every array and string, never emit an empty-string\nelement in key_claims, and never let one field's value appear inside another's array.\n\nFirst fill \"reasoning\" with a brief 1-2 sentence evaluation (justify certainty_level\nand staleness_risk against the definitions). Complete it BEFORE the other fields.\n\nSchema (keys, in this order):\n- reasoning: string\n    Write this FIRST. ONE or TWO sentences MAX (never a paragraph). State the logical basis for\n    your assessment by citing the specific cue(s) in the chunk that drive certainty_level and\n    staleness_risk — e.g. \"States a ratified decision with a hard Q3 2026 cutoff, so certainty\n    is high and staleness risk is high.\" This thinking step exists to improve the fields that\n    follow; keep it tight and evidence-based.\n- key_claims: a FLAT JSON array of NON-EMPTY strings, in order. Each entry is ONE\n    atomic fact. Do not nest arrays; do not emit empty strings. Consolidate to the\n    distinct key facts (typically 3-10 for a chunk), not every sub-clause. But do NOT\n    drop information: include consequences, deadlines, conditions, and comparative\n    results. If a statement pairs a fact with its consequence (e.g. \"kept 13 months,\n    then deleted\"), keep BOTH halves rather than only the first. SPLIT lists and\n    enumerations: if the text enumerates items (first/second/third, or a/b/c), make\n    EACH item its own claim rather than one claim listing them all.\n- chunk_summary: string        (one sentence; include all mentioned key details or constraints, numbers, dates, thresholds, deadlines, exceptions, risk qualifiers, causal or attribution details, important negative or safety qualifiers, key evidence, and similar kinds of details that describe the uniqueness of the text.)\n- provenance_basis: string|null\n    Name the cited source that GROUNDS the claims — the doc/report/dataset/survey/system/RFC/\n    ADR/ticket/URL that measures, ratifies, approves, or reports them. The source may be EXTERNAL\n    or INTERNAL — internal grounding sources count too (e.g. \"our post-checkout surveys\", an\n    internal report or dashboard). Return only the source identifier/name, not a narrative\n    sentence. The SAME identifier can appear in BOTH provenance_basis and external_refs — if it\n    grounds/ratifies/measures/reports the claim, name it HERE as well, not only in external_refs.\n    A source that is merely the SUBJECT of a definitional claim is NOT provenance: \"the\n    Deprecation header is defined in RFC 9745\" does NOT make RFC 9745 the provenance (the claim\n    is about the RFC, not grounded by a separate measuring/reporting source) — just as a plain\n    definition is not \"grounded\" by a dictionary.\n    Use null when no grounding source is cited — never cite \"the text\" itself.\n- question_status: \"open\"|\"deferred\"|\"resolved\"|null\n    Set null unless the chunk explicitly raises a specific question or a decision/choice it is\n    tracking. The question/decision need NOT contain a literal \"?\". IMPORTANT: tentativeness\n    about a FACT — \"preliminary\", \"likely\", \"not yet confirmed\", a floated idea with no\n    decision — is captured by certainty_level, NOT here; do NOT mark such content open.\n    open = the chunk explicitly poses an unresolved question, or names a decision/choice it is\n      actively trying to settle, and leaves it unsettled.\n    deferred = such a question/decision is explicitly postponed/tabled (set deferred even when\n      phrased as a statement, e.g. \"the question of X was postponed\").\n    resolved = such a question/decision is raised AND answered/decided within this chunk (set\n      resolved, NOT null, even though it now has an answer).\n    Examples:\n      \"Should we shard by tenant or region? The team has not decided.\" -> open\n      \"Should we shard by tenant or region? The team decided tenant.\" -> resolved\n      \"The question of multi-region failover was postponed to next quarter.\" -> deferred\n      \"Preliminary analysis suggests latency will likely improve, pending a benchmark.\" -> null (tentative fact; see certainty_level)\n      \"We floated the idea of a rewrite but made no decision.\" -> null (a passing idea, not a tracked question)\n      \"UTC is the primary civil time standard.\" -> null (states a fact; no question/decision)\n- question_resolution: string|null\n    If question_status is resolved, state the actual answer/decision/resolution in one concise\n    sentence, including the option chosen and any important condition/deadline. Otherwise null.\n- certainty_level: \"high\"|\"medium\"|\"low\"|\"unknown\"\n    Score confidence in the extracted factual claims/source, not confidence that the text\n    literally contains uncertainty words.\n    high = stated as settled/decided/ratified/factual.\n    medium = leaning one way WITH some basis but not yet confirmed — cue words like\n             \"likely\", \"probably\", \"strongly suggests\", \"appears\", \"preliminary\".\n    low = little or no basis: pure speculation, a bare possibility, or just an idea/proposal.\n          Also use low when the chunk says the source/data is unlabeled, unclear, or ambiguous.\n    unknown = not determinable.\n- staleness_risk: \"low\"|\"medium\"|\"high\"|\"unknown\"\n    high = pinned to an expiring anchor (deadline, cutoff, version cutover, dated\n           decision); score high even before that date arrives.\n    medium = true now but drifts with no fixed expiry (counts, status, ownership).\n    low = durable (definitions, concepts, design rationale, historical facts).\n    unknown = cannot tell.\n- external_refs: string[]\n    Extract EVERY external identifier the chunk names, each as its own string, copied as it\n    appears. An external reference is anything that points outside the chunk: RFC/standard\n    numbers (\"RFC 8259\"), named documents/reports/datasets/surveys (\"Customer Analytics Dataset\n    Q2-2026\"), product/protocol + version names (\"OAuth 2.0\", \"v3.0\"), API endpoint paths\n    (\"/v1/search\"), URLs, and ticket IDs (\"JIRA-1234\") — INCLUDING ones in parentheticals like\n    \"(see RFC-0042)\".\n    Example: \"migrate off /v1/search per RFC 8594 before v3.0; see the 2025 SO Developer Survey\"\n    -> [\"/v1/search\", \"RFC 8594\", \"v3.0\", \"2025 SO Developer Survey\"].\n    Use [] only if the chunk names nothing external.\n- temporal_markers: string[]\n    Capture EVERY time or version reference, each as its own string, copied as it appears in the\n    text. Include all of these kinds: absolute dates (\"2026-03-14\"), quarters/months\n    (\"Q3 2026\", \"March 2026\"), relative terms (\"next Friday\", \"in 18 months\"), deadlines\n    (\"By end of Q3\"), AND semantic version markers (\"v2.1.0\", \"v3.0\", \"version 2.1\").\n    Example: \"ships in v2.1.0 by Q3 2026 and the old API sunsets after v3.0\" ->\n    [\"v2.1.0\", \"Q3 2026\", \"v3.0\"]. Copy each EXACTLY as written — do NOT normalize or infer a\n    date (keep \"Next Friday\" as \"Next Friday\"; never compute what it resolves to).\n    Use [] only if the chunk has no time or version reference.\n- analyzed_content_hash: string  (leave \"\" — the system fills this in)\n\nExample of the OUTPUT FORMAT only (illustrative — do NOT copy its content; note\nevery list is an array and any cited identifier appears in external_refs):\n{\"reasoning\":\"Defines a term; stated as fact, no expiry, cites a standard.\",\"key_claims\":[\"UTC is the primary time standard\"],\"chunk_summary\":\"Explains what UTC is and cites the standard.\",\"provenance_basis\":\"ITU-R TF.460\",\"question_status\":null,\"question_resolution\":null,\"certainty_level\":\"high\",\"staleness_risk\":\"low\",\"external_refs\":[\"ITU-R TF.460\"],\"temporal_markers\":[],\"analyzed_content_hash\":\"\"}\n\nChunk:\n{{chunk_content}}",
    "requiredVariables": [
      "chunk_content"
    ],
    "overridable": true
  },
  {
    "id": "classify_edge",
    "version": "2",
    "template": "You classify the relationship FROM the source chunk TO the target chunk for a\nknowledge graph. Return ONLY a JSON object { \"edges\": Edge[] } — no prose, no fences.\nEmit an empty edges array if no relationship holds.\n\nClassified relation types:\n{{graph:classified_types}}\n\nEach Edge has:\n- reasoning: string          \n    Write this FIRST. ONE or TWO sentences MAX (never a paragraph).\n- relation: one of the relation names above (choose the most specific)\n- source_claims_referenced: number[]   (indices into source_key_claims)\n- target_claims_referenced: number[]   (indices into target_key_claims)\n- confidence_score: number 0..1   (how confident the relationship holds; LOWER it when the\n    source hedges its claim — \"may\", \"might\", \"possibly\", \"not sure\" — or the link is indirect)\n- metadata:\n    llm_assessment: \"strong\"|\"moderate\"|\"weak\"|\"uncertain\"\n      How solid the link is. Use \"strong\" only for a clearly stated, direct relationship; drop\n      to \"weak\" or \"uncertain\" when the source HEDGES the claim (\"may\", \"might\", \"possibly\",\n      \"not sure\", \"unclear\") or the connection is tenuous. A non-empty uncertainty qualifier\n      should travel with weak/uncertain AND a lower confidence_score.\n    qualifiers: { temporal: string[], conditional: string[], uncertainty: string[] }\n      Each qualifier is an ARRAY of strings (a list, even for a single item) — e.g.\n      \"conditional\": [\"only when the working set fits in memory\"]. Never a bare string.\n      Inspect the relationship for constraints and RECORD them:\n      - conditional: REQUIRED whenever the source qualifies its claim with words like\n        \"when\", \"if\", \"only\", \"provided\", \"as long as\", \"unless\" — put that condition\n        as a one-element array. Do not leave it empty if such a condition is present.\n      - temporal: time/version bounds, copied as written — e.g. [\"As of v2\"], [\"After Q3 2026\"],\n        [\"Until the migration completes\"], [\"Since 1.4\"].\n      - uncertainty: hedges that weaken the link, copied as written — e.g. [\"may\"], [\"might\"],\n        [\"possibly\"], [\"we are not sure\"]. When present, also set llm_assessment to\n        weak/uncertain and lower confidence_score.\n      Use [] for a kind that does not apply.\n\nSource:\n{{source_chunk}}\n\nTarget:\n{{target_chunk}}",
    "requiredVariables": [
      "graph:classified_types",
      "source_chunk",
      "target_chunk"
    ],
    "overridable": true
  }
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

function parseGraphPromptsYaml(raw: unknown, overrides?: Record<string, unknown>): GraphPromptDefinition[] {
  const result = PromptFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => `Graph prompts error: ${issue.path.join('.')} ${issue.message}`)
        .join('\n')
    );
  }

  return validateGraphPrompts(result.data.prompts.map(promptFromYaml), overrides);
}

export const DEFAULT_GRAPH_PROMPTS: GraphPromptDefinition[] = validateGraphPrompts(FALLBACK_GRAPH_PROMPTS);

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

  if (!fs.existsSync(resolvedPath)) {
    return validateGraphPrompts(DEFAULT_GRAPH_PROMPTS, options?.overrides);
  }

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(resolvedPath, 'utf-8'));
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
      const line = err.mark ? err.mark.line + 1 : '?';
      throw new Error(`Graph prompts error: Invalid YAML syntax at line ${line}: ${err.reason}`, {
        cause: err,
      });
    }
    throw err;
  }

  return parseGraphPromptsYaml(raw, options?.overrides);
}

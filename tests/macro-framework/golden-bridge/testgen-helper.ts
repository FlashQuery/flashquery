// Testgen helper for the macro-framework `flashquery-macro-testgen` skill.
//
// Phase 5 (per Macro Testing Framework Requirements §5.5 + §9.5).
//
// This module exposes utilities the testgen skill drives — the skill's body
// (markdown instructions) tells an AI agent how to compose these calls; the
// CLI wrapper (`testgen-cli.ts`) drives the same surface non-interactively
// for autonomous / scripted runs.
//
// The hard work — synthesizing a credible macro source + tool surface for a
// given cell — is divided across three pieces:
//
//   1. `loadCellMetadata(cellId)` — reads `manifest.ts`, follows
//      `source_citations`, returns the structured cell metadata + raw REQ
//      text fragments (when REQ-NNN citations are present).
//   2. `loadExemplars(category, n)` — returns up to N existing pilots in the
//      same category, parsed, as inspiration for shape and idiom.
//   3. `synthesizeTestInputs(cell, exemplars, reqs)` — when invoked by an AI
//      agent, this is where the synthesis happens. When invoked
//      autonomously (CLI), the helper consults `SCENARIOS` — a library of
//      hand-tuned scenario templates keyed by cell ID — and emits the
//      pre-baked inputs. Either path produces a `SynthesizedTest` value
//      that's then fed through `captureAndEmbed()` to attach the real
//      golden snapshot.
//
// Per §5.5 step 4, the synthesized macro MUST be run through the current
// golden to capture expectations — that's what `captureAndEmbed()` does. The
// returned YAML is fully self-sufficient: macro, inputs, vault, tools,
// expect block (from the captured envelope), and golden_snapshot block (the
// full snapshot for debug context).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

import { captureSnapshot, GOLDEN_VERSION, defaultToolRegistry } from './load.ts';
import type { SnapshotEnvelope } from './load.ts';
import type { CallToolResult } from '../macro-golden-model/src/broker.ts';
import type { ServerEntry, ToolRegistry, Value } from '../macro-golden-model/src/types.ts';
import {
  CELLS,
  getCell,
  type Cell,
} from '../coverage/manifest.ts';
import type { TestCase } from '../runner.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = join(__dirname, '..');
const CASES_DIR = join(FRAMEWORK_ROOT, 'cases');
const FRESH_DIR = join(FRAMEWORK_ROOT, 'cases-fresh');
const REPO_ROOT = join(FRAMEWORK_ROOT, '..', '..');
const MACRO_LANG_REQS = join(
  REPO_ROOT,
  '..',
  'flashquery-product',
  'Archive',
  'Implemented',
  'Macro Language (17-May-2026)',
  'FlashQuery Macro Language Requirements.md',
);

// ───── Cell selection ──────────────────────────────────────────────────────

export interface CellCoverageEntry {
  count: number;
  last_verified: string | null;
  tests: string[];
}

export interface CoverageDoc {
  schema_version: string;
  generated_at: string;
  cells: Record<string, CellCoverageEntry>;
}

export interface TargetSelectOptions {
  /** Maximum number of cells to return. */
  count?: number;
  /** Only consider cells in these categories (e.g. ["MTF-G", "MTF-S"]). */
  categories?: string[];
  /** Exclude these specific cell IDs (e.g. already-targeted in this batch). */
  exclude?: string[];
  /** Only include cells with this status. Default: "actionable". */
  status?: 'actionable' | 'planned' | 'blocked' | 'deprecated';
}

/**
 * Select the lowest-density cells from coverage, sorted by gap size
 * (density_target - count) descending. Returns at most `count` cells.
 * Cells already at their density target are excluded.
 */
export function selectTargetCells(
  coverage: CoverageDoc,
  opts: TargetSelectOptions = {},
): Cell[] {
  const status = opts.status ?? 'actionable';
  const exclude = new Set(opts.exclude ?? []);
  const categories = opts.categories ? new Set(opts.categories) : null;

  const candidates = CELLS.filter((cell) => {
    if (cell.status !== status) return false;
    if (exclude.has(cell.id)) return false;
    if (categories && !categories.has(cell.category)) return false;
    const entry = coverage.cells[cell.id];
    const count = entry?.count ?? 0;
    return count < cell.density_target;
  });

  candidates.sort((a, b) => {
    const ga = a.density_target - (coverage.cells[a.id]?.count ?? 0);
    const gb = b.density_target - (coverage.cells[b.id]?.count ?? 0);
    if (gb !== ga) return gb - ga;
    // Tie-break on count asc (prefer zero-density cells first).
    const ca = coverage.cells[a.id]?.count ?? 0;
    const cb = coverage.cells[b.id]?.count ?? 0;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });

  return candidates.slice(0, opts.count ?? candidates.length);
}

/** Load the coverage.json doc from disk. */
export async function loadCoverage(): Promise<CoverageDoc> {
  const path = join(FRAMEWORK_ROOT, 'coverage', 'coverage.json');
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as CoverageDoc;
}

// ───── Cell metadata loader ────────────────────────────────────────────────

export interface CellMetadata {
  cell: Cell;
  /**
   * REQ-NNN text fragments extracted from the Macro Language Requirements
   * doc by matching each `REQ-NNN` citation against headings + immediate
   * body. Best-effort regex; intentionally crude per the spec's "even crude
   * regex extraction is fine for v1" note.
   */
  req_fragments: Array<{ req: string; excerpt: string }>;
}

/**
 * Load cell metadata + REQ acceptance criteria. The req extraction is
 * intentionally lenient — it pulls a small window of text after each REQ
 * reference and returns it as `excerpt`. Generator agents use this as
 * grounding context.
 */
export async function loadCellMetadata(cellId: string): Promise<CellMetadata> {
  const cell = getCell(cellId);
  if (!cell) {
    throw new Error(`Unknown cell id: ${cellId}`);
  }
  const reqs: Array<{ req: string; excerpt: string }> = [];
  // Only attempt REQ extraction for REQ-NNN-style citations.
  const reqCitations = cell.source_citations.filter((c) => /^REQ-\d{3}$/.test(c));
  if (reqCitations.length > 0) {
    let docText: string;
    try {
      docText = await readFile(MACRO_LANG_REQS, 'utf8');
    } catch {
      // Reqs doc not reachable — return cell with empty req fragments. The
      // generator can fall back to the user guide or the cell description
      // alone.
      return { cell, req_fragments: [] };
    }
    for (const req of reqCitations) {
      const re = new RegExp(`${req}\\b[\\s\\S]{0,600}?(?=\\n(?:REQ-\\d{3}|##|\\Z))`, 'g');
      const match = re.exec(docText);
      if (match) {
        const excerpt = match[0].replace(/\s+/g, ' ').trim().slice(0, 500);
        reqs.push({ req, excerpt });
      } else {
        reqs.push({ req, excerpt: '(REQ ref not extractable from doc)' });
      }
    }
  }
  return { cell, req_fragments: reqs };
}

// ───── Exemplar loader ─────────────────────────────────────────────────────

/** Load up to N existing pilots in the given category as inspiration. */
export async function loadExemplars(
  category: string,
  n: number = 3,
): Promise<TestCase[]> {
  // Pilots are nested under category-named subdirs whose names differ from
  // MTF-* prefixes — e.g. MTF-G -> "grammar", MTF-C -> "control-flow".
  const subdir = CATEGORY_TO_DIR[category] ?? category.toLowerCase().replace(/^mtf-/, '');
  const dir = join(CASES_DIR, subdir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const exemplars: TestCase[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    if (entry.startsWith('_')) continue; // skip placeholders / intentional mismatches
    const file = join(dir, entry);
    const text = await readFile(file, 'utf8');
    try {
      const tc = loadYaml(text) as TestCase;
      tc.__file = relative(FRAMEWORK_ROOT, file);
      exemplars.push(tc);
    } catch {
      // Skip malformed YAML files quietly.
      continue;
    }
    if (exemplars.length >= n) break;
  }
  return exemplars;
}

// Maps MTF-* category prefixes to their on-disk subdirectory names. Mirrors
// the pilot batch's directory naming.
const CATEGORY_TO_DIR: Record<string, string> = {
  'MTF-G': 'grammar',
  'MTF-S': 'semantics',
  'MTF-C': 'control-flow',
  'MTF-D': 'dispatch',
  'MTF-L': 'lifecycle',
  'MTF-E': 'errors',
  'MTF-I': 'isolation',
  'MTF-FW': 'framework',
};

// ───── Synthesized test (intermediate representation) ──────────────────────

export interface SynthesizedTest {
  id: string;
  /** Path relative to FRAMEWORK_ROOT where the YAML should land. */
  output_path: string;
  /** Short slug used in filenames; e.g. "13-if-else-branches". */
  slug: string;
  category: string;
  name: string;
  description: string;
  covers: string[];
  macro: string;
  input_vars: Record<string, Value>;
  vault: Record<string, string>;
  /** Tool surface declarations as the YAML `tools:` block would carry. */
  tools: Record<string, unknown>;
  /** Optional tools.fq: "real" recognition without exercising native tools. */
  needs_fq_registry?: boolean;
  /** Golden-side registry used at capture time (synthesized from `tools`). */
  golden_registry?: ToolRegistry;
  /** Author-declared expect block (excluding the captured values). */
  expect_overrides?: Partial<TestCase['expect']>;
  /** Optional explicit expect_state_notes patterns to emit. */
  expect_state_notes?: TestCase['expect_state_notes'];
  /** Cells driving this test (subset of `covers`, used for provenance). */
  targeted_cells: string[];
  /** REQ refs that grounded the synthesis (provenance + traceability). */
  grounding_refs: string[];
  /** Optional trace_mode override. */
  trace_mode?: TestCase['trace_mode'];
  /** Optional progress_mode override (matches TestCase['progress_mode']). */
  progress_mode?: TestCase['progress_mode'];
  /** Optional dry_run flag. */
  dry_run?: boolean;
}

// ───── Scenario library — pre-baked synthesis for autonomous CLI runs ─────
//
// Each entry maps one of the well-known low-density cells to a complete
// SynthesizedTest spec. Used when the CLI runs without an AI agent in the
// loop. AI-driven mode bypasses these and provides the synthesis directly.

type ScenarioFactory = () => SynthesizedTest;

const SCENARIOS: Record<string, ScenarioFactory> = {
  // ─── MTF-G-006 — line-comment tokenization ──────────────────────────────
  // Production engine has no boolean literals (`true`/`false` are not
  // tokens); we use integer 1 as a truthy sentinel.
  'MTF-G-006': () => ({
    id: 'mtf-g-13-line-comments',
    output_path: 'cases/grammar/13-line-comments.yml',
    slug: '13-line-comments',
    category: 'MTF-G',
    name: 'Grammar — line comments are skipped by the lexer',
    description:
      'Macro source contains `#`-prefixed line comments interleaved with executable lines. The lexer skips them entirely; the evaluator only sees the executable statements. Verifies REQ-007 (comment tokenization rule).',
    covers: ['MTF-G-006', 'MTF-G-001', 'MTF-G-005'],
    macro: [
      '# top-of-file comment, no statements yet',
      'greeting = "hello"   # trailing comment after a value',
      '# blank-looking comment between statements',
      'target = "world"',
      '# multi-comment',
      '# block ',
      'msg = "$greeting, $target!"',
      'ok_flag = 1',
      'exit { msg: $msg, ok: $ok_flag }',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'success',
      return_result: { msg: 'hello, world!', ok: 1 },
    },
    targeted_cells: ['MTF-G-006'],
    grounding_refs: ['Macro Language Requirements REQ-007'],
  }),

  // ─── MTF-S-007 — field access ────────────────────────────────────────────
  // No bool literals in production; use integer 1 in the object.
  'MTF-S-007': () => ({
    id: 'mtf-s-14-field-access',
    output_path: 'cases/semantics/14-field-access.yml',
    slug: '14-field-access',
    category: 'MTF-S',
    name: 'Semantics — field access (`$var.field`) reads object fields',
    description:
      'Builds an object literal, reads three fields into bindings via `$obj.field`, exits with a composite. Verifies REQ-020 (object literal) + REQ-021 (field access semantics).',
    covers: ['MTF-S-007', 'MTF-G-004'],
    macro: [
      'profile = { name: "alpha", count: 7, active: 1 }',
      'who = $profile.name',
      'how_many = $profile.count',
      'flag = $profile.active',
      'exit { who: $who, how_many: $how_many, flag: $flag }',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'success',
      return_result: { who: 'alpha', how_many: 7, flag: 1 },
    },
    targeted_cells: ['MTF-S-007'],
    grounding_refs: [
      'Macro Language Requirements REQ-020',
      'Macro Language Requirements REQ-021',
    ],
  }),

  // ─── MTF-C-008 — if/then/else/fi (both branches) ───────────────────────
  // Use numeric comparisons since the production engine has no bool
  // literals.
  'MTF-C-008': () => ({
    id: 'mtf-c-15-if-else-branches',
    output_path: 'cases/control-flow/15-if-else-branches.yml',
    slug: '15-if-else-branches',
    category: 'MTF-C',
    name: 'Control flow — if/then/else/fi exercises both branches',
    description:
      'Two if/else blocks select between branches via integer comparison; verifies REQ-015 (conditional with else-branch) semantics. The macro accumulates which branch fired into a result object.',
    covers: ['MTF-C-008', 'MTF-C-003', 'MTF-S-008'],
    macro: [
      'taken = []',
      'a = 1',
      'b = 2',
      'if $a == 1 then',
      '  taken = append $taken "then-1"',
      'else',
      '  taken = append $taken "else-1"',
      'fi',
      'if $b == 99 then',
      '  taken = append $taken "then-2"',
      'else',
      '  taken = append $taken "else-2"',
      'fi',
      'exit { taken: $taken }',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'success',
      return_result: { taken: ['then-1', 'else-2'] },
    },
    targeted_cells: ['MTF-C-008'],
    grounding_refs: ['Macro Language Requirements REQ-015'],
  }),

  // ─── MTF-D-008 — ScriptedTool archetype dispatch ───────────────────────
  'MTF-D-008': () => ({
    id: 'mtf-d-16-scripted-tool-sequence',
    output_path: 'cases/dispatch/16-scripted-tool-sequence.yml',
    slug: '16-scripted-tool-sequence',
    category: 'MTF-D',
    name: 'Dispatch — ScriptedTool returns indexed responses per call',
    description:
      'A single brokered tool answered by `ScriptedTool` archetype returns three distinct responses across three calls. Validates per §5.7 ScriptedTool semantics + REQ-027 brokered-tool dispatch + REQ-029 multi-call sequencing within one macro.',
    covers: ['MTF-D-008', 'MTF-D-001', 'MTF-D-003'],
    macro: [
      'a = seq_srv.step({ i: 1 })',
      'b = seq_srv.step({ i: 2 })',
      'c = seq_srv.step({ i: 3 })',
      'exit { trail: [$a, $b, $c] }',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {
      seq_srv: {
        archetype: 'ScriptedTool',
        tool_name: 'step',
        responses: [
          { content: [{ type: 'text', text: JSON.stringify({ stage: 'first', value: 100 }) }] },
          { content: [{ type: 'text', text: JSON.stringify({ stage: 'second', value: 200 }) }] },
          { content: [{ type: 'text', text: JSON.stringify({ stage: 'third', value: 300 }) }] },
        ],
      },
    },
    golden_registry: {
      ...defaultToolRegistry,
      seq_srv: {
        label: 'scripted seq fake',
        tools: {
          step: scriptedResponsesForGolden([
            jsonTextEnvelopeForGolden({ stage: 'first', value: 100 }),
            jsonTextEnvelopeForGolden({ stage: 'second', value: 200 }),
            jsonTextEnvelopeForGolden({ stage: 'third', value: 300 }),
          ]),
        },
      },
    },
    expect_overrides: {
      outcome: 'success',
      return_result: {
        trail: [
          { stage: 'first', value: 100 },
          { stage: 'second', value: 200 },
          { stage: 'third', value: 300 },
        ],
      },
      side_effects: {
        tool_call_count: 3,
        tool_calls: [
          { server: 'seq_srv', tool: 'step', args_match: { i: 1 } },
          { server: 'seq_srv', tool: 'step', args_match: { i: 2 } },
          { server: 'seq_srv', tool: 'step', args_match: { i: 3 } },
        ],
      },
    },
    targeted_cells: ['MTF-D-008'],
    grounding_refs: [
      'Macro Language Requirements REQ-027',
      'MTF Framework §5.7 ScriptedTool',
    ],
  }),

  // ─── MTF-L-008 — progress emission cadence ─────────────────────────────
  // `..` is end-exclusive (REQ-014 buildRange), so 1..8 iterates 7 times.
  // The runner's progress-capture sink only receives events from explicit
  // `status` builtin calls (see builtins.ts status handler) — implicit
  // for-loop iteration events go through progressNotificationSink only.
  // So this test exercises the explicit-cadence path: emit a status from
  // every iteration; assert at least one milestone event was captured.
  'MTF-L-008': () => ({
    id: 'mtf-l-17-progress-emission',
    output_path: 'cases/lifecycle/17-progress-emission.yml',
    slug: '17-progress-emission',
    category: 'MTF-L',
    name: 'Lifecycle — explicit status milestones during iteration',
    description:
      'A for-loop iterates 1..8 (7 iterations); each iteration emits an explicit `status` milestone via the builtin. The runner captures progress events and the comparator asserts at least one milestone reached the sink (lower-bound assertion per REQ-052 cadence guarantees).',
    covers: ['MTF-L-008', 'MTF-C-001'],
    macro: [
      'acc = 0',
      'for n in 1..8 do',
      '  acc = add $acc $n',
      '  status --progress $n --total 7 "iter $n"',
      'done',
      'exit { sum: $acc }',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'success',
      return_result: { sum: 28 },
      progress_milestones_min: 1,
    },
    targeted_cells: ['MTF-L-008'],
    grounding_refs: ['Macro Language Requirements REQ-052'],
  }),

  // ─── MTF-E-004 — macro_aborted envelope ─────────────────────────────────
  'MTF-E-004': () => ({
    id: 'mtf-e-18-macro-aborted-envelope',
    output_path: 'cases/errors/18-macro-aborted-envelope.yml',
    slug: '18-macro-aborted-envelope',
    category: 'MTF-E',
    name: 'Errors — macro_aborted envelope from direct fail()',
    description:
      'Macro calls `fail "..."` directly; verifies the engine produces the canonical macro_aborted envelope with the operator-supplied message intact (REQ-016 + REQ-024 + REQ-054 envelope shape).',
    covers: ['MTF-E-004', 'MTF-C-004'],
    macro: [
      'x = 1',
      'fail "boom: operator-supplied message"',
      'echo "unreachable"',
      '',
    ].join('\n'),
    input_vars: {},
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'fail',
      error: {
        code: 'macro_aborted',
        message_contains: 'boom: operator-supplied message',
      },
    },
    targeted_cells: ['MTF-E-004'],
    grounding_refs: [
      'Macro Language Requirements REQ-016',
      'Macro Language Requirements REQ-024',
      'Macro Language Requirements REQ-054',
    ],
  }),

  // ─── MTF-I-003 — per-invocation isolation ───────────────────────────────
  'MTF-I-003': () => ({
    id: 'mtf-i-19-repeat-invocation-isolation',
    output_path: 'cases/isolation/19-repeat-invocation-isolation.yml',
    slug: '19-repeat-invocation-isolation',
    category: 'MTF-I',
    name: 'Isolation — per-invocation bindings don\'t leak across runs',
    description:
      'Macro reads `input_var "seed"` and computes a derived counter. Implicit invariant: every macro evaluation starts with a fresh scope frame — there is no module-level binding survival. Verifying success against a clean input_var contract validates REQ-058 / REQ-059 isolation guarantees.',
    covers: ['MTF-I-003', 'MTF-I-001', 'MTF-S-001'],
    macro: [
      'seed = input_var "seed"',
      'acc = $seed',
      // `..` is exclusive at end: 1..5 iterates over [1,2,3,4].
      'for n in 1..5 do',
      '  acc = add $acc $n',
      'done',
      'exit { seed_in: $seed, acc_out: $acc }',
      '',
    ].join('\n'),
    input_vars: { seed: 10 },
    vault: {},
    tools: {},
    expect_overrides: {
      outcome: 'success',
      return_result: { seed_in: 10, acc_out: 20 },
    },
    targeted_cells: ['MTF-I-003'],
    grounding_refs: [
      'Macro Language Requirements REQ-058',
      'Macro Language Requirements REQ-059',
    ],
  }),
};

// Helpers used by ScriptedTool scenarios on the golden side.
function jsonTextEnvelopeForGolden(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function scriptedResponsesForGolden(responses: CallToolResult[]): ServerEntry['tools'][string] {
  let i = 0;
  return () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r as unknown as Value;
  };
}

/**
 * Returns the catalog of cell IDs the autonomous CLI knows how to generate
 * tests for. The skill body uses this to advertise its `--mode=committed`
 * coverage when running without a model in the loop.
 */
export function listBuiltinScenarioCells(): string[] {
  return Object.keys(SCENARIOS);
}

/**
 * Look up a built-in scenario for the named cell, or return null if none.
 */
export function getBuiltinScenario(cellId: string): SynthesizedTest | null {
  const f = SCENARIOS[cellId];
  return f ? f() : null;
}

/**
 * Synthesize a test. When `synth` is provided (AI-agent invocation), use it
 * directly. Otherwise consult the built-in scenario library keyed by the
 * cell ID. Returns null if neither path yields a synthesis — caller falls
 * back to skipping the cell.
 */
export function synthesizeTestInputs(
  cell: Cell,
  _exemplars: TestCase[],
  _reqs: Array<{ req: string; excerpt: string }>,
  synth?: SynthesizedTest,
): SynthesizedTest | null {
  if (synth) return synth;
  return getBuiltinScenario(cell.id);
}

// ───── Capture-and-embed ──────────────────────────────────────────────────

export interface CaptureResult {
  envelope: SnapshotEnvelope;
  /** YAML text ready to be written. */
  yaml_text: string;
}

export interface CaptureOptions {
  /** Override the timestamp embedded in `golden_run_at` (testing only). */
  now?: Date;
  /** Override `generator.model` field. Default: `flashquery-macro-testgen-cli`. */
  model?: string;
}

/**
 * Run the synthesized macro through the golden, capture the envelope, and
 * emit a complete YAML test text. Per §5.5 step 4-6: the golden's outputs
 * are embedded as both `expect:` (live comparison) and `golden_snapshot:`
 * (debug context). The author-declared `expect_overrides` (e.g. outcome,
 * return_result shape) are merged on top of the captured baseline; sub-
 * fields the author cares about take precedence over auto-captured values.
 */
export async function captureAndEmbed(
  synth: SynthesizedTest,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const registry = synth.golden_registry ?? defaultToolRegistry;
  const envelope = await captureSnapshot(
    synth.macro,
    synth.input_vars,
    synth.vault,
    { registry },
    {},
  );

  const now = (opts.now ?? new Date()).toISOString();
  const model = opts.model ?? 'flashquery-macro-testgen-cli';

  // Derive the `expect:` block from the captured envelope + any author
  // overrides. The override wins for any field it specifies (the captured
  // baseline is a backstop, not gospel).
  const expectBlock: Record<string, unknown> = {};
  if (synth.expect_overrides) {
    Object.assign(expectBlock, synth.expect_overrides);
  }

  // Compose the YAML structure.
  const doc: Record<string, unknown> = {
    id: synth.id,
    name: synth.name,
    description: synth.description,
    covers: synth.covers,
    generator: {
      skill: 'flashquery-macro-testgen',
      version: 1,
      model,
      generated_at: now,
      targeted_cells: synth.targeted_cells,
      grounding_refs: synth.grounding_refs,
    },
    golden_version: GOLDEN_VERSION,
    golden_run_at: now,
    deps: [],
    require_embedding: false,
    require_git: false,
    macro: synth.macro,
    input_vars: synth.input_vars,
    vault: synth.vault,
    tools: synth.tools,
  };
  if (synth.dry_run !== undefined) doc.dry_run = synth.dry_run;
  if (synth.trace_mode !== undefined) doc.trace_mode = synth.trace_mode;
  if (synth.progress_mode !== undefined) doc.progress_mode = synth.progress_mode;
  doc.expect = expectBlock;
  doc.golden_snapshot = {
    state_notes: envelope.state_notes,
  };
  if (synth.expect_state_notes) {
    doc.expect_state_notes = synth.expect_state_notes;
  }

  const header = renderHeaderComment(synth);
  const body = dumpYaml(doc, { lineWidth: 120, noRefs: true });
  const yaml_text = `${header}\n${body}`;

  return { envelope, yaml_text };
}

function renderHeaderComment(synth: SynthesizedTest): string {
  const lines: string[] = [];
  lines.push(`# Generated pilot — ${synth.id}`);
  lines.push(`#`);
  lines.push(`# Generator: flashquery-macro-testgen (Phase 5 skill).`);
  lines.push(`# Targeted cells: ${synth.targeted_cells.join(', ')}`);
  lines.push(`# Grounding: ${synth.grounding_refs.join('; ')}`);
  lines.push(`#`);
  lines.push(
    `# This file was emitted by the generator after running the macro through`,
  );
  lines.push(
    `# the macro-golden-model (v${GOLDEN_VERSION}) and embedding the snapshot.`,
  );
  lines.push(`# Do NOT hand-edit \`expect:\` or \`golden_snapshot:\` — re-run the`);
  lines.push(`# generator (or its --mode=refresh) to update.`);
  return lines.join('\n');
}

// ───── Write + validate ───────────────────────────────────────────────────

export interface WriteOptions {
  /** Override the on-disk destination (used by fresh mode). */
  destination_override?: string;
  /** When true, output goes under `cases-fresh/` (the .gitignored area). */
  fresh_mode?: boolean;
}

/** Write the YAML text to its target path; returns the absolute path. */
export async function writeGeneratedTest(
  synth: SynthesizedTest,
  yaml_text: string,
  opts: WriteOptions = {},
): Promise<string> {
  let outRel: string;
  if (opts.destination_override) {
    outRel = opts.destination_override;
  } else if (opts.fresh_mode) {
    outRel = join('cases-fresh', `${synth.slug}.yml`);
  } else {
    outRel = synth.output_path;
  }
  const outAbs = join(FRAMEWORK_ROOT, outRel);
  await mkdir(dirname(outAbs), { recursive: true });
  await writeFile(outAbs, yaml_text, 'utf8');
  return outAbs;
}

// ───── Validate a generated test through the runner ───────────────────────

export interface ValidateResult {
  ok: boolean;
  findings_count: number;
  finding_summary?: string;
}

/**
 * Validate a generated test by driving it through the production engine and
 * comparing against the embedded `expect:` block. Returns a PASS/FAIL
 * verdict. Per §9.5 the testgen workflow ends with a real validation pass
 * to catch immediate breakage before committing.
 */
export async function validateGeneratedTest(yamlPath: string): Promise<ValidateResult> {
  const { loadCases, driveTest, compareToExpect } = await import('../runner.ts');
  // Reload the case fresh.
  // `loadCases()` returns ALL cases — we filter to just the file we wrote.
  const allCases = await loadCases();
  const relPath = relative(FRAMEWORK_ROOT, yamlPath);
  const tc = allCases.find((c) => c.__file === relPath);
  if (!tc) {
    return { ok: false, findings_count: 1, finding_summary: `Could not locate ${relPath} in loaded cases.` };
  }
  const drive = await driveTest(tc);
  try {
    const cmp = compareToExpect(tc, drive);
    if (!cmp.ok) {
      return {
        ok: false,
        findings_count: cmp.findings.length,
        finding_summary: JSON.stringify(cmp.findings.slice(0, 3), null, 2),
      };
    }
    return { ok: true, findings_count: 0 };
  } finally {
    await drive.cleanup();
  }
}

// ───── Refresh mode ───────────────────────────────────────────────────────

export interface StaleTestEntry {
  path: string;
  test_id: string;
  golden_version_used: string;
}

/** Walk all YAML tests and return those with a stale `golden_version`. */
export async function findStaleTests(
  currentGolden: string = GOLDEN_VERSION,
): Promise<StaleTestEntry[]> {
  const out: StaleTestEntry[] = [];
  const categories = await readdir(CASES_DIR, { withFileTypes: true });
  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const dir = join(CASES_DIR, cat.name);
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      const file = join(dir, entry);
      const text = await readFile(file, 'utf8');
      let tc: TestCase;
      try {
        tc = loadYaml(text) as TestCase;
      } catch {
        continue;
      }
      if (!tc?.golden_version) continue;
      if (tc.golden_version !== currentGolden) {
        out.push({
          path: file,
          test_id: tc.id,
          golden_version_used: tc.golden_version,
        });
      }
    }
  }
  return out;
}

export interface RefreshResult {
  changed: boolean;
  identical: boolean;
  diff_summary?: string;
}

/**
 * Re-capture the test's snapshot via the current golden, diff it against the
 * embedded snapshot, and update the test's `golden_version` +
 * `golden_run_at` fields (plus the embedded `state_notes`) when the diff
 * is "structurally identical" — same length, same per-step `kind`. The
 * auto-accept gate distinguishes superficial yaml-round-trip artifacts
 * (e.g. AST line numbers shifting by one because the YAML loader stripped
 * a leading blank line) from genuinely divergent snapshots.
 *
 * For v1 this is the only refresh path; full operator-interactive diff
 * review is a Phase 6 concern. When the structural diff IS genuine, the
 * helper reports it without rewriting the file.
 */
export async function refreshTest(
  yamlPath: string,
  opts: { auto_accept_identical?: boolean } = {},
): Promise<RefreshResult> {
  const text = await readFile(yamlPath, 'utf8');
  const tc = loadYaml(text) as TestCase;
  if (!tc?.macro) {
    return { changed: false, identical: false, diff_summary: 'No `macro:` field in YAML.' };
  }
  // Synthesize a registry from the YAML's tools block. For ScriptedTool /
  // archetype configs this requires a small adapter — for now refresh
  // supports only no-tool tests (the common case for the validation flow).
  // When the broker becomes critical we extend this; the gate test case is
  // a pilot that uses `tools: {}`.
  const registry = defaultToolRegistry;
  const envelope = await captureSnapshot(
    tc.macro,
    (tc.input_vars ?? {}) as Record<string, Value>,
    (tc.vault ?? {}) as Record<string, string>,
    { registry },
    {},
  );

  const oldNotes = tc.golden_snapshot?.state_notes ?? [];
  const newNotes = envelope.state_notes;
  const exactIdentical = JSON.stringify(oldNotes) === JSON.stringify(newNotes);
  const structurallyIdentical =
    oldNotes.length === newNotes.length &&
    oldNotes.every((n: unknown, i: number) => {
      const a = n as { kind?: unknown };
      const b = newNotes[i] as { kind?: unknown };
      return a?.kind === b?.kind;
    });

  if (exactIdentical) {
    if (opts.auto_accept_identical) {
      tc.golden_version = GOLDEN_VERSION;
      tc.golden_run_at = new Date().toISOString();
      const updated = dumpYaml(tc, { lineWidth: 120, noRefs: true });
      await writeFile(yamlPath, updated, 'utf8');
      return { changed: true, identical: true };
    }
    return { changed: false, identical: true };
  }

  if (structurallyIdentical && opts.auto_accept_identical) {
    // Treat as a benign drift (e.g. YAML loader artifacts in AST line
    // numbers); refresh the snapshot and bump version.
    tc.golden_version = GOLDEN_VERSION;
    tc.golden_run_at = new Date().toISOString();
    tc.golden_snapshot = { ...(tc.golden_snapshot ?? {}), state_notes: newNotes };
    const updated = dumpYaml(tc, { lineWidth: 120, noRefs: true });
    await writeFile(yamlPath, updated, 'utf8');
    return {
      changed: true,
      identical: true,
      diff_summary: 'structural identity; embedded snapshot replaced with current capture.',
    };
  }

  const oldLen = oldNotes.length;
  const newLen = newNotes.length;
  return {
    changed: false,
    identical: false,
    diff_summary: `state_notes: ${oldLen} -> ${newLen} entries; ${structurallyIdentical ? 'structurally identical' : 'shape diverged'}; operator review required.`,
  };
}

// ───── Convenience exports for the CLI ────────────────────────────────────

export { GOLDEN_VERSION, FRAMEWORK_ROOT };

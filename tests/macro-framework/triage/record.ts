// §9.6 failure-triage record writer + updater.
//
// Replaces the Phase 3 draft in `runner.ts` (still exported there for
// backward compatibility, but `cases.test.ts` now calls into this module).
//
// Per §9.6 the record format is Markdown body + YAML frontmatter, stored
// at `tests/macro-framework/failures/<YYYY-MM-DD>-<HHMMSS>-<test_id>.md`.
// Six body sections in order: triage classification rationale, expected
// vs actual, golden's perspective (state_notes table), suggested
// remediation, spec ambiguity proposal (only when classification =
// spec-ambiguity), action log.
//
// Per INV-MTF-07 the Expected-vs-Actual section is structured-fields only
// — no raw stdout/stderr/console diffs.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CompareFinding, DriveResult, TestCase } from '../runner.ts';
import type { StateNote } from '../state-notes/schema.ts';
import type {
  Classification,
  ClassificationResult,
  Confidence,
} from './classify.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = join(__dirname, '..');
const FAILURES_DIR = join(FRAMEWORK_ROOT, 'failures');

// ───── Inputs / outputs ─────

export interface WriteTriageRecordInput {
  tc: TestCase;
  findings: CompareFinding[];
  drive: DriveResult;
  classification: ClassificationResult;
  goldenVersionCurrent: string;
  /** Optional set of related-failure record IDs to embed in frontmatter. */
  relatedFailures?: string[];
}

export interface TriageRecordUpdate {
  status?: 'open' | 'resolved' | 'escalated' | 'invalidated';
  classification?: Classification;
  confidence?: Confidence;
  reviewed_by?: string;
  escalated_to?: string;
  related_failures?: string[];
  /** Free-form line appended to the action log. */
  action_log_entry?: string;
}

// ───── Writer ─────

export async function writeTriageRecord(input: WriteTriageRecordInput): Promise<string> {
  await mkdir(FAILURES_DIR, { recursive: true });
  const now = new Date();
  const filename = `${recordTimestamp(now)}-${input.tc.id}.md`;
  const path = join(FAILURES_DIR, filename);

  const frontmatter = buildFrontmatter(input, now);
  const body = buildBody(input, now);
  const content = `---\n${frontmatter}\n---\n\n${body}`;
  await writeFile(path, content, 'utf8');
  return path;
}

// ───── Updater ─────

/**
 * Re-write an existing record's frontmatter and append to its action log.
 * Used by `--triage <recordPath>` to capture a re-classification or an
 * operator review without losing the original record content.
 *
 * The frontmatter is parsed as a flat YAML-ish block (one field per line)
 * to keep this dependency-free. Unrecognized fields are preserved.
 */
export async function updateTriageRecord(
  recordPath: string,
  updates: TriageRecordUpdate,
): Promise<void> {
  const raw = await readFile(recordPath, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) {
    throw new Error(`Record ${recordPath} is missing the frontmatter delimiter`);
  }
  const [, frontmatterBlock, bodyBlock] = m;

  const fields = parseFlatFrontmatter(frontmatterBlock);
  if (updates.status) fields.set('status', updates.status);
  if (updates.classification) fields.set('classification', updates.classification);
  if (updates.confidence) fields.set('confidence', updates.confidence);
  if (updates.reviewed_by !== undefined) fields.set('reviewed_by', updates.reviewed_by);
  if (updates.escalated_to !== undefined) fields.set('escalated_to', updates.escalated_to);
  if (updates.related_failures !== undefined) {
    fields.set('related_failures', updates.related_failures);
  }

  const newFrontmatter = renderFlatFrontmatter(fields);
  const stamp = new Date().toISOString();
  const note = updates.action_log_entry ?? 'manual re-triage';
  const appended = `${bodyBlock.replace(/\n+$/, '')}\n- ${stamp} — ${note}\n`;
  const out = `---\n${newFrontmatter}\n---\n${appended.startsWith('\n') ? '' : '\n'}${appended}`;
  await writeFile(recordPath, out, 'utf8');
}

// ───── Related-failures lookup ─────

/**
 * Returns paths of existing failure records whose `test_id` matches.
 * Used when writing a new record so its `related_failures:` field can
 * surface earlier failures of the same test.
 */
export async function findRelatedFailures(testId: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(FAILURES_DIR);
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    if (entry === 'README.md' || entry === 'EXAMPLE.md') continue;
    // Filename pattern: YYYY-MM-DD-HHMMSS-<test_id>.md
    // Strip the timestamp prefix (length 17 = "YYYY-MM-DD-HHMMSS") and the
    // dash, compare the rest minus `.md`.
    const stripped = entry.replace(/^\d{4}-\d{2}-\d{2}-\d{6}-/, '').replace(/\.md$/, '');
    if (stripped === testId) {
      matches.push(entry);
    }
  }
  return matches.sort();
}

// ───── Internal helpers ─────

function buildFrontmatter(input: WriteTriageRecordInput, now: Date): string {
  const fm: [string, unknown][] = [
    ['type', 'macro-framework-failure'],
    ['status', 'open'],
    ['classification', input.classification.classification],
    ['confidence', input.classification.confidence],
    ['test_id', input.tc.id],
    ['test_file', input.tc.__file ?? '<unknown>'],
    ['covers', input.tc.covers ?? []],
    ['golden_version_used', input.tc.golden_version ?? '<unknown>'],
    ['golden_version_current', input.goldenVersionCurrent],
    ['failed_at', now.toISOString()],
    ['created_by', 'flashquery-macro-run'],
    ['reviewed_by', ''],
    ['escalated_to', ''],
    ['related_failures', input.relatedFailures ?? []],
  ];
  return fm.map(([k, v]) => `${k}: ${yamlScalar(v)}`).join('\n');
}

function buildBody(input: WriteTriageRecordInput, now: Date): string {
  const parts: string[] = [];

  // 1. Triage classification rationale.
  parts.push('## Triage classification rationale');
  parts.push('');
  parts.push(input.classification.rationale);
  parts.push('');

  // 2. Expected vs. Actual (structured per INV-MTF-07).
  parts.push('## Expected vs. Actual');
  parts.push('');
  parts.push('Comparator findings (structured fields only, per INV-MTF-07):');
  parts.push('');
  parts.push('```json');
  parts.push(JSON.stringify(input.findings, null, 2));
  parts.push('```');
  parts.push('');
  parts.push("Production engine's structured return envelope:");
  parts.push('');
  parts.push('```json');
  parts.push(JSON.stringify(input.drive.payload, null, 2));
  parts.push('```');
  parts.push('');

  // 3. Golden's perspective (§5.6.1 render).
  parts.push("## Golden's perspective");
  parts.push('');
  const stateNotes = input.tc.golden_snapshot?.state_notes ?? [];
  if (stateNotes.length === 0) {
    parts.push('_(no `golden_snapshot.state_notes` embedded)_');
  } else {
    parts.push('```');
    parts.push(renderStateNotesTable(stateNotes));
    parts.push('```');
  }
  parts.push('');

  // 4. Suggested remediation.
  parts.push('## Suggested remediation');
  parts.push('');
  parts.push(input.classification.suggested_action);
  parts.push('');

  // 5. Spec ambiguity proposal (conditional).
  if (input.classification.classification === 'spec-ambiguity') {
    parts.push('## Spec ambiguity proposal');
    parts.push('');
    parts.push('_(Operator: promote this section into a spec OQ in the relevant doc.)_');
    parts.push('');
    parts.push('- **Target spec doc:** `flashquery-product/Roadmap/Features/Macro Testing Framework/` (or Macro Language Requirements / MCP Broker Requirements as applicable)');
    parts.push(`- **REQ to revisit:** ${(input.tc.covers ?? ['(none)']).join(', ')}`);
    parts.push('- **Proposed OQ wording:** _(draft here; promote into the spec doc and link via `escalated_to:`)_');
    parts.push('');
  }

  // 6. Action log.
  parts.push('## Action log');
  parts.push('');
  parts.push(
    `- ${now.toISOString()} — auto-classified by flashquery-macro-run ` +
      `(${input.classification.classification}, ${input.classification.confidence} confidence)`,
  );
  parts.push('');

  return parts.join('\n');
}

function recordTimestamp(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const se = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da}-${h}${mi}${se}`;
}

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  }
  if (typeof v === 'string') {
    if (v === '') return '""';
    if (/[":#\n]/.test(v) || /^\s|\s$/.test(v)) return JSON.stringify(v);
    return v;
  }
  return JSON.stringify(v);
}

function renderStateNotesTable(notes: StateNote[]): string {
  const lines: string[] = [];
  lines.push('step | kind        | summary');
  lines.push('-----+-------------+--------------------------------------------------------');
  notes.forEach((n, idx) => {
    const step = String(idx + 1).padStart(4, ' ');
    const kind = (n.kind as string).padEnd(11, ' ');
    const summary = summarizeStateNote(n);
    lines.push(`${step} | ${kind} | ${summary}`);
  });
  return lines.join('\n');
}

function summarizeStateNote(n: StateNote): string {
  const obj = n as unknown as Record<string, unknown>;
  switch (n.kind) {
    case 'binding':
      return `${String(obj.op)}: ${String(obj.name)} = ${JSON.stringify(obj.value)} (${String(obj.scope)})`;
    case 'loop':
      return `${String(obj.loop_kind)}/${String(obj.loop_id ?? '?')} iter=${String(obj.iter)} var=${String(obj.var ?? '?')} value=${JSON.stringify(obj.value)}`;
    case 'ast':
      return `${String(obj.node_kind)} @ line ${String(obj.line)} col ${String(obj.column)}`;
    default:
      return JSON.stringify(obj);
  }
}

// ───── Flat frontmatter parser (no js-yaml dep for the updater path) ─────

type FlatField = string | string[] | unknown;

function parseFlatFrontmatter(block: string): Map<string, FlatField> {
  const out = new Map<string, FlatField>();
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (rest === '') {
      out.set(key, '');
      continue;
    }
    // Inline-array shorthand.
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      if (inner === '') {
        out.set(key, []);
      } else {
        try {
          // Try JSON parse first.
          out.set(key, JSON.parse(`[${inner}]`));
        } catch {
          // Fallback: split on comma, strip quotes/spaces.
          const items = inner
            .split(',')
            .map((s) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'));
          out.set(key, items);
        }
      }
      continue;
    }
    // Strip surrounding quotes for plain strings.
    if (
      (rest.startsWith('"') && rest.endsWith('"')) ||
      (rest.startsWith("'") && rest.endsWith("'"))
    ) {
      try {
        out.set(key, JSON.parse(rest));
      } catch {
        out.set(key, rest.slice(1, -1));
      }
      continue;
    }
    out.set(key, rest);
  }
  return out;
}

function renderFlatFrontmatter(fields: Map<string, FlatField>): string {
  const lines: string[] = [];
  for (const [k, v] of fields) {
    lines.push(`${k}: ${yamlScalar(v)}`);
  }
  return lines.join('\n');
}

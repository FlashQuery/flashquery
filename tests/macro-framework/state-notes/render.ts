// Failure-triage table renderer (per Macro Testing Framework Requirements
// §5.6.1 + §9.6). Renders the golden's `state_notes` as a compact
// `step | kind | summary` table for inclusion in failure-triage records.

import type { StateNote } from './schema.ts';

/**
 * Render `state_notes` as a markdown-ish table.
 */
export function renderStateNotesTable(notes: StateNote[]): string {
  const rows: Array<[string, string, string]> = notes.map((n, i) => [
    String(i + 1),
    n.kind,
    summarize(n),
  ]);

  const stepW = Math.max(4, ...rows.map((r) => r[0].length));
  const kindW = Math.max(11, ...rows.map((r) => r[1].length));
  const sumW = Math.max(7, ...rows.map((r) => r[2].length));

  const sep = `${'-'.repeat(stepW + 1)}+${'-'.repeat(kindW + 2)}+${'-'.repeat(sumW + 1)}`;
  const header = `${pad('step', stepW)} | ${pad('kind', kindW)} | ${pad('summary', sumW)}`;
  const lines = [header, sep];
  for (const r of rows) {
    lines.push(`${pad(r[0], stepW)} | ${pad(r[1], kindW)} | ${pad(r[2], sumW)}`);
  }
  return lines.join('\n');
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function summarize(n: StateNote): string {
  switch (n.kind) {
    case 'binding':
      return `${n.op}: ${n.name} = ${shortJson(n.value)} (${n.scope})`;
    case 'loop': {
      const control = n.control ? ` [${n.control}]` : '';
      const v = n.var ? ` var=${n.var}` : '';
      const val = n.value !== undefined ? ` value=${shortJson(n.value)}` : '';
      return `${n.loop_id} ${n.loop_kind} iter=${n.iter}${v}${val}${control}`;
    }
    case 'budget':
      return `tokens=${n.tokens} model_calls=${n.model_calls} external_tool_calls=${n.external_tool_calls} elapsed_ms=${n.elapsed_ms}`;
    case 'permission': {
      const reason = n.reason ? ` (${n.reason})` : '';
      return `${n.tool} -> ${n.decision}${reason}`;
    }
    case 'coerce': {
      const raw = n.raw_summary ? ` raw=${truncate(n.raw_summary, 40)}` : '';
      return `path=${n.path}${raw}`;
    }
    case 'task': {
      const parent = n.parent_id ? ` parent=${n.parent_id}` : '';
      return `${n.task_id} -> ${n.status}${parent} (elapsed ${n.elapsed_ms}ms)`;
    }
    case 'ast':
      return `${n.node_kind} @ line ${n.line} col ${n.column}`;
    default: {
      const x = n as { kind: string };
      return `(unrendered kind=${x.kind})`;
    }
  }
}

function shortJson(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length <= 60 ? s : `${s.slice(0, 57)}...`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
}

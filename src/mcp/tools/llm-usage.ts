/**
 * get_llm_usage MCP tool — Phase 103.
 *
 * Always-registered tool (D-01) that queries fqc_llm_usage and returns
 * pre-aggregated cost/usage statistics across four modes:
 *   - summary    — totals + vs_prior_period comparison block
 *   - by_purpose — per-purpose entries; _direct surfaced separately (D-08)
 *   - by_model   — per-model entries with pct_of_total_calls (D-10/D-11)
 *   - recent     — individual call records newest-first (D-12)
 *
 * Date range precedence (D-04):
 *   1. from_date + to_date   → explicit; overrides period; to-end-of-day inclusive
 *   2. from_date only        → from that date through now
 *   3. period only           → window relative to now (24h/7d/30d/all)
 *   4. nothing               → past 7 days
 *
 * Aggregation strategy (D-13): fetch filtered rows via supabase-js, group/sum
 * in TypeScript. supabase-js PostgREST does not support GROUP BY; client-side
 * grouping is the project pattern (precedent: trace_cumulative in llm.ts).
 *
 * Empty state (D-16): when fqc_llm_usage has zero matching rows, return zero/empty
 * results — NOT isError. Only Supabase-not-configured (D-15) and runtime query
 * failures (D-17) return isError.
 *
 * The tool is registered unconditionally in src/mcp/server.ts after
 * registerLlmTools(); it appears in the MCP tool listing whether config.llm
 * is defined or not (REPT-01).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types — handler-local. The PostgREST row shape (snake_case columns
// from fqc_llm_usage). BIGINT (input_tokens, output_tokens) and NUMERIC
// (cost_usd) come back as strings (Pitfall 2).
// ─────────────────────────────────────────────────────────────────────────────

interface UsageRow {
  id: string;
  instance_id: string;
  purpose_name: string;
  model_name: string;
  provider_name: string;
  input_tokens: string | number;       // BIGINT serialized as string
  output_tokens: string | number;
  cost_usd: string | number;           // NUMERIC(18,10) serialized as string
  latency_ms: number;
  fallback_position: number | null;
  trace_id: string | null;
  created_at: string;
}

interface ResolvedWindow {
  from: Date;
  to: Date;
}

interface PeriodEcho {
  from: string | null;
  to: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveWindow — D-04 four-rule date range precedence.
// Returns null when "all" (no created_at filters applied).
// ─────────────────────────────────────────────────────────────────────────────

function resolveWindow(params: {
  period?: '24h' | '7d' | '30d' | 'all';
  from_date?: string;
  to_date?: string;
}): ResolvedWindow | null {
  const now = new Date();

  // Rule 1: from_date + to_date — explicit range; overrides period
  if (params.from_date && params.to_date) {
    const from = new Date(params.from_date);
    // Pitfall 3: end-of-day inclusive for to_date
    const to = new Date(params.to_date);
    to.setUTCHours(23, 59, 59, 999);
    return { from, to };
  }

  // Rule 2: from_date only — through now
  if (params.from_date) {
    return { from: new Date(params.from_date), to: now };
  }

  // Rule 2.5: to_date without from_date — explicit error; not silently ignored
  if (params.to_date && !params.from_date) {
    throw new Error('to_date requires from_date. Provide both for an explicit date range.');
  }

  // Rule 3: period only — relative window
  const period = params.period ?? '7d';   // Rule 4 default
  if (period === 'all') return null;
  const ms =
    period === '24h' ? 86_400_000 :
    period === '7d'  ? 7 * 86_400_000 :
                       30 * 86_400_000;
  return { from: new Date(now.getTime() - ms), to: now };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyFilters — chain optional .eq() calls for purpose_name, model_name,
// trace_id. Lowercases purpose_name and model_name (D-03).
// Returns the supabase query builder for further chaining.
// ─────────────────────────────────────────────────────────────────────────────

// We type as `unknown` because the supabase-js query builder type is private
// to the SDK; we rely on duck-typing the chainable `.eq()` method signature.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
function applyEntityFilters(query: any, params: { purpose_name?: string; model_name?: string; trace_id?: string }): any {
  if (params.purpose_name) query = query.eq('purpose_name', params.purpose_name.toLowerCase());
  if (params.model_name)   query = query.eq('model_name',   params.model_name.toLowerCase());
  if (params.trace_id)     query = query.eq('trace_id',     params.trace_id);
  return query;
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

// ─────────────────────────────────────────────────────────────────────────────
// fetchRows — build and execute the supabase query. Applies window filters,
// entity filters, and (for recent mode) ordering + limit. Returns rows ?? [].
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
async function fetchRows(
  supabase: any,
  instanceId: string,
  window: ResolvedWindow | null,
  filters: { purpose_name?: string; model_name?: string; trace_id?: string },
  options?: { orderDescByCreatedAt?: boolean; limit?: number }
): Promise<{ rows: UsageRow[]; error: { message: string } | null }> {
  let query = supabase
    .from('fqc_llm_usage')
    .select('*')
    .eq('instance_id', instanceId);

  if (window) {
    query = query.gte('created_at', window.from.toISOString());
    query = query.lte('created_at', window.to.toISOString());
  }
  query = applyEntityFilters(query, filters);

  if (options?.orderDescByCreatedAt) {
    query = query.order('created_at', { ascending: false });
  }
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) return { rows: [], error };
  // Pitfall 6: data may be null on empty result sets in some SDK versions
  return { rows: (data as UsageRow[] | null) ?? [], error: null };
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

// ─────────────────────────────────────────────────────────────────────────────
// Number coercion — BIGINT and NUMERIC come back as strings (Pitfall 2).
// ─────────────────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const num = typeof v === 'number' ? v : Number(v);
  if (!isFinite(num)) {
    logger.warn(`get_llm_usage: non-finite value in fqc_llm_usage column: ${String(v)}`);
    return 0;
  }
  return num;
}

// ─────────────────────────────────────────────────────────────────────────────
// echoWindow — convert ResolvedWindow | null to the response.period field.
// ─────────────────────────────────────────────────────────────────────────────

function echoWindow(window: ResolvedWindow | null): PeriodEcho {
  if (!window) return { from: null, to: null };
  return { from: window.from.toISOString(), to: window.to.toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// aggregateSummary — D-06, D-07, D-14
// ─────────────────────────────────────────────────────────────────────────────

interface SummaryAggregate {
  total_calls: number;
  total_spend_usd: number;
  avg_cost_per_call_usd: number;
  avg_latency_ms: number;
  top_purpose: string | null;
  top_model_name: string | null;
}

function aggregateSummary(rows: UsageRow[]): SummaryAggregate {
  const total_calls = rows.length;
  const total_spend_usd = rows.reduce((s, r) => s + n(r.cost_usd), 0);
  const avg_cost_per_call_usd = total_calls > 0 ? total_spend_usd / total_calls : 0;
  const avg_latency_ms = total_calls > 0
    ? rows.reduce((s, r) => s + n(r.latency_ms), 0) / total_calls
    : 0;

  // top_purpose: most frequent purpose_name EXCLUDING _direct (D-14)
  const purposeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.purpose_name !== '_direct') {
      purposeCounts.set(r.purpose_name, (purposeCounts.get(r.purpose_name) ?? 0) + 1);
    }
  }
  const top_purpose = [...purposeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // top_model_name: most frequent model_name (across all rows including _direct)
  const modelCounts = new Map<string, number>();
  for (const r of rows) {
    modelCounts.set(r.model_name, (modelCounts.get(r.model_name) ?? 0) + 1);
  }
  const top_model_name = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { total_calls, total_spend_usd, avg_cost_per_call_usd, avg_latency_ms, top_purpose, top_model_name };
}

// ─────────────────────────────────────────────────────────────────────────────
// aggregateByPurpose — D-08, D-09
// ─────────────────────────────────────────────────────────────────────────────

interface PurposeEntry {
  purpose_name: string;
  calls: number;
  spend_usd: number;
  avg_cost_per_call_usd: number;
  avg_latency_ms: number;
  primary_model_hit_rate: number;
}

interface DirectAggregate {
  calls: number;
  spend_usd: number;
  avg_cost_per_call_usd: number;
  avg_latency_ms: number;
}

interface ByPurposeResult {
  purposes: PurposeEntry[];
  direct_model_calls: DirectAggregate;
}

function aggregateByPurpose(rows: UsageRow[]): ByPurposeResult {
  const purposeGroups = new Map<string, UsageRow[]>();
  const directRows: UsageRow[] = [];
  for (const r of rows) {
    if (r.purpose_name === '_direct') {
      directRows.push(r);
    } else {
      if (!purposeGroups.has(r.purpose_name)) purposeGroups.set(r.purpose_name, []);
      purposeGroups.get(r.purpose_name)!.push(r);
    }
  }

  const purposes: PurposeEntry[] = [];
  for (const [purpose_name, groupRows] of purposeGroups.entries()) {
    const calls = groupRows.length;
    const spend_usd = groupRows.reduce((s, r) => s + n(r.cost_usd), 0);
    const avg_cost_per_call_usd = calls > 0 ? spend_usd / calls : 0;
    const avg_latency_ms = calls > 0
      ? groupRows.reduce((s, r) => s + n(r.latency_ms), 0) / calls
      : 0;
    const hits = groupRows.filter((r) => r.fallback_position === 1).length;
    const primary_model_hit_rate = calls > 0 ? hits / calls : 0;
    purposes.push({ purpose_name, calls, spend_usd, avg_cost_per_call_usd, avg_latency_ms, primary_model_hit_rate });
  }
  // Sort purposes by call count descending (deterministic ordering)
  purposes.sort((a, b) => b.calls - a.calls);

  const dCalls = directRows.length;
  const dSpend = directRows.reduce((s, r) => s + n(r.cost_usd), 0);
  const direct_model_calls: DirectAggregate = {
    calls: dCalls,
    spend_usd: dSpend,
    avg_cost_per_call_usd: dCalls > 0 ? dSpend / dCalls : 0,
    avg_latency_ms: dCalls > 0
      ? directRows.reduce((s, r) => s + n(r.latency_ms), 0) / dCalls
      : 0,
  };

  return { purposes, direct_model_calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// aggregateByModel — D-10, D-11
// ─────────────────────────────────────────────────────────────────────────────

interface ModelEntry {
  model_name: string;
  provider_name: string;
  calls: number;
  pct_of_total_calls: number;
  avg_fallback_position: number | null;
  spend_usd: number;
  avg_cost_per_call_usd: number;
  avg_latency_ms: number;
}

function aggregateByModel(rows: UsageRow[]): { models: ModelEntry[] } {
  // Group by (model_name, provider_name) composite key — same model alias can
  // theoretically appear under different providers in distant historical data
  // (e.g., after reconfiguration). Use a NUL separator that cannot appear in names.
  const groups = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const key = `${r.model_name}\0${r.provider_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const totalCalls = rows.length;
  const models: ModelEntry[] = [];
  for (const [key, groupRows] of groups.entries()) {
    const sepIdx = key.indexOf('\0');
    const model_name = key.slice(0, sepIdx);
    const provider_name = key.slice(sepIdx + 1);
    const calls = groupRows.length;
    const spend_usd = groupRows.reduce((s, r) => s + n(r.cost_usd), 0);
    const avg_cost_per_call_usd = calls > 0 ? spend_usd / calls : 0;
    const avg_latency_ms = calls > 0
      ? groupRows.reduce((s, r) => s + n(r.latency_ms), 0) / calls
      : 0;
    // Fraction in [0, 1]. Audit success criterion 2 (Phase 106): pct_of_total_calls is
    // a fraction, not a percentage — callers multiply by 100 themselves when displaying.
    const pct_of_total_calls = totalCalls > 0 ? calls / totalCalls : 0;

    // D-11: avg_fallback_position from non-null values only; null when all are null
    const positionRows = groupRows.filter((r) => r.fallback_position !== null);
    const avg_fallback_position = positionRows.length > 0
      ? positionRows.reduce((s, r) => s + (r.fallback_position as number), 0) / positionRows.length
      : null;

    models.push({
      model_name, provider_name, calls, pct_of_total_calls,
      avg_fallback_position, spend_usd, avg_cost_per_call_usd, avg_latency_ms,
    });
  }
  models.sort((a, b) => b.calls - a.calls);
  return { models };
}

// ─────────────────────────────────────────────────────────────────────────────
// shapeRecentEntries — D-12
// ─────────────────────────────────────────────────────────────────────────────

interface RecentEntry {
  timestamp: string;
  purpose_name: string;
  model_name: string;
  provider_name: string;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  fallback_position: number | null;
  trace_id: string | null;
}

function shapeRecentEntries(rows: UsageRow[]): { entries: RecentEntry[] } {
  // Rows are already ordered newest-first by the .order() in fetchRows for recent mode.
  return {
    entries: rows.map((r) => ({
      timestamp: r.created_at,
      purpose_name: r.purpose_name,
      model_name: r.model_name,
      provider_name: r.provider_name,
      tokens: { input: n(r.input_tokens), output: n(r.output_tokens) },
      cost_usd: n(r.cost_usd),
      latency_ms: r.latency_ms,
      fallback_position: r.fallback_position,
      trace_id: r.trace_id,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computePriorPeriodDeltas — second supabase query for vs_prior_period.
// Returns { calls_delta_pct, spend_delta_pct } or null on query error.
// Division-by-zero (Pitfall 4): when prior_calls === 0, return null deltas.
// ─────────────────────────────────────────────────────────────────────────────

interface VsPriorPeriod {
  calls_delta_pct: number | null;
  spend_delta_pct: number | null;
}

async function computePriorPeriodDeltas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  instanceId: string,
  currentWindow: ResolvedWindow,
  filters: { purpose_name?: string; model_name?: string; trace_id?: string },
  current: { calls: number; spend: number }
): Promise<VsPriorPeriod | null> {
  const windowMs = currentWindow.to.getTime() - currentWindow.from.getTime();
  const priorTo = new Date(currentWindow.from.getTime() - 1);   // 1ms before current.from
  const priorFrom = new Date(priorTo.getTime() - windowMs);
  const { rows: priorRows, error } = await fetchRows(
    supabase,
    instanceId,
    { from: priorFrom, to: priorTo },
    filters,
  );
  if (error) {
    logger.warn(`get_llm_usage prior-period query failed: ${error.message}`);
    return null;
  }
  const prior_calls = priorRows.length;
  const prior_spend = priorRows.reduce((s, r) => s + n(r.cost_usd), 0);
  return {
    calls_delta_pct: prior_calls === 0
      ? null
      : ((current.calls - prior_calls) / prior_calls) * 100,
    spend_delta_pct: prior_spend === 0
      ? null
      : ((current.spend - prior_spend) / prior_spend) * 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// registerLlmUsageTools — D-01: registers `get_llm_usage` unconditionally
// (REPT-01). Always registered regardless of whether config.llm is defined.
// ─────────────────────────────────────────────────────────────────────────────

export function registerLlmUsageTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'get_llm_usage',
    {
      description:
        "Query aggregated LLM usage statistics from the fqc_llm_usage table. " +
        "Returns pre-aggregated data — never raw rows — across four modes: " +
        "summary (totals + prior-period comparison), by_purpose (per-purpose breakdown with _direct surfaced separately), " +
        "by_model (per-model breakdown with pct_of_total_calls), recent (newest-first individual records). " +
        "Filter by date range (period shortcut OR explicit from_date/to_date), purpose_name, model_name, or trace_id.",
      inputSchema: {
        mode: z.enum(['summary', 'by_purpose', 'by_model', 'recent']).describe(
          "Aggregation mode: 'summary' for totals + comparison, 'by_purpose' for per-purpose, 'by_model' for per-model, 'recent' for individual records."
        ),
        period: z.enum(['24h', '7d', '30d', 'all']).optional().describe(
          "Date range shortcut. '24h'/'7d'/'30d' = last N relative to now; 'all' = no date filter (and omits vs_prior_period). Default: '7d'. Overridden by from_date/to_date."
        ),
        from_date: z.string().optional().describe('ISO 8601 date string (YYYY-MM-DD or full timestamp). Lower bound (inclusive).'),
        to_date: z.string().optional().describe('ISO 8601 date string. Upper bound; date-only values are interpreted as end-of-day (23:59:59.999Z) inclusive.'),
        purpose_name: z.string().optional().describe('Filter to a single purpose name (lowercased before query).'),
        model_name: z.string().optional().describe('Filter to a single model alias (lowercased before query).'),
        trace_id: z.string().optional().describe('Filter to a single trace_id.'),
        limit: z.number().int().positive().max(1000).optional().describe('recent mode only — max number of entries to return. Default 20, max 1000.'),
      },
    },
    async (params) => {
      // Step 0: Shutdown guard (consistent with all other tools)
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }],
          isError: true,
        };
      }

      // Step 1: Supabase guard (D-15) — call inside handler (Pitfall 1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let supabase: any;
      try {
        supabase = supabaseManager.getClient();
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Supabase is not configured. get_llm_usage requires a Supabase connection.' }],
          isError: true,
        };
      }

      // Step 2: Resolve window (D-04) — wrapped in try/catch for T-103-02 (malformed date strings)
      let window: ResolvedWindow | null;
      try {
        window = resolveWindow({
          period: params.period,
          from_date: params.from_date,
          to_date: params.to_date,
        });
        // Validate that resolved Date values are not NaN (Invalid Date throws on .toISOString())
        if (window) {
          window.from.toISOString();
          window.to.toISOString();
        }
      } catch {
        return {
          content: [{ type: 'text' as const, text: 'Invalid date parameters: from_date or to_date could not be parsed as valid ISO 8601 dates.' }],
          isError: true,
        };
      }

      // Step 3: Fetch rows (mode-specific options)
      const filters = {
        purpose_name: params.purpose_name,
        model_name: params.model_name,
        trace_id: params.trace_id,
      };
      const fetchOptions = params.mode === 'recent'
        ? { orderDescByCreatedAt: true, limit: params.limit ?? 20 }
        : undefined;
      const { rows, error } = await fetchRows(
        supabase,
        config.instance.id,
        window,
        filters,
        fetchOptions,
      );
      if (error) {
        // D-17
        logger.warn(`get_llm_usage query failed: ${error.message}`);
        return { content: [{ type: 'text' as const, text: error.message }], isError: true };
      }

      // Step 4: Dispatch on mode
      const period = echoWindow(window);

      if (params.mode === 'summary') {
        const agg = aggregateSummary(rows);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: Record<string, any> = {
          mode: 'summary',
          period,
          total_calls: agg.total_calls,
          total_spend_usd: agg.total_spend_usd,
          avg_cost_per_call_usd: agg.avg_cost_per_call_usd,
          avg_latency_ms: agg.avg_latency_ms,
          top_purpose: agg.top_purpose,
          top_model_name: agg.top_model_name,
        };
        // D-05: vs_prior_period omitted entirely when window is null (period: "all")
        if (window) {
          const deltas = await computePriorPeriodDeltas(
            supabase,
            config.instance.id,
            window,
            filters,
            { calls: agg.total_calls, spend: agg.total_spend_usd },
          );
          // On prior-query error, deltas is null — attach stable shape with null fields.
          // This matches U-39 which expects vs_prior_period to be defined when window is not "all".
          result.vs_prior_period = deltas ?? { calls_delta_pct: null, spend_delta_pct: null };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      if (params.mode === 'by_purpose') {
        const { purposes, direct_model_calls } = aggregateByPurpose(rows);
        const result = { mode: 'by_purpose' as const, period, purposes, direct_model_calls };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      if (params.mode === 'by_model') {
        const { models } = aggregateByModel(rows);
        const result = { mode: 'by_model' as const, period, models };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      // params.mode === 'recent'
      const { entries } = shapeRecentEntries(rows);
      const result = { mode: 'recent' as const, period, entries };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

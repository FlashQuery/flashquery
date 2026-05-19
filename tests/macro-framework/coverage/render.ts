// Coverage renderer for the macro testing framework.
//
// Reads:
//   - coverage/manifest.ts  (the canonical MTF-* cell list)
//   - cases/<category>/*.yml  (every test file's `covers:` declaration)
//   - coverage/coverage.json  (previous cumulative state — optional)
//
// Writes:
//   - coverage/coverage.json     (authoritative cumulative histogram state)
//   - coverage/MTF_COVERAGE.md   (flat per-cell list via `tablemark`)
//   - coverage/MTF_INTERACTIONS.md  (category-level 2D heatmap via `markdown-table`)
//
// Invoked from `npm run coverage:macro-framework`. Does NOT run any tests
// and does NOT track pass/fail — those layers belong to the
// `flashquery-macro-run` skill (Phase 6).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { tablemark } from "tablemark";
import { markdownTable } from "markdown-table";

import { CELLS, CATEGORIES, type Cell } from "./manifest.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAMEWORK_DIR = path.resolve(__dirname, "..");
const CASES_DIR = path.join(FRAMEWORK_DIR, "cases");
const COVERAGE_DIR = __dirname;
const COVERAGE_JSON = path.join(COVERAGE_DIR, "coverage.json");
const COVERAGE_MD = path.join(COVERAGE_DIR, "MTF_COVERAGE.md");
const INTERACTIONS_MD = path.join(COVERAGE_DIR, "MTF_INTERACTIONS.md");

const SCHEMA_VERSION = "1";

// ─── Types ────────────────────────────────────────────────────────────

type TestRecord = {
  /** Test ID (from the YAML `id:` field). */
  id: string;
  /** Path relative to tests/macro-framework/. */
  path: string;
  /** Cell IDs declared in the test's `covers:` array. */
  covers: string[];
};

type CellCoverageState = {
  count: number;
  last_verified: string | null;
  tests: string[];
};

type InteractionState = {
  count: number;
  tests: string[];
};

type CoverageJson = {
  schema_version: string;
  generated_at: string;
  cells: Record<string, CellCoverageState>;
  interactions: Record<string, InteractionState>;
};

// ─── Test corpus loader ───────────────────────────────────────────────

function listYamlTests(): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  if (fs.existsSync(CASES_DIR)) walk(CASES_DIR);
  return out.sort();
}

function loadTest(filePath: string): TestRecord | null {
  const raw = fs.readFileSync(filePath, "utf8");
  let doc: unknown;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    console.warn(`[render] Failed to parse ${filePath}: ${(err as Error).message}`);
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const obj = doc as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : path.basename(filePath, path.extname(filePath));
  const coversRaw = Array.isArray(obj.covers) ? obj.covers : [];
  const covers = coversRaw.filter((c): c is string => typeof c === "string");
  return {
    id,
    path: path.relative(FRAMEWORK_DIR, filePath),
    covers,
  };
}

// ─── State assembly ───────────────────────────────────────────────────

function loadPreviousState(): CoverageJson | null {
  if (!fs.existsSync(COVERAGE_JSON)) return null;
  try {
    const raw = fs.readFileSync(COVERAGE_JSON, "utf8");
    return JSON.parse(raw) as CoverageJson;
  } catch {
    return null;
  }
}

function interactionKey(a: string, b: string): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

function buildState(tests: TestRecord[], previous: CoverageJson | null): CoverageJson {
  const now = new Date().toISOString();
  const cellState: Record<string, CellCoverageState> = {};
  const cellById = new Map<string, Cell>(CELLS.map((c) => [c.id, c]));

  // Initialize every manifest cell with zero coverage.
  for (const cell of CELLS) {
    cellState[cell.id] = { count: 0, last_verified: null, tests: [] };
  }

  // Walk tests; for each declared cell, count it once per test.
  const unknownCells = new Set<string>();
  for (const t of tests) {
    for (const cellId of new Set(t.covers)) {
      if (!cellById.has(cellId)) {
        unknownCells.add(cellId);
        continue;
      }
      const state = cellState[cellId]!;
      if (!state.tests.includes(t.id)) {
        state.tests.push(t.id);
        state.count = state.tests.length;
        state.last_verified = now;
      }
    }
  }

  // Build pairwise interactions: every unordered pair of cells co-appearing in a test.
  const interactions: Record<string, InteractionState> = {};
  for (const t of tests) {
    const declared = Array.from(new Set(t.covers)).filter((c) => cellById.has(c)).sort();
    for (let i = 0; i < declared.length; i++) {
      for (let j = i + 1; j < declared.length; j++) {
        const k = interactionKey(declared[i]!, declared[j]!);
        if (!interactions[k]) interactions[k] = { count: 0, tests: [] };
        if (!interactions[k].tests.includes(t.id)) {
          interactions[k].tests.push(t.id);
          interactions[k].count = interactions[k].tests.length;
        }
      }
    }
  }

  if (unknownCells.size > 0) {
    console.warn(
      `[render] WARNING: ${unknownCells.size} cell ID(s) referenced by tests but missing from manifest: ${[...unknownCells].sort().join(", ")}`,
    );
  }

  if (previous) {
    // Preserve `last_verified` for any cell whose count didn't change from
    // the previous state — keeps the "last seen" timestamp stable across runs
    // that don't actually add tests for a cell.
    for (const [cellId, prev] of Object.entries(previous.cells ?? {})) {
      const next = cellState[cellId];
      if (next && next.count === prev.count && next.count > 0 && prev.last_verified) {
        next.last_verified = prev.last_verified;
      }
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: now,
    cells: cellState,
    interactions,
  };
}

// ─── Renderers ────────────────────────────────────────────────────────

type FlatRow = {
  "Cell ID": string;
  Category: string;
  Description: string;
  Status: string;
  Count: number;
  Target: number;
  "Last Verified": string;
  Tests: string;
};

function renderFlatTable(state: CoverageJson): string {
  const rows: FlatRow[] = CELLS.slice()
    .sort((a, b) => {
      if (a.category !== b.category) {
        return CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
      }
      return a.id.localeCompare(b.id);
    })
    .map((cell) => {
      const cs = state.cells[cell.id]!;
      return {
        "Cell ID": cell.id,
        Category: cell.category,
        Description: cell.description,
        Status: cell.status,
        Count: cs.count,
        Target: cell.density_target,
        "Last Verified": cs.last_verified ? cs.last_verified.slice(0, 10) : "—",
        Tests: cs.tests.length === 0 ? "—" : cs.tests.join(", "),
      };
    });

  const tableMd = tablemark(rows, {
    headerCase: "preserve",
    columns: [
      {},
      {},
      {},
      {},
      { align: "right" },
      { align: "right" },
      {},
      {},
    ],
  });

  const totalCells = CELLS.length;
  const exercised = Object.values(state.cells).filter((c) => c.count > 0).length;
  const totalTouches = Object.values(state.cells).reduce((acc, c) => acc + c.count, 0);

  const header = [
    "# MTF Coverage — Flat per-cell list",
    "",
    "Generated by `npm run coverage:macro-framework`. **Do not hand-edit** — re-run the script to refresh.",
    "",
    `- Generated at: \`${state.generated_at}\``,
    `- Schema version: \`${state.schema_version}\``,
    `- Manifest cells: **${totalCells}** total, **${exercised}** exercised by ≥1 test (${((exercised / totalCells) * 100).toFixed(1)}%)`,
    `- Total cell-touches across all tests: **${totalTouches}**`,
    "",
    "Cells are sorted by category (per §5.3 ordering) then by ID. `Count` is the number of tests whose `covers:` array references the cell. Cells with `Count: 0` are planning signal — actionable cells the corpus has not yet exercised; planned cells await their gating feature.",
    "",
    "",
  ].join("\n");

  return header + tableMd + "\n";
}

function densityMarker(count: number): string {
  if (count <= 0) return "·";
  if (count <= 2) return "▫";
  if (count <= 5) return "▪";
  return "█";
}

function renderInteractionMatrix(state: CoverageJson): string {
  // Aggregate interaction counts at the category level.
  const cats = CATEGORIES;
  const cellByCategory = new Map<string, Set<string>>();
  for (const c of CELLS) {
    if (!cellByCategory.has(c.category)) cellByCategory.set(c.category, new Set());
    cellByCategory.get(c.category)!.add(c.id);
  }

  // For category×category counts:
  //   - off-diagonal: tests that cover ≥1 cell in row-cat AND ≥1 cell in col-cat
  //   - diagonal:     tests that cover ≥1 cell in that category
  // Tests are loaded fresh here (we have the data via state's `tests` lists per cell).
  const testCategories = new Map<string, Set<string>>();
  for (const [cellId, cs] of Object.entries(state.cells)) {
    const cell = CELLS.find((c) => c.id === cellId);
    if (!cell) continue;
    for (const t of cs.tests) {
      if (!testCategories.has(t)) testCategories.set(t, new Set());
      testCategories.get(t)!.add(cell.category);
    }
  }

  const counts: Record<string, Record<string, number>> = {};
  for (const r of cats) {
    counts[r] = {};
    for (const c of cats) counts[r]![c] = 0;
  }
  for (const cats_of_test of testCategories.values()) {
    const list = [...cats_of_test];
    for (const r of list) {
      counts[r]![r]! += 1; // diagonal: count tests touching this category
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        counts[a]![b]! += 1;
        counts[b]![a]! += 1;
      }
    }
  }

  // Build the markdown-table 2D array. Header row + body rows.
  const header = ["", ...cats];
  const body: string[][] = [];
  for (const r of cats) {
    const row: string[] = [`**${r}**`];
    for (const c of cats) {
      const n = counts[r]![c]!;
      row.push(`${densityMarker(n)} ${n}`);
    }
    body.push(row);
  }

  const table = markdownTable([header, ...body], {
    align: ["l", ...cats.map(() => "c" as const)],
  });

  const totalTests = testCategories.size;
  const intro = [
    "# MTF Coverage — Category × Category interactions",
    "",
    "Generated by `npm run coverage:macro-framework`. **Do not hand-edit** — re-run the script to refresh.",
    "",
    `- Generated at: \`${state.generated_at}\``,
    `- Schema version: \`${state.schema_version}\``,
    `- Tests counted: **${totalTests}**`,
    "",
    "Each cell shows how many tests in the corpus exercise at least one MTF-* cell in BOTH the row category and the column category. The diagonal shows how many tests touch the row category in total. Density markers: `·` 0, `▫` 1–2, `▪` 3–5, `█` 6+.",
    "",
    "Categories follow §5.3: MTF-G (grammar), MTF-S (semantics), MTF-C (control flow), MTF-D (dispatch), MTF-L (lifecycle), MTF-E (errors), MTF-I (isolation), MTF-FW (framework self-test).",
    "",
    "",
  ].join("\n");

  return intro + table + "\n";
}

// ─── Main ─────────────────────────────────────────────────────────────

function main(): void {
  console.log(`[render] Cases dir: ${CASES_DIR}`);
  const yamlFiles = listYamlTests();
  console.log(`[render] Found ${yamlFiles.length} YAML test file(s).`);

  const tests: TestRecord[] = [];
  for (const f of yamlFiles) {
    const t = loadTest(f);
    if (t) tests.push(t);
  }
  console.log(`[render] Parsed ${tests.length} test(s).`);

  const previous = loadPreviousState();
  const state = buildState(tests, previous);

  // Write coverage.json
  fs.writeFileSync(COVERAGE_JSON, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`[render] Wrote ${path.relative(FRAMEWORK_DIR, COVERAGE_JSON)}`);

  // Write MTF_COVERAGE.md
  fs.writeFileSync(COVERAGE_MD, renderFlatTable(state), "utf8");
  console.log(`[render] Wrote ${path.relative(FRAMEWORK_DIR, COVERAGE_MD)}`);

  // Write MTF_INTERACTIONS.md
  fs.writeFileSync(INTERACTIONS_MD, renderInteractionMatrix(state), "utf8");
  console.log(`[render] Wrote ${path.relative(FRAMEWORK_DIR, INTERACTIONS_MD)}`);

  // Summary
  const cells = Object.values(state.cells);
  const exercised = cells.filter((c) => c.count > 0).length;
  console.log(
    `[render] Summary: ${exercised}/${cells.length} cells exercised; ${Object.keys(state.interactions).length} pairwise interactions tracked.`,
  );
}

main();

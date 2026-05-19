// CLI wrapper for `flashquery-macro-testgen` (Phase 5 / §9.5).
//
// Three modes:
//
//   committed --target=<MTF-cell> [--target=<MTF-cell> ...]
//     For each named cell, synthesize a test (from the built-in scenario
//     library or by reading a spec file), run it through the golden,
//     embed the snapshot, write the YAML under `cases/<category>/`, and
//     validate by re-driving the production engine.
//
//   fresh --count=N [--categories=MTF-G,MTF-S,...]
//     Pick the N lowest-density actionable cells from coverage.json and
//     generate tests for the subset the library knows how to fulfill.
//     Files land under `cases-fresh/` (gitignored per §9.1) and validate.
//
//   refresh [--filter=<glob>] [--auto-accept-identical]
//     Walk all tests whose `golden_version` is older than the current
//     golden; re-run each macro through the current golden; for identical
//     snapshots bump `golden_version` + `golden_run_at` automatically when
//     `--auto-accept-identical` is set; otherwise report the divergence
//     and skip.
//
// Invoke via `npm run testgen:macro-framework -- --mode=committed --target=MTF-G-006`.

import {
  GOLDEN_VERSION,
  captureAndEmbed,
  findStaleTests,
  getBuiltinScenario,
  listBuiltinScenarioCells,
  loadCellMetadata,
  loadCoverage,
  loadExemplars,
  refreshTest,
  selectTargetCells,
  synthesizeTestInputs,
  validateGeneratedTest,
  writeGeneratedTest,
} from './testgen-helper.ts';

type Mode = 'committed' | 'fresh' | 'refresh';

interface CliArgs {
  mode: Mode;
  targets: string[];
  count: number;
  categories: string[] | null;
  filter: string | null;
  auto_accept_identical: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'committed',
    targets: [],
    count: 5,
    categories: null,
    filter: null,
    auto_accept_identical: false,
    quiet: false,
  };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [k, vRaw] = raw.slice(2).split('=');
    const v = vRaw ?? '';
    switch (k) {
      case 'mode':
        if (v !== 'committed' && v !== 'fresh' && v !== 'refresh') {
          throw new Error(`Unknown --mode=${v}. Expected committed|fresh|refresh.`);
        }
        args.mode = v;
        break;
      case 'target':
        args.targets.push(v);
        break;
      case 'count':
        args.count = Math.max(1, Number(v) || 5);
        break;
      case 'categories':
        args.categories = v.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'filter':
        args.filter = v;
        break;
      case 'auto-accept-identical':
        args.auto_accept_identical = v === '' || v === 'true' || v === '1';
        break;
      case 'quiet':
        args.quiet = v === '' || v === 'true' || v === '1';
        break;
      default:
        // Tolerate unknown flags so npm passes -- correctly.
        break;
    }
  }
  return args;
}

function log(args: CliArgs, ...parts: unknown[]): void {
  if (args.quiet) return;
  // eslint-disable-next-line no-console
  console.log(...parts);
}

async function runCommitted(args: CliArgs): Promise<number> {
  if (args.targets.length === 0) {
    // Operator didn't name a cell; pick zero-density ones from the
    // built-in library.
    const cov = await loadCoverage();
    const candidates = selectTargetCells(cov, {
      count: args.count,
    }).map((c) => c.id).filter((id) => listBuiltinScenarioCells().includes(id));
    if (candidates.length === 0) {
      log(args, '[testgen] No targets provided and library is empty.');
      return 1;
    }
    args.targets = candidates.slice(0, args.count);
    log(args, `[testgen] No --target given; using ${args.targets.length} library-known low-density cells.`);
  }

  let failures = 0;
  for (const cellId of args.targets) {
    log(args, `\n[testgen committed] cell=${cellId}`);
    const meta = await loadCellMetadata(cellId);
    const exemplars = await loadExemplars(meta.cell.category, 2);
    log(args, `  cell: ${meta.cell.description}`);
    log(args, `  exemplars: ${exemplars.length}`);
    log(args, `  req_fragments: ${meta.req_fragments.length}`);

    const synth = synthesizeTestInputs(meta.cell, exemplars, meta.req_fragments);
    if (!synth) {
      log(args, `  [skip] no built-in scenario for ${cellId} and no inline synthesis supplied.`);
      failures += 1;
      continue;
    }

    const cap = await captureAndEmbed(synth);
    // An error envelope is fine — fail-path tests deliberately produce
    // them. The author's `expect_overrides` should declare the matching
    // outcome=fail expectation; if they expect success but capture failed,
    // validation surfaces the mismatch.
    if (cap.envelope.error) {
      log(args, `  golden capture surfaced error: ${cap.envelope.error.code} (expected for error-path tests).`);
    }

    const path = await writeGeneratedTest(synth, cap.yaml_text);
    log(args, `  wrote: ${path}`);
    const v = await validateGeneratedTest(path);
    if (v.ok) {
      log(args, `  validate: PASS (${v.findings_count} findings)`);
    } else {
      log(args, `  validate: FAIL — ${v.findings_count} findings:\n${v.finding_summary}`);
      failures += 1;
    }
  }

  log(args, `\n[testgen committed] done. failures=${failures}/${args.targets.length}`);
  return failures > 0 ? 2 : 0;
}

async function runFresh(args: CliArgs): Promise<number> {
  const cov = await loadCoverage();
  const cells = selectTargetCells(cov, {
    count: args.count * 2, // overselect so library lookups can filter
    categories: args.categories ?? undefined,
  });
  const library = new Set(listBuiltinScenarioCells());
  const usable = cells.filter((c) => library.has(c.id)).slice(0, args.count);
  if (usable.length === 0) {
    log(args, '[testgen fresh] No library-known low-density cells available.');
    return 1;
  }

  let failures = 0;
  for (const cell of usable) {
    log(args, `\n[testgen fresh] cell=${cell.id}`);
    const synth = getBuiltinScenario(cell.id);
    if (!synth) {
      failures += 1;
      continue;
    }
    const cap = await captureAndEmbed(synth);
    if (cap.envelope.error) {
      log(args, `  capture surfaced error: ${cap.envelope.error.code} (expected for error-path tests).`);
    }
    const path = await writeGeneratedTest(synth, cap.yaml_text, { fresh_mode: true });
    log(args, `  wrote: ${path}`);
    const v = await validateGeneratedTest(path);
    log(args, `  validate: ${v.ok ? 'PASS' : 'FAIL'}`);
    if (!v.ok) failures += 1;
  }
  log(args, `\n[testgen fresh] done. failures=${failures}/${usable.length}`);
  return failures > 0 ? 2 : 0;
}

async function runRefresh(args: CliArgs): Promise<number> {
  const stale = await findStaleTests(GOLDEN_VERSION);
  if (args.filter) {
    const f = args.filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(f);
    for (let i = stale.length - 1; i >= 0; i -= 1) {
      if (!re.test(stale[i].path) && !re.test(stale[i].test_id)) {
        stale.splice(i, 1);
      }
    }
  }
  if (stale.length === 0) {
    log(args, `[testgen refresh] No stale tests at golden ${GOLDEN_VERSION}. (Filter: ${args.filter ?? 'none'})`);
    return 0;
  }
  log(args, `[testgen refresh] ${stale.length} stale test(s) at golden ${GOLDEN_VERSION}`);
  let failures = 0;
  for (const entry of stale) {
    log(args, `\n[refresh] ${entry.test_id}  (golden_version=${entry.golden_version_used})`);
    const r = await refreshTest(entry.path, {
      auto_accept_identical: args.auto_accept_identical,
    });
    if (r.identical && r.changed) {
      log(args, `  PASS — identical snapshot; version bumped to ${GOLDEN_VERSION}.`);
    } else if (r.identical && !r.changed) {
      log(args, `  IDENTICAL but operator review required (use --auto-accept-identical to bump).`);
    } else {
      log(args, `  DIVERGENT: ${r.diff_summary}`);
      failures += 1;
    }
  }
  log(args, `\n[testgen refresh] done. failures=${failures}/${stale.length}`);
  return failures > 0 ? 2 : 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;
  switch (args.mode) {
    case 'committed':
      exitCode = await runCommitted(args);
      break;
    case 'fresh':
      exitCode = await runFresh(args);
      break;
    case 'refresh':
      exitCode = await runRefresh(args);
      break;
  }
  process.exit(exitCode);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

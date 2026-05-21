// CLI wrapper for `flashquery-macro-run` (Phase 6).
//
// Three modes:
//
//   npm run run:macro-framework
//       Invokes `npm run test:macro-framework` (the vitest suite),
//       streams output, and reports the final pass/fail summary. Failure
//       records are emitted by the runner itself via `cases.test.ts`'s
//       `writeTriageRecord()` call — this wrapper just orchestrates.
//
//   npm run run:macro-framework -- --triage <recordPath>
//       Re-classifies an existing failure record. Reads the YAML test
//       referenced in the record's `test_file:` frontmatter field, drives
//       the production engine again, and (if the test still fails) writes
//       a fresh classification to the record's action log.
//
//   npm run run:macro-framework -- --stale-check
//       Pre-run §5.8 first-pass — reports stale-version tests without
//       running them. Pure read-only.
//
// Implementation note: this CLI deliberately keeps its dependencies thin
// — no test framework imports beyond what's already in the runner. Vitest
// stays under `npm run test:macro-framework`.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import { findStaleTests, renderStaleReport } from './stale-check.ts';
import { classifyFailure } from './classify.ts';
import { updateTriageRecord } from './record.ts';
import { GOLDEN_VERSION } from '../golden-bridge/load.ts';
import {
  compareToExpect,
  driveTest,
  type TestCase,
} from '../src/runner.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = join(__dirname, '..');
const REPO_ROOT = resolve(FRAMEWORK_ROOT, '..', '..');

interface Args {
  stale_check: boolean;
  triage?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { stale_check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--stale-check') {
      out.stale_check = true;
    } else if (a === '--triage') {
      out.triage = argv[i + 1];
      i += 1;
    } else if (a.startsWith('--triage=')) {
      out.triage = a.slice('--triage='.length);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(
    [
      'Usage: npm run run:macro-framework [-- <opts>]',
      '',
      'Options:',
      '  --stale-check         Pre-run check — report any tests whose golden_version',
      '                        is older than current. No tests are run.',
      '  --triage <path>       Re-triage an existing failure record at <path>.',
      '                        Reads test_file from frontmatter, drives the engine,',
      '                        re-classifies on failure, appends to the action log.',
      '  (no flag)             Invoke the full vitest suite via npm run test:macro-framework.',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.stale_check) {
    const stale = await findStaleTests(GOLDEN_VERSION);
    console.log(renderStaleReport(stale));
    // Exit code 0 — stale tests are signal, not an error per §5.8.
    process.exit(0);
  }

  if (args.triage) {
    await triageExistingRecord(args.triage);
    return;
  }

  // Default mode: invoke the vitest suite.
  await runVitestSuite();
}

async function runVitestSuite(): Promise<void> {
  // Pre-run stale check (advisory). Per §5.8 the run skill ALWAYS checks
  // golden_version against current as its first triage step — even before
  // running tests.
  const stale = await findStaleTests(GOLDEN_VERSION);
  if (stale.length > 0) {
    console.log('─── pre-run stale-version check ───');
    console.log(renderStaleReport(stale));
    console.log('───');
    console.log('');
  }

  console.log(`Invoking: npm run test:macro-framework  (golden v${GOLDEN_VERSION})`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['run', 'test:macro-framework'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => {
      if (code === 0) {
        console.log('');
        console.log('All tests passed. No new failure records written.');
        resolvePromise();
      } else {
        console.log('');
        console.log(
          `Tests failed (exit ${code}). New failure-triage records (if any) are in ` +
            `tests/macro-framework/failures/ — inspect them to confirm classifications.`,
        );
        // Propagate the failure exit code.
        process.exit(code ?? 1);
      }
    });
    child.on('error', (err) => rejectPromise(err));
  });
}

async function triageExistingRecord(recordPath: string): Promise<void> {
  const absPath = resolve(process.cwd(), recordPath);
  const raw = await readFile(absPath, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`Record ${absPath} is missing frontmatter`);
  const fm = parseFrontmatter(m[1]);
  const testFileRel = fm.test_file as string | undefined;
  if (!testFileRel) {
    throw new Error(`Record ${absPath} has no test_file: in frontmatter`);
  }
  // `test_file:` in §9.6 records is stored relative to FRAMEWORK_ROOT
  // (per `runner.ts`'s `relative(FRAMEWORK_ROOT, file)` on load). For
  // robustness against legacy records or operator-pasted paths, try
  // FRAMEWORK_ROOT first, then REPO_ROOT, then the literal path as-is.
  const candidates = [
    resolve(FRAMEWORK_ROOT, testFileRel),
    resolve(REPO_ROOT, testFileRel),
    resolve(process.cwd(), testFileRel),
  ];
  let testPath: string | undefined;
  let tcText: string | undefined;
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      tcText = await readFile(candidate, 'utf8');
      testPath = candidate;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (testPath === undefined || tcText === undefined) {
    throw new Error(
      `Could not locate test_file "${testFileRel}" relative to FRAMEWORK_ROOT, ` +
        `REPO_ROOT, or cwd. Last error: ${
          lastErr instanceof Error ? lastErr.message : String(lastErr)
        }`,
    );
  }
  const tc = loadYaml(tcText) as TestCase;
  tc.__file = testFileRel;
  tc.__category = testFileRel.split('/').slice(-2, -1)[0];

  console.log(`Re-triaging: ${tc.id}  (record: ${absPath})`);
  console.log(`  test_file: ${testFileRel}`);
  console.log(`  golden_version_used: ${tc.golden_version}`);
  console.log(`  golden_version_current: ${GOLDEN_VERSION}`);

  const drive = await driveTest(tc);
  try {
    const cmp = compareToExpect(tc, drive);
    if (cmp.ok) {
      console.log('');
      console.log('Re-triage result: test PASSES now. Suggest marking record `status: resolved`.');
      await updateTriageRecord(absPath, {
        action_log_entry:
          `re-triage via flashquery-macro-run: test now PASSES (golden v${GOLDEN_VERSION})`,
      });
      console.log(`Action log updated at: ${absPath}`);
      return;
    }
    const classification = classifyFailure(tc, cmp.findings, {
      goldenVersionCurrent: GOLDEN_VERSION,
    });
    console.log('');
    console.log(`Re-triage classification: ${classification.classification} (${classification.confidence})`);
    console.log(`  rationale: ${classification.rationale}`);
    console.log('');
    await updateTriageRecord(absPath, {
      classification: classification.classification,
      confidence: classification.confidence,
      action_log_entry:
        `re-triage via flashquery-macro-run: ${classification.classification} ` +
        `(${classification.confidence} confidence) — ${classification.suggested_action}`,
    });
    console.log(`Action log updated at: ${absPath}`);
  } finally {
    await drive.cleanup();
  }
}

function parseFrontmatter(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    out[k] = v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

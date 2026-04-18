---
name: flashquery-directed-run
description: Run FlashQuery directed scenario tests (one, several, or the full suite), triage every failure with the user, and hand each one off to the right place. Use this skill whenever the user wants to execute the directed scenario suite, investigate failing directed tests, triage results from a suite run, or "run and debug" directed tests. Also trigger on phrases like "run the suite", "run these tests", "why are these tests failing", "triage the failures", "work through the failing tests", "debug the suite", "execute the scenarios", "run and investigate", "run_suite", or any request that combines executing directed tests with understanding what's broken. Even casual mentions like "let's run the tests and see" or "check if everything still passes" should trigger this skill. This is the sister skill to flashquery-directed-testgen (which writes tests) and flashquery-directed-covgen (which defines what to test) — flashquery-directed-run is the runner and triage layer that coordinates the other two plus GSD debug when failures are found.
---

# FlashQuery Directed Run

This skill executes FlashQuery directed scenario tests and triages the results. It is the runner-and-coordinator layer that sits alongside two authoring skills:

- **`flashquery-directed-covgen`** decides *what behaviors should be tested* — maintains `DIRECTED_COVERAGE.md`.
- **`flashquery-directed-testgen`** writes *tests to exercise those behaviors* — owns test authoring and its own debug loop for fixing test-side problems.
- **`flashquery-directed-run`** (this skill) *runs the tests, categorizes every failure with the user, and hands each one off to the right place* — never fixes code directly.

The separation is load-bearing. This skill does not write code, does not modify FlashQuery, does not edit coverage rows beyond marking defects. It runs, it collects, it asks the user to confirm a diagnosis, and then it routes the work to the right place. Keeping triage and authoring in separate skills prevents this one from becoming a megaskill and keeps the user-in-the-loop checkpoints honest.

## Companion references

Read these when relevant; they are the source of truth for the test system this skill operates:

- `tests/scenarios/directed/README.md` — landing page for the directed test system
- `tests/scenarios/directed/WRITING_SCENARIOS.md` — human-facing authoring guide (explains opt-in flags, conventions, what belongs in directed scenario tests)
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` — the coverage matrix
- `tests/scenarios/dbtools/README.md` — operational/debug scripts available during triage (`snapshot.py`, `verify_cleanup.py`, `orphans.py`, `reset.py`, `clean_test_tables.py`)
- `.claude/skills/flashquery-directed-testgen/SKILL.md` — where you hand off for confirmed test bugs
- `.claude/skills/flashquery-directed-covgen/SKILL.md` — where you hand off for confirmed coverage-definition issues

## When to use / when not to use

**Use this skill when:**

- The user wants to run the directed scenario suite (or a subset) and see what's broken
- The user wants to triage failing directed tests — "why is X failing?"
- The user wants to work through a batch of failures and decide what to do about each
- The user wants a re-run after changes to verify they stuck

**Do not use this skill when:**

- The user wants to write a new directed test from scratch — that's `flashquery-directed-testgen`, not this.
- The user wants to add/modify/remove coverage rows — that's `flashquery-directed-covgen`, not this.
- The user wants to debug an FlashQuery defect in depth — hand off to `/gsd-debug` via this skill, but the actual code investigation lives there.

If in doubt, fall into this skill when a *run* or a *set of failures* is involved, and route to the others for the authoring decisions.

## Invocation patterns

The skill should accept any of these shapes:

- "Run the full suite" → run all tests under `directed/testcases/`
- "Run the memory tests" → glob-match and run
- "Run test_auto_commit_on_writes" → single test, via the suite runner
- "Why is test_X failing?" → run just that test with managed+strict, then triage
- "Triage the latest run" → skip execution; read the most recent report under `directed/reports/` and triage from there
- "Run and fix everything" → run, triage, route to testgen/GSD for each failure, re-run

The user might not use the word "directed"; fire on "run the tests," "run the suite," "triage failures," etc.

## Default configuration

When invoking `run_suite.py`, default to:

```
--managed --strict-cleanup
```

`--managed` gives a dedicated shared server with captured logs; `--strict-cleanup` catches the class of test bug where a test fails to tear down what it created. Both are cheap and both catch real problems early.

Override the defaults when the user asks or when the situation demands it:

- **`--per-test-server`** — when diagnosing test-to-test state leakage; slower but isolates each test.
- **`--stop-on-fail`** — when the user wants fast feedback on the first failure.
- **`--seed N`** — when investigating order-dependent flakiness.
- **`--require-embedding`** — when the suite includes tests that exercise semantic or mixed-mode search; enables the embedding provider in the shared managed server. Tests that hardcode `managed=True` for their own server are unaffected.
- **`--enable-git`** — when the suite includes tests that exercise git auto-commit behavior; initializes the shared managed server's vault as a git repo.
- **`--enable-locking`** — when the suite includes tests that exercise write-lock contention; enables the file-lock machinery in the shared managed server.
- **`--testcases DIR`** — when pointing at a non-default testcases directory.
- **`--report-dir DIR`** — when writing reports to a non-default location.
- **External server (`--url`/`--secret`)** — when the user explicitly says so; `--strict-cleanup` doesn't apply in this mode.

Never silently drop `--strict-cleanup`. If it can't be used (external mode, no PostgreSQL driver installed), surface that clearly to the user before proceeding.

## Workflow

### Phase 1 — Scope the run

Confirm what the user wants:

- Which tests? (all / pattern / list / single)
- Which mode? (default `--managed --strict-cleanup`; offer overrides if hinted)

Do not run yet. A short "I'm about to run these N tests with these flags on this OS — proceed?" is enough. Skip this check only when the user's phrasing is unambiguous and trivial ("just run the suite already").

### Phase 2 — Capture environment

Before execution, capture:

- **Operating system:** `platform.system()`, `platform.release()`, `platform.machine()` (or `uname -a` via Bash)
- **Node.js version:** `node --version`
- **Python version:** `python3 --version`
- **Git version:** `git --version` (matters for `enable_git=True` tests)
- **FlashQuery version:** from `package.json`'s `version` field, if readable
- **dbtools readiness:** is a PostgreSQL driver installed? (affects what's possible during triage)

Keep this environment snapshot alive for the rest of the run — it goes into every findings packet. FlashQuery is expected to run on Linux and macOS (and potentially Windows); the same test can pass on one and fail on another for reasons that have nothing to do with FlashQuery or the test (line endings, filesystem timing, git version). A failure's environment context is the first piece of evidence for categorization.

### Phase 3 — Execute

Invoke `run_suite.py` from the flashquery-core project root:

```bash
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup [patterns...]
```

Stream output; don't micro-narrate. Wait for the run to finish and for the timestamped report under `tests/scenarios/directed/reports/` to be written.

If the suite itself fails to start (can't build, can't connect to Supabase, missing config), that's an environment problem the skill should surface immediately — don't try to salvage a broken environment by looping. Report it clearly and pause.

### Phase 4 — Collect signals

Once the run completes, gather:

- **Per-test status** (PASS / FAIL / ERROR / SKIP) from the run's summary
- **The scenario report** at `tests/scenarios/directed/reports/scenario-report-<timestamp>.md` — read it end-to-end
- **Cleanup residue** (if `--strict-cleanup` was used): which tests left rows behind, in which tables
- **Console output** from the runner (the stderr summary often has the "copy this snapshot.py command" hint for failed tests in managed mode)

For each failing test, begin assembling its findings packet (see template below). Capture early — don't wait until the end. The managed server may still be running; that's the best time to snapshot DB state.

### Phase 5 — Categorize failures

Every failure gets slotted into one of five buckets. Use the criteria below as guidance; evidence matters more than certainty at this stage.

**Test bug.** The test is wrong. Examples:
- Assertion looks for a string that doesn't match FlashQuery's actual response format
- Missing `force_file_scan` between a vault write and a search
- Forgot to pass `vault_path=getattr(args, "vault_path", None)` (or used `managed=args.managed` alongside an opt-in flag; see WRITING_SCENARIOS.md for the "force managed" pattern)
- Cleanup registration is missing for a resource the test created
- Argparse or import error
- Wrong `sys.path.insert` path (using `parent.parent` instead of `parent.parent.parent`)

**Environment issue.** The test is fine but the environment can't support it. Examples:
- `require_embedding=True` but no `EMBEDDING_API_KEY` in `.env.test`
- Missing Node build (`dist/index.js` not present)
- DB unreachable (Supabase down, wrong port, credentials expired)
- Missing psycopg driver for `--strict-cleanup`
- OS-specific: passes on macOS, fails on Linux (or vice versa) due to platform differences

Often overlaps with "test bug" — a test that doesn't force `managed=True` for its opt-in flag fails with an environment error but the fix is in the test. Use judgment and name both factors in the packet.

**FlashQuery defect.** The test is correctly written, the environment is fine, and FlashQuery is doing something different from what the spec says it should. Examples:
- Tool returns wrong status or missing fields
- A documented capability doesn't work (an operation that should produce a commit produces none, an archived doc still shows up in search, etc.)
- Error shape differs from what DIRECTED_COVERAGE.md describes

**Spec ambiguity.** The test and FlashQuery disagree, but the right answer isn't obvious from DIRECTED_COVERAGE.md or surrounding docs. Neither side is clearly wrong — the behavior hasn't been pinned down yet. Examples:
- "Archive produces a commit" — does it? Only if FlashQuery touches the file; the matrix doesn't say.
- "Search excludes archived" — does this extend to plugin records? The matrix doesn't say.

**Flaky.** The test passes sometimes and fails others. Evidence: prior passing record in DIRECTED_COVERAGE.md, or the user has seen it pass; failure reason smells like timing (race with indexing, TTL on a lock, etc.). Before acting, re-run the test 3 times with `run_suite.py` to confirm flakiness and to catch a "passes on re-run" pattern that points at a real timing bug.

Run-scenarios proposes the category; the user confirms. **No action is taken before the user confirms the category**, because misclassification leads to fixing the wrong thing.

### Phase 6 — Present findings and get categorization approval

For each failing test, show the user:

- The test name, the step that failed, and the assertion
- The proposed category with a one-line reason
- The evidence that led you there (specific report excerpts, log lines, snapshot output)
- Any open questions about FlashQuery's spec

Batch when multiple failures share a root cause. If three tests all fail because `require_embedding=True` wasn't paired with `managed=True`, say so clearly: "Three failures, same root cause — proposed category: test bug (opt-in-flag pattern). Confirm and I'll hand the batch to testgen?"

Wait for confirmation on every failure (or batch). Don't proceed to action without it.

If the user's response raises a spec question ("wait, should archive produce a commit at all?"), pause the triage and discuss. Mark the failure as "spec ambiguity" and do not route it until the question is resolved.

### Phase 7 — Plan per-failure actions

Based on confirmed category, propose one specific action per failure:

| Category | Action |
|----------|--------|
| Test bug | Hand off to `flashquery-directed-testgen` with the failure description and proposed fix direction |
| Environment issue (test-fixable) | Hand off to `flashquery-directed-testgen` with the specific change (e.g., "force `managed=True`, add `enable_git=True`") |
| Environment issue (user-fixable) | Tell the user the exact change (e.g., "add `EMBEDDING_API_KEY` to `.env.test`") and pause |
| FlashQuery defect | Mark in DIRECTED_COVERAGE.md with `FAIL (YYYY-MM-DD)` and `*`-suffixed test name, assemble the findings packet, offer to invoke `/gsd-debug` |
| Spec ambiguity | Hand off to `flashquery-directed-covgen` to clarify the behavior definition, or discuss with the user directly first |
| Flaky | Run the specific test 3–5 more times to confirm. If consistently flaky, treat as a test bug (timing, ordering) or FlashQuery defect (race), categorize accordingly, and re-route |

Get explicit approval on each planned action before executing. For batches, one approval per batch is fine provided the shared root cause is clearly stated.

### Phase 8 — Execute approved actions

Execute each approved action by invoking the appropriate sub-skill or taking the direct step:

- **Test bug / test-fixable env → testgen.** Brief testgen with the failure, the proposed direction, and a pointer at the test file and the scenario report excerpt. Let testgen run its own debug loop (it has one; don't duplicate it here). When testgen returns "done," re-run the fixed test(s) in Phase 9.
- **User-fixable env → the user.** Tell them exactly what to change. Pause. When they say they've done it, continue.
- **FlashQuery defect → DIRECTED_COVERAGE.md mark + GSD (or user discussion).** Mark the coverage rows with `FAIL (YYYY-MM-DD)` and add `*` to the test name in `Covered By`. Then: if `/gsd-debug` is available, offer to invoke it with the findings packet; otherwise present the packet to the user for a decision on how to proceed. Don't modify FlashQuery code from this skill.
- **Spec ambiguity → covgen.** Hand the question to covgen. It'll propose a behavior clarification, get user sign-off, and update DIRECTED_COVERAGE.md. Afterward, re-categorize the original failure (it's usually now either a test bug or an FlashQuery defect once the spec is pinned down).

Use the `dbtools/` scripts freely during this phase. `snapshot.py --instance-id <id>` is particularly valuable when gathering evidence for a findings packet. `verify_cleanup.py` helps confirm residue is real. None of these modify FlashQuery code or test code — they're purely for investigation.

Note on `clean_test_tables.py`: this script is **called automatically by run_suite.py** before the first test and between every test in managed mode — it deletes all rows from every `fqc_*` table to give each test a clean slate. It is not a manual debug tool. If you find yourself wanting to run it manually (e.g., to clear a wedged state between two standalone runs), that's fine, but it's not part of the normal triage workflow. The manual escape hatch for a single test instance is `reset.py --instance-id <id>`.

**No code change happens without per-change approval.** Even inside testgen's workflow, the authoring skill has its own approval checkpoints. This skill is the outer coordinator, not the inner executor.

### Phase 9 — Re-run to verify

After changes are applied, re-run the affected tests to confirm the fix holds. Don't re-run the whole suite unless the user asks or the fix plausibly affected other tests.

```bash
python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup <test_pattern>
```

If a test that was supposed to be fixed still fails, return to Phase 5 and re-categorize — something was misdiagnosed. Don't loop without going back through the user checkpoint.

### Phase 10 — Summarize and close out

At the end of the run:

- **If everything passed clean (including strict cleanup):** bulk-update `Last Passing` in DIRECTED_COVERAGE.md to today's date for every ID covered by a passing test. This is the one DIRECTED_COVERAGE.md update this skill owns directly — it's the skill that just watched the suite pass. Do not touch `Date Updated` or `Covered By`; those belong to covgen and testgen.
- **If there were failures:** summarize which were fixed, which were handed to GSD, which remain open (e.g., pending a spec question), and which were marked `FAIL` in DIRECTED_COVERAGE.md. List the findings packets produced.
- **Either way:** print a compact suite status — N passed, N failed, N reclassified, environment context, report file path.

Offer a git commit if any files changed. Use the testgen convention for commit messages if testgen did the fixing; for DIRECTED_COVERAGE.md-only updates (Last Passing bulk update, FAIL marks), use a shorter `chore(coverage):` style message.

## Failure categorization — in more depth

Categorization is where this skill earns its keep. A few patterns worth remembering:

**Test bug, "opt-in flag pattern" subtype.** A test that uses `require_embedding=True`, `enable_locking=True`, or `enable_git=True` must also pass `managed=True`. If it uses `managed=args.managed` instead, the flag is silently ignored under `run_suite.py --managed` (shared server mode). Symptom: test passes standalone with `--managed`, fails in the suite with errors like "Semantic search unavailable" or "locking not enabled." This is the single most common environment-adjacent test bug. WRITING_SCENARIOS.md has the full pattern.

**Test bug, "cleanup residue" subtype.** Surfaced by `--strict-cleanup`. The test created something (a doc, memory, plugin record, intermediate directory) and didn't register it with `ctx.cleanup`. Read the report's residue section and the test's cleanup registration to find the gap.

**Test bug, "wrong sys.path" subtype.** A test file that uses `parent.parent / "framework"` instead of `parent.parent.parent / "framework"` will fail with an ImportError when run standalone (not through `run_suite.py`). The suite runner adds the framework path before importing test modules, so this bug can hide in suite runs but surface when running tests directly. The fix is always `parent.parent.parent / "framework"`.

**FlashQuery defect, "commit missing" subtype.** `enable_git=True` tests where the expected commit didn't happen. Verify with `git -C <vault> log` via Bash (or via `ctx.git.commits_since` evidence in the report). If zero commits followed a tool call that should have produced one, the test is right and FlashQuery is wrong — file to GSD.

**FlashQuery defect, "response format drift" subtype.** Assertion looks for a string FlashQuery no longer emits. Read the actual response text in the report. If the change is cosmetic and the matrix allows it, it's a test bug (update the assertion). If FlashQuery is now missing information it used to include, it's a defect.

**Environment issue, "OS divergence" subtype.** Same test passes on one OS, fails on another. Capture both environments if possible (ask the user what the other OS's result was); mark the finding with the OS in the packet. Don't assume it's FlashQuery's fault and don't assume it's the test's fault — OS-specific timing, file watching, and git behavior are all real sources of divergence.

## OS handling and cross-platform notes

FlashQuery runs on Linux and macOS; Windows support is in-scope in general. Directed scenario tests can behave differently across platforms. This skill captures OS on every run so cross-platform divergence is visible as it happens.

For now, treat OS as **metadata, not schema**. Every findings packet includes the OS context. Failures that appear OS-specific are marked as such in the packet and raised with the user. `DIRECTED_COVERAGE.md` does not have a per-OS `Last Passing` column yet — if cross-OS divergence becomes a pattern worth tracking persistently, that's a `flashquery-directed-covgen` discussion to extend the schema. Until then, the skill just makes sure nobody is surprised by an OS-specific pass/fail.

When a failure is diagnosed as OS-specific, the categorization should be explicit ("test bug on Linux" / "FlashQuery defect on macOS" / "environment issue, Windows-only") — not just "flaky."

## Findings packet template

One packet per failing test (or per batch of failures that share a root cause). This is the document that gets handed to GSD, or to the user for inline discussion. Capture everything at triage time so GSD doesn't have to reproduce your investigation.

```markdown
# Findings: <test_name> — <PROPOSED_CATEGORY>

## Summary
- **Test:** <test_name>
- **Coverage IDs:** <comma-separated list>
- **Failed step:** <step label from report>
- **Error:** <the one-line error that defined the failure>
- **Proposed category:** <test bug | environment | FlashQuery defect | spec ambiguity | flaky>
- **User-confirmed category:** <filled in after Phase 6, or left as "pending">

## Environment
- **OS:** <platform.system() platform.release() (platform.machine())>
- **Node.js:** <version>
- **Python:** <version>
- **Git:** <version>
- **FlashQuery:** <version from package.json>
- **Run mode:** <--managed / --per-test-server / external>
- **Strict cleanup:** <yes/no>
- **Runner invocation:** <the exact command used>

## The failing step
- **Label:** <label>
- **Tool:** <tool_name>(<args>)
- **Expected:** <the assertion / expected value>
- **Actual response:** <raw response text from FlashQuery>
- **Error message:** <verbatim>

## Server logs (scoped to the failing step)
```
<log lines from the report's step-logs section>
```

## DB state at failure
(from `python3 tests/scenarios/dbtools/snapshot.py --instance-id <instance_id>`)
```json
<snapshot output>
```

## Git state (if enable_git was on)
- **HEAD:** <sha>
- **Working tree clean:** <yes/no>
- **Commits since test start:** <count + SHAs>

## Cleanup residue (if strict-cleanup flagged this test)
- <table: count>
- <table: count>

## Spec reference
- **DIRECTED_COVERAGE.md behavior:** <ID + full row text>
- **Relevant FlashQuery source (if located):** <pointers to files/functions>

## Recent history of the test file
- Last modified: <git log -1 output>
- Relevant recent commits: <brief list>

## Questions / uncertainties
- <anything about the spec that isn't clear from DIRECTED_COVERAGE.md>
- <anything about FlashQuery behavior that needs to be confirmed>

## Recommended action
- <hand to testgen with direction X | hand to GSD | ask user Y | etc.>
```

Save packets under `tests/scenarios/directed/reports/findings/<YYYY-MM-DD-HHMMSS>-<test_name>.md` so they're grouped with the suite report that produced them. Skip writing packets for passing tests.

**The packet is a closed-loop record, not a write-once snapshot.** The full schema (documented at `tests/scenarios/directed/reports/findings/README.md`) includes `Resolution` sections that start empty at triage time and get filled in by whichever skill picks up the handoff — testgen writes `Test-side resolution`, covgen writes `Spec clarification`, GSD or the user writes `FlashQuery investigation`, the user writes `User-side resolution` for env fixes. Multiple resolution sections can end up populated for a single packet (e.g., a spec ambiguity clarified by covgen that turned into a test bug fixed by testgen).

This skill owns the final step: when re-running (Phase 9) confirms the failure is resolved, fill in the `Final disposition` section with the close date and a one-line outcome, plus any DIRECTED_COVERAGE.md updates that were applied (Last Passing date set, FAIL mark removed, etc.). That's the signal the packet is fully closed.

## GSD integration

If the project has a `/gsd-debug` slash command or agent available, prefer it for any FlashQuery-defect handoff. The findings packet is designed to be exactly what GSD needs to pick up without redoing triage.

**Detecting availability:** check for an agent definition at `.claude/agents/gsd-debug.md` or a slash command at `.claude/commands/gsd-debug.md` (or similar project-local conventions). If present, treat `/gsd-debug` as the preferred route for FlashQuery defects.

**Invoking:** pass the findings packet file path to the GSD agent/command. If GSD expects inline content, paste the packet body directly. Include a clear handoff message — what the failure is, what was already tried, why this skill has concluded it's an FlashQuery defect rather than a test bug.

**If GSD is not available:** present the findings packet to the user and discuss next steps together. The packet content is valuable whether or not there's an agent to consume it — it's the investigation record.

Do not run a long-form FlashQuery source investigation from inside this skill. The boundary is: this skill triages *the failure*; GSD (or the user) investigates *the code*. Crossing that boundary turns this skill into a megaskill.

## Principles

**Never fix code directly.** This skill coordinates. Fixes happen via testgen (test code), GSD or the user (FlashQuery code), or covgen (coverage definitions). This skill edits DIRECTED_COVERAGE.md only to mark `FAIL` on defects and to bulk-update `Last Passing` on clean runs.

**Categorization is a user-approval gate.** No handoff — and especially no handoff to testgen — happens until the user has confirmed the category. The user's "only as long as the test is understood to be broken" principle applies here: testgen should not be asked to modify a test that hasn't been confirmed as broken.

**Batch when root causes are shared.** Three tests failing for the same missing flag is one finding, not three. Name the shared cause, list the affected tests, and let the user approve one batch action.

**Capture everything at triage time.** Memory of the managed server's DB state, server logs, and git state is ephemeral. Grab snapshots while they're fresh. GSD (or a later conversation) shouldn't have to re-run the failing test to see what happened.

**Use dbtools freely for investigation; never for assertions.** The scripts under `dbtools/` are for humans (and this skill) to inspect state. They are explicitly *not* for test assertions — tests assert on FlashQuery's public surface, not the DB. If evidence from dbtools reveals something only the DB knows, that's usually a sign the behavior should be exposed through FlashQuery's public surface (or isn't a scenario concern at all).

**Don't duplicate testgen's debug loop.** Testgen already has a 5-iteration debug loop for test-side fixes, with its own stop-and-ask rule when FlashQuery looks at fault. Hand off and let it do its job.

**OS context goes in every packet.** Cross-platform divergence is a real category of failure. Make it visible from the start rather than discovering it late.

## Related skills

- **`flashquery-directed-testgen`** — where confirmed test bugs and test-fixable environment issues get routed. Has its own debug loop and per-change approval checkpoints.
- **`flashquery-directed-covgen`** — where spec ambiguities and new/modified behavior rows get routed. Owns `DIRECTED_COVERAGE.md` structure.
- **`/gsd-debug` (if available)** — where confirmed FlashQuery defects get routed with a findings packet.

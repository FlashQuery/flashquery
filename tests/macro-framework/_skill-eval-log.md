# Skill Evaluation Log — `flashquery-macro-author`

Calibration runs where we generated a macro from a natural-language description, observed what came out, and recorded any signal that should improve the skill's prompt (or its `macro-spec.md`).

This file is gitignored (`_` prefix). It exists as a working journal to feed into future skill improvements. When patterns recur, they should land in `macro-spec.md` or the SKILL.md as updates.

## Convention going forward

All entries in this log come from **calibration mode** invocations of the skill (`verify: true, auto_correct: false`). This means:

- Verify ALWAYS runs after generation, so we see what the verification step would have caught.
- Mechanical fixes are surfaced as `would_have_been_fixed` rather than applied — we see what the gen step needs to learn to stop making.
- No auto-correction loop fires — we see the raw zero-shot output, which is what an end-user would receive without verification.
- We then manually evaluate "does the macro source achieve the intent? would the fixes-not-applied have changed the outcome? are the algorithmic misses real?" and feed improvements back into `macro-spec.md` or this skill's prompt.

End-user usage of the skill defaults to **validated mode** (`auto_correct: true`) and gets the polished output. End-users don't need to run this calibration loop themselves — we're doing it on their behalf to make the underlying generation prompt better at zero-shot quality.

## Outer-loop protocol — A/B testing of skill prompt changes

Each calibration scenario in this log can have multiple **iterations** as the skill evolves. The protocol:

```
ITERATION 1
  Run scenario through skill (calibration mode) → record macro + report.
  Identify misses / signals.
  Update macro-spec.md or SKILL.md to address the gap.

ITERATION 2
  Run the SAME scenario through the NOW-UPDATED skill.
  Compare to iteration 1:
    - Old misses eliminated?    → improvement confirmed.
    - Old misses still present? → spec edit didn't take; try different framing.
    - New misses appeared?      → spec edit had unintended consequence; revise.

ITERATION N
  Repeat until calibration produces zero algorithmic_misses AND
  zero would_have_been_fixed for the scenario.
```

When a scenario converges (clean zero-shot in calibration mode), it joins the **stable corpus** — a set of descriptions the skill handles cleanly. Adding to the stable corpus is the skill's measurable progress: each new scenario that converges is one more description shape the skill won't regress on.

Whenever we make a structural change to `macro-spec.md` or SKILL.md, we should re-run the entire stable corpus to confirm no scenarios fell out (regression check).

### Entry structure

Each scenario entry contains:

- **Description** (input — never changes across iterations)
- **Iteration N** subsections, each containing:
  - Generated macro (as-is)
  - Verify report summary
  - Calibration findings (what changed vs. prior iteration)
  - Skill edit applied (if any) — link to which section of `macro-spec.md` / SKILL.md was updated
- **Convergence status**: `converged` (clean run achieved, in stable corpus) | `iterating` (still finding misses) | `blocked` (framework limitation or spec ambiguity preventing convergence)

### Stable corpus tracking

When a scenario reaches `convergence: converged`, list it under "Stable corpus" below.

#### Stable corpus

| Run # | Scenario | Iterations to converge | Notes |
|---|---|---|---|
| 1 | Error-recovery / failover (primary → backup) | 2 | Macro source correct on iter 1; iter 2 added integration-context warnings via §11.1/§11.2 |
| 2 | Items pipeline (per-item dispatch + aggregation + summary object) | 2 | Iter 1 macro had reserved-keyword (`done`) as bare object key → parse_error; iter 2 renamed to `completed` after §1.3 expansion in macro-spec.md |
| 3 | Conditional indexing (compound condition with reason tracking) | **1** | **First zero-shot win.** Skill produced clean idiomatic macro using early-exit guards on first attempt. No spec edits needed. Pilots 930/931/932 all pass. |

### Convergence stats

Updated after each run/iteration. The trajectory of these numbers is the skill's measurable quality signal over time.

| Metric | Count | Notes |
|---|---|---|
| Total scenarios attempted | 3 | Runs #1, #2, #3 |
| Converged (clean zero-shot in calibration mode) | 3 | All runs |
| Currently iterating | 0 | |
| Blocked (framework / spec ambiguity) | 0 | |
| **Zero-shot macro-source pass rate** | **2/3 = 67%** | scenarios where the macro source was correct on first attempt — run #1 (failover) and run #3 (conditional) both produced parseable, correct macros first try; run #2 (items pipeline) hit the reserved-keyword-object-key parse error |
| **Zero-shot full-report pass rate** (skill-actionable findings only) | **1/3 = 33%** | scenarios where verify produced no skill-actionable findings on iteration 1 — only run #3 was fully clean. Runs #1 and #2 each surfaced a real skill-actionable miss that drove a spec edit. (Context-informational warnings don't count against this metric.) |
| Avg iterations to convergence | 1.67 | run #1: 2, run #2: 2, run #3: 1 |
| Spec edits driven by calibration | 3 | `macro-spec.md` §11.1, §11.2, §1.3. Run #3 produced no new edits — first stable run. |

#### Trend log

Append a line every time the stats change:

- 2026-05-19: Run #1 iter 1. 0/1 converged. 2 spec edits applied. Iter 2 pending.
- 2026-05-19: Run #1 iter 2 confirmed convergence. 1/1 converged. Stable corpus: 1 entry. Zero-shot macro-source pass rate: 100%. Full-report (incl. warnings) pass rate: 0% — first iteration didn't surface integration warnings; second iteration did.
- 2026-05-19: Run #2 iter 1 — macro produced parse_error at pilot run due to bare `done` as object key. Iter 2 fixed via §1.3 expansion in macro-spec.md (reserved-keyword-as-object-key rule). Run #2 converged. Stable corpus: 2 entries. Zero-shot macro-source pass rate dropped to 50% — the run-#2 miss is real and was caught by calibration mode.
- 2026-05-19: Run #3 (negation / compound condition with reason tracking) — converged on iter 1. **First true zero-shot win.** No spec edits, no mechanical fixes, no algorithmic misses. Stable corpus: 3 entries. Macro-source pass rate climbs to 67%; full-report (skill-actionable) pass rate climbs to 33%. The skill's accumulated spec corpus (3 prior edits) was sufficient for this class of scenario — early-exit guard pattern, truthiness with `!`, `!= null` composing with REQ-112d, all idiomatic.

#### Interpretation

Two pass rates are tracked because they measure different things:

- **Macro-source pass rate**: how often the generated macro is *correct in isolation* on the first try. Measures gen-step quality at synthesizing valid macro semantics. 100% on run #1.
- **Full-report pass rate**: how often the entire calibration report (including warnings) is clean on first try. Measures whether the gen+verify pair anticipates ALL relevant concerns, not just the macro itself. 0% on run #1 because the framework_limitation warnings only surfaced after spec edits.

The first metric matters for end-user UX (the macro works). The second metric matters for skill convergence (the skill anticipates all relevant context). Watching both gives a fuller picture of where the skill stands.

---

## Run #1 — 2026-05-19 — error-recovery / failover pattern

**Convergence status:** CONVERGED — iteration 2 (2026-05-19) produced a clean calibration report; the integration-context warnings now surface at gen time rather than slipping through to the wrap stage.

### Description (what we asked for)

> "I need a macro that tries to fetch data from a primary brokered server. If the primary isn't reachable, fall back to a secondary server. The macro should return an object showing which path it took (`primary` or `backup`), the data it got, and whether the backup was needed. If neither server is reachable, fail the macro with a clear message."

### Iteration 1 — generated macro

```fqm
data = null
path_taken = "none"
backup_needed = false

if primary_srv._exists() then
  data = primary_srv.fetch({})
  path_taken = "primary"
else
  if backup_srv._exists() then
    data = backup_srv.fetch({})
    path_taken = "backup"
    backup_needed = true
  else
    fail "Neither primary_srv nor backup_srv is reachable."
  fi
fi

exit { path: $path_taken, data: $data, backup_needed: $backup_needed }
```

### Verify workflow result (attempt 1)

`pass: true`. No mechanical fixes. One stylistic warning about pre-declarations being optional under REQ-112b.

### Test-pilot wrapping outcome

Three pilots authored (910 happy path, 911 backup path, 912 both fail). Initial run:

- 910 (primary reachable, only primary registered): **FAIL** — production rejects with `unknown_server` at pre-scan because the macro references `backup_srv` (in the unreached else-branch) but it's not registered.
- 911 (backup path, only backup registered): **FAIL** — same reason in reverse.
- 912 (neither registered): **PASS** — no `tools:` block means no registry, so the framework skips pre-scan altogether and runtime executes the `fail` path. (Test passed by a different mechanism than intended.)

### Calibration findings

1. ✅ **Skill correctly chose the `_exists()` preflight pattern** over a try/catch-style runtime recovery (which doesn't exist in v1 per REQ-107 fail-fast). The `macro-spec.md` §7.2 grounding worked.
2. ✅ **Skill correctly leveraged REQ-112b** for branch-local assignments persisting after `fi`.
3. ✅ **Skill correctly used lowercase `false`** for the boolean literal (REQ-112c).
4. ⚠️ **Skill missed a static pre-scan implication.** Production's pre-scan walks ALL tool references in the AST, including in unreached branches. The skill didn't flag that the macro's `tool_surface` requirement is "BOTH servers must be registered, not just the one we expect to run." The skill needed `macro-spec.md` to make this explicit AND the verify workflow needed to extract tool references and compare to declared tool_surface in test-pilot mode.
5. ⚠️ **Framework limitation surfaced.** The FakeBroker conflates "registered" with "reachable" — there's no way to test the failover-backup branch at the framework layer. The macro is correct in production; the framework just can't exercise that path. Future framework affordance needed.

### Actions taken

- Added §11.1 (static pre-scan rule) to `macro-spec.md` with explicit verification-mode guidance.
- Added §11.2 (FakeBroker registered=reachable limitation) to `macro-spec.md`.
- Fixed pilot 910 to register both servers (now passes; tests primary path).
- Fixed pilot 911 to register both servers; documented in pilot's comments that the backup-path assertion is pending framework support; pilot's assertion now matches what actually happens.
- Pilot 912 unchanged; works by an unintended mechanism (no-registry-means-no-prescan) but the runtime `fail` path does fire when both probes return false.

### Iteration 1 — final state

178/178 tests passing (up from 175). Skill-prompt improvements landed in `macro-spec.md` §11.1 and §11.2.

### Iteration 2 — re-run with §11.1 / §11.2 in scope

Re-executed the same description through the skill on 2026-05-19 with `macro-spec.md` §11.1 (static pre-scan walks all branches) and §11.2 (FakeBroker registered=reachable) in scope.

**Macro source:** byte-identical to iteration 1 (it was correct).

**Verify report delta:**

| Finding | Iteration 1 | Iteration 2 |
|---|---|---|
| Mechanical fixes needed | none | none |
| Algorithmic misses | none | none |
| `framework_limitation` — pre-scan tool-reference mismatch (§11.1) | **MISSED** (silent — only surfaced when test pilot ran and failed) | **SURFACED** as warning with concrete suggestion |
| `framework_limitation` — backup-branch untestable due to FakeBroker (§11.2) | **MISSED** (silent) | **SURFACED** as warning with two remediation options |
| Suboptimal: pre-declaration could be dropped under REQ-112b | surfaced | surfaced (unchanged) |

**Skill improvement signal (iteration 2 → log):**

> Iteration 2 surfaces the two framework_limitation warnings that iteration 1 missed. Spec edits §11.1/§11.2 took effect; verification is now catching what previously slipped through to the wrapping stage. No new gaps observed.

**Convergence: CONVERGED.** Run #1 joins the stable corpus.

The macro source generation was correct first-time; the iteration 1 vs. iteration 2 difference is in the *quality of the surrounding diagnostic* the skill produces. End-users running this in validated mode benefit from the warnings being visible at gen time rather than discovered at run time.

### Skill-prompt confidence after iteration 1

| Dimension | Before iteration | After iteration 1 | Notes |
|---|---|---|---|
| Picks idiomatic REQ-112 patterns | Strong | Strong | unchanged |
| Avoids unsupported constructs | Strong | Strong | unchanged |
| Considers test-pilot wrapping constraints | **Weak** | **Improved** | §11.1/11.2 added |
| Verify catches integration gaps | **Weak** | **Improved** | New tool-reference vs tool-surface check spec'd |

---

## Run #2 — 2026-05-19 — multi-step composition (items pipeline)

**Convergence status:** CONVERGED on iteration 2.

### Description

> "I have a list of items in my frontmatter under `items`. For each item, call `processor_srv.process({ item: $item })`. The tool returns a structured value with a `status` field that's either 'done' or 'deferred'. Collect items where status was 'done' into a list, and items where status was 'deferred' into another list. Return a summary object showing both lists and a count for each."

### Iteration 1 — generated macro (FAILED at pilot wrap)

```fqm
done_items = []
deferred_items = []

for item in $_self.frontmatter.items do
  result = processor_srv.process({ item: $item })
  if $result.status == "done" then
    done_items = append $done_items $item
  else
    deferred_items = append $deferred_items $item
  fi
done

exit {
  done: $done_items,
  deferred: $deferred_items,
  done_count: count $done_items,
  deferred_count: count $deferred_items
}
```

**Iteration 1 verify report (calibration mode):** clean — no mechanical fixes, no algorithmic misses. ONE context-informational warning about defensive handling of missing `items` field.

**Why iteration 1 failed at the pilot run anyway:** the exit object literal uses `done:` as a key. The lexer recognizes `done` as the reserved `Done` keyword token, not as `Identifier`, so the object-key grammar (`Identifier | DoubleQuotedString | SingleQuotedString`) rejects it. Production fails with `parse_error / unexpected_token` at line 14.

**The skill missed this; verify missed it too.** This is the EXACT calibration signal we wanted: a real gap that validated mode would have silently auto-corrected. In calibration mode it surfaces, and we update `macro-spec.md` so future generations don't repeat it.

### Spec edit applied (between iteration 1 and 2)

Added a paragraph to `macro-spec.md` §1.3 (Reserved keywords) documenting that reserved keywords cannot be bare object-literal keys. Must be quoted or renamed. Listed `done`, `true`, `else`, etc. as common authoring pitfalls.

### Iteration 2 — re-generated macro (CLEAN)

Renamed object keys to non-reserved names. `done` → `completed`. `done_count` → `completed_count`.

```fqm
done_items = []
deferred_items = []

for item in $_self.frontmatter.items do
  result = processor_srv.process({ item: $item })
  if $result.status == "done" then
    done_items = append $done_items $item
  else
    deferred_items = append $deferred_items $item
  fi
done

exit {
  completed: $done_items,
  deferred: $deferred_items,
  completed_count: count $done_items,
  deferred_count: count $deferred_items
}
```

**Iteration 2 verify report (calibration mode):** clean. No reserved-keyword keys. One context-informational warning unchanged (defensive missing-`items` handling).

**Pilot result:** 179/179 passing. Production parses cleanly, executes correctly, produces the expected output object.

### Skill improvement signal from run #2

The skill's grammar awareness on iter 1 was incomplete: it knew reserved keywords can't be variable names, but didn't extend that to object keys. `macro-spec.md` §1.3 now makes the rule explicit. Future generations producing summary objects with naturally-keyword-named fields (`done`, `else`, `true`, etc.) will quote or rename.

This is a HIGH-VALUE calibration finding because:
- In validated mode, verify would have auto-corrected (renamed or quoted) and the user would never have known the gen prompt missed it.
- The miss is the kind that produces opaque parse errors when an end-user runs the macro — exactly the kind of brittleness calibration mode is designed to surface.
- One spec edit closes the gap for every future macro the skill produces with a similar shape.

### Skill-prompt confidence after run #2

| Dimension | Before run #2 | After run #2 | Notes |
|---|---|---|---|
| Picks idiomatic REQ-112 patterns | Strong | Strong | unchanged |
| Avoids unsupported constructs | Strong | Strong | unchanged |
| Considers test-pilot wrapping constraints | Improved | Improved | unchanged |
| Verify catches integration gaps | Improved | Improved | unchanged |
| Awareness of reserved-keyword positions | **Weak** | **Improved** | §1.3 expanded |

---

## Run #3 — 2026-05-19 — negation / boolean logic heavy (conditional indexing)

**Convergence status:** CONVERGED on iteration 1. First true zero-shot success.

### Description

> "I need a macro that processes a single document from my frontmatter. The document path is at `_self.frontmatter.target_doc`. The macro should call `doc_srv.fetch({ path: $target_doc })` to get the document. It should then apply this rule: process the document ONLY IF the document has a `published` field that is true AND its `archived` field is null. If either condition fails, skip the document and exit with `{ skipped: true, reason: <why> }` where `<why>` says which condition failed. If both conditions pass, call `index_srv.add({ doc: $doc })` to index it, then exit with `{ indexed: true, doc_id: $doc.id }`."

### Iteration 1 — generated macro (CLEAN)

```fqm
target_doc = $_self.frontmatter.target_doc
doc = doc_srv.fetch({ path: $target_doc })

if ! $doc.published then
  exit { skipped: true, reason: "doc is not published" }
fi
if $doc.archived != null then
  exit { skipped: true, reason: "doc is archived" }
fi

index_srv.add({ doc: $doc })
exit { indexed: true, doc_id: $doc.id }
```

**Iteration 1 verify report (calibration mode):**

- Mechanical fixes: none.
- Algorithmic misses: none.
- Warnings: one `framework_limitation` (both brokered servers must be in tool_surface per §11.1) — context-informational, not skill-actionable.

**Three pilot variants exercised:**

| Pilot | Input | Path taken | Result |
|---|---|---|---|
| `mtf-d-930` | published=true, archived=null | both guards pass → index | `{indexed: true, doc_id: "doc-001"}` |
| `mtf-d-931` | published=false | first guard fires | `{skipped: true, reason: "doc is not published"}` |
| `mtf-d-932` | published=true, archived="2026-04-01..." | second guard fires | `{skipped: true, reason: "doc is archived"}` |

All three pass production. 182/182 suite passing after this run.

### Skill improvement signal from run #3

**None.** The skill produced an idiomatic macro on the first attempt:

- Correctly chose early-exit guard pattern over nested conditionals or single compound condition, given the reason-tracking requirement.
- Used truthiness (`! $doc.published`) over explicit boolean comparison (`$doc.published == false`) — more idiomatic.
- Used `!= null` for the archived check, which composes with REQ-112d (missing `archived` → null → passes the not-archived check, treating absent as not-archived).
- Avoided reserved-keyword object keys (`skipped`, `reason`, `indexed`, `doc_id` are all non-reserved) — the run-#2 lesson stuck.
- Bound `target_doc` as a named variable rather than inlining — minor readability win, matched the description's wording.

**No spec edits.** Run #3 is the first datapoint of "the skill's accumulated spec is good enough for this class of scenario."

### Skill-prompt confidence after run #3

| Dimension | Before run #3 | After run #3 | Notes |
|---|---|---|---|
| Picks idiomatic REQ-112 patterns | Strong | Strong | unchanged |
| Avoids unsupported constructs | Strong | Strong | unchanged |
| Considers test-pilot wrapping constraints | Improved | Strong | §11.1 warning surfaced correctly |
| Awareness of reserved-keyword positions | Improved | Strong | applied in this run; no slip |
| Operator precedence + compound conditions | Untested | Demonstrated | first time exercised; produced correct shape |
| Early-exit guard pattern selection | Untested | Demonstrated | naturally chose guards over nested ifs given reason-tracking need |

---

## Strengthen workflow — first calibration (retroactive on run-#3 pilots)

**Convergence status:** CONVERGED on iteration 1. First-time use of the new strengthen workflow in `flashquery-macro-testgen`. Run retroactively against the three run-#3 pilots (930/931/932) as a baseline calibration.

### What the strengthen workflow surfaced

Two `required_assertion_missing` findings, both about side-effect coverage:

1. **Pilot 930 (happy path)** — return-shape assertion didn't bound dispatch count. A regression that takes the happy path WHILE ALSO dispatching to extra tools would pass silently. Suggested: `side_effects.tool_call_count: 2`.
2. **Pilots 931 / 932 (skip paths)** — return-shape assertion didn't prove `index_srv.add` was NOT called. A regression that always dispatches before checking guards would pass. Suggested: `side_effects.tool_call_count: 1`.

Both findings applied to the pilots. Suite still passes 182/182.

### Skill improvement signal for the strengthen workflow

> Wrap step (testgen Steps 1-9) produces correct return-shape assertions but doesn't proactively add side-effect counts for multi-dispatch macros. Convention to bake into the wrap step prompt: when the macro has >1 tool dispatch AND >1 exit path, automatically include `side_effects.tool_call_count` per pilot variant (positive on happy path, negative on skip/fail paths).

This goes in the testgen SKILL.md as a wrap-step convention so future pilots include the side-effect count by default. Then the strengthen workflow's next calibration on a multi-dispatch / multi-exit macro should produce zero findings — proving the wrap step learned.

### Strengthen workflow stats

| Metric | Value | Notes |
|---|---|---|
| Pilots analyzed | 3 | 930, 931, 932 |
| Findings surfaced | 2 (one for 930, one shared by 931/932) | Both `required_assertion_missing` axis: side_effect_coverage / negative_assertion |
| Auto-applied (would be in validated mode) | 2 | Both severity `required_assertion_missing` |
| Surfaced-only (would be in validated mode) | 0 | No `recommended_assertion` or `style` findings |
| Pilots that strengthened | 3/3 | All three got at least one side-effect-count addition |
| Test suite state post-strengthen | 182/182 pass | No regressions; assertions are stricter |

### Convention going forward

Every smoke-test run from #4 onward runs strengthen-in-calibration-mode after the author skill + wrap. The strengthen findings get logged alongside the author findings. When patterns recur (e.g., "wrap step always misses side-effect counts for multi-dispatch macros"), the wrap-step SKILL.md gets an edit — same pattern as `macro-spec.md` evolves from author calibration.

## Strengthen workflow — backfill on earlier smoke-test corpus (2026-05-19)

After the workflow's first calibration validated against pilots 930/931/932, we backfilled the earlier smoke-test pilots that had `intent:` fields. Goal: bring the entire corpus to the new rigor standard.

### Backfilled pilots

| Pilot | Macro shape | Path taken at runtime | `tool_call_count` added | Defect class caught |
|---|---|---|---|---|
| 910 (failover primary) | 2 mutually-exclusive dispatches | primary path | 1 | Regression dispatching backup before guard |
| 911 (failover backup) | Same; both servers registered (FakeBroker limit) | primary path | 1 | Same — regression dispatching backup |
| 912 (failover both fail) | `fail` before any dispatch | n/a (fail) | 0 | Regression dispatching before the fail |
| 920 (items pipeline) | Per-item dispatch | 3 items → 3 dispatches | 3 | Regression that skips items or dispatches extra times per item |

### Result

- All four pilots accepted the strengthening with no further changes.
- Suite state: 182/182 passing (unchanged count; pilots strictly more rigorous).
- The entire smoke-test corpus (7 pilots: 910/911/912/920/930/931/932) now uniformly has `intent:` + `side_effects.tool_call_count`.

### What the backfill tells us about the workflow

- The strengthen workflow correctly identified the same kind of missing assertion across every pilot we ran it against. Consistency suggests the side-effect-coverage axis is the highest-yield rigor check; that aligns with the wrap-step convention now baked into the testgen SKILL.md.
- No false positives — every finding was actionable and the suggested change was correct.
- Backfilling was bounded (4 pilots, under 5 minutes) — the workflow is cheap to run retroactively on existing pilots.

### What's NOT in this backfill

The strengthen workflow could in principle be run against the entire 175+ pilot corpus, including hand-authored pilots that pre-date this conversation. Several would surface findings (especially multi-dispatch / multi-exit macros without side-effect counts). That's a separate audit, deferred until the workflow's prompt is more mature — better to refine the workflow on a small set first, then scale.

---

## Golden-capture backfill — 7 smoke pilots (2026-05-19)

**Trigger.** User flagged a real architectural gap: the calibration runs had been bypassing the golden model and using AI-predicted `expect:` values directly. Per §5.6 (golden-as-snapshot) the golden is the framework's independent oracle. By skipping it, our pilots were running with AI-as-oracle — if AI prediction and production agreed but were both wrong, the test would pass silently.

**Action.** Ran each of the 7 smoke pilots through `captureSnapshot()` from the golden model. Compared captured envelope against the AI-predicted `expect:`. Recorded reconciliation outcomes.

**Per-pilot results:**

| Pilot | predicted_matched_captured | Notes |
|---|---|---|
| 910 (failover, primary) | ✓ | exact match |
| 911 (failover, "backup intent") | ✓ | exact match (both predicted primary path due to FakeBroker limit) |
| 912 (failover, both unreachable) | ✗ | **PRODUCTION SPEC DEVIATION** (per REQ-028 ac1+ac5, INV-07) — golden is spec-correct, production bypasses pre-scan when invoked without a registry. AI prediction matched production (incorrect path). Filed as production gap PG-001. |
| 920 (items pipeline) | ✗ | **GOLDEN PARSER GAP** (per REQ-011 ac4 "Values are any expression") — golden's `objectEntry` rule rejects pipelines (`count $list`) in object-literal value position; production correctly accepts the form per spec. Logged as a golden gap. |
| 930 (conditional, happy) | ✓ | exact match |
| 931 (conditional, skip not-published) | ✓ | exact match |
| 932 (conditional, skip archived) | ✓ | exact match |

**Findings from the backfill — three distinct calibration signals:**

1. **5/7 cases — clean reconciliation.** AI prediction matched golden capture exactly. The skill's mental model of the language was right for failover happy path + conditional indexing variants.

2. **Pilot 912 — PRODUCTION spec deviation (NOT framework asymmetry).** Initial classification of "neither is buggy, just architecturally asymmetric" was **wrong** — Matt pushed back that I should always check the spec before classifying golden-vs-production divergences. Spec verification:
   - **REQ-028 ac1**: "The pre-scan MUST walk the entire AST … collecting every `(server, tool)` tuple."
   - **REQ-028 ac5**: "The pre-scan MUST run after parse but before any statement executes. No partial side effects on permission failure."
   - **INV-07**: "The macro engine MUST NOT execute any tool call when the permission pre-scan finds a denied or unknown tool reference."
   
   The golden is spec-correct. **Production via the framework's null-registry path bypasses pre-scan altogether**, executes `primary_srv._exists()` (which the FakeBroker treats as a registered tool), then takes the `fail` runtime path. Per REQ-028+INV-07 it should have refused at pre-scan with `unknown_server` because neither `primary_srv` nor `backup_srv` is registered. Pilot 912 was passing for the wrong reason — its `expect.outcome: macro_aborted` matched production's runtime path, but the spec requires a pre-scan rejection. Filed as production gap **PG-001** in `PRODUCTION_GAPS.md`.

3. **Pilot 920 — GOLDEN parser gap, NOT a framework or production gap.** Initial classification was right by accident, but I should have cited the spec. Spec verification:
   - **REQ-011 ac4**: "Object literals MUST accept `{ key: value, ... }` … Values are any expression."
   
   Production accepts `count $list` as an object-literal value because pipelines are expressions; the golden's `objectEntry` rule only accepts `primary` for value position. **Golden is the lagging implementation**; future patch to extend `objectEntry` value rule. Workaround: pilots can pre-compute pipeline values into named variables before exit if they need golden parity.

**Lesson learned (saved to memory as `golden_vs_production_check_spec_first.md`):** when AI/golden/production diverge, the spec is the tiebreaker — don't default to "production wins" or "neither is buggy." Always look up the REQ before classifying.

**Subsidiary fix made during the backfill:**

When running the capture script, the golden rejected pilots 920/930/931/932 with `parse_error` near `.` — the symptom of a regression I introduced earlier when adding REQ-112a's VarRef-server-slot to the `toolCall` grammar gate. The gate matched `VarRefTok Dot Identifier` and committed to `toolCall`, choking on the next Dot (chained field access). Fixed by adding `LA(4) === LParen` to the three toolCall gate sites — disambiguates `$obj.tool(...)` from `$obj.a.b` cleanly. After the fix, the captures succeeded for the 5 clean pilots.

### Skill-prompt confidence after backfill

| Dimension | Before backfill | After backfill | Notes |
|---|---|---|---|
| AI prediction matches golden | Untested (skipping the gate entirely) | **5/7 = 71% match rate on first measurement** | Calibration baseline established |
| Golden parser correctness | Assumed OK | Two bugs surfaced (LA(4) gate + pipelines-in-objectEntry) | One fixed in this pass; one logged |
| Framework architecture coherence | Assumed OK | Framework's no-tools-block bypass is asymmetric with golden | Logged as a future framework refactor |

### Stats trajectory

Adding two new top-line metrics:

- **AI⟷golden agreement rate**: 5/7 = 71% on initial measurement (after fixing the LA(4) regression). Trend going forward: should climb as the skill's prompt refines.
- **Golden-parser bug count**: 2 (LA(4) regression — FIXED; pipelines-in-objectEntry — logged).

### Convention going forward

Every smoke-test run from run #4 onward executes the full 5-step pipeline (per testgen SKILL.md):

1. author.generate → macro
2. author.verify → "is the macro what was asked for?"
3. testgen.wrap → draft pilot + predicted_expect
4. testgen.strengthen → rigor findings
5. testgen.golden_capture → reconciliation gate
6. Run production against golden-verified expect

The reconciliation gate is mandatory. AI prediction is a checkpoint; golden capture is the source of truth; AI ⊆ golden is OK, AI ⊥ golden is a hard stop until resolved.

---

## Run #4 — _(pending)_

Next smoke-test scenario TBD. From run #4 onward, calibration runs use the full 5-step pipeline including reconciliation gate.

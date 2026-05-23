# FlashQuery Audit Output Template

**Role:** Bundled reference for the `flashquery-codebase-audit` skill — the output
contract: the document set, the per-finding schema, and the independent-review
annotation convention. The Report and Independent Review workflows follow this
precisely.
**Last updated:** 2026-05-23

---

## Contents

- Purpose
- Principles of the output format
- Part 1 — Output location & document set
- Part 2 — The finding block (template)
- Part 3 — Field guide
- Part 4 — Worked example
- Part 5 — Test awareness
- Part 6 — How AI fix-agents consume this
- Part 7 — Independent-review annotations and audit history
- Open items / to expand

---

## Purpose

The audit produces a report. That report is **not just a human-readable list of
problems** — it is an instruction set that AI fix-agents will work from to repair
the code. This document defines how findings must be codified so that an agent
can pick up any finding and act on it without re-investigating.

A finding that only says *what is wrong* is incomplete. Every finding must also
say **how to fix it**, **which tests relate to it**, and **how to verify the
fix** — including any new tests that must be written.

---

## Principles of the output format

1. **Every finding is self-contained.** An agent should be able to act on one
   finding without reading the rest of the report.
2. **Diagnosis *and* remediation.** Naming the problem is half the finding; the
   concrete fix is the other half.
3. **Test-aware by construction.** Each finding names the existing tests to
   rerun and the new tests to add. The fix-agent inherits a test plan rather
   than reconstructing one.
4. **Actionable, not vague.** "Improve error handling" is not remediation.
   "Narrow the caught value with `instanceof Error`, log at error level, rethrow
   with `{ cause }`" is.
5. **Honest about confidence.** Findings are marked *Confirmed* or *To verify*
   (see `audit-method.md`). An agent treats *To verify* findings as
   investigate-first.

   *Note on terminology:* the finding's `Confidence` field (Confirmed / To
   verify) is the **producer's** statement of whether the finding was verified
   against the code. Independent Review's `Verdict` field (also has a
   `Confirmed` value — see Part 7) is a separate concept: it is the
   reviewer's judgement that the finding as written is correct. They share
   the word but operate on different scopes; an IR verdict does not change
   the finding's Confidence field.
6. **Traceable.** Every finding links back to the rule or standard it relates to
   and carries a stable ID for tracking across audit runs.

---

## Part 1 — Output location & document set

### Where the output goes

By default the audit writes to a dated subfolder under the FlashQuery Tech Debt
folder:

`flashquery-product/Roadmap/Tech Debt/Codebase Audit (DD-MMM-YYYY)/`

— for example, `Codebase Audit (19-May-2026)/`. The skill **must ask the user for
the output location at the start of a run if it has not been specified**, and
offer this path as the default. The location must be known *before* Sweep runs
(Sweep writes raw tool outputs and the inventory to `<output-folder>/_working/`),
so the orchestrator establishes the folder up front and Sweep inherits it.

**Scoped audits** — when the user limits scope to a subdirectory (e.g.
`src/mcp/` only), tag the folder name with the scope so it doesn't collide
with a future full-repo audit on the same date:
`Codebase Audit src-mcp (DD-MMM-YYYY)/`. The slug is `<scope>` with `/` and
spaces replaced by `-`.

### A document set, not one file

A whole-codebase audit is too large for one file. Each run produces a set of
documents inside its dated folder:

| File | Contents |
|---|---|
| `Audit Summary.md` | Entry point — metadata header (audit date, repo(s) and commit/branch, tool versions, who ran it), **document-level Audit history section** (one line per pass — Original, Verify, Independent review N — see Part 7), executive summary, scope & assumptions, risk heatmap, finding counts by severity and category, remediation roadmap, and links to the findings files. |
| `Findings.md` | Every finding as a block (Part 2), grouped by severity, Critical first. Each finding ends with its per-finding `**Audit history**` block (Part 2 + Part 7). Split into `Findings — Critical.md`, `Findings — High.md`, and so on when a single file would be unwieldy. |
| `Accepted Debt.md` | Baselined findings, listed separately, not counted as new debt. |
| `Appendix — Tool Output.md` | Raw mechanical-tool output, for traceability. Points at the audit's `_working/` directory, which holds the producer's structured inventory and raw tool outputs (consumed by Independent Review for spot-checks). |

`Audit Summary.md` is the human entry point and the document an `fq-devspec` run
ingests as research input. The findings files are what AI fix-agents consume.

**Scope & assumptions**, inside `Audit Summary.md`, must state what was audited,
what was skipped, environment limitations, and which checks were incomplete
because credentials or local services were unavailable.

---

## Part 2 — The finding block (template)

Copy this block for each finding. Keep field names and order exact — the
consistency is what lets an agent (or an orchestrator) parse the report.

```markdown
### [ID] — [One-line title]

- **Category:** [A–S, from the audit taxonomy]
- **Severity:** [Critical | High | Medium | Low]
- **Effort:** [Quick | Moderate | Large]
- **Blast radius:** [Single file | Module | Workflow | Product surface]
- **Confidence:** [Confirmed | To verify]
- **Location:** [repo/path/to/file.ts:line — list every relevant location]
- **Detection source:** [tool command, grep pattern, AI review, external reference]

**Diagnosis — what is wrong**
[Precise description of the problem, specific enough that the reader does not
need to re-investigate to understand it.]

**Why it matters**
[The concrete risk or impact if left unfixed.]

**Standard reference**
[The section of typescript-standard.md or the named rule this relates to,
if applicable. Otherwise "n/a".]

**External reference**
[MCP spec, OWASP LLM/MCP Top 10, OpenTelemetry, or another source that shaped
the rule. Use "n/a" for purely local conventions.]

**Remediation — how to fix it**
[Concrete, ordered steps an AI fix-agent can execute. Name the functions,
patterns, and APIs involved. Include a code sketch where it removes ambiguity.]

**Open questions** — *include only if the fix turns on a genuine product-scope or
product-behavior decision; omit this field entirely otherwise*
[Do NOT raise implementation or architecture choices here — those are the
fix-agent's to make. Raise only decisions about how the product should behave.
Keep them few. For each:]

- **Q:** [the product-behavior question]
  - **Options:** [the viable ways to handle it]
  - **Recommendation:** [the recommended option, and the FlashQuery precedent it
    is based on; include any references to requirements docs + sections as necessary.]

Once Matt answers an open question — he writes a comment under it in the findings
document — the **Resolve** workflow folds the decision into *Remediation* and
rewrites the OQ into its compact resolved form (see `workflows/resolve.md`).

**Related tests — must be rerun**
[Existing test files/cases that exercise this code and must pass after the fix.
If none exist, state that explicitly — the absence is itself a gap.]

**New tests needed**
[Test cases to add so the fix is locked in and the original defect cannot
regress. Classify each by test layer — unit, integration, E2E, directed scenario,
integration scenario — so the set maps onto an fq-devspec Test Plan. Note any
COVERAGE.md matrix point involved; flashquery-testgen is the route to author FQC
scenario tests.]

**Verification — how to confirm the fix**
[The checks that prove the fix is complete and correct: commands to run, tests
that must pass, manual confirmation steps.]

**Dependencies / ordering**
[Finding IDs that must be fixed first, or that this finding blocks. "None" if
independent.]

**Risk of fix**
[What the fix-agent should watch for — shared code paths, callers depending on
current behavior, etc.]

**Rollback / fallback**
[How to back out or mitigate if the fix causes a regression. For config,
schema, packaging, and runtime findings, state whether rollback requires a
migration or user-visible change.]

**Audit history**
- [YYYY-MM-DD] — Original ([Model name]): created.
[Append one line per subsequent pass that changes this finding — see Part 7
for the full convention (Verify, Independent review, verdicts, Disputed flag).]
```

---

## Part 3 — Field guide

- **ID** — stable and unique, e.g. `FQ-AUDIT-0042`. Never reused; survives across
  audit runs so a finding can be tracked until resolved.
- **Category** — one letter from the `audit-method.md` taxonomy (A–S).
- **Severity / Effort / Confidence** — as defined in `audit-method.md`.
- **Blast radius** — how broadly the defect can affect the system:
  Single file, Module, Workflow, or Product surface. A low-effort finding with
  Product surface blast radius should usually outrank a similar local cleanup.
- **Location** — `repo/path:line`. List all sites for the same underlying issue
  rather than filing near-duplicates.
- **Detection source** — the evidence trail: a command and output summary,
  grep pattern, AI-read file set, or external standard that produced the
  finding.
- **Diagnosis** — the *what*. Factual, specific, no remedy yet.
- **Why it matters** — the *so what*. Connects the diagnosis to real risk.
- **Standard reference** — the *rule*. Anchors the finding to the agreed
  standard so the fix is principled, not ad hoc.
- **External reference** — records where the rule comes from when it is not just
  a local preference. This is especially important for MCP, LLM, telemetry,
  security, and packaging findings.
- **Remediation** — the *how*. The most important field. Written so a competent
  agent needs no further context. A code sketch is encouraged.
- **Open questions** — *conditional.* Present only when the fix turns on a
  product-scope or product-behavior decision the agent should not make alone.
  Each question carries its options and a recommended answer grounded in
  FlashQuery precedent, so Matt can decide quickly without doing developer or
  architect work. Implementation and architecture choices are *not* open
  questions — the fix-agent owns those. Most findings will have none, and that
  is expected. These map onto `fq-devspec`'s batched gap pass.
- **Related tests** — existing coverage that must be rerun. Pre-populated so the
  fix-agent does not have to discover it.
- **New tests needed** — coverage to add. See Part 5.
- **Verification** — the *done check*. The fix is not finished until these pass.
- **Dependencies / ordering** — lets an orchestrator sequence fixes correctly.
- **Risk of fix** — guards against the fix introducing a new problem.
- **Rollback / fallback** — forces the report to consider operational recovery,
  especially for migrations, release packaging, CLI behavior, and MCP contracts.
- **Audit history** — the running ledger of which passes have touched this
  finding. Report writes the first line (`Original`) when it creates the
  finding. Verify and Independent Review append lines per the convention in
  Part 7. The history is what makes the finding a single source of truth
  while still preserving provenance — a reader sees the current state of the
  finding and can trace how it got there.

---

## Part 4 — Worked example

Modelled on the motivating bug — a `catch` that ran but never surfaced the error.
Paths are illustrative.

```markdown
### FQ-AUDIT-0001 — catch block in vault indexer swallows error without surfacing

- **Category:** A — Error handling & failure surfacing
- **Severity:** Critical
- **Effort:** Quick
- **Blast radius:** Workflow
- **Confidence:** Confirmed
- **Location:** flashquery/src/vault/indexer.ts:148
- **Detection source:** AI review of catch blocks flagged by grep pattern `catch`

**Diagnosis — what is wrong**
The `catch` block around the per-file index operation binds the error to a
variable that is never used. The error is not logged, not rethrown, and not
returned. A failure indexing any file is silently discarded and the loop
continues, so partial-index failures are invisible at runtime.

**Why it matters**
Files can silently fail to index with no signal anywhere. The vault appears
healthy while returning incomplete results. This is the exact class of silent
failure that prompted the audit.

**Standard reference**
typescript-standard.md → "Error handling in try/catch" (catch blocks that
handle without surfacing; narrow before use).

**External reference**
OpenTelemetry semantic conventions for recording operation failures without
dropping error classification.

**Remediation — how to fix it**
1. Narrow the caught value: `if (error instanceof Error) { ... }`.
2. Log at error level via the project logger, including the file path and the
   original error.
3. Apply the failure contract chosen in Open question Q1 — but do not continue
   silently regardless of which option is chosen.
4. Ensure the index run's return value reflects the outcome.

**Open questions**
- **Q1:** When a single file fails to index, should the whole index run abort,
  or continue and report partial failure?
  - **Options:** (a) abort the run and surface the error immediately; (b)
    continue, collect the failed files, and return a typed partial-failure
    result the caller can inspect.
  - **Recommendation:** (b). FlashQuery precedent favors partial-success results
    over hard aborts for batch vault operations, so one bad file does not block
    the rest of the index. Confirm this matches the indexer's intended contract.

**Related tests — must be rerun**
flashquery/tests/vault/indexer.test.ts. Note: no existing case covers the
per-file failure path — that gap is why this bug survived.

**New tests needed**
Add an *integration*-layer test that forces a single file to throw during
indexing and asserts (a) the error is logged and (b) the run surfaces the failure
via its return value or a thrown error. If this also maps to a COVERAGE.md point
for the indexer, add a *directed scenario* test via flashquery-testgen and update
the matrix.

**Verification — how to confirm the fix**
`npm run typecheck` and `npm run lint` clean; the new indexer failure test
passes; manually corrupt one vault file and confirm the failure appears in logs
and in the run result.

**Dependencies / ordering**
None.

**Risk of fix**
Check callers of the index run — if any assume it never throws, the rethrow
option will need their handling updated.

**Rollback / fallback**
If aborting the index run breaks callers, keep the log-and-accumulate behavior
temporarily and file a follow-up to update callers to handle typed partial
failure.

**Audit history**
- 2026-05-19 — Original (Claude Opus 4.7): created.
```

After Verify amends the line number from `:148` to `:152` and the Independent
Review (different model) confirms with an enhancement, the same finding's
history block grows to:

```markdown
**Audit history**
- 2026-05-19 — Original (Claude Opus 4.7): created.
- 2026-05-19 — Verify (Claude Opus 4.7): corrected location line `:148` → `:152`.
- 2026-05-20 — Independent review (Claude Sonnet 4.6): Enhanced. Added
  `flashquery/src/vault/indexer.ts:201` (second catch block in same loop)
  to the location list; added integration test for the second site to
  *New tests needed*.
```

---

## Part 5 — Test awareness

Matt's standing rule: **a fix is not complete until its tests are in place** —
tests ship with the change, never deferred. The finding template enforces this
by making tests a required part of every finding, not an afterthought.

Each finding carries three test obligations:

1. **Rerun related tests.** The finding names the existing tests that exercise
   the affected code. The fix-agent reruns them and they must pass.
2. **Add new tests.** Every fix ships with tests that (a) prove the new
   behavior and (b) cover the gap the defect slipped through — if a test had
   existed there, the bug would not have. The finding specifies what those tests
   should assert.
3. **Update the coverage matrix.** If the fix touches a `COVERAGE.md` point,
   update it; author new FQC scenario tests through the `flashquery-testgen`
   skill.

Pre-populating obligations 1 and 2 in the finding means the fix-agent inherits
the test plan instead of reconstructing it — and means the audit, not the agent,
is accountable for noticing the missing coverage.

---

## Part 6 — How AI fix-agents consume this

The intended loop, once the audit skill and a fix workflow exist:

1. An orchestrator (or Matt) selects findings by priority, respecting
   **Dependencies / ordering**.
2. The fix-agent reads one finding block — self-contained by design.
3. If the finding carries unresolved **Open questions**, it is not auto-fixed —
   Matt answers them and the **Resolve** workflow folds the decisions in first
   (see `workflows/resolve.md`). Once the open questions are in resolved form,
   the fix-agent applies **Remediation**, consulting **Standard reference** for
   the principle behind the fix.
4. It reruns **Related tests** and adds **New tests needed**.
5. It runs **Verification**; the finding is done only when these pass.
6. The finding is marked resolved; the next audit run confirms it is gone.

---

## Part 7 — Independent-review annotations and audit history

The Independent Review workflow (see `audit-method.md`) has a *separate*
language model re-examine the finished output. Its conclusions are folded
**into the existing documents** so each finding remains a single source of
truth; a per-finding **Audit history** block at the bottom of every finding
preserves the provenance of who changed what and when.

The same convention applies to the audit's own Verify pass — any change Verify
makes to a finding gets logged in that finding's Audit history block. The
producer's original pass also gets a "created" history line. The history is the
audit's running ledger for that finding across passes and across models.

### Verdicts an independent reviewer can issue

Every existing finding gets one of four verdicts:

| Verdict | Meaning | What folds in | What stays separate |
|---|---|---|---|
| **Confirmed** | Finding is correct and complete as written. | Nothing — the body is unchanged. | — |
| **Enhanced** | Finding is correct; the reviewer is adding to it. | The additions — extra locations, missing tests, sharper remediation, additional standard reference — go directly into the relevant fields of the finding body. | — |
| **Amended** | Finding is wrong on some specific detail. | The correction — corrected severity, location, line number, category, diagnosis, or remediation — replaces the wrong value(s) in the finding body. | — |
| **Disputed** | Finding should not exist; the diagnosis is wrong at its root. | **Do not fold.** Add a top-of-finding flag (see below); the original finding body stays verbatim pending resolution. | The entire finding stays as-is, contested. |

`Confirmed` and `Enhanced` differ in whether the reviewer added anything;
`Amended` and `Disputed` differ in scope of disagreement (a detail vs. the
whole finding). When in doubt between Amended and Disputed: if the *location*
is right and the *category* is right but the *details* are wrong, Amend. If
the location, category, or root diagnosis is wrong, Dispute.

### The per-finding Audit history block

Append at the bottom of every finding. Each pass that touches a finding
appends one line. Format:

```markdown
**Audit history**
- [YYYY-MM-DD] — [Pass type] ([Model name]): [What this pass did].
```

`[Pass type]` is one of: `Original`, `Verify`, `Independent review`, `Resolve`,
`Devspec handoff`. For **Original**, the line records that the finding was
created. For **Verify**, record only if Verify changed something (no entry
needed if it just confirmed). For **Independent review**, always record a line —
even Confirmed verdicts get a history entry so the audit shows that a second
pass examined the finding and agreed. For **Resolve**, record a line on every
finding whose open question it folded in and resolved. For **Devspec handoff**,
record a line on every finding that was specced — it captures the originating
REQ ID(s) and the Requirements document path (see
`workflows/devspec-handoff.md`).

Examples:

```markdown
**Audit history**
- 2026-05-23 — Original (Claude Opus 4.7): created.
- 2026-05-23 — Verify (Claude Opus 4.7): corrected cast site count 9 → 8;
  corrected proportional wording in diagnosis ("five of the nine" → "six of
  the eight").
- 2026-05-24 — Independent review (Claude Sonnet 4.6): Confirmed.
```

```markdown
**Audit history**
- 2026-05-23 — Original (Claude Opus 4.7): created.
- 2026-05-24 — Independent review (Claude Sonnet 4.6): Enhanced. Added
  `mcp/utils/document-output.ts:539` to the location list; added unit test
  for the `WeakMap` retrieval path under *New tests needed*.
```

```markdown
**Audit history**
- 2026-05-23 — Original (Claude Opus 4.7): created.
- 2026-05-24 — Independent review (Claude Sonnet 4.6): Amended. Severity
  downgraded High → Medium because the scanner's EMBED-DRAIN backstop is
  more complete than the original finding allowed; remediation reordered.
```

### Disputed verdict — the top-of-finding flag

Disputed is the one case that does **not** fold. Add a blockquote flag at the
very top of the finding (before the metadata fields), and append a history
line as usual. The original finding body stays verbatim until Matt decides.

```markdown
### FQ-AUDIT-NNNN — [original title]

> ⚠️ **Contested by independent review.** Claude Sonnet 4.6 on 24-May-2026
> concluded this finding should not exist. See *Audit history* at the bottom
> for the reviewer's reasoning. Original finding body kept verbatim pending
> resolution.

- **Category:** [original — unchanged]
...
[original finding body — unchanged]

**Audit history**
- 2026-05-23 — Original (Claude Opus 4.7): created.
- 2026-05-24 — Independent review (Claude Sonnet 4.6): Disputed. The cited
  pattern at `src/x/y.ts:42` is a deliberate FlashQuery convention documented
  in `docs/ARCHITECTURE.md#section`. The original diagnosis treats it as a
  bug; in context it is intended behavior. Recommend closing as
  not-a-finding.
```

### Adding a net-new finding

A finding the original pass missed is written as a normal finding block
(Part 2), with two differences:

- Its ID comes from the `FQ-AUDIT-IR-NNNN` range so its origin is obvious at
  a glance. **NNNN is a separate counter** that starts at `0001` for the
  first net-new IR finding in this audit (independent from the `FQ-AUDIT-NNNN`
  sequence the producer used). If multiple Independent Review passes happen
  on the same audit by different models, all IR-added findings share the
  single `FQ-AUDIT-IR-NNNN` counter — IDs are never reused across reviewers.
- Its *Detection source* names the independent review and the model that
  found it.
- Its Audit history starts with a single line attributing it to the review:
  ```markdown
  **Audit history**
  - 2026-05-24 — Original (via Independent review, Claude Sonnet 4.6):
    created. Gap-analysis pass against {category group} surfaced this.
  ```

### Updating `Audit Summary.md`

After annotating, the reviewer updates `Audit Summary.md` in three places:

1. **Audit history section** (top of the document, after Metadata). Add one
   line per pass: `[date] — [Pass type] ([Model name]): [one-sentence
   summary].` This is the document-level mirror of the per-finding history
   and tells anyone opening the audit immediately that multiple passes have
   touched it.

2. **Finding counts + risk heatmap** — recompute to reflect the combined
   view including any new findings (`FQ-AUDIT-IR-NNNN`), any severity
   amendments, and any Disputed findings (which still count, but get an
   asterisk in the heatmap so the contested status is visible at a glance).

3. **Counts by primary category** — same recompute.

The audit's conclusions are then the merged result of every pass — single
source of truth in each finding, full provenance in the history blocks and
the document-level Audit history.

---

## Open items / to expand

- **Format decision:** findings are prose Markdown with bolded field labels
  (greppable, human-readable). If an orchestrator needs to queue findings
  programmatically, add a YAML/JSON frontmatter block per finding for the
  structured fields. Decide when the fix workflow is designed.
- **Closure tracking:** how resolved findings are logged, and whether the audit
  keeps a running ledger across runs.
- **Pipeline integration:** whether findings also become FlashQuery pipeline
  captures (deferred earlier — report-only for now).
- **Severity of the fix vs. the finding:** a Quick-effort finding may still
  carry a high *risk of fix*; consider whether risk deserves its own rating.

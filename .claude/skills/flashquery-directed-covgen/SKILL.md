---
name: flashquery-directed-covgen
description: Analyze FlashQuery features, capabilities, specs, or change descriptions and propose additions, modifications, or removals to the directed scenario testing DIRECTED_COVERAGE.md matrix. Use this skill whenever the user wants to update the directed coverage matrix, evaluate new FlashQuery functionality for test coverage, review a spec/PR/feature description against DIRECTED_COVERAGE.md, asks "what behaviors should we test for X", "does the coverage matrix need updating", "analyze these features for coverage", "add these to DIRECTED_COVERAGE.md", "review this for coverage gaps", or hands you any document, diff, or description of FlashQuery functionality and asks what directed scenario coverage it implies. Even casual mentions like "should we cover this?", "let's update COVERAGE", or "do we have test points for this?" should trigger this skill. This is the sister skill to flashquery-directed-testgen — covgen defines WHAT behaviors belong in the matrix; testgen writes the tests that exercise them.
---

# FlashQuery Directed Coverage Generator (flashquery-directed-covgen)

This skill takes information about FlashQuery features, capabilities, specs, diffs, or change descriptions and proposes updates to the directed scenario testing coverage matrix at `tests/scenarios/directed/DIRECTED_COVERAGE.md`. It is the planning counterpart to `flashquery-directed-testgen`: covgen decides which behaviors belong in the matrix, testgen writes the scenario tests that exercise them.

The output of this skill is a set of edits to `DIRECTED_COVERAGE.md` — new behavior rows, modifications to existing rows, and soft-deleted rows for behaviors that no longer apply — produced through a deliberate, user-in-the-loop workflow.

## When to use

Use this skill any time the user wants to reason about whether FlashQuery's directed coverage matrix reflects current functionality. Typical triggers:

- "Here's a new feature spec — what should we add to DIRECTED_COVERAGE.md?"
- "I just refactored memory archival, does the matrix need updating?"
- "Review this PR description and tell me what test behaviors it implies."
- "We removed the old recall-by-tag tool — clean up DIRECTED_COVERAGE."
- "What behaviors should we add for the new search modes?"

If the user just wants to write a test for an *existing* coverage point, that's `flashquery-directed-testgen`, not this skill.

## Inputs

The user will typically provide one or more of:

- A feature description, spec, or design doc
- A diff, PR description, or commit message
- A list of new tools, parameters, or capabilities
- A verbal description of a change
- A path to a file containing any of the above
- **A findings packet from `flashquery-directed-run`** when a suite run surfaced a spec ambiguity — a failure that's been user-confirmed as "neither the test nor FlashQuery is clearly wrong; the behavior needs to be pinned down first." Findings packets live at `tests/scenarios/directed/reports/findings/<timestamp>-<test>.md` and the schema is documented at `tests/scenarios/directed/reports/findings/README.md`. When handed a packet, the `Questions / uncertainties` section tells you what needs clarifying, and the `Spec reference` section points at the existing (ambiguous) DIRECTED_COVERAGE.md row(s). Use that as the starting point for a modification proposal rather than treating it as an open-ended spec-from-scratch task.

  When you complete a packet-driven clarification, close the loop by filling in the packet's `Spec clarification` section with what was clarified, which DIRECTED_COVERAGE.md rows were added/modified/removed, and what the original failure's re-categorization is now that the spec is pinned down. If the re-categorization turns it into a test bug or FlashQuery defect, note the intended destination for the follow-up hand-off, but don't write `Final disposition` yet — leave that for whoever resolves the underlying failure. The point is that future readers of the packet see a coherent story: "this was ambiguous, we clarified it this way, and then X happened."

If the input is ambiguous or thin, ask the user to clarify what changed and where the authoritative description lives before proceeding.

## The DIRECTED_COVERAGE.md document

The coverage matrix lives at `tests/scenarios/directed/DIRECTED_COVERAGE.md` relative to the FlashQuery repo root. The full path on this machine is typically:

```
/sessions/admiring-beautiful-mccarthy/mnt/FlashQuery/flashquery-core/tests/scenarios/directed/DIRECTED_COVERAGE.md
```

If you can't find it there, ask the user where it is before continuing — do not guess and do not write a new one.

The matrix is organized into numbered category sections (Documents, Collections, Operations, Search, Search Advanced, Memory, Plugins, Tools, Folders, Backups, Cross-cutting, Git Behaviors, etc.). Each category has a table with the columns:

```
| ID | Behavior | Covered By | Date Updated | Last Passing |
```

IDs use a category-specific prefix and an incrementing number: `D-01`, `D-02`, … for Documents; `C-01`, … for Collections; `O-`, `S-`, `SA-`, `M-`, `P-`, `T-`, `F-`, `B-`, `X-`, `G-` for the others. Behavior titles are short and declarative ("Soft delete via `archive_document`", not paragraphs).

## What belongs in the directed scenario coverage matrix

Directed scenario tests in FlashQuery are end-to-end: they spin up a real FlashQuery server, talk to it through the public client/tool surface, and verify outcomes that a user (or an LLM acting on a user's behalf) could actually observe. The coverage matrix should reflect that scope. Not every interesting property of FlashQuery belongs here — some properties are better covered by other kinds of tests, and a few aren't testable in FlashQuery at all.

Use these heuristics when deciding whether a candidate behavior belongs in the matrix.

**A behavior belongs in the matrix when all of these are true:**

- It's **observable from outside FlashQuery** through the public surface — tools, returned payloads, error responses, or vault state a user can inspect. If you can only verify it by reading internal logs or poking at private fields, it doesn't belong here.
- It describes a **user-meaningful outcome**, not an implementation detail. "Archived documents are excluded from default search results" is a behavior. "The archive flag is stored as a boolean column" is not.
- It's **deterministic enough to assert on**. Scenario tests are bad at fuzzy or probabilistic outcomes (embedding quality, ranking nuance beyond clear signals, model-dependent phrasing). If the only way to check the behavior is "looks about right," it doesn't belong as a scenario row.
- It's **end-to-end in nature** — exercising it requires the real server, the real vault, and the real tool surface working together. Behaviors that can be verified in isolation usually shouldn't pay the cost of a full scenario run.

**A behavior does NOT belong in the matrix when any of these are true:**

- **It's a unit-level concern.** Pure function correctness, parser edge cases, internal data-structure invariants, type-safety properties, and similar are unit tests, not scenario tests. The matrix shouldn't list "the slug generator handles unicode" — that's a unit test for the slug generator.
- **It's a performance, load, or scaling property.** "Search returns within 200ms on a 10k-document vault" is a benchmark concern, not a scenario behavior. Scenario tests aren't the right harness for timing or throughput claims.
- **It's about migration, schema, or DB-level integrity.** Things like "the v3 → v4 migration preserves archived flag" belong in migration tests, not scenario tests.
- **It's about third-party behavior.** "OpenAI returns 1536-dimension vectors" or "the SQLite driver supports WAL mode" aren't FlashQuery behaviors — they're properties of dependencies. FlashQuery's *handling* of those things (e.g., "FlashQuery raises a clear error when the embedding API key is missing") is fair game; the dependency's own behavior is not.
- **It's an internal refactor-safety check.** "Method X still calls method Y" is a coupling test, not a behavior. If a refactor changes internal call structure but the public surface keeps doing the right thing, the matrix should be silent.
- **It's only observable via logs or private state.** If you have to grep stdout or read a private attribute to verify it, it's not a scenario behavior. Either expose it through the public surface or test it elsewhere.
- **It's a property of the protocol/transport.** MCP framing, JSON-RPC envelope correctness, stdio handling — these are transport concerns, not FlashQuery scenario behaviors.

**Edge cases worth thinking about explicitly:**

- *Error messages and error shapes* belong in the matrix when the user-facing error is part of the contract ("attempting to archive a non-existent document returns a clear `not_found` error"). They don't belong when the assertion is on internal exception types or stack traces.
- *Configuration and environment handling* belong when they change observable behavior ("when `EMBEDDING_PROVIDER=none`, semantic search returns a clear unsupported error"). They don't belong when they're internal plumbing.
- *Concurrency and ordering* belong when FlashQuery makes a guarantee about them through its public surface ("two rapid `add_document` calls both succeed and both appear in `list_documents`"). They don't belong when they're implementation details of the underlying store.

When in doubt, ask: *"If this behavior broke, would a user notice through normal use of FlashQuery's tools?"* If yes, it probably belongs in the matrix. If no — or if the only way they'd notice is by reading source code or logs — it probably belongs in a different kind of test, or nowhere at all.

If a candidate behavior doesn't belong in the matrix, **don't silently drop it**. Mention it to the user in your phase 4 proposals under a brief "**Not added (out of scope for directed scenario tests):**" note, with a one-line reason. That way the user gets to confirm the call rather than wondering why something they expected to see isn't there.

## Workflow

Follow these phases in order. Don't skip ahead — the user-in-the-loop checkpoints in phases 4–6 exist to prevent you from making large unreviewed edits.

### Phase 1 — Evaluate the input

Read everything the user provided. If they pointed at a file, read it. If they described a change verbally, restate your understanding back to them in one or two sentences and confirm before continuing.

You're trying to build a mental model of: what FlashQuery functionality this describes, which existing categories it touches, and whether it introduces anything that doesn't fit any current category.

### Phase 2 — Review DIRECTED_COVERAGE.md

Read the current `DIRECTED_COVERAGE.md` end-to-end. Pay attention to:

- The category structure (which categories exist, what each one covers)
- The ID prefixes and the highest-numbered ID currently in each category (you'll need this to assign new IDs)
- Existing behaviors that are adjacent to whatever the input describes — these are candidates for modification rather than new additions
- Any behaviors that the input renders obsolete

If the file isn't where you expect, ask the user for the path. Don't fabricate one.

### Phase 3 — Categorize the changes

From the input and the current matrix, produce three working lists in your head (or in scratch notes):

1. **New behaviors** — capabilities in the input that aren't reflected anywhere in the matrix
2. **Modified existing behaviors** — current matrix rows whose semantics, scope, or wording need to change because of the input
3. **Behaviors to remove** — current matrix rows that describe functionality the input has eliminated or obsoleted

Be conservative on additions — don't propose a new row when an existing one already covers the behavior, even loosely. Be specific on modifications — say what about the existing row needs to change and why. Be explicit on removals — explain why the behavior no longer applies.

### Phase 3.5 — Code presence check (default on)

Before presenting proposals, do a quick, shallow pass over the codebase to confirm that each candidate behavior has *some* footprint in the code. This is **not** a reconciliation step (that's phase 6.5) and it is **not** a way to source or reword behaviors from the code. It's a basic existence check, and nothing more.

The goal is to catch the case where a spec describes functionality that — for whatever reason — isn't actually in the codebase yet. Specs and code drift: the document the user handed you might predate or postdate the implementation, the feature might have been renamed, or some piece might not have made it out of design. Catching that early prevents you from proposing a behavior that has nothing to test against.

**How to do it cheaply:**

- For each candidate behavior, pick one or two distinctive identifiers from the spec — a tool name, function name, parameter, config flag, error code, or a distinctive string. Grep the codebase for them.
- A single hit is enough to consider the behavior "present." You're checking for any footprint, not verifying correctness.
- Stick to obvious public surfaces: tool registrations, public modules, schema files, config handling. Don't go deep into internals — this is supposed to be fast.
- If the obvious identifier doesn't hit, try one or two near-variants (snake_case ↔ kebab-case, plural ↔ singular, common synonyms) before giving up. Renames are common.

**What to do with the results:**

- **Found**: no annotation needed. Carry the proposal forward as-is.
- **Not found**: flag the proposal with a "**⚠ Not located in code**" note. Do not drop the proposal and do not change its wording — the spec is still the source of truth for what the behavior *should* be. The flag just tells the user "I couldn't find evidence this is implemented yet, please confirm."
- **Found under a different name**: note both names ("spec calls this `archive_doc`; code has `documents.archive`"). Don't rewrite the behavior to match the code's naming — that's the user's call.

This phase exists to give the user a heads-up, not to make decisions for them. If everything is found, this phase is invisible. If anything is missing, it surfaces in phase 4 as an annotation the user can react to.

If the user has already told you the spec describes unimplemented or future functionality (e.g., "this is a design doc for work that hasn't started"), skip this phase — it would just produce noise.

### Phase 4 — Present proposals to the user

Show your proposals to the user in this exact structure (use empty sections with "None" if a list is empty — don't omit the headers):

```markdown
# Proposed New Behaviors

- **[Category] [Proposed ID]**: [Short behavior title]
  - **Reasoning**: [Why this belongs in the matrix]
  - **Source**: [Which part of the input implies this — quote or paraphrase]
  - **Code presence**: [✓ found at `path/to/file.py` | ⚠ Not located in code | ✓ found under different name: `actual_name`]

# Modified Existing Behaviors

- **[Existing ID]** ([current title]): [What needs to change]
  - **Reasoning**: [Why the change is needed]
  - **Source**: [Which part of the input implies this]
  - **Code presence**: [as above]

# Behaviors to Remove

- **[Existing ID]** ([current title]): [Why it's obsolete]
  - **Source**: [Which part of the input implies removal]

# Not added (out of scope for directed scenario tests)

- **[Candidate]**: [One-line reason — e.g., "unit-level concern", "performance property", "internal refactor check"]
```

If everything passed the phase 3.5 presence check cleanly and there are no out-of-scope candidates, you can omit the empty sections. But if *any* behavior was flagged "Not located in code," call it out clearly at the top of the message so the user sees it before reviewing the list — that's the kind of thing they need to react to early.

Do not edit `DIRECTED_COVERAGE.md` yet. This is a review checkpoint.

### Phase 5 — Get user feedback

Ask the user to review the proposals and tell you what to change, add, or drop. Common feedback patterns:

- "These three new ones should be one row, not three"
- "M-12 doesn't actually need modification — leave it"
- "Add one for the new `--dry-run` flag I forgot to mention"
- "Looks good, proceed"

Wait for the user's response. Don't proceed to edits without it.

### Phase 6 — Refine

Apply the user's feedback to your proposed lists. If they made substantive changes (renamed behaviors, added new ones, removed proposals), re-present the updated lists in the same Phase 4 format and ask for another round of feedback. Keep looping until the user signs off.

If the user said "looks good, proceed" or equivalent on the first pass, skip straight to phase 7.

### Phase 6.5 — Optional code reconciliation (opt-in only)

This phase is **off by default**. The skill is deliberately spec-first: behaviors come from requirements and intended functionality, never from "what the code happens to do." Sourcing behaviors from the code produces self-fulfilling tests that lock in current implementation details rather than verifying intended behavior.

That said, there is a narrow, useful role for looking at the code at this point in the workflow — but only as a way to **generate clarifying questions for the user**, never as a way to source new rows directly. Offer this phase to the user when:

- The input was thin or vague and you suspect there are surfaces the spec didn't describe
- A proposal removes behaviors and you want to confirm the underlying code is actually gone
- The user explicitly asks you to "double-check against the code"

If the user opts in, do a focused read of the relevant code surfaces (tool definitions, public entry points, schemas — not internals) and look for:

1. **Surfaces the spec doesn't mention.** If the code exposes a parameter, return field, or error path the spec is silent on, ask the user: "the code exposes X but your spec doesn't mention it — is that intentional, or should we add a behavior for it?" Do not add the row yourself.
2. **Removals that aren't actually removed.** If you proposed soft-deleting a row, confirm the underlying functionality is actually gone from the code. If it's still live, withdraw the removal and tell the user.
3. **Spec/code drift.** If the spec says one thing and the code clearly does another, that's a defect — flag it the same way `flashquery-directed-testgen` flags FlashQuery defects during the debug loop. Don't silently align the matrix to the code.
4. **Category placement.** If the code makes it obvious that a behavior belongs in a different category than you initially placed it, fix the placement.

The output of this phase is a short list of questions or corrections back to the user, *not* matrix edits. Once they answer, fold the answers into your proposed lists and continue to phase 7.

If the user declines this phase, skip straight to phase 7. The default path is spec → matrix, with no code involved.

### Phase 7 — Final sanity check

Before touching `DIRECTED_COVERAGE.md`, do one more pass yourself looking for:

- **Duplicates**: does any proposed new behavior overlap an existing row you didn't flag?
- **Misalignments**: is anything filed under the wrong category? (E.g., a search ranking concern under Documents instead of Search)
- **ID collisions**: have you assigned the same new ID twice, or reused an existing one?
- **Granularity drift**: are some new rows much broader or narrower than the surrounding rows in the same category? Adjust to match the matrix's existing grain.

If you find issues, fix them silently (these are mechanical corrections, not new proposals) before editing.

### Phase 8 — Edit DIRECTED_COVERAGE.md

Now make the edits. Follow these rules strictly:

**ID assignment for new rows.** Append new rows to the bottom of the appropriate category table. Use the next sequential number after the highest existing ID in that category. Never reuse a removed row's ID. Never renumber existing rows.

**Date Updated.** For every row you add or modify, set the `Date Updated` column to today's date in `YYYY-MM-DD` format. Get today's date from the environment if you're unsure — don't guess. Do *not* touch the `Date Updated` column on rows you didn't change.

**Last Passing.** Leave the `Last Passing` column blank for new rows (testgen will fill it in when a test passes). For modified rows, leave the existing value alone unless the modification invalidates prior passing runs — in that case, clear it and note in your summary that the row needs re-testing.

**Removals use strikethrough, not deletion.** Do not delete rows from the matrix. Instead, wrap the `ID`, `Behavior`, and `Covered By` cells in markdown strikethrough (`~~...~~`) and update `Date Updated` to today's date. This preserves the historical record and prevents future ID collisions. Example:

```
| ~~D-07~~ | ~~Recall by legacy tag syntax~~ | ~~test_legacy_tag.py~~ | 2026-04-14 | 2026-03-22 |
```

**Behavior titles stay short.** Match the style of existing rows: a short declarative phrase, not a sentence. If you need to explain nuance, do it in your summary message to the user, not in the row itself.

**Covered By for new rows.** Leave it as `—` (em dash) or empty. testgen fills this in when a test is written.

### Phase 9 — Summarize and hand off

After the edits are saved, summarize what you did in a short message to the user:

- New rows added (by ID and title)
- Rows modified (by ID, with one-line description of the change)
- Rows soft-deleted via strikethrough (by ID)
- Any rows whose `Last Passing` you cleared and that need re-testing
- Anything noteworthy from the sanity-check pass

Then explicitly offer the natural next step: ask the user whether they'd like to run `flashquery-directed-testgen` against any of the changed behaviors. Frame it concretely so they can pick from the actual list of changes rather than answering an open-ended question. For example:

> Want me to hand off to `flashquery-directed-testgen` for any of these? Likely candidates:
> - **New**: D-42, D-43, S-18 — these have no test yet
> - **Modified**: M-09 — the existing test may need updating to match the new behavior
> - **Removed**: ~~P-04~~ — the existing test should probably be deleted or archived
>
> Or we can stop here and pick this up later.

Don't run the testgen handoff without the user's explicit go-ahead.

### Phase 10 — Offer a git commit

After the user has seen the summary, check whether the project is under git:

```bash
git -C <project_root> rev-parse --is-inside-work-tree 2>/dev/null
```

If yes, offer to commit the `DIRECTED_COVERAGE.md` changes. This is the natural close to the workflow — the matrix changes are a meaningful unit of work and deserve their own commit, separate from any test files testgen might add later. Frame the offer concretely so the user can say yes/no without having to think about scope:

> Everything is updated. Would you like me to commit the DIRECTED_COVERAGE.md changes? I'd include just `tests/scenarios/directed/DIRECTED_COVERAGE.md` — testgen will commit the new test files separately when those get written.

If the user agrees, stage and commit with a descriptive message. Use this format:

```
docs(coverage): <summary of the batch>

New behaviors:
- <Category prefix>-<ID>: <short title>
- ...

Modified behaviors:
- <ID>: <one-line description of change>

Removed behaviors:
- <ID>: <one-line reason>

Proposed test scenarios:
- test_<name> (covers <IDs>)
- ...
```

Omit any sections that are empty for this batch. If the batch is removals-only, the type prefix can be `chore(coverage):` instead of `docs(coverage):` since it's cleanup work.

If the only thing in the batch is a single new behavior, the verbose format is overkill — use a one-line message: `docs(coverage): add <ID> for <short title>`.

Do not push — leave that to the user.

If the repo is not under git, skip this phase entirely (don't try to initialize git, don't warn — just stop after phase 9).

## Principles

**Be conservative on additions.** The matrix is most useful when each row maps to a real behavior worth testing in isolation. Inventing rows to look thorough dilutes that. If a capability is already implicitly covered by an existing row, prefer modifying the existing row's wording over adding a new one.

**Preserve history.** The matrix doubles as a changelog — that's why removals are strikethroughs, IDs are never reused, and `Date Updated` exists. Treat it accordingly.

**Don't write tests in this skill.** Coverage planning and test authoring are deliberately separated. If the user starts asking "now write the test for D-42", switch to `flashquery-directed-testgen`.

**Ask when unsure.** If the input is ambiguous about whether a capability is new, modified, or removed, ask the user rather than guessing. The cost of a clarifying question is much lower than the cost of an unreviewed matrix change.

## Related skills

- **flashquery-directed-testgen** — sister skill that writes directed scenario tests against the coverage matrix. Hand off to it once the matrix is updated and the user wants to start exercising the new behaviors.
- **flashquery-directed-run** — runner skill that executes the directed suite and triages failures. May hand off spec ambiguity packets to this skill.

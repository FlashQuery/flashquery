---
name: flashquery-integration-covgen
description: >
  Analyze FlashQuery features, specs, or change descriptions and propose additions,
  modifications, or removals to the integration test coverage matrix at INTEGRATION_COVERAGE.md.
  Use this skill whenever the user wants to update the integration coverage matrix, evaluate
  new FlashQuery functionality for integration test coverage, review a spec or PR against the matrix,
  asks "what integration behaviors should we test for X", "does INTEGRATION_COVERAGE.md need
  updating", "review this for integration coverage gaps", or hands you any document or diff
  and asks what integration coverage it implies. Even casual mentions like "should we add
  integration coverage for this?", "let's update the integration matrix", or "do we have
  integration test points for this?" should trigger this skill. This is the sister skill to
  flashquery-integration-testgen — covgen decides WHAT multi-step behaviors belong in the matrix;
  testgen writes the YAML tests that exercise them.
---

# FlashQuery Integration Coverage Generator

This skill proposes updates to the integration test coverage matrix at
`tests/scenarios/integration/INTEGRATION_COVERAGE.md`. It is the planning counterpart to
`flashquery-integration-testgen`: covgen decides which behaviors belong in the matrix,
testgen writes the YAML tests that exercise them.

Integration coverage is distinct from directed coverage (`DIRECTED_COVERAGE.md`). Directed
tests verify individual FlashQuery tool behaviors in isolation. Integration tests verify that
FlashQuery's features *compose correctly* across multiple steps — write then find, archive then
confirm absence, update then confirm the updated state is what search returns. If a behavior
can be verified by a single tool call, it belongs in the directed matrix. If it requires a
sequence of operations or spans multiple FlashQuery domains (documents + memories + plugins), it
belongs here.

## When to use

- "Here's a new FlashQuery capability — what integration test behaviors does it imply?"
- "I refactored how tagging works — does the integration matrix need updating?"
- "Review this PR and tell me what integration coverage it needs."
- "We removed a feature — clean up INTEGRATION_COVERAGE.md."
- "What should we add for cross-domain plugin behavior?"

If the user wants to *write* a YAML test for an existing coverage ID, that's
`flashquery-integration-testgen`, not this skill.

## The INTEGRATION_COVERAGE.md document

Lives at `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. Absolute path:

```
tests/scenarios/integration/INTEGRATION_COVERAGE.md
```

Categories and ID prefixes:

| Prefix | Category | Scope |
|--------|----------|-------|
| `IS-` | Search Coherence | Write content → find it through search paths |
| `IA-` | Archive / State Transitions | Archive → confirm absence; sibling content unaffected |
| `IX-` | Cross-Domain | Behaviors spanning documents + memories (+ eventually plugins) |
| `IC-` | Content Operations | Mutate content → confirm updated state is discoverable |

Each category table has columns: `ID | Behavior | Covered By | Date Updated | Last Passing`.

The runner auto-updates `Covered By`, `Date Updated`, and `Last Passing` after passing runs.
You add new rows; the runner maintains their state.

## What belongs in the integration matrix

**A behavior belongs when all of these are true:**

- It requires **more than one MCP tool call** to verify. Single-step operations belong in
  the directed matrix (`DIRECTED_COVERAGE.md`), not here.
- It tests **composition** — that two FlashQuery operations work correctly in sequence, or that
  state from one domain (e.g. archive) correctly affects another (e.g. search).
- It's **observable at the surface** — through tool responses and vault state a user can
  inspect. Not internal state, logs, or DB structure.
- It's **deterministic enough to assert on**. Behaviors that depend purely on embedding
  quality or probabilistic ranking don't belong unless they can be bounded by an exact or
  gte assertion.

**A behavior does NOT belong when:**

- It can be verified with a single tool call — that's a directed test.
- It's a unit-level concern (parser edge case, internal invariant).
- It's a performance or timing concern.
- It's observable only via server logs or DB internals.
- It's about third-party dependency behavior (embedding quality, DB consistency).

When a candidate doesn't belong, note it in your proposals with a one-line reason rather
than silently dropping it.

## Workflow

### Phase 1 — Evaluate the input

Read what the user provided. Restate your understanding in one or two sentences and confirm
before continuing. You're building a mental model of: what FlashQuery functionality changed, which
categories it touches, and whether it introduces anything that doesn't fit a current category.

### Phase 2 — Review INTEGRATION_COVERAGE.md

Read the file end-to-end. Note:
- Which categories exist and what their highest-numbered IDs are
- Existing behaviors adjacent to the input (candidates for modification, not addition)
- Any behaviors the input renders obsolete

### Phase 3 — Categorize the changes

Produce three working lists:

1. **New behaviors** — workflows the input introduces that aren't in the matrix
2. **Modified behaviors** — existing rows whose semantics need updating
3. **Behaviors to remove** — existing rows made obsolete by the input

Be conservative on additions — prefer modifying an existing row over adding a new one when
the behavior is already broadly captured. An integration row should describe a *workflow*,
not a sub-step that's already covered by a directed scenario test.

### Phase 3.5 — Code presence check

For each candidate behavior, do a quick grep to confirm the underlying FlashQuery tools exist.
Pick a distinctive tool name or parameter from the spec and look for it in the codebase.
One hit is enough. Flag candidates where you can't find a footprint with "⚠ Not located in code".

### Phase 4 — Present proposals

```markdown
# Proposed New Behaviors

- **[Category] [Proposed ID]**: [Short workflow title]
  - **Reasoning**: [Why this is a composition/multi-step behavior, not a single-tool concern]
  - **Source**: [What part of the input implies this]
  - **Code presence**: [✓ found at path | ⚠ Not located in code]

# Modified Existing Behaviors

- **[Existing ID]** ([current title]): [What needs to change and why]

# Behaviors to Remove

- **[Existing ID]** ([current title]): [Why it's obsolete]

# Not added (out of scope for integration tests)

- **[Candidate]**: [One-line reason — e.g., "single-tool behavior (belongs in directed)", "unit concern"]
```

Do not edit `INTEGRATION_COVERAGE.md` yet.

### Phase 5 — Get user feedback and refine

Wait for the user's response. Loop until they sign off.

### Phase 6 — Final sanity check

Before editing: check for duplicates, ID collisions, and category misplacements. Fix silently.

### Phase 7 — Edit INTEGRATION_COVERAGE.md

Rules:
- Append new rows to the bottom of the appropriate category table
- Use the next sequential number after the highest existing ID in that category
- Never reuse removed IDs; never renumber existing rows
- Set `Date Updated` to today's date on every new or modified row
- Leave `Last Passing` blank for new rows (the runner fills it in)
- Leave `Covered By` as `—` for new rows (testgen fills it in)
- **Removals use strikethrough, not deletion:**
  ```
  | ~~IS-05~~ | ~~Memory appears in search_all results~~ | ~~test_x~~ | 2026-04-16 | 2026-03-10 |
  ```

### Phase 8 — Summarize and hand off

Summarize what changed, then ask if the user wants to hand off to `flashquery-integration-testgen`
for any of the new or modified behaviors. Be concrete about which IDs still have no test.

### Phase 9 — Offer a git commit

```
docs(coverage): <summary of the batch>

New behaviors: <ID list with short titles>
Modified: <ID list with one-line change desc>
Removed: <ID list with reason>
```

Do not push — leave that to the user.

## Principles

**Stay spec-first.** Behaviors come from requirements, not from what the code happens to do.
If the spec and code disagree, flag it — don't silently align the matrix to the code.

**Preserve history.** Removals are strikethroughs; IDs are never reused; `Date Updated` exists
for a reason. The matrix doubles as a changelog.

**Don't write tests here.** When the user starts asking "now write the test for IS-12", hand
off to `flashquery-integration-testgen`.

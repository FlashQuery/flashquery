---
name: fq-devplan
description: >
  Create a phased development plan from a FlashQuery feature requirements
  document. Use this skill whenever the user wants to create a dev plan, write
  an implementation plan, plan the development work for a feature, break a
  feature into development phases, or prepare a feature for implementation. Also
  trigger when the user says "create a dev plan for X", "plan the
  implementation", "break this into phases", "write up the development work",
  "prep this for the dev agent", or references a feature document and asks how
  to build it. Even casual phrasing like "ok let's figure out how to build this"
  or "what's the dev plan" should trigger this skill. This skill produces a
  document aimed at an AI developer/architect agent — the last gate before
  implementation begins.
---

# FlashQuery Development Plan Skill

You are creating a **phased development plan** from a feature requirements
document. The output is a standalone document written for an AI developer and
architect agent — it must contain everything that agent needs to build and test
the feature without ambiguity. This is the last planning gate before
implementation begins, so completeness and precision matter.

The development plan template lives at:
`flashquery-product/Meta/Templates/development-plan.md`

Read this template before writing anything — it defines the section structure
you must follow.

**Numbering convention:** Both the development plan and the requirements
document use numbered headings and subheadings (1, 1.1, 1.1.1) for precise
cross-referencing. When citing sections from the requirements doc, use the
format "Req §X.Y" (e.g., "Req §4.1").

**Pipeline status:** When the development plan is finalized and all open
questions are resolved, the feature's pipeline status moves to `ready-for-dev`.
This document is the last gate — once it's clean, the dev agent can begin
implementation.

---

## Step 1 — Identify the feature document

The user will name or reference a feature requirements document. This is
typically a roadmap item in the FlashQuery product vault — something in
`Roadmap/Features/` or a path the user provides directly.

If the user names a feature by title (e.g., "Native LLM Access"), search for
it:
- Try `mcp__flashquery__search_documents` first
- Fall back to file system search if the vault doesn't have it

Once identified, load the full document and its outline in parallel:
- `mcp__flashquery__get_document` — full body
- `mcp__flashquery__get_doc_outline` — frontmatter and structure

If the feature doc references an archived research document as its
specification source (common pattern: the feature doc has a Specification
section pointing to an archived research doc), load that research document
too — it contains the detailed implementation spec you'll need.

Also load any documents listed in `depends_on`, `enables`, or `relates_to` —
you need to understand the dependency landscape.

---

## Step 2 — Organize the feature folder

Check whether a subfolder already exists for this feature. The convention is
a folder named using the same slug as the feature document filename (without
the `.md` extension).

**Example:** For `Native-LLM-Access.md`, the folder would be
`Roadmap/Features/Native-LLM-Access/`.

If the folder doesn't exist:
1. Call `mcp__flashquery__create_directory` to create it
2. Call `mcp__flashquery__move_document` to move the feature requirements
   document into the new folder

The development plan document goes in this same folder, named:
`<slug> Dev Plan.md`

**Example:** `Roadmap/Features/Native-LLM-Access/Native-LLM-Access Dev Plan.md`

Create the development plan document using `mcp__flashquery__create_document`
so it's tracked in the vault. Use the template's frontmatter structure, filling
in the `feature` and `requirements_doc` fields.

Confirm the folder structure with the user before proceeding.

---

## Step 3 — Study the FlashQuery codebase

Before writing anything, you need to understand the current state of the code
that this feature will touch. The FlashQuery source repo is typically at
`flashquery/` relative to the workspace root. If you can't find it, ask the
user for the path.

**Do not modify any source code.** This is a read-only research phase.

Your codebase investigation should cover:

1. **Files the feature will touch** — based on the requirements doc, identify
   which source files, config files, and test files are relevant. Read them.
2. **Existing patterns** — look at how similar features are currently
   implemented. If the requirements doc references existing code as a
   structural pattern (e.g., "follow the embedding provider pattern"), read
   that code.
3. **Test infrastructure and conventions** — familiarize yourself with both
   the test setup and the existing test style:
   - `flashquery/tests/` — unit and integration tests. Read a representative
     test file to understand import conventions, setup/teardown patterns,
     assertion styles, and naming conventions.
   - `flashquery/tests/scenarios/directed/` — directed scenario tests
     (Python, using `TestContext`/`TestRun` from `fqc_test_utils`).
     Read `DIRECTED_COVERAGE.md` for the coverage matrix and ID scheme
     (prefixes like `D-01`, `C-01`, `X-01`).
   - `flashquery/tests/scenarios/integration/` — integration scenario tests
     (declarative YAML with `action:` and `assert:` steps).
     Read `INTEGRATION_COVERAGE.md` for the coverage matrix and ID scheme
     (prefixes like `IS-01`, `IA-01`).
   - Read at least one existing test of each type to understand the
     conventions the dev agent will need to follow.
4. **Config files and templates** — `.env.example`, `.env.test.example`,
   `flashquery.yml`, and any template files the requirements doc mentions
   updating.

Take notes as you go — you'll reference specific files, functions, line
numbers, and test patterns in the development plan.

---

## Step 4 — Design the phase plan

This is the most important intellectual work in the skill. You are designing
a build order that avoids dependency problems and ensures each phase is
independently testable.

### Phasing principles

- **Foundational first.** Start with the lowest-level building blocks that
  everything else depends on. Config parsing before client code. Client code
  before features that use the client.
- **Each phase is independently verifiable.** After completing a phase, there
  must be a concrete way to confirm it works — tests pass, a command produces
  expected output, a config loads correctly.
- **No forward dependencies.** Phase N must never depend on work planned for
  Phase N+1. If you find yourself needing something from a later phase,
  restructure.
- **Tests ship with the code.** Every phase includes both development work
  AND the tests that verify that work. Never defer testing to a later phase.
- **Test both success and failure.** Every phase must include negative tests
  alongside positive ones. If you're building config validation, test that
  valid config loads AND that invalid config produces a clear error. If you're
  building a fallback chain, test that it works AND test what happens when
  everything fails.

### What goes into each phase

For each phase, you need:

1. **Development work:**
   - Files to create (with purpose and location)
   - Files to modify (with specific changes — reference function names, line
     numbers, describe before/after)
   - Files to remove (if replacing deprecated code)
   - Reasoning: why this work is in this phase, what it depends on from
     prior phases, and what it enables for subsequent phases
   - Requirements traceability: which section(s) of the requirements doc
     source these changes

2. **Test work:**
   - **Unit tests** — isolated tests for new functions, classes, and modules.
     Specify the test file path, what it tests, and expected assertions.
     Include both positive (expected behavior) and negative (error handling,
     invalid inputs, edge cases) tests.
   - **Integration tests** — tests that exercise multiple components working
     together. May use the existing test infrastructure in `flashquery/tests/`.
   - **Directed scenario tests** — Python-based behavioral tests. Specify
     new coverage behaviors to add to `DIRECTED_COVERAGE.md` and the test
     file that exercises them. Reference the `flashquery-directed-covgen`
     skill for generating coverage behaviors and `flashquery-directed-testgen`
     for authoring test cases. Include failure-mode behaviors, not just
     happy paths.
   - **Integration scenario tests** — YAML-based declarative tests. Specify
     new coverage behaviors to add to `INTEGRATION_COVERAGE.md` and the YAML
     test file. Reference the `flashquery-integration-covgen` and
     `flashquery-integration-testgen` skills.
   - Requirements traceability: which requirement(s) each test validates

---

## Step 5 — Write the development plan document

Read the template at `flashquery-product/Meta/Templates/development-plan.md`
and follow its section structure exactly. Fill in every section:

### §1 — Purpose
Link to the feature requirements doc. One sentence on what this plan
implements. The requirements doc is the "what and why"; this document is the
"how and where."

### §2 — Reading Guide
Explain your cross-referencing conventions. How do requirement sections map to
phase numbers and test IDs? Define any shorthand.

### §3 — Scope
Three subsections:

- **§3.1 In Scope** — what is being built in this plan, restated in
  implementation terms
- **§3.2 Out of Scope** — what is explicitly NOT being built. Restate
  deferrals from the requirements doc and add any implementation-level
  exclusions. This prevents scope creep — the dev agent treats this as a
  hard boundary.
- **§3.3 Assumptions** — things this plan assumes to be true. Number each
  one. If an assumption turns out to be false, the affected phases should
  be re-evaluated. Examples: "Supabase connection is already configured,"
  "existing embedding tests are passing," "Node 18+ is available."

### §4 — Phase Overview
Two subsections:

- **§4.1 Phasing Rationale** — narrative prose explaining WHY the phases are
  ordered as they are. The dependency chain, the build-up logic.
- **§4.2 Phase Summary** — table with columns: Phase, Name, Depends On,
  Key Deliverables, Test Coverage. The "Depends On" column makes the
  dependency chain scannable at a glance.

### §5 — Codebase Context
Two subsections:

- **§5.1 Source Code** — current state of relevant code. Key files, modules,
  patterns, stubs to replace, patterns to follow. File paths and line refs.
- **§5.2 Test Conventions** — how existing tests are structured. Import
  conventions, setup/teardown, assertion styles, naming patterns, test
  utilities. Cover each test type: unit, integration, directed scenario,
  integration scenario. The dev agent should be able to write new tests that
  fit the existing style without guessing.

### §6 — Implementation Phases
The detailed phase-by-phase plan from Step 4. For each phase, follow the
template's subsection structure:

- **§6.N.1 Development Work** — files to create/modify/remove, reasoning,
  requirements traceability
- **§6.N.2 Unit & Integration Tests** — split into positive and negative
  test tables
- **§6.N.3 Scenario Tests** — directed and integration, with coverage IDs,
  behavior descriptions, and positive/negative classification
- **§6.N.4 Verification** — concrete checklist items with specific commands
  and expected outcomes

Be concrete. Instead of "update the config loader," write "In
`src/config/loader.ts`, add a `providers` array to the `FlashQueryConfig`
interface (line ~45) with fields `name`, `type`, `endpoint`, and `api_key`.
Add a `validateProviderNames()` function that enforces the naming rules from
Req §3.1 (Naming Rules)."

### §7 — Migration and Backward Compatibility
Breaking changes, data migrations, config format changes. If none, state
"No migration concerns — this is net-new functionality."

### §8 — Traceability Matrix
Two subsections:

- **§8.1 Requirements → Tests** — cross-reference table showing every
  requirement mapped to its tests (unit, directed scenario, integration
  scenario) and which phase delivers them. This is the single place to
  verify complete coverage.
- **§8.2 Coverage Gaps** — any requirements NOT yet covered by tests, with
  an explanation. If full coverage, state so explicitly.

### §9 — Open Questions
Unresolved questions that affect implementation. Number them. These must be
resolved before the dev agent starts work.

### §10 — Related
Requirements spec, archived research, prerequisite plans, related features.

---

## Step 6 — Self-review

After writing the complete document, do a thorough review before presenting
it to the user. This review has three passes:

### Pass 1 — Requirements coverage

Re-read the feature requirements document section by section. For each
substantive requirement, verify:
- It appears in at least one phase's development work
- It has at least one test case covering it (check both positive and negative)
- The requirements traceability citation is correct
- It appears in the §8 Traceability Matrix

If anything is missing, add it.

### Pass 2 — Codebase accuracy

Re-check the files and code references in your plan against the actual
codebase:
- Do the file paths exist (or are they new files in the right directories)?
- Are the function names and line numbers still accurate?
- Do the existing code patterns you reference actually work the way you
  described?
- Are there any dependencies or imports you missed?
- Do the test conventions described in §5.2 match what you observed in
  actual test files?

### Pass 3 — Ambiguity and gap check

Read the document as if you were the dev agent seeing it for the first time:
- Is anything confusing or ambiguous?
- Are there implicit assumptions not listed in §3.3?
- Could any instruction be interpreted in multiple ways?
- Are the phase boundaries clean — could a dev agent complete Phase 1 without
  knowing anything about Phase 2?
- Does the Out of Scope section (§3.2) clearly prevent foreseeable scope
  creep?
- Are error cases and failure modes tested, not just happy paths?

Document any issues found, fix them in the plan, and note the corrections
in a brief "Review Notes" comment at the bottom of the document (below the
Related section). These review notes are for the user's awareness — they show
what was caught and fixed during self-review.

---

## Step 7 — Present to the user and advance pipeline

Tell the user:
- The development plan is ready at `[path]`
- Give a brief summary of the phase structure and why it's ordered that way
- List any open questions from §9 that need resolution before implementation
  can begin
- If the plan is clean (no open questions), say so: "No blockers — this is
  ready for the dev agent whenever you are."

If there are no blocking open questions, update the feature document's pipeline
status to `ready-for-dev`:
- Call `mcp__flashquery__update_doc_header` on the feature requirements document
  with `{ "status": "ready-for-dev" }`
- Call `mcp__flashquery__apply_tags` to swap pipeline tags:
  `add_tags: ["#pipeline/ready-for-dev"]`,
  `remove_tags: ["#pipeline/spec-complete"]` (or whatever the current pipeline
  tag is)

If open questions remain, leave the status unchanged and tell the user what
needs to be resolved before the feature can advance.

---

## Edge cases

**Feature doc has no detailed spec:** If the feature document is a thin
summary pointing to an archived research doc for the full spec, you MUST
load and use that research doc as your primary source. The feature doc alone
won't have enough detail.

**Codebase not found:** Ask the user for the path. Do not guess or proceed
without it — codebase context is essential for a useful dev plan.

**Multiple features in one doc:** Ask the user to clarify scope. Each dev
plan covers one feature.

**Feature has unresolved open questions:** Flag them prominently. The dev
plan can still be written around them, but §9 must clearly state that these
block implementation.

**Assumptions that need validation:** If during Step 3 (codebase study) you
discover that an assumption you were about to make is actually uncertain —
e.g., you can't confirm a dependency is configured, or an existing test
suite has failures — promote it from an assumption to an open question in §9.

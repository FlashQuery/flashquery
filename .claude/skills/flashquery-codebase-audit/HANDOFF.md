# HANDOFF — flashquery-codebase-audit skill

This note hands the `flashquery-codebase-audit` skill off to Claude Code (or
whoever picks it up next). It was drafted in a Cowork session on 2026-05-23 using
the skill-creator skill. Read it fully before changing the skill.

This file is documentation only — it is not part of skill operation (only
`SKILL.md` is auto-loaded).

## Status

**Complete v1 draft. Not yet tested.** Every file is written and the skill is
internally coherent, but it has NOT been through the skill-creator
test-and-refine loop. Expect the workflow documents to need one round of
tightening after the first real runs.

## What the skill does

Runs a structured technical-debt and code-health audit of the FlashQuery
codebase (primarily the `flashquery` repo) and produces a prioritized,
fix-ready report. It is backward-looking — it finds debt already in the tree.
It reports; it does not fix code.

## Skill structure

```
flashquery-codebase-audit/
├── SKILL.md                     # router: workflow table, default run, principles
├── HANDOFF.md                   # this file (not part of skill operation)
├── workflows/
│   ├── sweep.md                 # Layer 1 — mechanical sweep
│   ├── review.md                # Layer 2 — targeted AI review
│   ├── report.md                # synthesize -> output document set
│   ├── verify.md                # post-report self-check
│   ├── independent-review.md    # optional external-model review (self-contained)
│   ├── resolve.md               # fold Matt's open-question answers into findings
│   └── devspec-handoff.md       # pick a batch of findings and brief fq-devspec to spec them
└── references/
    ├── audit-method.md          # method + 19-category taxonomy (A-S) + severity model
    ├── typescript-standard.md   # the coding standard findings are judged against
    └── output-template.md       # output document set + per-finding schema
```

There are eight workflows. Seven have their own document under `workflows/`; the
eighth, **Help**, lives in `SKILL.md` (it just returns the workflow table).

## Design decisions already made — do not silently reverse these

These were resolved with Matt across the design conversation. To change one,
raise it with him first.

1. **Eight named workflows, individually invocable:** Sweep, Review, Report,
   Verify, Independent Review, Resolve, Devspec Handoff, Help. The default run
   chains the core four (Sweep -> Review -> Report -> Verify). Independent
   Review, Resolve, Devspec Handoff, and Help are on-demand.
2. **Progressive disclosure:** `SKILL.md` is a lean router. Each workflow's
   detail lives in its own `workflows/` document, loaded only when that workflow
   runs. The three large `references/` files are loaded only when a workflow
   calls for them. Keep it this way — do not inline reference content into
   `SKILL.md`.
3. **References are bundled, not linked.** The skill carries its own copies of
   the taxonomy / standard / template so it is self-contained — required because
   the Independent Review workflow may be run by a *different model* with no
   access to Matt's repos. The originals (the "design record") live in
   `flashquery-product/Product/Development/` as `Technical Debt Audit.md`,
   `Typescript Best Practices.md`, and `Audit Output Template.md`. The skill's
   `references/` copies are now the LIVING version; the design docs are frozen.
4. **Output location:** the audit writes a multi-document set to a dated folder,
   `flashquery-product/Roadmap/Tech Debt/Codebase Audit (DD-MMM-YYYY)/`. The
   skill must ask the user for the location if it is not specified, offering that
   path as the default.
5. **Independent Review vs Verify:** Verify is the audit's own self-check.
   Independent Review is a separate, optional second opinion run by a *different*
   model; it annotates the existing output in place per Part 7 of
   `references/output-template.md`. They are not the same thing.
6. **Skill name** is `flashquery-codebase-audit` — keep it, and keep the skill in
   `flashquery/.claude/skills/` so Claude Code auto-discovers it.

## What's left to do (in order)

1. **Test the skill — scoped runs.** Validation approach agreed with Matt:
   *scoped test runs* — point the skill at a small slice of the repo so a
   test finishes quickly, rather than auditing all of `src/` each iteration.
   (Historical note: this section originally said "~2,300 files," which came
   from knip walking `.claude/worktrees/`. The real number is ~120 source
   files in `src/`. Updated 23-May-2026 after the first full-repo run
   surfaced the discrepancy. The scoped-run approach is still right, just
   for a different reason — depth per category, not file count.) Three
   test prompts are ready (below).
2. **Refine** the workflow documents based on what the test runs reveal.
3. **Run the real audit** once the skill is solid. This is the actual goal.
4. **(Optional) Package** the skill into a `.skill` file — only needed to
   distribute or install it elsewhere. For use inside the `flashquery` repo it is
   already in `.claude/skills/` and needs no packaging.

## Test cases (ready to run, not yet run)

1. **Scoped audit** — "Run the codebase audit on the `src/mcp/` directory — I
   want to know what technical debt is lurking in the MCP layer before we touch
   it." Exercises the default chain (Sweep -> Review -> Report -> Verify) on a
   tractable slice.
2. **Help** — "what can the codebase audit skill actually do? give me the
   rundown" Exercises the Help workflow; should return the workflow table.
3. **Single workflow** — "just do the mechanical sweep over `src/embedding/`,
   don't run the full audit" Exercises individual-workflow routing and
   progressive disclosure; should load only `workflows/sweep.md`.

Independent Review was deliberately deferred to a later iteration — it needs an
existing audit to review, so test it after test case 1 has produced one.

## Environment notes

- **Two repos.** The skill lives in and audits the `flashquery` repo, but writes
  its report into the *sibling* `flashquery-product` repo
  (`Roadmap/Tech Debt/...`). Claude Code needs access to both, or repoint the
  output location at run time.
- **The mechanical Sweep needs the repo's toolchain.** It runs `npm run
  typecheck` / `lint` / `knip` and similar, which need the repo's dependencies
  installed. `workflows/sweep.md` already says to use them "where the environment
  supports them" and to record skipped checks as scope notes — but an environment
  with `npm install` done gives the fullest sweep.
- **Exclude nested vendored paths.** The repo nests `src/node_modules/` and
  `src/dist/` inside the source tree. Every scan must exclude
  `**/node_modules/**` and `**/dist/**`, or patterns will match vendored code.

## Known minor items (non-blocking)

- The three `references/` files retain their original "Open items / to expand"
  sections from the design phase. These are honest known-gaps, not cruft — e.g.
  `audit-method.md` notes that concrete severity thresholds (file-length and
  complexity numbers) are not yet pinned down. Worth resolving as the skill
  matures; they do not block use.
- No `scripts/` directory yet. If test runs show every Sweep re-deriving the same
  tool-invocation logic, bundle it as a script then — that is the skill-creator
  pattern (add scripts when repeated work is observed, not before).

## Review performed before handoff

The skill was reviewed against the conversation's design resolutions and against
skill-creator's skill-building rules. Outcome: structurally complete and
coherent. Two fixes were applied — a table of contents was added to each of the
three large `references/` files (skill-creator calls for a TOC on reference files
over ~300 lines), and the `audit-method.md` header was reframed from a
working-document status line to a bundled-reference role line. No other gaps
were found.

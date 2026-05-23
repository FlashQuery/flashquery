---
name: flashquery-codebase-audit
description: Audits the FlashQuery codebase for technical debt and code-health risks — swallowed errors, type-safety escape hatches, MCP tool-contract problems, LLM and context-safety gaps, performance debt, dead code, weak tests, and more — then produces a prioritized, fix-ready report. Use this skill whenever the user wants to audit the codebase, find or inventory technical debt, check code health, hunt for hidden bugs or risky patterns, review the code before starting new feature work, or run any named audit workflow. Trigger on phrasing like "audit the code", "what tech debt do we have", "is the codebase healthy", "run the codebase audit", "find code problems", "review the audit output", or when a different model is asked to independently review an existing audit. Trigger even for casual phrasing like "let's check the code for problems before we build X".
---

# FlashQuery Codebase Audit

Run a structured technical-debt and code-health audit of the FlashQuery codebase
and produce a prioritized, fix-ready report.

This audit is **backward-looking** — it finds debt already in the tree. That is
different from `code-simplifier`, which polishes code as it is written, and from
`req-verify`, which checks code against a feature's requirements. If the user
wants either of those, this is the wrong skill.

## How this skill works

The audit is too large for one pass — 19 detection categories across
~120 TypeScript source files in `src/` (plus tests, configs, and docs that
sit outside the audit scope) — so it is split into **named workflows, each
invoked on its own**. Every workflow has a dedicated instruction document
under `workflows/`.
**Load only the workflow document you need** — that is the point of the split;
do not read all of them up front.

Pick the workflow from the table, read its document, follow it.

## Workflows

| Workflow | What it does | Document |
|---|---|---|
| **Sweep** | Layer 1 — run the deterministic mechanical tools; build the structured inventory and hotspot ranking. | `workflows/sweep.md` |
| **Review** | Layer 2 — targeted AI review of hotspots against the detection taxonomy; produces findings. Chunked by category group. | `workflows/review.md` |
| **Report** | Synthesize the findings into the output document set in the dated audit folder. | `workflows/report.md` |
| **Verify** | The audit's own post-report self-check — gaps, self-consistency, codebase-grounding. | `workflows/verify.md` |
| **Independent Review** | An optional review of a finished audit by a *different* model. Self-contained. | `workflows/independent-review.md` |
| **Help** | List the workflows and what each does. | (this table) |

## Default full run

If the user asks for "the audit" without naming a workflow, run the core four in
order: **Sweep → Review → Report → Verify**. Independent Review and Help are
on-demand only.

Confirm scope before starting: by default the `flashquery` repo, plus a light
pass over `flashquery-plugins/scripts`; `flashquery-product` is docs and out of
scope. Confirm or ask for the output location (see `workflows/report.md`).

## Bundled reference material

The audit's substance lives in three reference documents under `references/`.
Read them as each workflow directs — they are large, so do not load them until a
workflow tells you to.

- `references/audit-method.md` — the full method: the **19-category detection
  taxonomy (A–S)**, the severity / effort / blast-radius model, the mechanical
  toolkit, and FlashQuery-specific calibration. Review and Verify lean on this.
- `references/typescript-standard.md` — the TypeScript coding standard findings
  are judged against. Cite its sections in findings.
- `references/output-template.md` — the exact output format: the document set,
  the per-finding schema, and the independent-review annotation convention.
  Report and Independent Review follow this precisely.

These are bundled copies, so the skill is self-contained — it runs without access
to the FlashQuery product-docs repo, including when a *different* model runs the
Independent Review workflow.

## Help

When the user asks what this skill or the audit can do, reply with the
**Workflows** table above — the named workflows and what each does — and offer to
run one or the default full run.

## Principles that hold across every workflow

- **Find what tools cannot.** Mechanical tools find the empty `catch`; only a
  reading finds the `catch` that logs to a dead channel and returns a plausible
  default. Both layers matter — neither alone is the audit.
- **Every finding is actionable** — real location, severity, and a concrete fix,
  never a vague "this could be better." The schema in
  `references/output-template.md` is mandatory.
- **Stay codebase-grounded.** Every finding must be rooted in real code — real
  paths, real line numbers, real symbols. A finding that cannot be verified
  against the code is marked *To verify*, not asserted as *Confirmed*.
- **The audit reports; it does not fix.** Remediation is a separate, deliberate
  step — see the `fq-devspec` handoff in `references/audit-method.md`.
- **Exclude vendored, build, and worktree paths.** The repo nests
  `src/node_modules/` and `src/dist/` inside the source tree, and keeps live
  agent clones under `.claude/worktrees/agent-*`. Every scan must exclude
  `**/node_modules/**`, `**/dist/**`, AND `.claude/worktrees/**` or it will
  match vendored code or duplicate source from worktrees, swamping real
  findings.

# Workflow: Independent Review

This workflow exists so a **different language model** can independently
review a finished FlashQuery codebase audit. It runs on demand, separately
from the audit itself — a second, independent model catches what the
original pass, and even the audit's own Verify step, cannot.

If you are reading this as that independent reviewer, you may have no prior
context at all. This document and the bundled references give you
everything you need. Do not assume you already know the audit — read what
follows.

## What the audit is

`flashquery-codebase-audit` is a technical-debt and code-health audit of
the FlashQuery codebase — the `flashquery` repo, a TypeScript MCP server of
~120 source files under `src/` plus a separate `tests/` tree that is out
of audit scope. A completed audit is a document set: an `Audit Summary.md`,
one or more `Findings.md` files, an `Accepted Debt.md`, and a tool-output
appendix. Every finding follows a fixed schema.

## Posture — be skeptical, not deferential

The whole point of a second model is independence. The producer (the
original audit pass) has had time to convince itself its findings are
right. You have not. Read every finding with the question *"does the cited
code actually do what this finding says it does?"* — not *"how do I confirm
this?"*

If a finding's reasoning doesn't follow from the code, mark it **Disputed**
even if the conclusion looks plausible. If a finding has the right
location and category but the details are off, **Amend** it. If the
finding is correct but you can add to it — extra locations, missing
tests, sharper remediation — issue an **Enhanced** verdict and fold the
additions in. If it's right and complete, **Confirm**. (See *How to
record your review* below for the verdict mechanics.)

A reviewer that only confirms is doing the producer's job again. Look for
disagreement.

## Read these first

In order:

1. **`references/audit-method.md`** — the method and the **19-category
   detection taxonomy (A–S)**. This is the bar the audit was held to; it
   is your bar too. Two sections in particular:
   - *The AI review layer — semantic checklist* — the deeper-read prompts
     the original Review worked from (misleading error handling, weak
     abstractions, divergent copy-paste, agent contract mismatch, context
     poisoning, authorization by convention, operational blind spots).
     Apply this against the hotspots when you do your gap-analysis pass.
   - *FlashQuery-specific calibration* — the list of patterns that look
     like findings but are *by design* (Supabase as a hard dependency, the
     nested `src/node_modules/` and `src/dist/`, etc.). Do not file
     findings against patterns this section explicitly excludes; the
     producer correctly avoided them, and so should you.

2. **`references/typescript-standard.md`** — the coding standard findings
   are judged against. Cite its sections when you amend or enhance.

3. **`references/output-template.md`** — the finding schema (Part 2) and
   the per-finding **Audit history** convention (Part 7) — Part 7 is how
   your conclusions are recorded into the document set. Read it before
   you start writing annotations.

4. **`workflows/sweep.md`** — the hotspot-ranking rubric the producer used
   (size, churn, escape-hatch density, architectural centrality). You'll
   need it to challenge the ranking — and to identify files in the
   *skim* band (score 3–5) the producer did not deep-read, which is
   prime gap-analysis territory.

5. **The audit output under review** — the document set the user points
   you at. Read in this order:
   - `Audit Summary.md` — start with the *Audit history* section at the top
     (tells you which passes already ran and what they did, so you don't
     duplicate effort), the *Scope & assumptions* section (lists tools
     that did not run — each is a gap candidate), and the existing
     *Verification note* (tells you what the producer's own Verify pass
     already corrected, so you don't re-flag those).
   - `Findings.md` — the findings themselves.
   - `Accepted Debt.md` — items the producer or Matt have consciously kept;
     don't re-file them as findings unless your read disagrees with the
     acceptance rationale.
   - `_working/inventory.md` — the structured mechanical-tool inventory
     and hotspot ranking. This is the producer's pre-Review evidence
     base; spot-check claims in findings against it.
   - `_working/*.txt` (ripgrep.txt, madge-circular.txt, npm-audit.txt,
     file-sizes.txt, churn.txt, etc.) — raw mechanical-tool output for
     deeper spot-checks where a finding's evidence needs verification.

6. **`assets/knip.template.json`** (bundled with this skill) — if you want
   to re-run knip independently rather than trust the producer's
   inventory, use this template. The repo's worktree noise makes a
   default knip run unusable; this template is calibrated.

## Your job

Re-examine the finished audit with fresh eyes and no stake in its
conclusions. Three passes, in this order:

### Pass 1 — Verify every existing finding against the code

For each finding in `Findings.md`:

1. Confirm the path exists, the line numbers are accurate, and the
   symbols named in the finding exist as cited.
2. Read the code at the cited location. Does the diagnosis match what the
   code actually does?
3. Judge severity, effort, blast radius, and category. Is each right
   given what the code does and what FlashQuery's calibration says?
4. Judge the remediation. Would a competent fix-agent be able to
   execute it without re-investigating? Is it safe? Does it cover the
   blast radius?
5. Judge the test plan. Are the *Related tests* the right ones to rerun?
   Are the *New tests needed* sufficient to lock in the fix and close
   the gap the bug slipped through?
6. Assign a verdict — Confirmed / Enhanced / Amended / Disputed — and
   record it per *How to record your review* below.

### Pass 2 — Look for what was missed (gap analysis)

This is where independent review earns its keep. The producer worked from
a hotspot list and a category checklist; your job is to challenge both.

- **Re-rank the hotspots.** Read the rubric in `workflows/sweep.md` and the
  ranking table in `_working/inventory.md`. Did the producer rank files
  correctly? Are there files in the *skim* band (score 3–5) that you'd
  promote to *hotspot* on a read? Pick two or three and read them.
- **Walk the 19-category taxonomy yourself** against the top hotspots and
  the elevated paths (`src/mcp/**`, `src/llm/**`, `src/server/**`,
  `src/macro/**`, `src/services/**`, `src/embedding/**`, `src/storage/**`,
  `src/config/**`, `src/logging/**`, `src/plugins/**`). For each
  category, ask: did the producer surface every instance, or only the
  obvious ones?
- **Apply the AI review layer's semantic checklist** (in
  `audit-method.md`). These are the patterns mechanical tools can't see —
  misleading error handling, weak abstractions, divergent copy-paste,
  agent-contract mismatch, context poisoning, authorization by
  convention, operational blind spots. Each is a likely gap source.
- **Cross-check the Scope & assumptions list** in `Audit Summary.md`. The
  producer recorded tools that didn't run (knip, jscpd, gitleaks, test
  coverage). Each is a category the original Review could not exercise;
  if you can run any of them yourself (the bundled
  `assets/knip.template.json` makes knip tractable), do so and surface
  what the producer couldn't see.
- **Check categories the producer marked as "no findings."** A
  no-findings category is either (a) genuinely clean or (b) under-read.
  Pick the ones that look "convenient" and audit them yourself.

Write any new findings as `FQ-AUDIT-IR-NNNN` per *How to record your
review*.

### Pass 3 — Update the overall record

After Passes 1 and 2, refresh `Audit Summary.md` so the document-level
view reflects the merged audit (see *How to record your review*).

## How to record your review

Follow **Part 7 of `references/output-template.md`** exactly. Summary of
the key mechanics:

- **Fold, don't append.** Each finding remains a single source of truth.
  Your conclusions go directly into the relevant fields (Remediation,
  New tests needed, Severity, etc.) and you log what you did in the
  per-finding `**Audit history**` block at the bottom of the finding.
  The producer's audit-history line should already be there from the
  original pass; you append yours below it.
- **Always log a history line.** Even for `Confirmed`, append a line so
  the audit shows that a second pass examined the finding and agreed.
- **Disputed is the exception.** Do not fold a Disputed verdict — the
  reviewer is saying the finding should not exist. Add the top-of-
  finding blockquote flag (Part 7 shows the format), append a history
  line explaining your reasoning, and leave the original finding body
  verbatim. Matt resolves Disputed findings.
- **Net-new findings get `FQ-AUDIT-IR-NNNN` IDs**, a *Detection source*
  that names this review and your model, and a single Audit history line
  attributing creation to the review.
- **Update `Audit Summary.md`** in three places: the Audit history
  section at the top (one line for your pass), the finding counts /
  primary-category counts (recompute), and the risk heatmap (recompute;
  put an asterisk on Disputed findings).

Your output is the **same document set, edited in place** — not a separate
report. The audit's conclusions are the merged result of the original
pass, the producer's Verify pass, and your review; the per-finding and
document-level Audit history blocks are the running ledger of how it got
there.

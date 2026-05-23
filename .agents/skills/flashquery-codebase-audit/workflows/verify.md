# Workflow: Verify

Verify is the audit's own self-check, run after Report. It is deliberately a
separate workflow: a producer reviewing its own work in the same pass misses
things. Verify reads the finished output document set and holds it to account.

(For a review by a *different* model, see `workflows/independent-review.md` —
that is a separate, stronger check. Verify is the built-in one.)

## What to check

1. **No gaps.** Every category in the chosen scope was actually exercised.
   Nothing the Sweep inventory flagged was silently dropped. Every finding has
   severity, effort, blast radius, and confidence populated.
2. **Self-consistency.** Finding IDs are unique. Cross-references resolve. The
   counts in `Audit Summary.md` match the actual findings. Every finding follows
   the schema in `references/output-template.md`.
3. **Codebase-grounded.** This is the important one. For each finding, confirm
   the file path exists, the line numbers and symbol names are accurate, and the
   diagnosis matches what the code actually does. Verify against the real code —
   do not take the finding's own word for it. No hallucinated or stale findings.

## Resolving problems

- A finding that fails the codebase-grounding check is **corrected** if the real
  issue is clear, or **down-marked to *To verify*** if it cannot be confirmed.
  Never leave an unverified finding marked *Confirmed*.
- A gap — a missed category, a dropped inventory item — is sent back to the
  Review workflow for that category.
- A consistency error — a wrong count, a broken cross-reference — is fixed in
  place.

## How to record what Verify changed

Verify uses the same fold-mode recording convention as Independent Review
(defined in **Part 7 of `references/output-template.md`** — read it before
making changes).

- **Fold corrections directly into the finding body.** Wrong line number →
  fix the line number. Wrong count → fix the count. Wrong severity → change
  the severity. The finding remains a single source of truth.
- **Log every change in the per-finding `**Audit history**` block** at the
  bottom of the affected finding, on a line like:
  ```markdown
  - [YYYY-MM-DD] — Verify ([Model name]): corrected cast site count 9 → 8;
    corrected proportional wording in diagnosis.
  ```
- **Findings that Verify did not change get no history entry from Verify** —
  the absence is itself the signal that Verify reviewed and agreed. (This
  is the one place the convention differs from Independent Review, which
  always logs a line even for Confirmed verdicts.)
- **Always add a per-finding `Audit history` block if one does not exist
  yet.** Report should have created it during the original pass; if it's
  missing, seed it with the producer's creation line:
  ```markdown
  **Audit history**
  - [original-pass-date] — Original ([Model name]): created.
  ```
  Then append the Verify line if Verify changed anything.

## Output

The corrected document set, plus:

- A document-level **Verification note** in `Audit Summary.md` summarizing
  what Verify ran and which findings it changed — this lives in the
  `Audit history` section at the top of the Summary (one line per Verify
  pass) and, if substantial, a longer prose block lower in the document.
- Per-finding `Audit history` entries on every finding Verify changed.

Only then is the audit complete.

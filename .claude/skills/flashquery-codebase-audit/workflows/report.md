# Workflow: Report

The Report workflow turns the findings from Review into the audit's deliverable —
the output document set — exactly as specified by `references/output-template.md`.
Read Part 1 of that document before starting; it is the authoritative spec.

## Output location

The audit writes to a dated folder. Default:

`flashquery-product/Roadmap/Tech Debt/Codebase Audit (DD-MMM-YYYY)/`

— for example `Codebase Audit (19-May-2026)/`. **If the output location has not
been specified, ask the user**, offering this path as the default.

## The document set

A whole-codebase audit is too large for one file. Per
`references/output-template.md`, produce a set inside the dated folder:

- `Audit Summary.md` — metadata header, executive summary, scope & assumptions,
  risk heatmap, finding counts by severity and category, the remediation
  roadmap, and links to the findings files.
- `Findings.md` — every finding as a block, grouped by severity, Critical first.
  Split into `Findings — Critical.md`, `Findings — High.md`, and so on if a
  single file would be unwieldy.
- `Accepted Debt.md` — any baselined findings, listed separately.
- `Appendix — Tool Output.md` — the raw mechanical output from Sweep.

## Steps

1. Confirm the output folder and create the dated folder. (If the orchestrator
   has not already established it — e.g. Report is being invoked standalone —
   ask the user, offering the default path above. The folder must already
   exist if Sweep has run, because Sweep writes to `<output-folder>/_working/`.)
2. Give every finding a stable ID (`FQ-AUDIT-NNNN`). De-duplicate — merge
   findings that are the same underlying issue at multiple sites into one.
3. Order findings by severity, then blast radius, then effort.
4. Write each finding in the exact schema from `references/output-template.md` —
   every field present, **including the final `**Audit history**` block with
   the initial line**:
   ```markdown
   **Audit history**
   - [YYYY-MM-DD] — Original ([Model name]): created.
   ```
   This is the seed line that Verify and Independent Review later append to.
   The *Remediation*, *Related tests*, and *New tests needed* fields exist so
   an AI fix-agent can act without re-investigating; write them that way.
5. Write `Audit Summary.md`: the counts, the risk heatmap, a three-lane
   remediation roadmap (*quick wins*, *before next feature*, *longer-term*),
   and the **document-level Audit history section** at the top (one line per
   pass — for an Original run, just one line):
   ```markdown
   ## Audit history
   - [YYYY-MM-DD] — Original ([Model name]): [N] findings created.
   ```
6. State scope & assumptions honestly — what was audited, what was skipped, and
   any checks that could not run.

## After Report

Hand off to the **Verify** workflow. The report is not final until it has passed
verification. Verify will append its own line to each finding's Audit history
when it changes something, and a line to the document-level Audit history in
the Summary.

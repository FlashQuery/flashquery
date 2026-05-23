# Workflow: Devspec Handoff

The Devspec Handoff workflow turns a batch of audit findings into a development
project by invoking the `fq-devspec` skill with the right inputs, and then
records on each addressed finding that it has been specced.

This is the bridge between *reporting debt* (the audit's job) and *building the
fix* (devspec → dev/test agents). It does NOT write code or tests, and it does
NOT write the Requirements / Test Plan documents itself — those are
`fq-devspec`'s output. This workflow chooses a batch with the user, hands
`fq-devspec` everything it needs, and folds the resulting REQ IDs back into the
findings.

The audit's *Alignment with fq-devspec* section in `references/audit-method.md`
explains why the audit output is shaped to be devspec-ready — read it once if
you have not. This workflow operationalizes that alignment.

This is an on-demand workflow. It runs after `Report` (and usually after
`Verify` and any `Resolve` passes), when the audit document set is settled
enough to drive a remediation project.

## Steps

### Step 1 — Locate the audit and load findings

1. Confirm the dated audit folder. Default offer:
   `flashquery-product/Roadmap/Tech Debt/Codebase Audit (DD-MMM-YYYY)/`. If
   the user did not name one, ask.
2. Read `Audit Summary.md` and every `Findings*.md` file in that folder.
   Build an internal table per finding with: ID, title, severity, effort,
   blast radius, category, whether it has unresolved *Open questions*,
   whether it carries a `Disputed` flag, whether it already carries a
   `Specced:` flag (Step 6 — skip already-specced findings), and any
   `Dependencies / ordering` references to other findings.
3. Note the document-level *Audit history* section in `Audit Summary.md`
   so the new line in Step 7 matches its existing format.

### Step 2 — Summarize the batches

Before asking the user to pick, surface what the audit contains. Present
three views in one tight message:

1. **By severity.** Counts for Critical / High / Medium / Low. List the IDs
   and one-line titles under Critical and High explicitly; the rest as
   counts only.
2. **By theme.** Use the *Executive summary* in `Audit Summary.md` as the
   primary source for themes. If the summary already names clusters (e.g.
   "silent degradation patterns", "fire-and-forget background work"),
   reuse those names and the IDs in each. If the summary does not group,
   infer themes from category overlap and *Dependencies / ordering* links,
   and say so.
3. **Low-hanging fruit.** Findings with `Effort: Quick` AND a small
   `Blast radius` (Single file or Module) that are not blocked by other
   findings. These ship cheaply and clear noise from later batches.

Also call out anything that **disqualifies a finding from being specced this
round**:

- **Unresolved *Open questions*** — route through the `Resolve` workflow
  first. Note it; do not silently include it.
- **`Disputed` flag** — stays out of any batch until the dispute is settled.
- **Cross-batch dependency** — if finding X has `Dependencies / ordering:
  blocked by FQ-AUDIT-Y` and Y is not in the chosen batch, X has to wait or
  the batch has to expand. Flag it; let the user decide.

### Step 3 — Recommend and ask

Recommend a default batch and ask the user to confirm or change it.

**Default recommendation logic:**

- **Primary:** all `Severity: Critical` findings plus all `Severity: High`
  findings that are not blocked or disqualified.
- **Plus opportunistic:** any low-hanging-fruit Mediums or Lows that share a
  theme or file with the Criticals/Highs already in scope. Adding a Quick /
  Single-file finding that sits in the same module as a Critical typically
  costs nothing extra in the spec and consolidates the touch.

Use `AskUserQuestion` with a small set of options, e.g.:

- "Spec the recommended batch (Criticals + High + theme-adjacent Quick wins)"
- "Spec just the Criticals"
- "Spec a single theme — I'll name it"
- "Spec specific IDs — I'll list them"

If the user picks the last two, follow up with a free-form question to get
the names/IDs. Apply the disqualifier rules from Step 2 — if the chosen set
pulls in a finding with unresolved Open questions or a `Disputed` flag, tell
the user and ask whether to drop it from the batch or pause to Resolve
first. Do not silently exclude.

### Step 4 — Confirm output location and feature name

1. **Output folder for the Requirements + Test Plan.** `fq-devspec`'s
   default is "same folder as the research doc." For an audit handoff that
   puts the spec inside the audit folder, which is usually not what the
   user wants. Offer a feature-folder default — for example
   `flashquery-product/Roadmap/Tech Debt/<batch slug>/` — and ask the user
   to confirm or override. The `<batch slug>` is a short, descriptive name
   for the batch (e.g. `Silent Degradation Remediation`).
2. **Feature name.** `fq-devspec` produces `<Feature> Requirements.md` and
   `<Feature> Test Plan.md`. Confirm the feature name with the user;
   default to the batch slug.

### Step 5 — Invoke fq-devspec

Invoke the `fq-devspec` skill via the `Skill` tool. The brief must give
devspec everything it needs to skip its usual "find the research doc, scan
maturity, push back if thin" routine, because the input shape differs from
the feature-research doc it expects.

The briefing prompt must contain, at minimum:

- **Research input (override):** the absolute path to `Audit Summary.md`.
  Tell devspec to treat this as the research document and NOT to look for a
  `*Research*.md` file in the folder.
- **Supporting input:** the absolute path(s) to the `Findings*.md` file(s).
  Each in-scope finding (`FQ-AUDIT-NNNN`) is a resolved decision; its
  *Diagnosis*, *Why it matters*, *Remediation*, *Related tests*, *New tests
  needed*, *Verification*, *Risk of fix*, and *Rollback / fallback* are the
  source material for the spec.
- **Scope — exact IDs:** the list of `FQ-AUDIT-NNNN` IDs in this batch.
  Tell devspec to spec only these and ignore any others in the findings
  file(s).
- **Extract-step mapping (override).** Devspec's `subskills/extract.md`
  walks research-doc `§2 OQ` blocks and `§3 R-section` Implementation-status
  footers — neither of which exists in an audit. Tell devspec to walk the
  in-scope finding blocks instead, and use this field-by-field mapping:

  | Audit finding field | Devspec destination |
  |---|---|
  | *Diagnosis* + *Why it matters* | REQ Description (§6.1.x) |
  | *Remediation* | REQ acceptance criteria (§6.1.x), plus Architecture & Contracts (§7) where it lifts code/contract shapes |
  | *Standard reference* | REQ Notes (§6.1.x) |
  | *Related tests — must be rerun* | Test Plan regression set |
  | *New tests needed* (already layered) | Test Plan per-layer cases (carry the layer classification through verbatim) |
  | *Verification* | Test Plan exit criteria for the related test(s) |
  | *Open questions* (unresolved) | Devspec Step 5 batched gap pass |
  | *Dependencies / ordering* | Devspec Requirements §8 phase ordering |
  | *Risk of fix* + *Rollback / fallback* | REQ Notes (§6.1.x) / Implementation Plan risk callouts |

- **Gap inventory (override):** any unresolved *Open questions* on the
  in-scope findings ARE the gap inventory. Devspec should feed them into
  its Step 5 batched gap pass instead of looking for a research-doc §7
  section. If there are none (because `Resolve` already folded them all
  in), say so — devspec should NOT push back on missing OQs in that case.
- **No POC:** explicitly tell devspec to skip §5.3 / §5.4 / Test Plan §2.6.
  The audit has no executable reference implementation.
- **Push-back rule (override):** devspec normally pushes back at its Step 2
  if a research doc is thin or full of unresolved OQs. Tell it the audit
  summary is mature input by construction — do not push back on that
  ground.
- **Traceability (mandatory):** every `REQ-NNN` it emits MUST cite the
  originating finding(s) in its existing **`**Source.**`** REQ field (see
  `fq-devspec/subskills/write-dev-spec.md` Per-REQ format). Format:
  `**Source.** Audit FQ-AUDIT-NNNN (<relative path to Findings file>).`
  When multiple findings collapse into one REQ, list them comma-separated.
  Step 6 of this workflow relies on this citation to fold the handoff back
  into the findings — without it the mapping is lost.
- **REQ right-sizing is expected.** Devspec's right-sizing rules
  (`fq-devspec/subskills/extract.md` "Right-sizing the REQ list") may
  collapse several thematically related findings into a single REQ with
  several acceptance criteria, or split one large finding across several
  REQs. Either is fine — the `**Source.**` citation captures the
  many-to-many mapping for Step 6.
- **Test layers map directly:** the audit's *New tests needed* already
  classifies tests by devspec's layers (unit / integration / E2E / directed
  scenario / integration scenario). Carry the classification through; do
  not re-derive it.
- **Phasing:** use the *remediation roadmap* lanes from `Audit Summary.md`
  (quick wins / before next feature / longer-term) — or the finer
  *Dependencies / ordering* relationships between in-scope findings — as
  the phase boundaries in Requirements §8.
- **Pipeline advance (override).** Devspec's Step 8 advances the *research
  document's* frontmatter to `status: ready-for-dev`. The audit summary is
  a report, not a pipeline-tracked feature, and has no such status. Tell
  devspec to **skip Step 8 entirely** — this workflow updates the audit
  documents itself in Steps 6 and 7. If the user wants the resulting
  Requirements doc tracked in a pipeline, they can advance its status
  manually or via a follow-on devspec invocation on the Requirements doc.
- **Output location and feature name:** as confirmed in Step 4.

Hand devspec the brief and let it run. Do not pre-write Requirements
content yourself.

### Step 6 — Fold the handoff back into the findings

Once devspec completes, read the Requirements document it produced. Extract
the REQ-NNN ↔ FQ-AUDIT-NNNN mapping from each REQ's `**Source.**` line
(devspec was instructed in Step 5 to cite the originating finding ID(s)
there). The mapping is many-to-many: one finding may produce several REQs,
and several findings may collapse into one REQ. Capture every pairing.

If a REQ does not cite a source `FQ-AUDIT-NNNN`, surface the gap to the
user — do not guess the mapping.

For each finding that was specced, update the finding block in place:

1. **Add a top-of-finding flag** immediately under the finding's `###`
   header, on its own line. Mirrors the `Disputed` flag pattern in Part 7
   of `references/output-template.md`:

   ```markdown
   > **Specced:** [DD-MMM-YYYY] as [REQ-NNN] in [relative path to Requirements doc]
   ```

   If a finding becomes more than one REQ, list them comma-separated.

2. **Append a `Devspec handoff` line to the finding's *Audit history*
   block.** This is a recognized pass type (see Part 7 of
   `references/output-template.md`). Format:

   ```markdown
   - [YYYY-MM-DD] — Devspec handoff (flashquery-codebase-audit): specced as [REQ-NNN] in [Path to Requirements doc].
   ```

Do not modify the finding body itself (Diagnosis, Remediation, tests,
etc.). The finding stays the canonical record of the debt; the spec is the
implementation plan derived from it.

### Step 7 — Update `Audit Summary.md`

Add one line to the document-level *Audit history* section at the top of
`Audit Summary.md`:

```markdown
- [YYYY-MM-DD] — Devspec handoff (flashquery-codebase-audit): specced [N] findings ([list of IDs]) into [Requirements doc path] + [Test Plan path].
```

If a remediation-roadmap or status section in the Summary tracks per-batch
progress, update it too so the Summary stays a useful entry point.

### Step 8 — Close out

In your final message to the user, report:

- The batch chosen (with IDs).
- The two devspec artifacts and where they landed.
- Findings that were deliberately left out and why (unresolved OQs,
  Disputed, blocked by dependencies, user choice).
- Any blocking open questions devspec surfaced during its own Step 5 gap
  pass that still need the user's input before the spec is fully
  `ready-for-dev`.

## Output

- Updated `Findings*.md` file(s) — each specced finding carries a `Specced:`
  flag and a `Devspec handoff` line in its *Audit history*.
- Updated `Audit Summary.md` — one new document-level *Audit history* line
  (and any roadmap/status updates).
- Two new `fq-devspec` artifacts (Requirements + Test Plan) at the location
  chosen in Step 4. These are devspec's output — this workflow does not
  write them.

## Notes

- This workflow only invokes `fq-devspec`. It does not write the spec
  itself. If `fq-devspec` is unavailable, stop and tell the user — do not
  improvise a spec from the audit; that defeats the layering.
- **One batch per run.** If the user wants several batches specced, run
  this workflow multiple times. Findings already carrying a `Specced:`
  flag are filtered out in Step 1, so subsequent runs do not re-spec them.
- **Re-spec scenario:** if the user explicitly wants to re-spec a finding
  (the earlier spec was scrapped), remove the existing `Specced:` flag
  from the finding first, then run this workflow. The prior handoff's
  *Audit history* line stays — it is provenance.

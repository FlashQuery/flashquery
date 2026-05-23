# Workflow: Sweep (Layer 1 — mechanical sweep)

The Sweep runs the deterministic tooling across the codebase to produce a
complete, structured inventory of mechanically-detectable issues, plus a
**hotspot ranking** that tells the Review workflow where to look. Fast,
exhaustive, no judgment — judgment is Review's job.

## Before you start

- Confirm the target repo(s). Default: the `flashquery` repo. Give
  `flashquery-plugins/scripts` a light pass only; skip `flashquery-product`.
- **Every scan must exclude `**/node_modules/**`, `**/dist/**`, AND
  `.claude/worktrees/**`.** The first two are because the repo nests
  `src/node_modules/` and `src/dist/` inside the source tree; the third is
  because `.claude/worktrees/agent-*` are live agent clones of the source —
  any tool walking the tree without exclusions will treat them as duplicate
  source code, swamping real findings.
- Prefer the repo's own scripts where they exist before installing new tools.

## The working area

Sweep, Review, and Report share a working area inside the audit's dated
output folder:

`<output-folder>/_working/`

Write every raw tool output here as a named file (`ripgrep.txt`,
`npm-audit.txt`, `madge-circular.txt`, `knip.txt`, `jscpd-report.json`,
`file-sizes.txt`, `churn.txt`). Report consumes them as the appendix; an
Independent Review run reads them to spot-check claims. Do not put working
files anywhere else — they need to travel with the report.

## Steps

1. **Run the repo's own checks.** `npm run typecheck`, `npm run lint`, and the
   test / coverage scripts where the environment supports them. Capture all
   output. A clean pass is itself a finding — record it as the baseline.
2. **Run the mechanical toolkit.** Work through the *The mechanical toolkit*
   section of `references/audit-method.md` — typescript-eslint, `tsc --noEmit`,
   knip (dead code / unused deps), madge or dpdm (circular deps), jscpd
   (duplication), `npm audit` / `npm outdated`, complexity rules, secret
   scanning, and the ripgrep anti-pattern set listed there.

   **Tool availability:** check `node_modules/.bin/` first. For anything not
   locally installed, use `npx --yes <tool>@latest`. Knip, jscpd, and madge
   all need explicit exclude configuration on this repo. If a tool cannot
   run at all (missing credentials, missing system dep), record it as a scope
   note; never a silent gap.

   **Knip in particular:** without a config it walks the entire tree
   (including `.claude/worktrees/`) and reports thousands of false-positive
   "unused" files. Two options, in order of preference:

   - **Use a repo-local `knip.json`** if one exists at the target repo's root.
   - **Otherwise**, copy `assets/knip.template.json` (bundled with this
     skill) to a temporary location and pass it via
     `npx --yes knip@latest --config <path-to-template>`. The template's
     excludes (`.claude/worktrees/**`, `src/node_modules/**`,
     `src/dist/**`, `tests/**`, `scripts/**`, `setup/**`) are calibrated for
     FlashQuery and produce usable output. Record in *Scope & assumptions*
     that the template was used so a future run can either keep using it or
     promote it to a committed `knip.json` in the repo.
3. **Record every result** into a structured inventory file in `_working/`
   (typically `_working/inventory.md`): the tool, the taxonomy category it
   maps to (A–S), the file/location, and the raw finding. Do not yet assign
   severity — that is Review's call.
4. **Score hotspots.** Rank files and modules by combined risk signal:

   **Signals (each rated 0–3):**
   - **Size** — LOC. 0 if <200, 1 if 200–500, 2 if 500–1000, 3 if >1000.
   - **Churn** — commits touching the file in the last 6 months
     (`git log --since="6 months ago" --pretty=format: --name-only`). 0 if
     <5, 1 if 5–15, 2 if 15–30, 3 if >30.
   - **Escape-hatch density** — count of ripgrep hits in the file for
     `as any` / `@ts-ignore` / `eslint-disable` / block-level disables /
     `as unknown as` / non-null `!` assertions. 0 if 0, 1 if 1–2, 2 if 3–5,
     3 if >5.
   - **Architectural centrality** — does the file sit on one of the elevated
     paths from *FlashQuery-specific calibration* (`src/mcp/**`,
     `src/server/**`, `src/llm/**`, `src/macro/**`, `src/plugins/**`,
     `src/embedding/**`, `src/storage/**`, `src/config/**`,
     `src/logging/**`), and/or does it participate in a circular dependency?
     0 if no, 1 if elevated path OR cycle, 2 if both, 3 if both AND it sits
     at the centre of the cycle (i.e. multiple cycles converge on it).

   **Score:** sum of the four signals (0–12). Files scoring ≥6 are
   *hotspots* and get full AI-review attention in the next phase. Files
   scoring 3–5 get a skim. Below 3, mechanical-only.

   Ties broken by churn (higher = higher priority), then size.

## Output

Hand the Review workflow two things:

- the **structured inventory** at `_working/inventory.md` — every mechanical
  hit, categorized;
- the **ranked hotspot list** — table at the bottom of the inventory file,
  ranked by score, broken into the three bands above.

The raw tool output in `_working/` also becomes the report's appendix (see
`workflows/report.md`).

If a check could not run — missing credentials, no local service, a tool not
installable — record that explicitly. It becomes a *Scope & assumptions* note
in the report, never a silent gap.

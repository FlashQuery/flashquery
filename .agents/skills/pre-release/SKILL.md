---
name: pre-release
description: Run the FlashQuery pre-release workflow before cutting a new version, or audit an already-drafted changelog entry before publishing. Use this skill whenever the user wants to prepare a release, update the changelog for a new version, decide what version number to use, cut a release, ship a version, or says things like "let's release this", "what version should this be", "update the changelog", "prepare the release notes", "is this ready to ship", or "bump the version". Also use it when the user wants to validate, audit, or double-check an existing changelog entry before tagging — phrases like "validate the changelog", "audit the release", "is the changelog ready to publish", "double-check the release notes", "pre-publish check", "review the changelog entry", or "verify before I tag". This skill contains two workflows: one for drafting a new release entry (Phases 1–7), and one for auditing an already-written entry before publishing (Pre-Publish Audit). Invoke it for any release-related checkpoint.
---

# FlashQuery Pre-Release Workflow

This skill walks through every step needed to safely cut a FlashQuery release. Each phase has a clear gate — if a phase surfaces a problem, resolve it before moving on. The goal is a changelog entry and version bump that are accurate, complete, and confirmed by the developer before anything is committed.

---

## Phase 1: Coverage Audit

Read both coverage matrices:
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md`

You're looking for two things:

**Uncovered behaviors** — rows where `Covered By` is empty. These are declared behaviors with no test at all. If any of them relate to the features being released, flag them — shipping a feature whose behavior is explicitly declared but never exercised is a risk.

**Stale coverage** — rows where `Date Updated` is more recent than `Last Passing`. This means the behavior was added or changed after the last passing run, so the test may not reflect current code. Cross-reference with the branch's changed files (`git diff main...HEAD --name-only`) to judge whether the staleness is relevant to this release.

If you find relevant gaps or stale rows, report them clearly:
```
Coverage issue: [ID] — [Behavior] — Covered By: [test or empty] — Last Passing: [date or never]
```

Ask the user whether to proceed anyway or address the gap first. Don't block on coverage issues in unrelated areas (e.g., a stale plugin reconciliation row when releasing filesystem tools), but be transparent about what you found.

---

## Phase 2: Preflight Gate

Check whether `npm run preflight` has been run recently on this branch. If you're uncertain, run it now:

```bash
npm run preflight
```

This runs lint, unit tests, package contents check, and Docker Compose validation. If it fails, stop and report which step failed. Do not proceed with the release until preflight passes or the user explicitly overrides.

If preflight was already run and passed in this session (e.g., via the `/pre-push` skill), you can skip re-running it — just note that it passed.

---

## Phase 3: Docs Audit

Review the following files against the changes being released:

- `README.md` (root)
- All files under `docs/`

For each changed area (new MCP tools, changed config schema, new CLI commands, removed tools, changed behavior), ask: would a developer reading the docs to set up or use FlashQuery have an accurate picture after this release? Specifically check:

- **New MCP tools** — Are they mentioned in the README or any setup guide?
- **Removed or renamed tools** — Is the old name still referenced anywhere in docs?
- **Config schema changes** — Does `flashquery.example.yml` or any doc reflect the new shape?
- **New CLI commands** — Does the README or `docs/DEPLOYMENT.md` mention them?

Report any docs that need updating and suggest the specific change. If docs gaps exist, decide with the user whether to fix them before or after the changelog entry.

---

## Phase 4: Version Bump Decision

Determine the right version bump based on what changed. Use these rules — they derive from Semantic Versioning 2.0 and reflect what users actually care about:

| Bump | When | FlashQuery examples |
|------|------|---------------------|
| **PATCH** `1.2.x → 1.2.x+1` | Bug fix only — no new features, no behavior changes for users | Fix a crash, fix a test, fix a CI step, fix a doc typo |
| **MINOR** `1.x.0 → 1.x+1.0` | New backwards-compatible capability — users can ignore it and nothing breaks | New MCP tool, new optional config field with a default, new CLI command |
| **MAJOR** `x.0.0 → x+1.0.0` | Breaking change — users must update their setup to continue working | Remove or rename an existing MCP tool, incompatible config schema change, drop a supported Node.js LTS version |

The key question for MINOR vs MAJOR: if a user upgrades without changing their `flashquery.yml` or their tool calls, does everything still work? If yes → MINOR or PATCH. If no → MAJOR.

Examine `git log main..HEAD --oneline` and `git diff main...HEAD --name-only` to inventory the changes. State your recommendation and the reasoning. The user should confirm before you proceed.

---

## Phase 5: Draft the CHANGELOG Entry

Draft the entry using the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Use only the sections that apply:

```markdown
## [X.Y.Z] - YYYY-MM-DD

> [preamble — for MINOR and MAJOR bumps only]

### Added
- ...

### Changed
- ...

### Deprecated
- ...

### Removed
- ...

### Fixed
- ...

### Security
- ...
```

**Preamble** (MINOR/MAJOR releases only): Write 1–2 sentences that capture the significance and reasoning behind the release at a glance. This is for the developer scanning the changelog to understand *why* this version matters, not just *what* changed. Think of it as the release's headline. Leave it out entirely for patch releases — the Fixed entries tell the story.

Good preamble example:
> This release introduces native filesystem navigation to the vault. The new `list_vault`, `create_directory`, and `remove_directory` tools give AI tools direct control over vault structure without requiring manual file system access.

**Entry style rules:**
- One bullet per distinct behavior, not per commit
- Lead with the capability, not the implementation: "Add `create_directory` MCP tool" not "Implement handler in files.ts"
- Breaking changes get a `**BREAKING:**` prefix on their bullet
- Omit sections that have no entries — don't include empty `### Deprecated` headings

Source the entries from:
- `git log main..HEAD --oneline` — what commits are on this branch
- The coverage matrices — what behaviors were added or changed
- Your Phase 3 docs audit — anything user-visible that changed

---

## Phase 6: User Confirmation

Present the full draft entry to the user before writing anything to disk:

```
Here's the proposed [X.Y.Z] changelog entry. Please review and let me know if anything needs changing before I commit it.

---
[draft entry here]
---

Does this look right? Any additions, corrections, or wording changes?
```

Wait for an explicit go-ahead. If the user requests changes, revise the draft and present it again. Don't write to `CHANGELOG.md` until the user confirms.

---

## Phase 7: Write and Verify

Once the user confirms:

1. **Update `CHANGELOG.md`**: Insert the new versioned entry directly below the `## [Unreleased]` heading. Keep `[Unreleased]` at the top (empty). Add the comparison URL reference link at the bottom of the file:
   ```
   [X.Y.Z]: https://github.com/FlashQuery/flashquery/compare/vPREV...vX.Y.Z
   ```
   Also update the `[Unreleased]` reference link to point from the new version to HEAD.

2. **Update `package.json`**: Set `"version"` to the new version number.

3. **Verification pass**: Re-read the finished `CHANGELOG.md` entry against the commit log and coverage matrices. Confirm:
   - No significant user-visible change was omitted
   - All entries are in the correct section (Added/Changed/Removed/Fixed/Security)
   - The preamble (if present) accurately describes the release's significance
   - Version numbers are consistent between `CHANGELOG.md` and `package.json`
   - The reference link at the bottom points to the correct comparison range

Report what you verified and flag anything that needed a correction.

---

# Pre-Publish Audit Workflow

Run this after any post-`pre-release` changes, or any time you want a final confidence check before tagging and pushing. It applies all seven lenses from the main workflow to the entry that's already in `CHANGELOG.md` and produces a findings report.

**This workflow is read-only.** It surfaces issues for you to address; it writes nothing.

---

## Audit Step 1: Identify the Entry

Read `CHANGELOG.md`. The entry under review is the first versioned heading after `## [Unreleased]` — the `## [X.Y.Z] - YYYY-MM-DD` line. Note the version, date, and which change sections are present.

Also check whether `## [Unreleased]` has any content. Items left there that belong in the versioned entry are a common oversight worth catching early.

---

## Audit Step 2: Coverage Check

Read both coverage matrices:
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md`

For each tool or behavior mentioned in the entry's Added/Changed/Removed sections, find its corresponding coverage rows. Flag any that have no `Covered By` entry (never tested) or where `Date Updated` is more recent than `Last Passing` (behavior declared but not re-verified). Unrelated stale rows don't need to be flagged — focus on what's in this release.

---

## Audit Step 3: Preflight

Run `npm run preflight` if it hasn't passed in this session. A failing preflight is a BLOCKING issue — the release should not be tagged until it passes.

---

## Audit Step 4: Docs Consistency

For each user-visible change in the entry (new tools, removed tools, config changes, new CLI commands), verify `README.md` and all files under `docs/` reflect the current state. The test: would a developer reading the docs after upgrading have an accurate picture? Anything misleading or missing is a BLOCKING issue.

---

## Audit Step 5: Version Correctness

Apply the SemVer rules to verify the bump is right:

- Any removal or rename of an existing MCP tool, or incompatible config schema change → must be MAJOR
- Any new tool, new optional config field, or new CLI command → must be MINOR (at minimum)
- Bug fixes only, no new capabilities → PATCH is correct

If the entry's version is under-bumped (e.g., new tools labeled as a patch), that's BLOCKING. If it's over-bumped, flag it as ADVISORY.

---

## Audit Step 6: Entry Quality Review

Read the entry itself against the writing standards:

**Completeness** — Run `git log main..HEAD --oneline` and compare against the entry's bullets. Any user-visible change missing from the entry is an issue. Internal refactors and test-only changes don't need changelog entries, but anything that changes observable behavior or adds/removes a capability does.

**Preamble** — For a MINOR or MAJOR entry: is there a 1–2 sentence preamble capturing the significance? Does it describe the *why*, not just the what? For a PATCH entry: the preamble should be absent.

**Section placement** — Are all bullets in the right section? New capabilities → Added. Behavioral shifts in existing features → Changed. Deletions → Removed. Defect fixes → Fixed. Misplaced entries dilute the signal for users scanning the changelog.

**Writing style** — Bullets should lead with the user-facing capability, not the implementation detail. Flag any bullet that reads like a commit message ("Implement handler in files.ts") rather than a changelog entry ("Add `create_directory` MCP tool").

**Breaking changes** — Any breaking change must carry a `**BREAKING:**` prefix on its bullet.

---

## Audit Step 7: Consistency Check

Verify these mechanical details, which are easy to miss after editing:

- `package.json` `"version"` matches the entry version exactly
- The `[X.Y.Z]: https://github.com/FlashQuery/flashquery/compare/vPREV...vX.Y.Z` reference link at the bottom exists and points to the right range
- The `[Unreleased]: https://...` link points from the new version tag to HEAD
- No empty section headings (a `### Added` with no bullets underneath it)

---

## Report Format

Produce a structured findings report:

```
Pre-Publish Audit: [X.Y.Z] — [date]
=====================================

BLOCKING (must resolve before tagging):
  [Step N] — [specific issue and what to do about it]

ADVISORY (recommended but not blocking):
  [Step N] — [specific issue and what to do about it]

Checked and clear:
  ✓ Coverage — all release-relevant behaviors covered and passing
  ✓ Preflight — passed
  ✓ Docs — README and docs/ consistent with entry
  ✓ Version bump — correct (MINOR: new MCP tools, no breaking changes)
  ✓ Completeness — all user-visible commits accounted for
  ✓ Writing style — bullets capability-led, sections correct
  ✓ Consistency — package.json and reference links match
```

If there are no issues at all, lead with that: **"Pre-Publish Audit: [X.Y.Z] — No issues found. Ready to tag and publish."**

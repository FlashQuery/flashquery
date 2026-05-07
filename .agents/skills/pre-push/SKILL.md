---
name: pre-push
description: Run the FlashQuery preflight check before any git push. Use this skill whenever you are about to execute `git push`, push to a remote branch, create a pull request, or push commits upstream — even if the user just says "push it", "ship it", "push these changes", "push to main", "push to origin", or any other casual phrasing that means committing code to the remote repository. The preflight must pass before the push happens. This is a hard gate, not a suggestion.
---

# Pre-Push Preflight Gate

Before pushing any commits to the remote repository, run the preflight check. This mirrors exactly what CI will run, so failures here are failures that would block the PR anyway — catching them locally saves a round-trip.

## The gate

Run:

```bash
npm run preflight
```

This runs four checks in sequence:

1. **Lint** — ESLint with zero warnings tolerance
2. **Tests** — Unit test suite (excludes two known macOS-only deferred failures in `git-manager` and `compound-tools`)
3. **Package contents** — Verifies no `src/`, `tests/`, or `.env` files sneak into the published npm package
4. **Docker Compose** — Validates all three compose files structurally (skipped automatically if Docker is not installed)

## Decision tree

**If preflight passes (exit 0):**
Proceed with `git push` as planned. No announcement needed — just push.

**If preflight fails:**
- Report which step failed and paste the relevant error output
- Do NOT push
- Ask the user: "Preflight failed on [step]. Fix it before pushing, or override?"
- Only push if the user explicitly says to override

## Override

If the user explicitly asks to push despite a failure ("push anyway", "skip preflight", "I know it's broken, just push"), respect that. State what failed and that you're overriding at their request, then push.

Do not override silently or on your own initiative. The point of the gate is that it requires a conscious human decision to bypass.

## What the preflight does NOT cover

- Integration tests (`npm run test:integration`) — these require a live Supabase instance and are not part of preflight
- E2E tests (`npm run test:e2e`) — same; run manually when needed
- The two deferred test files (`git-manager.test.ts`, `compound-tools.test.ts`) — known macOS failures that pass on CI; tracked separately

CI runs the full test suite including the deferred files. If the user is specifically working on git or compound-tool code, suggest running `npm test` (the full suite) in addition to preflight.

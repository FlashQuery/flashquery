---
phase: 105-config-template-updates
plan: 01
subsystem: config
tags: [yaml, env, templates, llm-config, three-layer-config, openai, provider-model-purpose]

# Dependency graph
requires:
  - phase: 105-00
    provides: "RED-state TDD scaffold (8 TMPL-01 tests) defining exact required structure for the v3.0 three-layer LLM config templates"
provides:
  - "flashquery.example.yml with canonical v3.0 three-layer LLM config (providers + models + purposes) replacing stale gpt-4o/default-purpose content"
  - ".env.example with OPENAI_API_KEY promoted to active (uncommented) entry in LLM Providers section"
  - ".env.test.example with commented OPENROUTER_API_KEY entry for multi-provider test scenarios"
  - "All 8 [TMPL-01] tests passing GREEN — TMPL-01 requirement satisfied"
affects:
  - "New user onboarding — un-comment llm: block + set OPENAI_API_KEY → working three-layer config"
  - "Phase 105 milestone closure — TMPL-01 complete, v3.0 template baseline established"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Double-comment prefix (# # ) for sub-example entries that stay commented even when user un-comments the default block"
    - "Single-comment prefix (# ) for default shipping config entries that become active when user un-comments the llm: section"

key-files:
  created: []
  modified:
    - flashquery.example.yml
    - .env.example
    - .env.test.example

key-decisions:
  - "D-02: Default provider endpoint is https://api.openai.com/v1 (with /v1) — old https://api.openai.com (missing /v1) removed"
  - "D-03: Two default models: embeddings (text-embedding-3-small, embedding type, 0.02/0.00) and fast (gpt-5-nano, language type, 0.15/0.60)"
  - "D-04: Two default purposes: embedding (models: [embeddings]) and general (models: [fast]) — no 'default' purpose name"
  - "D-05: Additional provider/model/purpose examples (openrouter, ollama, smart, summarization) remain as double-commented sub-examples"
  - "D-07: OPENAI_API_KEY promoted from comment-example to active entry (OPENAI_API_KEY=sk-proj-...) in .env.example LLM Providers section"
  - "D-11: Commented OPENROUTER_API_KEY= entry appended to .env.test.example after OLLAMA_URL line"
  - "D-13: provider_name: (snake_case per Zod ModelSchema) used for all model entries — never bare provider:"
  - "D-14: src/index.ts NOT modified — ready banner update is out of scope (Phase 104 D-08 deferral)"

patterns-established:
  - "Template double-comment pattern: # # prefix for sub-examples that must not activate when the default block is un-commented by a user"

requirements-completed: [TMPL-01]

# Metrics
duration: 3min
completed: 2026-04-30
---

# Phase 105 Plan 01: Config Template Updates Summary

**Replaced stale three-template LLM config with canonical v3.0 providers/models/purposes structure using openai provider, embeddings+fast default models, and embedding+general default purposes — all 8 TMPL-01 tests now pass GREEN**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-30T03:40:27Z
- **Completed:** 2026-04-30T03:43:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced entire commented `# llm:` section in `flashquery.example.yml` with the canonical v3.0 default shipping config: 1 provider (openai with `/v1` endpoint), 2 default models (`embeddings`/text-embedding-3-small and `fast`/gpt-5-nano), 2 default purposes (`embedding` and `general`), plus double-commented sub-examples (openrouter, ollama, smart, summarization)
- Promoted `OPENAI_API_KEY` from a comment-example to an active variable entry in `.env.example` LLM Providers section, with full inline documentation
- Appended a commented `# OPENROUTER_API_KEY=` entry to `.env.test.example` for multi-provider directed scenario use
- Full unit test suite: 71 files, 1301 tests — all passed, zero new failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace flashquery.example.yml LLM section** - `aa33578` (feat)
2. **Task 2: Update .env.example + .env.test.example** - `f9db3fc` (feat)

**Plan metadata:** (see final docs commit below)

## Files Modified

| File | Lines before | Lines after | Delta | What changed |
|------|-------------|-------------|-------|--------------|
| `flashquery.example.yml` | 232 | 264 | +32 | LLM section lines 191–232 replaced with canonical v3.0 block |
| `.env.example` | 151 | 148 | -3 net (+11/-14) | LLM Providers section rewritten; OPENAI_API_KEY promoted to active entry |
| `.env.test.example` | 52 | 55 | +3 | OPENROUTER_API_KEY commented entry appended after OLLAMA_URL |

## Decision-to-File Mapping

| Decision | File | Lines edited |
|----------|------|-------------|
| D-01: Replace entire llm: block | flashquery.example.yml | 191–232 → 191–264 |
| D-02: Endpoint https://api.openai.com/v1 | flashquery.example.yml | Provider endpoint line |
| D-03: Two default models (embeddings, fast) | flashquery.example.yml | Models block |
| D-04: Two default purposes (embedding, general) | flashquery.example.yml | Purposes block |
| D-05: Double-commented sub-examples | flashquery.example.yml | All # # lines |
| D-06: Section header + NOTE paragraph | flashquery.example.yml | Lines 191–202 |
| D-07: OPENAI_API_KEY active entry | .env.example | Lines 83–96 |
| D-08: OPENROUTER_API_KEY + GROQ_API_KEY commented | .env.example | Lines 95–96 |
| D-09: EMBEDDING_API_KEY unchanged | .env.example | Lines 99+ (untouched) |
| D-10: OPENAI_API_KEY= preserved | .env.test.example | Line 49 (untouched) |
| D-11: OPENROUTER_API_KEY= commented entry | .env.test.example | Lines 53–55 (new) |
| D-13: provider_name: (not provider:) | flashquery.example.yml | All model entries |
| D-14: src/index.ts NOT modified | — | Not touched |

## Test Results

- **[TMPL-01] tests:** 8/8 passed GREEN (previously 0/8 — all RED in 105-00)
- **Full unit suite:** 71 test files, 1301 tests — 0 failures (baseline preserved)
- **Regression check:** No new failures introduced by template-only changes

## Decisions Made

- Used Edit tool (not Write) for all three files to guarantee only the targeted blocks changed — the remainder of each file is preserved byte-for-byte (T-105-06 mitigation)
- Verified `api_key: ${OPENAI_API_KEY}` uses env-var reference syntax (not a real key) per T-105-04 and T-105-05 threat mitigations
- Confirmed directional word "above" in NOTE paragraph is correct — the legacy `embedding:` section appears at lines 150–167, above the LLM section at 191+

## Deviations from Plan

None — plan executed exactly as written. All three files modified exactly as specified in `<canonical_replacement_blocks>`. No source code changes, no schema changes, no test changes beyond what was already committed in 105-00.

## Issues Encountered

Minor: `grep -c "api_key: \${OPENAI_API_KEY}"` returned 0 due to shell double-quote expansion of `\$` — the file content was correct as confirmed by `grep -cF 'api_key: ${OPENAI_API_KEY}'` returning 1. This was a test-command shell escaping issue, not a file content issue.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. Template files are not loaded at runtime. All security-relevant surface was pre-existing:
- T-105-04: `api_key: ${OPENAI_API_KEY}` uses env-var reference — no real key in template. PASS.
- T-105-05: `OPENAI_API_KEY=sk-proj-...` uses placeholder — no real key. PASS.
- T-105-06: Edit tool used (not Write) — only targeted blocks changed. PASS.

## User Setup Required

None — no external service configuration required. Users copying these templates get working defaults; `OPENAI_API_KEY` in `.env` is the only secret needed to enable the LLM system.

## Phase 105 Closure Note

TMPL-01 is now complete. The three template files accurately reflect the v3.0 three-layer LLM config structure. A new user can:
1. Copy `flashquery.example.yml` to `flashquery.yml`
2. Un-comment the `# llm:` block
3. Set `OPENAI_API_KEY` in `.env`
4. Run FlashQuery — the config passes `loadConfig()` Zod validation without error

Phase 105 milestone (v3.0 template baseline) is ready for verification.

## Next Phase Readiness

- TMPL-01 requirement satisfied — no follow-up template work needed
- The ready banner update in `src/index.ts` (Phase 104 D-08 deferral, D-14) remains deferred to a future cleanup PR
- No blockers for subsequent milestone work

---
*Phase: 105-config-template-updates*
*Completed: 2026-04-30*

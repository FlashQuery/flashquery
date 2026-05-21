# cases-ts/ — TypeScript escape-hatch tests

Almost every framework test is a declarative YAML pilot under `cases/`, run by
the shared runner. This directory is the escape hatch for the rare test that
genuinely needs imperative TypeScript instead of the YAML schema.

The Vitest config (`tests/config/vitest.macro-framework.config.ts`) includes
`tests/macro-framework/cases-ts/**/*.test.ts`, so any `*.test.ts` file dropped
here is picked up automatically alongside the YAML corpus.

It is normally empty — that is expected. Prefer a YAML pilot under `cases/`
unless the test cannot be expressed declaratively.

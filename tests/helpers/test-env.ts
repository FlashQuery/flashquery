/**
 * Centralized test environment configuration.
 *
 * All integration/e2e tests import connection details from here instead of
 * hardcoding URLs. Values come from environment variables (loaded from
 * .env.test by vitest via dotenv). No hardcoded fallback defaults — if
 * .env.test is missing, tests that need Supabase will skip gracefully.
 *
 * Setup:
 *   cp .env.test.example .env.test   # then fill in your values
 */

/** Supabase REST API URL (e.g. http://192.168.15.13:8000 or https://xyz.supabase.co) */
export const TEST_SUPABASE_URL = process.env.SUPABASE_URL ?? '';

/** Supabase service_role JWT */
export const TEST_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Postgres connection string for direct DB access */
export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';

/** OpenAI API key for embedding tests */
export const TEST_OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

/** Ollama URL for local embedding tests */
export const TEST_OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

/** True when all required Supabase env vars are set — use to skip tests otherwise */
export const HAS_SUPABASE = !!(TEST_SUPABASE_URL && TEST_SUPABASE_KEY && TEST_DATABASE_URL);

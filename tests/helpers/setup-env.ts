/**
 * Vitest setup file — loads .env.test so all test helpers pick up
 * SUPABASE_URL, DATABASE_URL, etc. from a single file.
 *
 * Load order (later files override earlier):
 *   1. .env.test        — your personal test credentials
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../.env.test') });

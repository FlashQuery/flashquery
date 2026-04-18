-- FlashQuery Core — PostgreSQL Extension Initialization
-- This script runs automatically on first container start from
-- /docker-entrypoint-initdb.d/ in the supabase/postgres container.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS prevents errors on re-init.
-- pgvector is pre-built in supabase/postgres:15.8.1.085 — no compilation needed.

CREATE EXTENSION IF NOT EXISTS vector;

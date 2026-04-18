-- FlashQuery Core — Supabase Role Bootstrap
-- Runs before 01-extensions.sql (lexicographic order).
--
-- The supabase/postgres image ships supautils, which intercepts CREATE EXTENSION
-- and requires supabase_admin to exist as the privileged_extensions_superuser.
-- Without this role, even "CREATE EXTENSION vector" fails at container init time.
--
-- This script creates the minimum set of roles required for the bundled stack
-- (supabase_admin, supabase_auth_admin, authenticator, anon, authenticated,
-- service_role) so that the postgres image's supautils hook, GoTrue migrations,
-- and PostgREST all start cleanly.

-- Core superuser role required by supautils for privileged extension creation.
DO $$ BEGIN
  CREATE ROLE supabase_admin WITH LOGIN SUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- GoTrue auth admin role.
DO $$ BEGIN
  CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PostgREST authenticator — connects to DB on behalf of clients.
DO $$ BEGIN
  CREATE ROLE authenticator NOINHERIT LOGIN NOREPLICATION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- JWT roles granted to PostgREST requests by role claim.
DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grant JWT roles to authenticator so PostgREST can switch to them.
GRANT anon, authenticated, service_role TO authenticator;

-- Grant auth admin privileges.
GRANT supabase_auth_admin TO supabase_admin;

-- Create schemas expected by GoTrue and PostgREST.
-- GoTrue's DB URL has ?search_path=auth — the schema must exist before migrations run.
CREATE SCHEMA IF NOT EXISTS auth;
ALTER SCHEMA auth OWNER TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres;

-- extensions schema (supabase convention for shared extensions).
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

import { describe, it, expect } from 'vitest';
import { maskConnectionUrl, buildSchemaDDL } from '../../src/storage/supabase.js';

describe('maskConnectionUrl', () => {
  it('masks user and password in postgresql:// URLs', () => {
    const result = maskConnectionUrl(
      'postgresql://postgres:secretpass@db.supabase.co:5432/postgres'
    );
    expect(result).toBe('postgresql://***:***@db.supabase.co:5432/postgres');
  });

  it('masks percent-encoded credentials', () => {
    const result = maskConnectionUrl('postgresql://user:p%40ss@host:5432/db');
    expect(result).toBe('postgresql://***:***@host:5432/db');
  });
});

describe('buildSchemaDDL', () => {
  it('uses the provided dimensions parameter (1536)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('vector(1536)');
  });

  it('uses the provided dimensions parameter (768) and does NOT hardcode 1536', () => {
    const ddl = buildSchemaDDL(768);
    expect(ddl).toContain('vector(768)');
    expect(ddl).not.toContain('vector(1536)');
  });

  it('creates fqc_memory table', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_memory');
  });

  it('creates fqc_vault table (fqc_projects removed in v1.7 — CLEAN-01)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS fqc_projects');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_vault');
    expect(ddl).toContain('idx_fqc_vault_instance');
  });

  it('creates fqc_plugin_registry table', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_plugin_registry');
  });

  it('does NOT create fqc_routing_rules table (CLEAN-02: removed in v1.7)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS fqc_routing_rules');
  });

  it('does NOT create fqc_event_log table (CLEAN-01: removed in v1.7)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS fqc_event_log');
  });

  it('enables the pgvector extension', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE EXTENSION IF NOT EXISTS vector');
  });

  it('creates the match_memories RPC function', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE OR REPLACE FUNCTION match_memories');
  });

  it('creates the HNSW embedding index on fqc_memory', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS idx_fqc_memory_embedding');
  });

  it('creates fqc_documents table with no DEFAULT on id', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_documents');
    expect(ddl).toContain('id UUID PRIMARY KEY,');
    expect(ddl).toContain('content_hash TEXT');
  });

  it('creates fqc_documents indexes including HNSW and instance_path unique index', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('idx_fqc_documents_embedding');
    expect(ddl).toContain('idx_fqc_documents_instance');
    expect(ddl).toContain('idx_fqc_documents_instance_path');
    expect(ddl).toContain('idx_fqc_documents_status');
    expect(ddl).not.toContain('idx_fqc_documents_project');
  });

  it('creates the match_documents RPC function without filter_project parameter', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE OR REPLACE FUNCTION match_documents');
    expect(ddl).toContain('embedding IS NOT NULL');
    expect(ddl).toContain('path text');
    expect(ddl).not.toContain('vault_path text');
    // match_documents should not have filter_project; check by extracting that function's block
    const matchDocStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_documents');
    const matchDocEnd = ddl.indexOf('$$;', matchDocStart) + 3;
    const matchDocBlock = ddl.slice(matchDocStart, matchDocEnd);
    expect(matchDocBlock).not.toContain('filter_project');
  });
});

describe('Phase 23 DDL updates', () => {
  it('does NOT contain user_id column definition in fqc_memory CREATE TABLE', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain("user_id TEXT DEFAULT 'default'");
  });

  it('does NOT contain category column definition in fqc_memory CREATE TABLE', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('category TEXT,');
  });

  it('does NOT contain source_context column definition in fqc_memory CREATE TABLE', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('source_context TEXT,');
  });

  it('contains ALTER TABLE DROP COLUMN IF EXISTS user_id', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS user_id');
  });

  it('contains ALTER TABLE DROP COLUMN IF EXISTS category', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS category');
  });

  it('contains ALTER TABLE DROP COLUMN IF EXISTS source_context', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS source_context');
  });

  it('enables pg_trgm extension', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  });

  it('creates find_plugin_scope RPC function', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('CREATE OR REPLACE FUNCTION find_plugin_scope');
  });

  it('find_plugin_scope uses similarity(plugin_id, search_name)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('similarity(plugin_id, search_name)');
  });

  it('match_memories RETURNS TABLE does NOT contain category', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const matchMemoriesFn = ddl.substring(fnStart, fnEnd);
    expect(matchMemoriesFn).not.toContain('category');
  });

  it('match_memories RETURNS TABLE does NOT contain source_context', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const matchMemoriesFn = ddl.substring(fnStart, fnEnd);
    expect(matchMemoriesFn).not.toContain('source_context');
  });

  it('match_memories RETURNS TABLE contains plugin_scope text', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const matchMemoriesFn = ddl.substring(fnStart, fnEnd);
    expect(matchMemoriesFn).toContain('plugin_scope text');
  });

  it('match_memories SELECT clause does NOT contain m.category', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('m.category');
  });

  it('match_memories SELECT clause does NOT contain m.source_context', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('m.source_context');
  });

  it('fqc_memory CREATE TABLE still contains plugin_scope column', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain("plugin_scope TEXT DEFAULT 'global'");
  });

  it('idx_fqc_memory_project index is removed (PROJ-04)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('idx_fqc_memory_project');
  });

  it('Phase 31 drops project column from fqc_documents and fqc_memory (PROJ-04)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS project');
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_memory DROP COLUMN IF EXISTS project');
  });

  it('fqc_memory CREATE TABLE has no project column (PROJ-04)', () => {
    const ddl = buildSchemaDDL(1536);
    const tableStart = ddl.indexOf('CREATE TABLE IF NOT EXISTS fqc_memory');
    const tableEnd = ddl.indexOf(');', tableStart);
    const tableBlock = ddl.slice(tableStart, tableEnd);
    expect(tableBlock).not.toContain('project TEXT');
  });

  it('match_memories RETURNS TABLE has no project field (PROJ-05)', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    const returnsStart = block.indexOf('RETURNS TABLE');
    const returnsEnd = block.indexOf(')', returnsStart);
    const returnsBlock = block.slice(returnsStart, returnsEnd);
    expect(returnsBlock).not.toContain('project');
  });
});

describe('Phase 33 DDL updates (tag_match support)', () => {
  it('match_memories has filter_tag_match param with default any', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    expect(block).toContain("filter_tag_match text DEFAULT 'any'");
  });

  it('match_memories does NOT contain filter_project param', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).not.toContain('filter_project');
  });

  it('match_memories WHERE clause uses CASE for tag matching with @> and &&', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_memories');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    expect(block).toContain("CASE WHEN filter_tag_match = 'all'");
    expect(block).toContain('m.tags @> filter_tags');
    expect(block).toContain('m.tags && filter_tags');
  });

  it('match_documents has filter_tags param', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_documents');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    expect(block).toContain('filter_tags text[] DEFAULT NULL');
  });

  it('match_documents has filter_tag_match param with default any', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_documents');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    expect(block).toContain("filter_tag_match text DEFAULT 'any'");
  });

  it('match_documents WHERE clause uses CASE for tag matching with @> and &&', () => {
    const ddl = buildSchemaDDL(1536);
    const fnStart = ddl.indexOf('CREATE OR REPLACE FUNCTION match_documents');
    const fnEnd = ddl.indexOf('$$;', fnStart) + 3;
    const block = ddl.slice(fnStart, fnEnd);
    expect(block).toContain("CASE WHEN filter_tag_match = 'all'");
    expect(block).toContain('d.tags @> filter_tags');
    expect(block).toContain('d.tags && filter_tags');
  });

  it('DROP match_memories targets the old 6-param signature (vector, double precision, integer, text, text[], text)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain(
      'DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text[], text) CASCADE'
    );
  });

  it('DROP match_documents targets the old 4-param signature (vector, double precision, integer, text)', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain(
      'DROP FUNCTION IF EXISTS match_documents(vector, double precision, integer, text) CASCADE'
    );
  });
});

describe('Phase 54 DDL updates (plugin ownership & discovery tracking)', () => {
  it('adds ownership_plugin_id column to fqc_documents', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain(
      'ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS ownership_plugin_id TEXT DEFAULT NULL'
    );
  });

  it('adds ownership_type column to fqc_documents', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain(
      'ALTER TABLE IF EXISTS fqc_documents ADD COLUMN IF NOT EXISTS ownership_type TEXT DEFAULT NULL'
    );
  });

  it('drops legacy push-notification infrastructure (Phase 88 LEGACY-07)', () => {
    const ddl = buildSchemaDDL(1536);
    // DROP TABLE must precede DROP COLUMN statements (FK ordering)
    expect(ddl).toContain('DROP TABLE IF EXISTS fqc_change_queue');
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS watcher_claims');
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS needs_discovery');
    expect(ddl).toContain('ALTER TABLE IF EXISTS fqc_documents DROP COLUMN IF EXISTS discovery_status');
    // Legacy ADD COLUMN statements must be absent
    expect(ddl).not.toContain('ADD COLUMN IF NOT EXISTS needs_discovery');
    expect(ddl).not.toContain('ADD COLUMN IF NOT EXISTS discovery_status');
    expect(ddl).not.toContain('ADD COLUMN IF NOT EXISTS watcher_claims');
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS fqc_change_queue');
    expect(ddl).not.toContain('idx_fqc_documents_discovery_status');
    expect(ddl).not.toContain('idx_fqc_change_queue');
  });

  it('creates index on (ownership_plugin_id, ownership_type) for query performance', () => {
    const ddl = buildSchemaDDL(1536);
    expect(ddl).toContain(
      'CREATE INDEX IF NOT EXISTS idx_fqc_documents_ownership ON fqc_documents(ownership_plugin_id, ownership_type)'
    );
  });
});

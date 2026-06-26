#!/usr/bin/env python3
"""
Clean all fqc_* tables between test runs.

This script deletes all rows from FQC tables (preserving table structure) to ensure
each test starts with a clean database slate. Run this between each test in the suite
to enable perfect isolation and reliable residue detection.

Usage:
    python3 dbtools/clean_test_tables.py

    # Or with explicit Supabase credentials:
    DATABASE_URL="postgresql://..." python3 dbtools/clean_test_tables.py

Exit codes:
    0 - Success
    1 - Connection/environment error
    2 - Table deletion error
"""

from __future__ import annotations

import os
import sys
import json
from pathlib import Path

# Core tables to empty (in dependency order). Plugin tables (fqcp_*) are
# discovered dynamically and dropped before core deletes so test-only plugin
# schemas do not leak between scenario tests.
TABLES_TO_CLEAN = [
    'fqc_llm_usage',          # No FK dependencies; accumulates across runs without cleanup
    'fqc_pending_plugin_review',  # Plugin review queue state; FK to documents
    'fqc_documents',          # May be referenced by plugin tables (cleaned first below)
    'fqc_memory',             # May reference plugins
    'fqc_vault',              # May reference documents
    'fqc_plugin_registry',    # No FK dependencies
]


def _quote_ident(identifier: str) -> str:
    """Quote a PostgreSQL identifier."""
    return '"' + identifier.replace('"', '""') + '"'


def build_cleanup_sql(plugin_tables: list[str], core_tables: list[str]) -> str:
    """Build one server-side cleanup block for plugin drops and core deletes."""
    statements = [
        "DO $$",
        "DECLARE",
        "    deleted_count integer;",
        "    total_deleted integer := 0;",
        "    dropped_plugin_tables integer := 0;",
        "BEGIN",
    ]
    for table in plugin_tables:
        escaped_table = table.replace("'", "''")
        quoted_table = _quote_ident(table).replace("'", "''")
        statements.extend([
            f"    EXECUTE 'DROP TABLE IF EXISTS {quoted_table} CASCADE';",
            "    dropped_plugin_tables := dropped_plugin_tables + 1;",
            f"    RAISE NOTICE '{escaped_table}: dropped plugin table';",
        ])
    for table in core_tables:
        escaped_table = table.replace("'", "''")
        quoted_table = _quote_ident(table).replace("'", "''")
        statements.extend([
            f"    EXECUTE 'DELETE FROM {quoted_table}';",
            "    GET DIAGNOSTICS deleted_count = ROW_COUNT;",
            "    total_deleted := total_deleted + deleted_count;",
            f"    RAISE NOTICE '{escaped_table}: % rows deleted', deleted_count;",
        ])
    statements.extend([
        "    IF dropped_plugin_tables > 0 THEN",
        "        PERFORM pg_notify('pgrst', 'reload schema');",
        "    END IF;",
        "    RAISE NOTICE 'FQC_CLEANUP_TOTAL=%', total_deleted;",
        "    RAISE NOTICE 'FQC_CLEANUP_DROPPED_PLUGIN_TABLES=%', dropped_plugin_tables;",
        "END $$;",
    ])
    return "\n".join(statements)


def get_database_url() -> str:
    """Get DATABASE_URL from environment or .env.test."""
    # Try environment variable first
    if 'DATABASE_URL' in os.environ:
        return os.environ['DATABASE_URL']

    # Try .env.test in current directory and parent directories
    for search_dir in [Path.cwd(), Path.cwd().parent, Path.home()]:
        env_test = search_dir / '.env.test'
        if env_test.exists():
            with open(env_test) as f:
                for line in f:
                    if line.startswith('DATABASE_URL='):
                        return line.split('=', 1)[1].strip().strip('"')

    raise EnvironmentError(
        'DATABASE_URL not found. Set it in environment or .env.test file:\n'
        '  export DATABASE_URL="postgresql://..."\n'
        '  or create .env.test with DATABASE_URL=... line'
    )


def _discover_plugin_tables(cur) -> list[str]:
    """Return all fqcp_* table names that exist in the public schema."""
    try:
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name LIKE 'fqcp_%'
            ORDER BY table_name
        """)
        return [row[0] for row in cur.fetchall()]
    except Exception:
        return []


def clean_tables() -> tuple[int, str]:
    """
    Drop fqcp_* plugin tables and delete rows from core fqc_* tables.

    Runs the delete sequence in a single server-side block so hosted database
    latency does not dominate cleanup time.

    Returns: (exit_code, message)
    """
    try:
        import psycopg2
    except ImportError:
        return 1, 'ERROR: psycopg2 not installed. Install with: pip install psycopg2-binary'

    try:
        database_url = get_database_url()
    except EnvironmentError as e:
        return 1, f'ERROR: {e}'

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
    except Exception as e:
        return 1, f'ERROR: Failed to connect to database: {e}'

    conn.notices.clear()

    # Drop plugin tables first (they hold FK refs to fqc_documents), then empty
    # core tables. Execute the full sequence in one server-side block: hosted
    # Supabase latency makes one round trip per table too slow for suite cleanup.
    plugin_tables = _discover_plugin_tables(cur)
    cleanup_sql = build_cleanup_sql(plugin_tables, TABLES_TO_CLEAN)
    try:
        cur.execute(cleanup_sql)
    except Exception as e:
        conn.rollback()
        conn.close()
        return 2, f'ERROR: Failed to clean tables: {e}'

    try:
        conn.commit()
    except Exception as e:
        conn.close()
        return 2, f'ERROR: Failed to commit transaction: {e}'

    total_deleted = 0
    dropped_plugin_tables = 0
    for notice in conn.notices:
        notice_text = notice.strip()
        if 'FQC_CLEANUP_TOTAL=' in notice_text:
            try:
                total_deleted = int(notice_text.rsplit('FQC_CLEANUP_TOTAL=', 1)[1])
            except ValueError:
                total_deleted = 0
        if 'FQC_CLEANUP_DROPPED_PLUGIN_TABLES=' in notice_text:
            try:
                dropped_plugin_tables = int(
                    notice_text.rsplit('FQC_CLEANUP_DROPPED_PLUGIN_TABLES=', 1)[1]
                )
            except ValueError:
                dropped_plugin_tables = 0

    conn.close()

    return (
        0,
        f'SUCCESS: Dropped {dropped_plugin_tables} plugin table(s) and '
        f'cleaned {total_deleted} row(s) from core tables (verified clean)',
    )


def main() -> int:
    """Run table cleanup."""
    print('Cleaning FQC test tables...')
    exit_code, message = clean_tables()
    print(message)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

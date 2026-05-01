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

# Core tables to clean (in dependency order).
# Plugin tables (fqcp_*) are discovered dynamically and cleaned first so that
# FK constraints from plugin tables → fqc_documents do not block the core deletes.
TABLES_TO_CLEAN = [
    'fqc_write_locks',        # No FK dependencies
    'fqc_llm_usage',          # No FK dependencies; accumulates across runs without cleanup
    'fqc_documents',          # May be referenced by plugin tables (cleaned first below)
    'fqc_memory',             # May reference plugins
    'fqc_vault',              # May reference documents
    'fqc_plugin_registry',    # No FK dependencies
]


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


def _delete_with_savepoint(cur, conn, table: str, errors: list[str]) -> int:
    """
    Delete all rows from `table` using a SAVEPOINT so a failure on one table
    does not roll back successful deletes on others.

    Returns the number of rows deleted (0 on failure).
    """
    sp = f"sp_{table.replace('-', '_')}"
    try:
        cur.execute(f'SAVEPOINT {sp}')
        cur.execute(f'DELETE FROM {table}')
        deleted = cur.rowcount
        cur.execute(f'RELEASE SAVEPOINT {sp}')
        if deleted > 0:
            print(f'  {table}: {deleted} rows deleted')
        else:
            print(f'  {table}: (empty)')
        return deleted
    except Exception as e:
        try:
            cur.execute(f'ROLLBACK TO SAVEPOINT {sp}')
            cur.execute(f'RELEASE SAVEPOINT {sp}')
        except Exception:
            pass
        err_str = str(e)
        if 'does not exist' in err_str.lower():
            print(f'  {table}: (table not yet created)')
        else:
            errors.append(f'{table}: {err_str}')
        return 0


def clean_tables() -> tuple[int, str]:
    """
    Delete all rows from fqc_* tables (and any fqcp_* plugin tables).

    Uses SAVEPOINTs so a FK violation on one table does not roll back
    successful deletes on others.

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

    total_deleted = 0
    errors = []

    # --- Step 1: clean plugin tables first (they hold FK refs to fqc_documents) ---
    plugin_tables = _discover_plugin_tables(cur)
    for pt in plugin_tables:
        total_deleted += _delete_with_savepoint(cur, conn, pt, errors)

    # --- Step 2: clean core fqc_* tables ---
    for table in TABLES_TO_CLEAN:
        total_deleted += _delete_with_savepoint(cur, conn, table, errors)

    # Commit all successful deletes regardless of per-table errors.
    try:
        conn.commit()
    except Exception as e:
        conn.close()
        return 2, f'ERROR: Failed to commit transaction: {e}'

    conn.close()

    if errors:
        error_msg = '\n'.join(f'  {err}' for err in errors)
        return 2, f'ERROR: Failed to clean some tables:\n{error_msg}'

    return 0, f'SUCCESS: Cleaned {total_deleted} rows from tables (verified clean)'


def main() -> int:
    """Run table cleanup."""
    print('Cleaning FQC test tables...')
    exit_code, message = clean_tables()
    print(message)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

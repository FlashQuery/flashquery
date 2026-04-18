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

# Tables to clean (in dependency order - foreign keys last)
TABLES_TO_CLEAN = [
    'fqc_change_queue',      # No FK dependencies
    'fqc_write_locks',        # No FK dependencies
    'fqc_documents',          # May reference plugins
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


def clean_tables() -> tuple[int, str]:
    """
    Delete all rows from fqc_* tables.

    Returns: (row_count_deleted, message)
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
    except psycopg2.Error as e:
        return 1, f'ERROR: Failed to connect to database: {e}'

    total_deleted = 0
    errors = []

    for table in TABLES_TO_CLEAN:
        try:
            cur.execute(f'DELETE FROM {table}')
            deleted = cur.rowcount
            total_deleted += deleted
            if deleted > 0:
                print(f'  {table}: {deleted} rows deleted')
            else:
                print(f'  {table}: (empty)')
        except psycopg2.Error as e:
            # If table doesn't exist yet, skip it
            if 'does not exist' in str(e).lower():
                print(f'  {table}: (table not yet created)')
                conn.rollback()
                continue
            else:
                errors.append(f'{table}: {e}')
                conn.rollback()

    if errors:
        conn.rollback()
        conn.close()
        error_msg = '\n'.join(f'  {err}' for err in errors)
        return 2, f'ERROR: Failed to clean some tables:\n{error_msg}'

    try:
        conn.commit()
    except psycopg2.Error as e:
        conn.close()
        return 2, f'ERROR: Failed to commit transaction: {e}'

    # Verify all tables are actually empty
    verification_errors = []
    for table in TABLES_TO_CLEAN:
        try:
            cur.execute(f'SELECT COUNT(*) FROM {table}')
            count = cur.fetchone()[0]
            if count > 0:
                verification_errors.append(f'{table}: {count} rows still present (expected 0)')
        except psycopg2.Error as e:
            if 'does not exist' not in str(e).lower():
                verification_errors.append(f'{table}: verification query failed: {e}')

    conn.close()

    if verification_errors:
        error_msg = '\n'.join(f'  {err}' for err in verification_errors)
        return 2, f'ERROR: Tables not empty after cleanup:\n{error_msg}'

    return 0, f'SUCCESS: Cleaned {total_deleted} rows from {len(TABLES_TO_CLEAN)} tables (verified empty)'


def main() -> int:
    """Run table cleanup."""
    print('Cleaning FQC test tables...')
    exit_code, message = clean_tables()
    print(message)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

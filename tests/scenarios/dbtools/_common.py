"""
Shared plumbing for FQC scenario dbtools.

These utilities are for operational / debugging scripts that inspect or clean up
the scenario-test database. They are NOT meant to be used from inside test
scripts themselves — scenario tests should assert on FQC's public surface, not
on direct DB queries. See tests/scenarios/dbtools/README.md for the rationale.

This module provides:
    - Config discovery (mirrors the framework's flashquery.yml / .env loader)
    - DB connection helpers (psycopg v3 preferred, psycopg2 fallback)
    - Table registry listing the instance-scoped tables the scripts operate on
    - Scope guards used by destructive operations (refuse to run without an
      instance_id that matches the test pattern; refuse non-local connections
      without explicit override)
    - Small CLI helpers (argparse setup, pretty-print, JSON formatting)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Import the framework's existing config loaders so the same env/yaml
# resolution is used across the suite.
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_client import (  # type: ignore  # noqa: E402
    _find_project_dir,
    _load_env_file,
    _load_yaml_config,
)

# ---------------------------------------------------------------------------
# DB driver — prefer psycopg v3, fall back to psycopg2
# ---------------------------------------------------------------------------

_DRIVER: str | None = None
_psycopg: Any = None

try:
    import psycopg as _psycopg  # type: ignore
    _DRIVER = "psycopg3"
except ImportError:
    try:
        import psycopg2 as _psycopg  # type: ignore
        import psycopg2.extras  # type: ignore  # noqa: F401
        _DRIVER = "psycopg2"
    except ImportError:
        _DRIVER = None


def _require_driver() -> None:
    if _DRIVER is None:
        sys.stderr.write(
            "Error: no PostgreSQL driver installed.\n"
            "Install one of:\n"
            "    pip install psycopg[binary]   # psycopg v3 (recommended)\n"
            "    pip install psycopg2-binary   # psycopg v2 (fallback)\n"
        )
        sys.exit(2)


# ---------------------------------------------------------------------------
# Test-pattern convention
# ---------------------------------------------------------------------------
#
# The managed-test FQCServer generates instance IDs of the form "test-<hex8>"
# (see framework/fqc_test_utils.py). The static test config uses "test-fqc".
# Any instance_id that starts with "test-" is considered test-safe.
#
# This pattern is what keeps the dbtools from touching real user data even
# when pointed at a shared Postgres. Destructive operations refuse to run if
# the instance_id doesn't match.
#
# Users who want to operate on a different pattern can pass --test-pattern
# explicitly, but the default is intentionally narrow.
# ---------------------------------------------------------------------------

DEFAULT_TEST_PATTERN = "test-%"
_TEST_PATTERN_REGEX_CACHE: dict[str, re.Pattern] = {}


def pattern_to_regex(sql_pattern: str) -> re.Pattern:
    """Convert an SQL LIKE pattern into a Python regex for client-side checks."""
    if sql_pattern in _TEST_PATTERN_REGEX_CACHE:
        return _TEST_PATTERN_REGEX_CACHE[sql_pattern]
    # Only translate % and _ — everything else is literal for our purposes.
    parts: list[str] = []
    for ch in sql_pattern:
        if ch == "%":
            parts.append(".*")
        elif ch == "_":
            parts.append(".")
        else:
            parts.append(re.escape(ch))
    compiled = re.compile("^" + "".join(parts) + "$")
    _TEST_PATTERN_REGEX_CACHE[sql_pattern] = compiled
    return compiled


# ---------------------------------------------------------------------------
# Table registry
# ---------------------------------------------------------------------------
#
# These are the instance-scoped tables the scripts operate on. Each entry
# describes: the table name, the column that holds the instance_id, and
# whether the table has a soft-delete "status" column.
#
# If new instance-scoped tables are added to FQC's schema, list them here
# so snapshot / orphans / reset pick them up automatically.

@dataclass(frozen=True)
class TableSpec:
    name: str
    instance_col: str = "instance_id"
    status_col: str | None = None  # name of status column, if soft-deletable
    id_col: str = "id"


TABLES: tuple[TableSpec, ...] = (
    TableSpec("fqc_documents", status_col="status"),
    TableSpec("fqc_memory", status_col="status"),
    TableSpec("fqc_vault"),
    TableSpec("fqc_plugin_registry", status_col="status"),
    TableSpec("fqc_write_locks", id_col=""),  # composite PK (instance_id, resource_type)
    TableSpec("fqc_change_queue"),
)


# ---------------------------------------------------------------------------
# Config discovery
# ---------------------------------------------------------------------------

@dataclass
class DbConfig:
    database_url: str
    source_yaml: str | None  # path to the yaml file that supplied it, if any
    project_dir: Path

    @property
    def looks_local(self) -> bool:
        """Cheap heuristic for 'this is a dev/test DB'."""
        url = self.database_url.lower()
        return (
            "localhost" in url
            or "127.0.0.1" in url
            or "::1" in url
            or "host.docker.internal" in url
        )


def discover_db_config(fqc_dir: str | Path | None = None) -> DbConfig:
    """
    Resolve the PostgreSQL connection string using the same precedence as the
    rest of the suite:

        1. DATABASE_URL environment variable (from shell or .env / .env.test)
        2. supabase.database_url from flashquery.test.yml (preferred)
        3. supabase.database_url from flashquery.yml

    Raises SystemExit with a helpful message if no URL is found.
    """
    dir_hint = fqc_dir or os.environ.get("FQC_DIR")
    project_dir = Path(dir_hint) if dir_hint else _find_project_dir()
    if project_dir is None or not project_dir.is_dir():
        sys.stderr.write(
            "Error: cannot locate flashquery-core project directory.\n"
            "Set FQC_DIR or run this script from within the repo.\n"
        )
        sys.exit(2)

    env = _load_env_file(project_dir)
    env_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")

    cfg = _load_yaml_config(project_dir)
    yaml_url = None
    if cfg:
        yaml_url = (cfg.get("supabase") or {}).get("database_url")

    url = env_url or yaml_url
    if not url:
        sys.stderr.write(
            "Error: no database_url found.\n"
            "Expected one of:\n"
            "    DATABASE_URL in .env or .env.test\n"
            "    supabase.database_url in flashquery.test.yml or flashquery.yml\n"
        )
        sys.exit(2)

    return DbConfig(
        database_url=url,
        source_yaml=cfg.get("_source_file") if cfg else None,
        project_dir=project_dir,
    )


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def connect(db: DbConfig):
    """Open a psycopg connection. Caller is responsible for closing."""
    _require_driver()
    return _psycopg.connect(db.database_url)


def dict_cursor(conn):
    """Return a cursor that produces dict-like rows, regardless of driver."""
    if _DRIVER == "psycopg3":
        from psycopg.rows import dict_row  # type: ignore
        return conn.cursor(row_factory=dict_row)
    # psycopg2
    import psycopg2.extras  # type: ignore
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


# ---------------------------------------------------------------------------
# Scope guards
# ---------------------------------------------------------------------------

class UnsafeScopeError(Exception):
    """Raised when a destructive operation is asked to act outside its scope."""


def assert_instance_is_test_safe(
    instance_id: str,
    pattern: str = DEFAULT_TEST_PATTERN,
) -> None:
    """
    Refuse to proceed if *instance_id* doesn't match the test pattern.
    This is the primary guard for destructive operations.
    """
    if not instance_id:
        raise UnsafeScopeError("instance_id is required for destructive operations")
    if not pattern_to_regex(pattern).match(instance_id):
        raise UnsafeScopeError(
            f"instance_id {instance_id!r} does not match test pattern {pattern!r}. "
            f"Destructive operations are only allowed on test instances."
        )


def assert_connection_is_local_or_override(
    db: DbConfig,
    override: bool,
) -> None:
    """
    Warn or refuse if the DB connection doesn't look local. Destructive scripts
    call this before touching anything. The override flag lets power users
    operate against a shared staging DB if they really mean to.
    """
    if db.looks_local:
        return
    if not override:
        raise UnsafeScopeError(
            f"Database URL {db.database_url!r} does not look local "
            f"(expected localhost / 127.0.0.1 / host.docker.internal). "
            f"Re-run with --i-know-this-is-not-local to proceed anyway."
        )
    sys.stderr.write(
        f"Warning: operating on non-local database {db.database_url!r} "
        f"under --i-know-this-is-not-local override.\n"
    )


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def count_rows(
    conn,
    table: TableSpec,
    instance_id: str | None = None,
    test_pattern: str | None = None,
) -> int:
    """
    Count rows in *table*. One of instance_id / test_pattern must be supplied
    — we never run unscoped counts against a shared DB by accident.

    Rows where status_col = 'archived' are excluded when status_col is set.
    Archiving is the expected cleanup path for soft-deletable resources, so
    archived rows are treated as cleaned up for residue-detection purposes.
    """
    # Exclude archived rows when the table has a status column — archiving is
    # the expected cleanup mechanism, not a residue-leaving operation.
    status_filter = f" AND {table.status_col} != 'archived'" if table.status_col else ""
    with conn.cursor() as cur:
        if instance_id is not None:
            cur.execute(
                f'SELECT COUNT(*) FROM "{table.name}" WHERE {table.instance_col} = %s{status_filter}',
                (instance_id,),
            )
        elif test_pattern is not None:
            cur.execute(
                f'SELECT COUNT(*) FROM "{table.name}" WHERE {table.instance_col} LIKE %s{status_filter}',
                (test_pattern,),
            )
        else:
            raise ValueError("count_rows requires instance_id or test_pattern")
        return int(cur.fetchone()[0])


def fetch_rows(
    conn,
    table: TableSpec,
    instance_id: str | None = None,
    test_pattern: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Fetch rows from *table* scoped by instance_id or test_pattern."""
    limit_sql = f" LIMIT {int(limit)}" if limit else ""
    with dict_cursor(conn) as cur:
        if instance_id is not None:
            cur.execute(
                f'SELECT * FROM "{table.name}" '
                f'WHERE {table.instance_col} = %s'
                f'{limit_sql}',
                (instance_id,),
            )
        elif test_pattern is not None:
            cur.execute(
                f'SELECT * FROM "{table.name}" '
                f'WHERE {table.instance_col} LIKE %s'
                f'{limit_sql}',
                (test_pattern,),
            )
        else:
            raise ValueError("fetch_rows requires instance_id or test_pattern")
        return [dict(r) for r in cur.fetchall()]


def baseline_counts(conn, instance_id: str) -> dict[str, int]:
    """
    Snapshot current row counts per registered table for *instance_id*.

    Used for residue detection: take a baseline right after the managed server
    starts (which seeds ambient rows in tables like fqc_vault), then after each
    test compare current counts against the baseline. Anything above baseline
    is residue the test failed to clean up.
    """
    return {spec.name: count_rows(conn, spec, instance_id=instance_id) for spec in TABLES}


def residue_since_baseline(
    conn,
    instance_id: str,
    baseline: dict[str, int],
) -> dict[str, int]:
    """
    Return the per-table delta above *baseline*. Tables at or below baseline
    are omitted from the result.
    """
    residue: dict[str, int] = {}
    for spec in TABLES:
        current = count_rows(conn, spec, instance_id=instance_id)
        base = baseline.get(spec.name, 0)
        if current > base:
            residue[spec.name] = current - base
    return residue


def distinct_instances(
    conn,
    test_pattern: str = DEFAULT_TEST_PATTERN,
) -> dict[str, dict[str, int]]:
    """
    Return a map of instance_id -> {table_name: row_count} for every test
    instance currently in the DB.
    """
    result: dict[str, dict[str, int]] = {}
    for spec in TABLES:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT {spec.instance_col}, COUNT(*) '
                f'FROM "{spec.name}" '
                f'WHERE {spec.instance_col} LIKE %s '
                f'GROUP BY {spec.instance_col}',
                (test_pattern,),
            )
            for instance_id, count in cur.fetchall():
                result.setdefault(instance_id, {})[spec.name] = int(count)
    return result


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def print_json(data: Any, pretty: bool = True) -> None:
    if pretty:
        print(json.dumps(data, indent=2, sort_keys=True, default=_json_default))
    else:
        print(json.dumps(data, default=_json_default))


def _json_default(obj: Any) -> Any:
    # Handle datetimes, UUIDs, memoryview (bytea) so psycopg rows serialize cleanly
    try:
        return obj.isoformat()  # datetime
    except AttributeError:
        pass
    try:
        return str(obj)  # UUID, Decimal, memoryview fallback
    except Exception:
        return repr(obj)


# ---------------------------------------------------------------------------
# Argparse scaffolding used by every script
# ---------------------------------------------------------------------------

def base_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=description,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--fqc-dir",
        default=None,
        help="Path to flashquery-core project (default: auto-discover)",
    )
    p.add_argument(
        "--test-pattern",
        default=DEFAULT_TEST_PATTERN,
        help=f"SQL LIKE pattern for test instance_ids (default: {DEFAULT_TEST_PATTERN!r})",
    )
    p.add_argument(
        "--json",
        dest="output_json",
        action="store_true",
        help="Emit machine-readable JSON instead of human-readable output",
    )
    return p


def describe_table_counts(counts: dict[str, int]) -> Iterable[str]:
    """Yield 'table: count' lines, skipping empty tables."""
    for name in sorted(counts):
        n = counts[name]
        if n:
            yield f"  {name}: {n}"

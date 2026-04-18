#!/usr/bin/env python3
"""
Test: write lock contention → error response → lock release → successful write.

Scenario:
    1. Start a managed FQC server with locking enabled (enable_locking=True)
    2. Inject a live lock row directly into fqc_write_locks via psycopg2
       using the server's own instance_id and resource_type='memory' — this
       simulates another writer holding the lock before our call arrives
    3. Call save_memory — FQC attempts to acquire the lock, hits its own PK,
       backs off with exponential delay, and times out after ~10 seconds.
       The response must carry isError=true and the "Retry in a few seconds" guidance.
    4. Delete the injected lock row via psycopg2 so the lock is free again
    5. Call save_memory a second time — must succeed now that the lock is clear
    6. Retrieve the memory by ID to confirm it was stored correctly
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: X-04

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_write_lock_contention.py                            # existing server
    python test_write_lock_contention.py --managed                  # managed server
    python test_write_lock_contention.py --managed --json           # structured JSON with server logs
    python test_write_lock_contention.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["X-04"]
REQUIRES_MANAGED = True

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests as http_requests

# Framework path setup — always this exact line
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import _find_project_dir, _load_env_file
from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_write_lock_contention"

# Resource type to contend on — 'memory' requires no file scan, keeping
# setup fast and the lock scope narrow.
_LOCK_RESOURCE = "memory"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _inject_lock_pg(
    database_url: str,
    instance_id: str,
    resource_type: str,
    ttl_seconds: int = 120,
) -> tuple[bool, str]:
    """
    Insert a non-expired lock row into fqc_write_locks via a direct PostgreSQL
    connection (psycopg2).  Returns (success, error_detail).

    The row expires well after the test completes, so FQC's 'delete expired
    rows' cleanup step won't clear it prematurely during our 10-second wait.
    """
    try:
        import psycopg2  # type: ignore[import]
    except ImportError:
        return False, "psycopg2 not installed — run: pip install psycopg2-binary"

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=ttl_seconds)
        cur.execute(
            """INSERT INTO fqc_write_locks
                    (instance_id, resource_type, locked_at, expires_at)
               VALUES (%s, %s, %s, %s)""",
            (instance_id, resource_type, now, expires_at),
        )
        conn.commit()
        conn.close()
        return True, ""
    except Exception as exc:
        return False, str(exc)


def _release_lock_pg(
    database_url: str,
    instance_id: str,
    resource_type: str,
) -> tuple[bool, str]:
    """Delete the injected lock row via direct SQL.  Returns (success, error_detail)."""
    try:
        import psycopg2  # type: ignore[import]
    except ImportError:
        return False, "psycopg2 not installed"

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM fqc_write_locks WHERE instance_id = %s AND resource_type = %s",
            (instance_id, resource_type),
        )
        conn.commit()
        conn.close()
        return True, ""
    except Exception as exc:
        return False, str(exc)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    memory_content = f"Write-lock contention test memory created by {TEST_NAME} run {run.run_id}."
    memory_tags = ["fqc-test", "lock-test", run.run_id]

    port_range = tuple(args.port_range) if args.port_range else None

    # Resolve DATABASE_URL from .env / .env.test for direct lock injection
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    if not project_dir:
        run.step(
            label="Resolve database credentials",
            passed=False,
            detail="Cannot find flashquery-core project directory.",
        )
        return run
    env = _load_env_file(project_dir)
    database_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL", "")

    if not database_url:
        run.step(
            label="Resolve database credentials",
            passed=False,
            detail="DATABASE_URL not found in .env — needed for lock injection.",
        )
        return run

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — enable_locking=True activates
        # write-lock checking; the shared suite server runs with locking disabled.
        managed=True,
        port_range=port_range,
        enable_locking=True,
    ) as ctx:

        # Resolve the live server's instance_id from the public /mcp/info
        # endpoint.  Works whether ctx.server is set (dedicated managed server)
        # or the suite runner injected a shared server URL.
        try:
            _info = http_requests.get(
                f"{ctx.client.base_url}/mcp/info",
                timeout=5,
            )
            instance_id = _info.json().get("instance_id", "") if _info.ok else ""
        except Exception:
            instance_id = ""

        if not instance_id:
            run.step(
                label="Resolve server instance_id from /mcp/info",
                passed=False,
                detail="Could not fetch instance_id — cannot inject a targeted lock.",
            )
            return run

        # ── Step 1: Inject the blocking lock row via direct SQL ───────
        t0 = time.monotonic()
        injected, inj_err = _inject_lock_pg(
            database_url, instance_id, _LOCK_RESOURCE
        )
        elapsed = int((time.monotonic() - t0) * 1000)

        run.step(
            label=f"Inject lock row (instance_id={instance_id!r}, resource={_LOCK_RESOURCE!r})",
            passed=injected,
            detail="" if injected else f"DB insert failed: {inj_err}",
            timing_ms=elapsed,
        )
        if not injected:
            return run

        # ── Step 2: Call save_memory — expect write lock timeout error ─
        # FQC attempts to INSERT (instance_id, 'memory') and hits its own PK.
        # It backs off and retries for DEFAULT_TIMEOUT_MS (10 s), then returns
        # isError: true with the "Retry in a few seconds" guidance message.
        log_mark = ctx.server.log_position if ctx.server else 0
        contention_result = ctx.client.call_tool(
            "save_memory",
            content=memory_content,
            tags=memory_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Tool must return an error containing the contention message
        contention_result.expect_contains("Write lock timeout")
        contention_result.expect_contains("Retry in a few seconds")

        lock_error_ok = (
            not contention_result.ok
            and contention_result.status != "pass"
        )
        expectations_ok = all(e["passed"] for e in contention_result.expectations)

        run.step(
            label="save_memory under held lock → 'Write lock timeout' error with retry guidance",
            passed=(lock_error_ok and expectations_ok),
            detail=(
                expectation_detail(contention_result)
                or (
                    "Expected isError response but got success"
                    if not lock_error_ok
                    else contention_result.error or ""
                )
            ),
            timing_ms=contention_result.timing_ms,
            tool_result=contention_result,
            server_logs=step_logs,
        )

        # ── Step 3: Release the injected lock via direct SQL ──────────
        t0 = time.monotonic()
        released, rel_err = _release_lock_pg(database_url, instance_id, _LOCK_RESOURCE)
        elapsed = int((time.monotonic() - t0) * 1000)

        run.step(
            label="Release injected lock row via direct SQL",
            passed=released,
            detail="" if released else f"DB delete failed: {rel_err}",
            timing_ms=elapsed,
        )
        if not released:
            return run

        # ── Step 4: Retry save_memory — must succeed now ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        save_result = ctx.client.call_tool(
            "save_memory",
            content=memory_content,
            tags=memory_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        save_result.expect_contains("Memory saved")

        saved_memory_id = _extract_field(save_result.text, "Memory ID")
        if saved_memory_id:
            ctx.cleanup.track_mcp_memory(saved_memory_id)

        run.step(
            label="save_memory after lock released → success",
            passed=(save_result.ok and save_result.status == "pass"),
            detail=expectation_detail(save_result) or save_result.error or "",
            timing_ms=save_result.timing_ms,
            tool_result=save_result,
            server_logs=step_logs,
        )
        if not save_result.ok:
            return run

        # ── Step 5: Retrieve memory to confirm it was stored correctly ─
        if saved_memory_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            get_result = ctx.client.call_tool(
                "get_memory",
                memory_ids=saved_memory_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # The response should contain the unique run_id we embedded
            get_result.expect_contains(run.run_id)

            run.step(
                label="get_memory by ID confirms content is stored",
                passed=(get_result.ok and get_result.status == "pass"),
                detail=expectation_detail(get_result) or get_result.error or "",
                timing_ms=get_result.timing_ms,
                tool_result=get_result,
                server_logs=step_logs,
            )

            # Inline cleanup: archive the memory we actually created
            ctx.client.call_tool("archive_memory", memory_id=saved_memory_id)

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: write lock contention returns error with retry guidance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
    parser.add_argument("--managed", action="store_true",
                         help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                         default=None,
                         help="Port range for managed server (default: 9100 9199).")
    parser.add_argument("--json", action="store_true", dest="output_json",
                         help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                         help="Retain test files for debugging (skip cleanup).")

    args = parser.parse_args()
    run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

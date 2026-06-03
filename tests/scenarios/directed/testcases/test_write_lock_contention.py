#!/usr/bin/env python3
"""
Test: document write lock contention -> error response -> lock release -> successful write.

Scenario:
    1. Start a managed FQC server with locking enabled.
    2. Create a document, then hold that document's PostgreSQL advisory lock directly.
    3. Call write_document(update) and expect a lock_timeout conflict with retry guidance.
    4. Release the advisory lock.
    5. Retry write_document(update) and confirm the update succeeds.
    6. Retrieve the document by fq_id to confirm the update was stored.

Coverage points: X-04
"""
from __future__ import annotations

COVERAGE = ["X-04"]
REQUIRES_MANAGED = True

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import _find_project_dir, _load_env_file
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_write_lock_contention"


def _extract_field(text: str, field: str) -> str:
    json_key = {"FQC ID": "fq_id", "Path": "path", "Memory ID": "memory_id"}.get(field)
    if json_key:
        try:
            payload = json.loads(text)
            value = payload.get(json_key) if isinstance(payload, dict) else None
            if value is not None:
                return str(value)
        except Exception:
            pass
    m = re.search("^" + re.escape(field) + r":\s*(.+)", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _advisory_key_for_file(file_path: str) -> int:
    digest = hashlib.sha256(f"file:{file_path}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _hold_advisory_lock_pg(database_url: str, advisory_key: int) -> tuple[bool, str, object | None]:
    try:
        import psycopg2  # type: ignore[import]
    except ImportError:
        return False, "psycopg2 not installed -- run: pip install psycopg2-binary", None

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        cur.execute("SELECT pg_advisory_lock(%s)", (advisory_key,))
        conn.commit()
        return True, "", conn
    except Exception as exc:
        return False, str(exc), None


def _release_advisory_lock_pg(conn: object, advisory_key: int) -> tuple[bool, str]:
    try:
        cur = conn.cursor()  # type: ignore[attr-defined]
        cur.execute("SELECT pg_advisory_unlock(%s)", (advisory_key,))
        released = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return bool(released), "" if released else "pg_advisory_unlock returned false"
    except Exception as exc:
        return False, str(exc)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    if not project_dir:
        run.step(
            label="Resolve database credentials",
            passed=False,
            detail="Cannot find flashquery project directory.",
        )
        return run
    env = _load_env_file(project_dir)
    database_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if not database_url:
        run.step(
            label="Resolve database credentials",
            passed=False,
            detail="DATABASE_URL not found in .env/.env.test -- needed for advisory lock injection.",
        )
        return run

    doc_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    initial_content = f"Initial document for {TEST_NAME} run {run.run_id}."
    updated_content = f"Updated document after lock release for {TEST_NAME} run {run.run_id}."

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        enable_locking=True,
        extra_config={"locking": {"lock_timeout_seconds": 1}},
    ) as ctx:
        if not ctx.server:
            run.step(
                label="Resolve managed server",
                passed=False,
                detail="Managed server context is required for advisory lock key derivation.",
            )
            return run

        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=f"Write Lock Contention {run.run_id}",
            content=initial_content,
            tags=["fqc-test", "lock-test", run.run_id],
        )
        create_result.expect_json_path("fq_id")
        created_fq_id = _extract_field(create_result.text, "FQC ID")
        if create_result.ok:
            ctx.cleanup.track_file(doc_path, mcp_identifier=created_fq_id or doc_path)
            ctx.cleanup.track_dir("_test")
        run.step(
            label="setup write_document creates document for advisory lock contention",
            passed=create_result.ok and create_result.status == "pass" and bool(created_fq_id),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
        )
        if not create_result.ok or not created_fq_id:
            return run

        locked_abs_path = str((ctx.server.vault_path / doc_path).resolve())
        advisory_key = _advisory_key_for_file(locked_abs_path)

        t0 = time.monotonic()
        locked, lock_err, lock_conn = _hold_advisory_lock_pg(database_url, advisory_key)
        run.step(
            label=f"Hold document advisory lock for {doc_path}",
            passed=locked,
            detail="" if locked else f"DB advisory lock failed: {lock_err}",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not locked or not lock_conn:
            return run

        log_mark = ctx.server.log_position
        contention_result = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=created_fq_id,
            title=f"Write Lock Contention {run.run_id}",
            content="This update should be blocked by the advisory lock.",
            tags=["fqc-test", "lock-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark)
        contention_result.expect_contains("Write lock timeout")
        try:
            contention_payload = json.loads(contention_result.text)
        except Exception:
            contention_payload = {}
        contention_reason_ok = (
            isinstance(contention_payload, dict)
            and contention_payload.get("error") == "conflict"
            and contention_payload.get("details", {}).get("reason") == "lock_timeout"
        )
        expectations_ok = all(e["passed"] for e in contention_result.expectations)
        run.step(
            label="write_document(update) under held advisory lock -> lock_timeout error with retry guidance",
            passed=expectations_ok and contention_reason_ok,
            detail=(
                expectation_detail(contention_result)
                or ("" if contention_reason_ok else f"Unexpected error JSON: {contention_result.text[:300]}")
                or contention_result.error
                or ""
            ),
            timing_ms=contention_result.timing_ms,
            tool_result=contention_result,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        released, release_err = _release_advisory_lock_pg(lock_conn, advisory_key)
        run.step(
            label="Release held document advisory lock",
            passed=released,
            detail="" if released else f"DB advisory unlock failed: {release_err}",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not released:
            return run

        log_mark = ctx.server.log_position
        save_result = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=created_fq_id,
            title=f"Write Lock Contention {run.run_id}",
            content=updated_content,
            tags=["fqc-test", "lock-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark)
        save_result.expect_json_path("fq_id")
        run.step(
            label="write_document(update) after advisory lock release -> success",
            passed=save_result.ok and save_result.status == "pass",
            detail=expectation_detail(save_result) or save_result.error or "",
            timing_ms=save_result.timing_ms,
            tool_result=save_result,
            server_logs=step_logs,
        )
        if not save_result.ok:
            return run

        log_mark = ctx.server.log_position
        get_result = ctx.client.call_tool("get_document", identifiers=created_fq_id)
        step_logs = ctx.server.logs_since(log_mark)
        get_result.expect_contains(updated_content)
        run.step(
            label="get_document by fq_id confirms updated content is stored",
            passed=get_result.ok and get_result.status == "pass",
            detail=expectation_detail(get_result) or get_result.error or "",
            timing_ms=get_result.timing_ms,
            tool_result=get_result,
            server_logs=step_logs,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: write lock contention returns error with retry guidance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")

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

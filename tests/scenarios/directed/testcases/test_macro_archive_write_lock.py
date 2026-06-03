#!/usr/bin/env python3
"""
T-S-020: macro-dispatched archive_document calls serialize through document locking.
Coverage: ML-24
"""
from __future__ import annotations

COVERAGE = ["ML-24"]

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402


TEST_NAME = "test_macro_archive_write_lock"


def _payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw": result.text}


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
    env = _load_env_file(project_dir) if project_dir else {}
    database_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL", "")

    if not database_url:
        run.step(
            label="Resolve database credentials",
            passed=False,
            detail="DATABASE_URL not found in .env/.env.test — needed for document lock injection.",
        )
        return run

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        enable_locking=True,
        extra_config={
            "locking": {"lock_timeout_seconds": 1},
            "host_mcp_tools": {
                "tools": ["call_macro", "write_document", "archive_document", "get_document"],
            },
        },
    ) as ctx:
        client: FQCClient = ctx.client
        path = f"_test/{TEST_NAME}_{run.run_id}.md"
        create = client.call_tool(
            "write_document",
            mode="create",
            path=path,
            title=f"Macro archive lock {run.run_id}",
            content="Created for macro archive lock scenario.",
            tags=["macro-archive-lock", run.run_id],
        )
        create_payload = _payload(create)
        created_fq_id = create_payload.get("fq_id")
        ctx.cleanup.track_file(path, mcp_identifier=str(created_fq_id or path))
        run.step(
            label="setup write_document creates document for macro archive lock scenario",
            passed=create.ok and create_payload.get("path") == path and isinstance(created_fq_id, str),
            detail=json.dumps(create_payload, sort_keys=True)[:1000],
            timing_ms=create.timing_ms,
            tool_result=create,
        )
        if not create.ok or not isinstance(created_fq_id, str):
            return run

        if not ctx.server:
            run.step(
                label="resolve managed server for advisory lock contention",
                passed=False,
                detail="Managed server context is required for advisory lock key derivation.",
            )
            return run

        locked_abs_path = str((ctx.server.vault_path / path).resolve())
        advisory_key = _advisory_key_for_file(locked_abs_path)
        started = time.monotonic()
        injected, inj_err, lock_conn = _hold_advisory_lock_pg(database_url, advisory_key)
        run.step(
            label=f"hold document advisory lock for {path}",
            passed=injected,
            detail="" if injected else f"DB advisory lock failed: {inj_err}",
            timing_ms=int((time.monotonic() - started) * 1000),
        )
        if not injected or not lock_conn:
            return run

        try:
            locked = client.call_tool(
                "call_macro",
                source=f'exit fq.archive_document({{ identifiers: "{path}" }})',
            )
            locked_payload = _payload(locked)
            locked_result = locked_payload.get("result") or {}
            run.step(
                label="ML-24 / T-S-020 macro archive_document surfaces held document lock contention",
                passed=(
                    locked.ok
                    and locked_result.get("error") == "conflict"
                    and locked_result.get("details", {}).get("reason") == "lock_timeout"
                ),
                detail=json.dumps(locked_payload, sort_keys=True)[:1500],
                timing_ms=locked.timing_ms,
                tool_result=locked,
            )
        finally:
            released, rel_err = _release_advisory_lock_pg(lock_conn, advisory_key)
            run.step(
                label="release held document advisory lock",
                passed=released,
                detail="" if released else f"DB advisory unlock failed: {rel_err}",
            )
            if not released:
                return run

        archived = client.call_tool(
            "call_macro",
            source=f'exit fq.archive_document({{ identifiers: "{path}" }})',
        )
        archived_payload = _payload(archived)
        archived_result = archived_payload.get("result") or {}
        run.step(
            label="ML-24 / T-S-020 macro archive_document succeeds after document lock release",
            passed=(
                archived.ok
                and archived_result.get("path") == path
                and archived_result.get("fq_id") == created_fq_id
                and archived_result.get("error") is None
            ),
            detail=json.dumps(archived_payload, sort_keys=True)[:1500],
            timing_ms=archived.timing_ms,
            tool_result=archived,
        )

        read_back = client.call_tool("get_document", identifiers=path, include=["frontmatter"])
        read_payload = _payload(read_back)
        frontmatter = read_payload.get("frontmatter") or {}
        run.step(
            label="ML-24 / T-S-020 archived document remains readable with archived status",
            passed=read_back.ok and frontmatter.get("fq_status") == "archived" and read_payload.get("fq_id") == created_fq_id,
            detail=json.dumps(read_payload, sort_keys=True)[:1000],
            timing_ms=read_back.timing_ms,
            tool_result=read_back,
        )

        reacquired = client.call_tool(
            "call_macro",
            source=f'exit fq.archive_document({{ identifiers: "{path}" }})',
        )
        reacquired_payload = _payload(reacquired)
        reacquired_result = reacquired_payload.get("result") or {}
        run.step(
            label="ML-24 / T-S-020 subsequent macro archive does not leave stale lock contention",
            passed=(
                reacquired.ok
                and reacquired_result.get("path") == path
                and reacquired_result.get("fq_id") == created_fq_id
                and reacquired_result.get("error") is None
            ),
            detail=json.dumps(reacquired_payload, sort_keys=True)[:1500],
            timing_ms=reacquired.timing_ms,
            tool_result=reacquired,
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

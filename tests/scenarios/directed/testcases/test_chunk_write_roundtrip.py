#!/usr/bin/env python3
"""D-chunk-1: public write/update workflow creates and updates chunk rows."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_chunk_write_roundtrip"
COVERAGE = ["D-chunk-1", "T-A-001"]


def _payload(result) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if not value:
        env_path = Path(__file__).resolve().parents[4] / ".env.test"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not value:
        raise RuntimeError("DATABASE_URL is required for chunk scenario verification")
    return value


def _chunks_for_document(document_id: str) -> list[dict[str, Any]]:
    if psycopg is None:
        raise RuntimeError("psycopg is required for chunk scenario verification")
    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, breadcrumb, content, content_hash
                FROM fqc_chunks
                WHERE document_id = %s
                ORDER BY breadcrumb, chunk_index
                """,
                (document_id,),
            )
            return [
                {
                    "id": row[0],
                    "breadcrumb": row[1],
                    "content": row[2],
                    "content_hash": row[3],
                }
                for row in cur.fetchall()
            ]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    doc_path = f"_test/chunk_write_{run.run_id}.md"
    title = f"Chunk Write {run.run_id}"
    original = f"# {title}\n\n## Durable Section\n\nOriginal chunk body {run.run_id}."
    updated = f"# {title}\n\n## Durable Section\n\nUpdated chunk body {run.run_id}."

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        create = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=title,
            content=original,
            tags=["chunk-write", run.run_id],
        )
        create_payload = _payload(create)
        document_id = str(create_payload.get("fq_id") or "")
        if document_id:
            ctx.cleanup.track_mcp_document(document_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("_test")

        run.step(
            "create document through public write_document",
            passed=create.ok and bool(document_id),
            detail=expectation_detail(create) or create.error or json.dumps(create_payload, sort_keys=True),
            timing_ms=create.timing_ms,
            tool_result=create,
        )
        if not document_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        t0 = time.monotonic()
        try:
            chunks = _chunks_for_document(document_id)
            passed = len(chunks) >= 1 and any(run.run_id in chunk["content"] for chunk in chunks)
            run.step(
                "created document has persisted chunk metadata",
                passed=passed,
                detail="" if passed else json.dumps(chunks, sort_keys=True),
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        except Exception as exc:
            run.step(
                "created document has persisted chunk metadata",
                passed=False,
                detail=f"Exception: {exc}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            run.record_cleanup(ctx.cleanup_errors)
            return run

        before = _chunks_for_document(document_id)
        before_hashes = {chunk["id"]: chunk["content_hash"] for chunk in before}
        update = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=document_id,
            content=updated,
        )
        run.step(
            "update document through public write_document",
            passed=update.ok,
            detail=expectation_detail(update) or update.error or update.text[:1000],
            timing_ms=update.timing_ms,
            tool_result=update,
        )

        t0 = time.monotonic()
        after = _chunks_for_document(document_id)
        changed_hash = any(before_hashes.get(chunk["id"]) != chunk["content_hash"] for chunk in after)
        contains_updated = any("Updated chunk body" in chunk["content"] for chunk in after)
        run.step(
            "updated document refreshes chunk metadata",
            passed=update.ok and changed_hash and contains_updated,
            detail="" if changed_hash and contains_updated else json.dumps({"before": before, "after": after}, sort_keys=True),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--vault-path", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else "\n".join(run.summary_lines()))
    raise SystemExit(run.exit_code)


if __name__ == "__main__":
    main()

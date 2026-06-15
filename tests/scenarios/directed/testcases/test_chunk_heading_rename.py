#!/usr/bin/env python3
"""D-chunk-2: heading rename removes stale chunk rows."""
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
from lifecycle_embedding_scenario_helpers import lifecycle_catalog_config  # noqa: E402

TEST_NAME = "test_chunk_heading_rename"
COVERAGE = ["D-chunk-2", "T-A-002"]
EMBEDDING_NAME = "chunk_rename_primary"


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


def _chunk_breadcrumbs(document_id: str) -> list[str]:
    if psycopg is None:
        raise RuntimeError("psycopg is required for chunk scenario verification")
    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT breadcrumb
                FROM fqc_chunks
                WHERE document_id = %s
                ORDER BY breadcrumb, chunk_index
                """,
                (document_id,),
            )
            return [str(row[0]) for row in cur.fetchall()]


def _matched_chunk_breadcrumbs(payload: dict[str, Any], document_id: str) -> list[str]:
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    for result in results:
        if not isinstance(result, dict):
            continue
        if str(result.get("fq_id") or result.get("id") or result.get("document_id") or "") != document_id:
            continue
        chunks = result.get("matched_chunks")
        if not isinstance(chunks, list):
            return []
        return [str(chunk.get("breadcrumb") or "") for chunk in chunks if isinstance(chunk, dict)]
    return []


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    doc_path = f"_test/chunk_rename_{run.run_id}.md"
    title = f"Chunk Rename {run.run_id}"
    old_heading = f"Old Chunk Heading {run.run_id}"
    new_heading = f"New Chunk Heading {run.run_id}"
    original = f"# {title}\n\n## {old_heading}\n\nStable chunk body {run.run_id}."
    renamed = f"# {title}\n\n## {new_heading}\n\nStable chunk body {run.run_id}."

    with TestContext(
        fqc_dir=args.fqc_dir,
        vault_path=getattr(args, "vault_path", None),
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME),
    ) as ctx:
        create = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=title,
            content=original,
            tags=["chunk-rename", run.run_id],
        )
        create_payload = _payload(create)
        document_id = str(create_payload.get("fq_id") or "")
        if document_id:
            ctx.cleanup.track_mcp_document(document_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("_test")

        run.step(
            "create headed document through public write_document",
            passed=create.ok and bool(document_id),
            detail=expectation_detail(create) or create.error or json.dumps(create_payload, sort_keys=True),
            timing_ms=create.timing_ms,
            tool_result=create,
        )
        if not document_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        t0 = time.monotonic()
        before = _chunk_breadcrumbs(document_id)
        before_ok = any(old_heading in breadcrumb for breadcrumb in before)
        run.step(
            "created chunks include original heading metadata",
            passed=before_ok,
            detail="" if before_ok else json.dumps(before),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        update = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=document_id,
            content=renamed,
        )
        run.step(
            "rename heading through public write_document",
            passed=update.ok,
            detail=expectation_detail(update) or update.error or update.text[:1000],
            timing_ms=update.timing_ms,
            tool_result=update,
        )

        t0 = time.monotonic()
        after = _chunk_breadcrumbs(document_id)
        stale_removed = not any(old_heading in breadcrumb for breadcrumb in after)
        replacement_present = any(new_heading in breadcrumb for breadcrumb in after)
        run.step(
            "renamed heading removes stale chunk metadata",
            passed=update.ok and stale_removed and replacement_present,
            detail="" if stale_removed and replacement_present else json.dumps({"before": before, "after": after}, sort_keys=True),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        search = ctx.client.call_tool(
            "search",
            query=f"Stable chunk body {run.run_id}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=3,
        )
        search_payload = _payload(search)
        matched_breadcrumbs = _matched_chunk_breadcrumbs(search_payload, document_id)
        search_stale_removed = not any(old_heading in breadcrumb for breadcrumb in matched_breadcrumbs)
        search_replacement_present = any(new_heading in breadcrumb for breadcrumb in matched_breadcrumbs)
        run.step(
            "semantic search omits stale old-heading matched chunks",
            passed=search.ok and search_stale_removed and search_replacement_present,
            detail=expectation_detail(search) or search.error or json.dumps(search_payload, sort_keys=True),
            timing_ms=search.timing_ms,
            tool_result=search,
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

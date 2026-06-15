#!/usr/bin/env python3
"""D-chunk-3: maintain_vault backfill reports chunk counts and by-document breakdown."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import cli_main, db_url, first_action, lifecycle_catalog_config, parse_payload  # noqa: E402
from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_chunk_lifecycle_backfill"
COVERAGE = ["D-chunk-3"]
EMBEDDING_NAME = "chunk_lifecycle_primary"


def _clear_chunk_vectors(ctx, document_id: str, embedding_name: str = EMBEDDING_NAME) -> None:
    base = f"embedding_{embedding_name}"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE fqc_chunks
                SET "{base}" = NULL,
                    "{base}_model" = NULL,
                    "{base}_dimensions" = NULL,
                    "{base}_provider" = NULL,
                    "{base}_truncated" = NULL,
                    "{base}_indexed_at" = NULL
                WHERE document_id = %s
                """,
                (document_id,),
            )
        conn.commit()


def _record_model_count(ctx, document_id: str, embedding_name: str = EMBEDDING_NAME) -> int:
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT count(*) FROM fqc_chunks WHERE document_id = %s AND "embedding_{embedding_name}_model" IS NOT NULL',
                (document_id,),
            )
            return int(cur.fetchone()[0])


def _first_by_document(action: dict[str, Any]) -> dict[str, Any]:
    rows = action.get("by_document")
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = run.run_id.replace("-", "_")
    doc_path = f"chunk-lifecycle/backfill-{suffix}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME),
    ) as ctx:
        doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=f"Chunk Backfill {suffix}",
            content=f"## Alpha\n\nBackfill alpha body {suffix}.\n\n## Beta\n\nBackfill beta body {suffix}.",
            tags=["chunk-lifecycle"],
        )
        doc_payload = parse_payload(doc)
        document_id = str(doc_payload.get("fq_id") or "")
        if document_id:
            ctx.cleanup.track_mcp_document(document_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("chunk-lifecycle")
        run.step(
            "seed chunked document through public write_document",
            passed=doc.ok and bool(document_id),
            detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not document_id:
            return run

        _clear_chunk_vectors(ctx, document_id)

        backfill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name=EMBEDDING_NAME,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
        )
        payload = parse_payload(backfill)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        by_doc = _first_by_document(action)
        model_count = _record_model_count(ctx, document_id)
        passed = (
            backfill.ok
            and int(counts.get("rows_embedded") or 0) >= 1
            and by_doc.get("document_id") == document_id
            and int(by_doc.get("chunks_embedded") or 0) >= 1
            and model_count >= 1
        )
        run.step(
            "maintain_vault backfill reports chunk counts and by-document breakdown",
            passed=passed,
            detail=expectation_detail(backfill) or backfill.error or json.dumps(
                {"payload": payload, "model_count": model_count},
                sort_keys=True,
            ),
            timing_ms=backfill.timing_ms,
            tool_result=backfill,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

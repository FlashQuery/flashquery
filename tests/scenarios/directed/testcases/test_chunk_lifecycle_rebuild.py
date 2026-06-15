#!/usr/bin/env python3
"""D-chunk-4: rebuild_embeddings handles heading restructure and stale chunk removal."""
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

TEST_NAME = "test_chunk_lifecycle_rebuild"
COVERAGE = ["D-chunk-4", "T-A-004"]
EMBEDDING_NAME = "chunk_lifecycle_primary"


def _chunk_rows(ctx, document_id: str) -> list[dict[str, Any]]:
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT breadcrumb, embedding_chunk_lifecycle_primary_model
                FROM fqc_chunks
                WHERE document_id = %s
                ORDER BY breadcrumb, chunk_index
                """,
                (document_id,),
            )
            return [{"breadcrumb": row[0], "model": row[1]} for row in cur.fetchall()]


def _stamp_stale_chunk_vectors(ctx, document_id: str) -> None:
    dims = 768
    vector = "[" + ",".join(["0.001"] * dims) + "]"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE fqc_chunks
                SET embedding_chunk_lifecycle_primary = %s::vector,
                    embedding_chunk_lifecycle_primary_model = 'stale-model',
                    embedding_chunk_lifecycle_primary_dimensions = %s,
                    embedding_chunk_lifecycle_primary_provider = 'scenario',
                    embedding_chunk_lifecycle_primary_truncated = false,
                    embedding_chunk_lifecycle_primary_indexed_at = now()
                WHERE document_id = %s
                """,
                (vector, dims, document_id),
            )
        conn.commit()


def _first_by_document(action: dict[str, Any]) -> dict[str, Any]:
    rows = action.get("by_document")
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = run.run_id.replace("-", "_")
    doc_path = f"chunk-lifecycle/rebuild-{suffix}.md"
    old_heading = f"Old lifecycle heading {suffix}"
    new_heading = f"New lifecycle heading {suffix}"

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
            title=f"Chunk Rebuild {suffix}",
            content=f"## {old_heading}\n\nRebuild lifecycle body {suffix}.",
            tags=["chunk-lifecycle"],
        )
        doc_payload = parse_payload(doc)
        document_id = str(doc_payload.get("fq_id") or "")
        if document_id:
            ctx.cleanup.track_mcp_document(document_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("chunk-lifecycle")
        run.step(
            "seed headed chunked document through public write_document",
            passed=doc.ok and bool(document_id),
            detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not document_id:
            return run

        vault_file = Path(ctx.vault.vault_root) / doc_path
        vault_file.write_text(
            vault_file.read_text(encoding="utf-8").replace(old_heading, new_heading),
            encoding="utf-8",
        )
        before_rebuild = _chunk_rows(ctx, document_id)
        stale_still_present = any(old_heading in str(row.get("breadcrumb")) for row in before_rebuild)
        replacement_not_yet_present = not any(new_heading in str(row.get("breadcrumb")) for row in before_rebuild)
        run.step(
            "out-of-band heading edit leaves stale chunk rows for rebuild",
            passed=stale_still_present and replacement_not_yet_present,
            detail="" if stale_still_present and replacement_not_yet_present else json.dumps(before_rebuild, sort_keys=True),
        )
        if not (stale_still_present and replacement_not_yet_present):
            return run

        _stamp_stale_chunk_vectors(ctx, document_id)
        rebuild = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            embedding_name=EMBEDDING_NAME,
            confirm=EMBEDDING_NAME,
            stale_only=True,
            max_rows=10,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
        )
        payload = parse_payload(rebuild)
        action = first_action(payload)
        by_doc = _first_by_document(action)
        after = _chunk_rows(ctx, document_id)
        passed = (
            rebuild.ok
            and by_doc.get("document_id") == document_id
            and int(by_doc.get("chunks_embedded") or 0) >= 1
            and all(row.get("model") and row.get("model") != "stale-model" for row in after)
            and not any(old_heading in str(row.get("breadcrumb")) for row in after)
            and any(new_heading in str(row.get("breadcrumb")) for row in after)
        )
        run.step(
            "maintain_vault rebuild deletes stale old-heading chunks and embeds replacements",
            passed=passed,
            detail=expectation_detail(rebuild) or rebuild.error or json.dumps(
                {"payload": payload, "after": after},
                sort_keys=True,
            ),
            timing_ms=rebuild.timing_ms,
            tool_result=rebuild,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

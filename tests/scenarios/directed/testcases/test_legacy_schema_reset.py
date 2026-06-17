#!/usr/bin/env python3
"""D-121: managed legacy embedding schema reset recipe validates reset then backfill."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    db_url,
    first_action,
    lifecycle_context,
    parse_payload,
)

TEST_NAME = "test_legacy_schema_reset"


def _seed_and_drop_legacy_columns(ctx) -> dict[str, list[str]]:
    import psycopg

    if not ctx.server:
        raise RuntimeError("legacy reset scenario refuses non-managed mode")

    before: list[str] = []
    after: list[str] = []
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            for table in ("fqc_documents", "fqc_memory"):
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS embedding vector(768)')
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS embedding_model TEXT')
            cur.execute(
                """
                SELECT table_name || '.' || column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN ('fqc_documents', 'fqc_memory')
                  AND column_name IN ('embedding', 'embedding_model')
                ORDER BY 1
                """
            )
            before = [row[0] for row in cur.fetchall()]
            for table in ("fqc_documents", "fqc_memory"):
                cur.execute(f'ALTER TABLE "{table}" DROP COLUMN IF EXISTS embedding')
                cur.execute(f'ALTER TABLE "{table}" DROP COLUMN IF EXISTS embedding_model')
            cur.execute(
                """
                SELECT table_name || '.' || column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN ('fqc_documents', 'fqc_memory')
                  AND column_name IN ('embedding', 'embedding_model')
                ORDER BY 1
                """
            )
            after = [row[0] for row in cur.fetchall()]

            # The shared scenario database still has startup/write paths that expect
            # the legacy singular vector column to exist. Restore it after recording
            # the reset evidence so this managed scenario cannot poison later tests.
            for table in ("fqc_documents", "fqc_memory"):
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS embedding vector(768)')
                cur.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_embedding" ON "{table}" USING hnsw (embedding vector_cosine_ops)')
            cur.execute("SELECT pg_notify('pgrst', 'reload schema')")
        conn.commit()
    time.sleep(1)
    return {"before": before, "after": after}


def _clear_doc_vector(ctx, doc_id: str, name: str = "primary") -> None:
    import psycopg

    base = f"embedding_{name}"
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
                (doc_id,),
            )
        conn.commit()


def _doc_model(ctx, doc_id: str, name: str = "primary") -> str | None:
    import psycopg

    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT "embedding_{name}_model" FROM fqc_chunks WHERE document_id = %s LIMIT 1',
                (doc_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        legacy = _seed_and_drop_legacy_columns(ctx)
        run.step(
            "managed reset removes legacy singular embedding columns",
            passed=bool(legacy["before"]) and legacy["after"] == [],
            detail=json.dumps(legacy, sort_keys=True),
        )

        doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=f"lifecycle/legacy-reset-{run.run_id}.md",
            title=f"Lifecycle legacy-reset-{run.run_id}",
            content=f"Lifecycle document body legacy-reset-{run.run_id}",
            tags=["lifecycle"],
        )
        doc_payload = parse_payload(doc)
        doc_id = str(doc_payload.get("fq_id") or "")
        if doc_id:
            ctx.cleanup.track_mcp_document(doc_id)
            ctx.cleanup.track_file(f"lifecycle/legacy-reset-{run.run_id}.md")
            ctx.cleanup.track_dir("lifecycle")
        run.step(
            "seed document after managed reset",
            passed=doc.ok and bool(doc_id),
            detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not doc_id:
            return run

        _clear_doc_vector(ctx, doc_id, "primary")
        backfill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents"]},
        )
        payload = parse_payload(backfill)
        counts = first_action(payload).get("counts")
        model = _doc_model(ctx, doc_id, "primary")
        run.step(
            "post-reset top-level embedding catalog backfills documents",
            passed=(
                backfill.ok
                and isinstance(counts, dict)
                and counts.get("rows_embedded") == 1
                and bool(model)
            ),
            detail=expectation_detail(backfill) or backfill.error or json.dumps(
                {"payload": payload, "model": model},
                sort_keys=True,
            ),
            timing_ms=backfill.timing_ms,
            tool_result=backfill,
        )

        search = ctx.client.call_tool(
            "search",
            query=f"Lifecycle document body legacy-reset-{run.run_id}",
            entity_types=["documents", "memories"],
        )
        run.step(
            "post-reset semantic search returns reset recipe content",
            passed=search.ok and "Lifecycle legacy-reset" in search.text and "semantic" in search.text,
            detail=expectation_detail(search) or search.error or search.text[:1000],
            timing_ms=search.timing_ms,
            tool_result=search,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

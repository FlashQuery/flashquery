#!/usr/bin/env python3
"""
Test: backfill_embeddings dry_run returns would_process counts → backfill embeds → re-backfill skips

Scenario:
    1. Create a document with two heading sections (write_document)
    2. Wait for auto-embedding to settle
    3. Clear chunk embedding vectors directly in the DB
    4. Call maintain_vault backfill_embeddings with dry_run=True — verify would_process_chunks >= 1
       and would_process_documents == 1, and that no embedding was actually written (D-chunk-9)
    5. Run a real backfill (no dry_run) to embed chunks
    6. Run a second backfill — verify by_document reports chunks_skipped_already_present >= 1
       and chunks_embedded == 0 (D-chunk-10)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-chunk-9, D-chunk-10

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_chunk_lifecycle_dry_run_and_skip.py                            # existing server
    python test_chunk_lifecycle_dry_run_and_skip.py --managed                  # managed server
    python test_chunk_lifecycle_dry_run_and_skip.py --managed --json           # structured JSON with server logs
    python test_chunk_lifecycle_dry_run_and_skip.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    db_url,
    first_action,
    lifecycle_catalog_config,
    parse_payload,
)
from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_chunk_lifecycle_dry_run_and_skip"
COVERAGE = ["D-chunk-9", "D-chunk-10"]
EMBEDDING_NAME = "chunk_lifecycle_primary"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clear_chunk_vectors(ctx: TestContext, document_id: str, embedding_name: str = EMBEDDING_NAME) -> None:
    """Null out all embedding stamp columns for a document's chunks in the DB."""
    import psycopg

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


def _count_non_null_embeddings(ctx: TestContext, document_id: str, embedding_name: str = EMBEDDING_NAME) -> int:
    """Return the count of chunks for this document that have a non-null embedding vector."""
    import psycopg

    col = f"embedding_{embedding_name}"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT count(*) FROM fqc_chunks WHERE document_id = %s AND "{col}" IS NOT NULL',
                (document_id,),
            )
            return int(cur.fetchone()[0])


def _first_by_document(action: dict[str, Any]) -> dict[str, Any]:
    """Extract the first entry from the by_document breakdown, or empty dict."""
    rows = action.get("by_document")
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = run.run_id.replace("-", "_")
    doc_path = f"chunk-lifecycle/dry-skip-{suffix}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — require_embedding needs a server
        # configured with the test embedding catalog; shared servers don't have it.
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME),
    ) as ctx:

        # ── Step 1: Create a document with two heading sections ───────────
        doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=f"Chunk DryRun Skip {suffix}",
            content=(
                f"## Alpha\n\nDryrun alpha body {suffix}.\n\n"
                f"## Beta\n\nDryrun beta body {suffix}."
            ),
            tags=["chunk-lifecycle"],
        )
        doc_payload = parse_payload(doc)
        document_id = str(doc_payload.get("fq_id") or "")
        if document_id:
            ctx.cleanup.track_mcp_document(document_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("chunk-lifecycle")

        run.step(
            label="seed chunked document via write_document",
            passed=doc.ok and bool(document_id),
            detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not document_id:
            return run

        # ── Step 2: Wait for auto-embedding to settle ─────────────────────
        # write_document triggers background embedding; wait for it to complete
        # so that clearing vectors afterward has a defined baseline.
        time.sleep(5)

        # ── Step 3: Clear chunk vectors (DB direct) ───────────────────────
        # This ensures the backfill has something to process during the dry-run.
        _clear_chunk_vectors(ctx, document_id)

        # ── Step 4: dry_run backfill — D-chunk-9 ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        dry = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name=EMBEDDING_NAME,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
            dry_run=True,
        )
        dry_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        dry_payload = parse_payload(dry)
        dry_action = first_action(dry_payload)

        would_process_chunks = dry_action.get("would_process_chunks")
        would_process_documents = dry_action.get("would_process_documents")
        non_null_after_dry = _count_non_null_embeddings(ctx, document_id)

        dry_checks = {
            "dry_run call succeeded": dry.ok,
            "would_process_chunks >= 1": isinstance(would_process_chunks, int) and would_process_chunks >= 1,
            "would_process_documents == 1": would_process_documents == 1,
            "no embedding rows written after dry_run": non_null_after_dry == 0,
        }
        dry_all_ok = all(dry_checks.values())
        dry_detail = ""
        if not dry_all_ok:
            failed = [k for k, v in dry_checks.items() if not v]
            dry_detail = (
                f"Failed: {', '.join(failed)}. "
                f"would_process_chunks={would_process_chunks!r}, "
                f"would_process_documents={would_process_documents!r}, "
                f"non_null_after_dry={non_null_after_dry!r}, "
                f"action={json.dumps(dry_action, sort_keys=True)}"
            )

        run.step(
            label="dry_run backfill returns would_process counts without writing embeddings (D-chunk-9)",
            passed=dry_all_ok,
            detail=dry_detail or expectation_detail(dry) or dry.error or "",
            timing_ms=dry.timing_ms,
            tool_result=dry,
            server_logs=dry_logs,
        )

        # ── Step 5: Real backfill to embed chunks ─────────────────────────
        log_mark2 = ctx.server.log_position if ctx.server else 0
        real_fill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name=EMBEDDING_NAME,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
        )
        real_logs = ctx.server.logs_since(log_mark2) if ctx.server else None
        real_payload = parse_payload(real_fill)
        real_action = first_action(real_payload)
        real_by_doc = _first_by_document(real_action)
        real_counts = real_action.get("counts") if isinstance(real_action.get("counts"), dict) else {}

        run.step(
            label="real backfill embeds chunks in preparation for skip test",
            passed=(
                real_fill.ok
                and int(real_counts.get("rows_embedded") or 0) >= 1
                and int(real_by_doc.get("chunks_embedded") or 0) >= 1
            ),
            detail=expectation_detail(real_fill) or real_fill.error or json.dumps(real_payload, sort_keys=True),
            timing_ms=real_fill.timing_ms,
            tool_result=real_fill,
            server_logs=real_logs,
        )
        if not real_fill.ok:
            return run

        # ── Step 6: Second backfill — D-chunk-10 ─────────────────────────
        # Chunks are already embedded with current content_hash; backfill should
        # skip them and report chunks_skipped_already_present >= 1.
        log_mark3 = ctx.server.log_position if ctx.server else 0
        skip_fill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name=EMBEDDING_NAME,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
        )
        skip_logs = ctx.server.logs_since(log_mark3) if ctx.server else None
        skip_payload = parse_payload(skip_fill)
        skip_action = first_action(skip_payload)
        skip_by_doc = _first_by_document(skip_action)

        chunks_skipped = skip_by_doc.get("chunks_skipped_already_present")
        chunks_embedded = skip_by_doc.get("chunks_embedded")

        skip_checks = {
            "second backfill call succeeded": skip_fill.ok,
            "by_document entry present": bool(skip_by_doc),
            "chunks_skipped_already_present >= 1": isinstance(chunks_skipped, int) and chunks_skipped >= 1,
            "chunks_embedded == 0": chunks_embedded == 0,
        }
        skip_all_ok = all(skip_checks.values())
        skip_detail = ""
        if not skip_all_ok:
            failed = [k for k, v in skip_checks.items() if not v]
            skip_detail = (
                f"Failed: {', '.join(failed)}. "
                f"chunks_skipped_already_present={chunks_skipped!r}, "
                f"chunks_embedded={chunks_embedded!r}, "
                f"by_doc={json.dumps(skip_by_doc, sort_keys=True)}"
            )

        run.step(
            label="second backfill skips already-present chunks in by_document breakdown (D-chunk-10)",
            passed=skip_all_ok,
            detail=skip_detail or expectation_detail(skip_fill) or skip_fill.error or "",
            timing_ms=skip_fill.timing_ms,
            tool_result=skip_fill,
            server_logs=skip_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────────
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
        description=TEST_NAME,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
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

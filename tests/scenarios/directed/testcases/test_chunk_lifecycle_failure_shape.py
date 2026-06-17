#!/usr/bin/env python3
"""
Test: write_document -> backfill_embeddings (bad model) -> chunk failures include chunk_id, document_id, heading_path

Scenario:
    1. Start managed server with a bad embedding model so every embedding call fails.
    2. Create a multi-section document so multiple chunk rows are produced (write_document).
    3. Clear chunk vector columns directly so backfill has rows to process.
    4. Run backfill_embeddings scoped to the document path.
    5. Assert that failures[] contains entries with entity_type="document_chunk", non-empty
       chunk_id and document_id, and the heading_path key present.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-chunk-17

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_chunk_lifecycle_failure_shape.py                            # existing server
    python test_chunk_lifecycle_failure_shape.py --managed                  # managed server
    python test_chunk_lifecycle_failure_shape.py --managed --json           # structured JSON with server logs
    python test_chunk_lifecycle_failure_shape.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    db_url,
    first_action,
    lifecycle_catalog_config,
    parse_payload,
)
from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_chunk_lifecycle_failure_shape"
COVERAGE = ["D-chunk-17"]
EMBEDDING_NAME = "primary"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clear_chunk_vectors(ctx: TestContext, document_id: str, embedding_name: str = EMBEDDING_NAME) -> None:
    """Clear embedding columns for all chunks of a document so backfill has rows to process."""
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


def _count_chunks(ctx: TestContext, document_id: str) -> int:
    """Return the number of chunk rows for a document."""
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM fqc_chunks WHERE document_id = %s",
                (document_id,),
            )
            return int(cur.fetchone()[0])


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = run.run_id.replace("-", "_")
    doc_path = f"chunk-failure/{suffix}.md"

    # Force managed=True and use a bad model so every embedding call fails.
    # The bad model name causes the provider to reject every request,
    # which populates failures[] instead of counts.rows_embedded.
    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME, model="definitely-missing-lifecycle-model"),
    ) as ctx:

        # ── Step 1: Create multi-section document ──────────────────────────
        doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=doc_path,
            title=f"Chunk Failure {suffix}",
            content=(
                f"## Alpha\n\nFailure alpha body {suffix}.\n\n"
                f"## Beta\n\nFailure beta body {suffix}."
            ),
            tags=["chunk-failure"],
        )
        doc_payload = parse_payload(doc)
        doc_id = str(doc_payload.get("fq_id") or "")
        if doc_id:
            ctx.cleanup.track_mcp_document(doc_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("chunk-failure")
        run.step(
            "seed chunked document through write_document",
            passed=doc.ok and bool(doc_id),
            detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not doc_id:
            return run

        # Wait for chunk rows to be created — chunking is synchronous with the write
        # but we give a small buffer for any async follow-up work to settle.
        import time
        time.sleep(3)

        # ── Step 2: Verify chunk rows exist before clearing ────────────────
        chunk_count = _count_chunks(ctx, doc_id)
        run.step(
            "chunk rows exist in fqc_chunks after write_document",
            passed=chunk_count >= 1,
            detail=f"chunk_count={chunk_count}, document_id={doc_id}",
        )
        if chunk_count < 1:
            return run

        # Clear the embedding columns so backfill has NULL rows to process
        _clear_chunk_vectors(ctx, doc_id)

        # ── Step 3: Run backfill with bad model — expect failures[] ───────
        result = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name=EMBEDDING_NAME,
            scope={"entity_types": ["documents"], "documents": {"paths": [doc_path]}},
        )
        payload = parse_payload(result)
        action = first_action(payload)
        failures = action.get("failures") if isinstance(action.get("failures"), list) else []

        # Filter to document_chunk failures only
        chunk_failures = [f for f in failures if f.get("entity_type") == "document_chunk"]

        checks = {
            "result ok": result.ok,
            "at least one chunk failure": len(chunk_failures) >= 1,
            "all chunk failures have entity_type=document_chunk": all(
                f.get("entity_type") == "document_chunk" for f in chunk_failures
            ),
            "all chunk failures have non-empty chunk_id": all(
                bool(f.get("chunk_id")) for f in chunk_failures
            ),
            "all chunk failures have non-empty document_id": all(
                bool(f.get("document_id")) for f in chunk_failures
            ),
            "all chunk failures have heading_path key": all(
                "heading_path" in f for f in chunk_failures
            ),
            "all chunk failures have error": all(
                bool(f.get("error")) for f in chunk_failures
            ),
        }
        passed = all(checks.values())
        failed_checks = [k for k, v in checks.items() if not v]
        detail = (
            expectation_detail(result)
            or result.error
            or json.dumps(
                {
                    "checks_failed": failed_checks,
                    "chunk_failures": chunk_failures,
                    "all_failures": failures,
                    "payload": payload,
                },
                sort_keys=True,
            )
        )
        run.step(
            "per-chunk failures include entity_type, chunk_id, document_id, heading_path",
            passed=passed,
            detail=detail,
            timing_ms=result.timing_ms,
            tool_result=result,
        )

        # ── Optionally retain files for debugging ──────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ─────────────────────────────
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

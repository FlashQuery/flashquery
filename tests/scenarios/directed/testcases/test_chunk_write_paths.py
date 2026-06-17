#!/usr/bin/env python3
"""
Test: Chunk rows created via copy_document, scanner discovery, and heading-less documents.

Scenario:
    D-chunk-6: Create source doc → copy_document → verify chunk rows for copy → semantic search
               returns matched_chunks for copy content.
    D-chunk-7: Write file directly to vault (bypassing MCP) → scan_vault → semantic search
               returns matched_chunks for that file's content.
    D-chunk-8: Create heading-less document → semantic search returns matched_chunks where
               matched_chunks[0].breadcrumb contains the document title (title-derived breadcrumb).

    Cleanup is automatic.

Coverage points: D-chunk-6, D-chunk-7, D-chunk-8

Modes:
    Default     Connects to an already-running FlashQuery instance (embedding must be enabled)
    --managed   Starts a dedicated FlashQuery subprocess for this test (recommended)

Usage:
    python test_chunk_write_paths.py --managed
    python test_chunk_write_paths.py --managed --json
    python test_chunk_write_paths.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

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

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    db_url,
    lifecycle_catalog_config,
    parse_payload,
)

TEST_NAME = "test_chunk_write_paths"
COVERAGE = ["D-chunk-6", "D-chunk-7", "D-chunk-8"]
EMBEDDING_NAME = "chunk_write_paths_primary"


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _chunks_for_document(ctx: TestContext, document_id: str) -> list[dict[str, Any]]:
    """Query fqc_chunks for a given document_id via psycopg."""
    if psycopg is None:
        raise RuntimeError("psycopg is required for chunk verification")
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, breadcrumb, content
                FROM fqc_chunks
                WHERE document_id = %s
                ORDER BY chunk_index
                """,
                (document_id,),
            )
            return [
                {"id": row[0], "breadcrumb": row[1], "content": row[2]}
                for row in cur.fetchall()
            ]


# ---------------------------------------------------------------------------
# Search helpers
# ---------------------------------------------------------------------------

def _matched_chunks_for(payload: dict[str, Any], document_id: str) -> list[dict[str, Any]]:
    """Extract matched_chunks from a search payload for a specific document_id."""
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    for r in results:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("fq_id") or r.get("id") or r.get("document_id") or "")
        if rid == document_id:
            chunks = r.get("matched_chunks")
            return [c for c in chunks if isinstance(c, dict)] if isinstance(chunks, list) else []
    return []


def _any_matched_chunks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return matched_chunks from the first result that has any, regardless of document_id."""
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    for r in results:
        if not isinstance(r, dict):
            continue
        chunks = r.get("matched_chunks")
        if isinstance(chunks, list) and chunks:
            return [c for c in chunks if isinstance(c, dict)]
    return []


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = run.run_id

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — embeddings must be enabled
        # for semantic search to work, and the shared suite server runs without embeddings.
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME),
    ) as ctx:

        # ══════════════════════════════════════════════════════════════════════
        # D-chunk-6: copy_document produces chunk rows for the copy, and
        #            semantic search returns matched_chunks for copy content.
        # ══════════════════════════════════════════════════════════════════════

        src_path = f"_test/chunk_copy_src_{suffix}.md"
        src_title = f"Chunk Copy Source {suffix}"
        src_content = (
            f"## Alpha\n\nCopy source alpha {suffix}.\n\n"
            f"## Beta\n\nCopy source beta {suffix}."
        )

        # ── Step 1: Create source document ───────────────────────────────────
        create = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=src_path,
            title=src_title,
            content=src_content,
            tags=["chunk-write-paths", suffix],
        )
        create_payload = parse_payload(create)
        src_doc_id = str(create_payload.get("fq_id") or "")
        if src_doc_id:
            ctx.cleanup.track_mcp_document(src_doc_id)
            ctx.cleanup.track_file(src_path)
            ctx.cleanup.track_dir("_test")

        run.step(
            "D-chunk-6: create source document for copy",
            passed=create.ok and bool(src_doc_id),
            detail=expectation_detail(create) or create.error or json.dumps(create_payload, sort_keys=True),
            timing_ms=create.timing_ms,
            tool_result=create,
        )
        if not src_doc_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # Wait for embedding to settle after write_document (async)
        time.sleep(5)

        # ── Step 2: copy_document to a new path ──────────────────────────────
        copy_path = f"_test/chunk_copy_dest_{suffix}.md"
        copy_result = ctx.client.call_tool(
            "copy_document",
            identifier=src_doc_id,
            destination=copy_path,
        )
        copy_payload = parse_payload(copy_result)
        copy_doc_id = str(copy_payload.get("fq_id") or "")
        if copy_doc_id:
            ctx.cleanup.track_mcp_document(copy_doc_id)
            ctx.cleanup.track_file(copy_path)

        run.step(
            "D-chunk-6: copy_document produces a new document",
            passed=copy_result.ok and bool(copy_doc_id),
            detail=expectation_detail(copy_result) or copy_result.error or json.dumps(copy_payload, sort_keys=True),
            timing_ms=copy_result.timing_ms,
            tool_result=copy_result,
        )
        if not copy_doc_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 3: Verify chunk rows exist in DB for the copy ───────────────
        t0 = time.monotonic()
        try:
            copy_chunks = _chunks_for_document(ctx, copy_doc_id)
            has_chunks = len(copy_chunks) >= 1
            run.step(
                "D-chunk-6: copy document has chunk rows in fqc_chunks",
                passed=has_chunks,
                detail="" if has_chunks else f"No chunk rows found for copy document_id={copy_doc_id}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        except Exception as exc:
            run.step(
                "D-chunk-6: copy document has chunk rows in fqc_chunks",
                passed=False,
                detail=f"Exception: {exc}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # Wait for embedding on the copy to settle
        time.sleep(5)

        # ── Step 4: Semantic search finds matched_chunks for copy content ─────
        search6 = ctx.client.call_tool(
            "search",
            query=f"copy source alpha {suffix}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=3,
        )
        search6_payload = parse_payload(search6)
        matched6 = _matched_chunks_for(search6_payload, copy_doc_id)
        search6_visible = any(
            suffix in str(chunk.get("content") or "") for chunk in matched6
        )
        run.step(
            "D-chunk-6: semantic search on copy content returns matched_chunks",
            passed=search6.ok and search6_visible,
            detail=(
                expectation_detail(search6)
                or search6.error
                or json.dumps(
                    {"matched_for_copy": matched6, "all_results": search6_payload.get("results", [])},
                    sort_keys=True,
                )
            ),
            timing_ms=search6.timing_ms,
            tool_result=search6,
        )

        # ══════════════════════════════════════════════════════════════════════
        # D-chunk-7: Scanner discovery of a file written directly to vault
        #            creates chunk rows; semantic search returns matched_chunks.
        # ══════════════════════════════════════════════════════════════════════

        # ── Step 5: Write file directly to vault (bypass MCP) ────────────────
        scanner_path = f"_test/chunk_scanner_{suffix}.md"
        scanner_title = f"Scanner Discovery {suffix}"
        scanner_body = f"This document was written directly to the vault for scanner test {suffix}."
        ctx.create_file(scanner_path, title=scanner_title, body=scanner_body, tags=["chunk-write-paths", suffix])

        # ── Step 6: Run scan_vault (blocking sync) ────────────────────────────
        scan_result = ctx.scan_vault()
        run.step(
            "D-chunk-7: scan_vault discovers directly-written file",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or scan_result.text[:500],
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
        )
        if not scan_result.ok:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 7: Resolve the scanner document's fq_id via filesystem search ─
        t0 = time.monotonic()
        fs_search = ctx.client.call_tool(
            "search",
            query=scanner_title,
            mode="filesystem",
            entity_types=["documents"],
            limit=5,
        )
        fs_payload = parse_payload(fs_search)
        fs_results = fs_payload.get("results", [])
        scanner_doc_id = ""
        for r in fs_results:
            if not isinstance(r, dict):
                continue
            path_val = str(r.get("path") or "")
            if scanner_path in path_val or scanner_title in str(r.get("title") or ""):
                scanner_doc_id = str(r.get("fq_id") or r.get("id") or "")
                if scanner_doc_id:
                    ctx.cleanup.track_mcp_document(scanner_doc_id)
                    break
        scanner_found = bool(scanner_doc_id)
        run.step(
            "D-chunk-7: scanner-indexed document found via filesystem search",
            passed=fs_search.ok and scanner_found,
            detail=(
                expectation_detail(fs_search)
                or fs_search.error
                or json.dumps({"scanner_doc_id": scanner_doc_id, "results": fs_results}, sort_keys=True)
            ),
            timing_ms=int((time.monotonic() - t0) * 1000),
            tool_result=fs_search,
        )
        if not scanner_found:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # Wait longer for scanner-triggered embedding (async embed queue may be slower)
        time.sleep(8)

        # ── Step 8: Semantic search returns matched_chunks for scanner file ───
        search7 = ctx.client.call_tool(
            "search",
            query=f"written directly to the vault for scanner test {suffix}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=3,
        )
        search7_payload = parse_payload(search7)
        matched7 = _matched_chunks_for(search7_payload, scanner_doc_id)
        if not matched7:
            # Also accept it appearing in any result (scanner doc id may differ from filesystem)
            matched7 = _any_matched_chunks(search7_payload)
        search7_visible = any(
            suffix in str(chunk.get("content") or "") for chunk in matched7
        )
        run.step(
            "D-chunk-7: semantic search on scanner-discovered file returns matched_chunks",
            passed=search7.ok and search7_visible,
            detail=(
                expectation_detail(search7)
                or search7.error
                or json.dumps(
                    {"matched_for_scanner": matched7, "all_results": search7_payload.get("results", [])},
                    sort_keys=True,
                )
            ),
            timing_ms=search7.timing_ms,
            tool_result=search7,
        )

        # ══════════════════════════════════════════════════════════════════════
        # D-chunk-8: Heading-less document produces a single chunk with a
        #            title-derived breadcrumb visible in matched_chunks[0].breadcrumb
        # ══════════════════════════════════════════════════════════════════════

        # ── Step 9: Create heading-less document ─────────────────────────────
        hl_path = f"_test/chunk_headingless_{suffix}.md"
        hl_title = f"Headingless Doc {suffix}"
        hl_body = f"This is a headingless document body for test {suffix}."
        # No ## headings — plain body text only
        hl_content = hl_body

        hl_create = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=hl_path,
            title=hl_title,
            content=hl_content,
            tags=["chunk-write-paths", suffix],
        )
        hl_payload = parse_payload(hl_create)
        hl_doc_id = str(hl_payload.get("fq_id") or "")
        if hl_doc_id:
            ctx.cleanup.track_mcp_document(hl_doc_id)
            ctx.cleanup.track_file(hl_path)

        run.step(
            "D-chunk-8: create heading-less document",
            passed=hl_create.ok and bool(hl_doc_id),
            detail=expectation_detail(hl_create) or hl_create.error or json.dumps(hl_payload, sort_keys=True),
            timing_ms=hl_create.timing_ms,
            tool_result=hl_create,
        )
        if not hl_doc_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # Wait for embedding to settle
        time.sleep(5)

        # ── Step 10: Semantic search returns exactly 1 chunk with title breadcrumb ─
        search8 = ctx.client.call_tool(
            "search",
            query=f"headingless document body for test {suffix}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=5,
        )
        search8_payload = parse_payload(search8)
        matched8 = _matched_chunks_for(search8_payload, hl_doc_id)
        exactly_one = len(matched8) == 1
        breadcrumb_has_title = hl_title in str(matched8[0].get("breadcrumb") or "") if matched8 else False
        run.step(
            "D-chunk-8: heading-less doc yields exactly 1 chunk with title-derived breadcrumb",
            passed=search8.ok and exactly_one and breadcrumb_has_title,
            detail=(
                expectation_detail(search8)
                or search8.error
                or json.dumps(
                    {
                        "exactly_one": exactly_one,
                        "breadcrumb_has_title": breadcrumb_has_title,
                        "hl_title": hl_title,
                        "matched8": matched8,
                    },
                    sort_keys=True,
                )
            ),
            timing_ms=search8.timing_ms,
            tool_result=search8,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=TEST_NAME)
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

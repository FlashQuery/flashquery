#!/usr/bin/env python3
"""
Test: semantic search matched_chunks shape — limit cap, span nulls, indexed_at map,
      archived exclusion, and mixed-mode doc-centric results.

Scenario:
    1. Create a multi-section document via write_document (3 sections so limit_chunks_per_result=1
       is meaningful) and wait for embedding (time.sleep(8))
    2. D-chunk-11: search with limit_chunks_per_result=1 — verify the test doc has at most
       1 matched chunk even when multiple sections match
    3. D-chunk-12a: search with limit_chunks_per_result=0 — verify invalid_input error envelope
    4. D-chunk-12b: search with limit_chunks_per_result=26 — verify invalid_input error envelope
    5. D-chunk-13: verify matched_chunks entries carry indexed_at as a dict with ISO timestamps
    6. D-chunk-14: verify matched_chunks entries always carry span_start=null and span_end=null
    7. Create a second document for D-chunk-15, wait for embedding, then archive it
    8. D-chunk-15: semantic search for archived doc's unique content — verify it's excluded
    9. D-chunk-16: search with mode="mixed" for test doc — verify doc-centric result with
       matched_chunks present
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-chunk-11, D-chunk-12, D-chunk-13, D-chunk-14, D-chunk-15, D-chunk-16

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_chunk_search_result_shape.py                            # existing server
    python test_chunk_search_result_shape.py --managed                  # managed server
    python test_chunk_search_result_shape.py --managed --json           # structured JSON with server logs
    python test_chunk_search_result_shape.py --managed --json --keep    # keep files for debugging

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

# testcases/ -> directed/ -> scenarios/ -> framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from lifecycle_embedding_scenario_helpers import lifecycle_catalog_config, parse_payload  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_chunk_search_result_shape"
COVERAGE = ["D-chunk-11", "D-chunk-12", "D-chunk-13", "D-chunk-14", "D-chunk-15", "D-chunk-16"]
EMBEDDING_NAME = "chunk_search_shape"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_doc_in_results(results: list[dict[str, Any]], fq_id: str) -> dict[str, Any] | None:
    """Return the result entry whose fq_id matches, or None."""
    for item in results:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("fq_id") or item.get("id") or item.get("document_id") or "")
        if item_id == fq_id:
            return item
    return None


def _matched_chunks(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract matched_chunks list from a search result item."""
    chunks = item.get("matched_chunks")
    if not isinstance(chunks, list):
        return []
    return [c for c in chunks if isinstance(c, dict)]


def _response_indicates_invalid(result) -> bool:
    """Return True if the response signals rejection of invalid input.

    Accepts two shapes:
    - MCP schema-level rejection (result.ok=False, text contains "validation" or "invalid")
    - FlashQuery invalid_input envelope (result.ok=True, payload status/error contains "invalid")
    """
    text = result.text or ""
    lower = text.lower()
    # MCP schema validation rejection
    if not result.ok and ("valid" in lower or "invalid" in lower):
        return True
    # FlashQuery-level invalid_input in response text
    if "invalid" in lower:
        return True
    # Parsed payload envelope check
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            status = payload.get("status") or ""
            error = payload.get("error") or ""
            if "invalid" in str(status).lower() or "invalid" in str(error).lower():
                return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    suffix = run.run_id
    main_doc_path = f"_test/{TEST_NAME}_{suffix}_main.md"
    archived_doc_path = f"_test/{TEST_NAME}_{suffix}_archived.md"

    # Multi-section body so limit_chunks_per_result=1 is meaningful
    main_body = (
        f"# Main Title {suffix}\n\n"
        f"## Section Alpha\n\n"
        f"Content about alpha topic {suffix} for retrieval testing.\n\n"
        f"## Section Beta\n\n"
        f"Content about beta topic {suffix} for retrieval testing.\n\n"
        f"## Section Gamma\n\n"
        f"Content about gamma topic {suffix} for retrieval testing.\n"
    )

    archived_body = (
        f"# Archived Doc {suffix}\n\n"
        f"This document will be archived {suffix} and must not appear in semantic search.\n"
    )

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — embeddings must be enabled
        # for semantic search to work, and the shared suite server runs without
        # embedding configured.
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(EMBEDDING_NAME),
    ) as ctx:

        # ── Step 1: Create main multi-section document ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_main = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=main_doc_path,
            title=f"Chunk Shape Main {suffix}",
            content=main_body,
            tags=["fqc-test", "chunk-shape", suffix],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        main_payload = parse_payload(create_main)
        main_fq_id = str(main_payload.get("fq_id") or "")

        if main_fq_id:
            ctx.cleanup.track_mcp_document(main_fq_id)
            ctx.cleanup.track_file(main_doc_path)
            ctx.cleanup.track_dir("_test")

        run.step(
            label="create main multi-section document",
            passed=create_main.ok and bool(main_fq_id),
            detail=expectation_detail(create_main) or create_main.error or json.dumps(main_payload),
            timing_ms=create_main.timing_ms,
            tool_result=create_main,
            server_logs=step_logs,
        )
        if not main_fq_id:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 2: D-chunk-11 — limit_chunks_per_result=1 caps results ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_limit1 = ctx.client.call_tool(
            "search",
            query=f"topic {suffix} retrieval testing",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        limit1_payload = parse_payload(search_limit1)
        limit1_results = limit1_payload.get("results", [])
        main_item = _find_doc_in_results(limit1_results, main_fq_id)
        main_chunks = _matched_chunks(main_item) if main_item else []

        checks_11 = {
            "search ok": search_limit1.ok,
            "doc found in results": main_item is not None,
            "matched_chunks <= 1": len(main_chunks) <= 1,
        }
        all_ok_11 = all(checks_11.values())
        detail_11 = ""
        if not all_ok_11:
            failed_11 = [k for k, v in checks_11.items() if not v]
            detail_11 = (
                f"Failed: {', '.join(failed_11)}. "
                f"results_count={len(limit1_results)}, "
                f"doc_found={main_item is not None}, "
                f"chunk_count={len(main_chunks)}, "
                f"payload_keys={list(limit1_payload.keys())}"
            )

        run.step(
            label="D-chunk-11: limit_chunks_per_result=1 caps matched_chunks to 1",
            passed=all_ok_11,
            detail=detail_11,
            timing_ms=search_limit1.timing_ms,
            tool_result=search_limit1,
            server_logs=step_logs,
        )

        # ── Step 3: D-chunk-12a — limit_chunks_per_result=0 → invalid_input ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_invalid0 = ctx.client.call_tool(
            "search",
            query=f"topic {suffix}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=0,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        is_invalid0 = _response_indicates_invalid(search_invalid0)

        run.step(
            label="D-chunk-12a: limit_chunks_per_result=0 returns invalid_input",
            passed=is_invalid0,
            detail="" if is_invalid0 else f"Expected invalid_input signal but got: {search_invalid0.text[:500]}",
            timing_ms=search_invalid0.timing_ms,
            tool_result=search_invalid0,
            server_logs=step_logs,
        )

        # ── Step 4: D-chunk-12b — limit_chunks_per_result=26 → invalid_input ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_invalid26 = ctx.client.call_tool(
            "search",
            query=f"topic {suffix}",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=26,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        is_invalid26 = _response_indicates_invalid(search_invalid26)

        run.step(
            label="D-chunk-12b: limit_chunks_per_result=26 returns invalid_input",
            passed=is_invalid26,
            detail="" if is_invalid26 else f"Expected invalid_input signal but got: {search_invalid26.text[:500]}",
            timing_ms=search_invalid26.timing_ms,
            tool_result=search_invalid26,
            server_logs=step_logs,
        )

        # ── Step 5: D-chunk-13 — indexed_at map with ISO timestamps ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_shape = ctx.client.call_tool(
            "search",
            query=f"topic {suffix} retrieval testing",
            mode="semantic",
            entity_types=["documents"],
            limit=5,
            limit_chunks_per_result=5,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        shape_payload = parse_payload(search_shape)
        shape_results = shape_payload.get("results", [])
        shape_item = _find_doc_in_results(shape_results, main_fq_id)
        shape_chunks = _matched_chunks(shape_item) if shape_item else []

        # Verify each chunk has indexed_at as a dict with a non-null ISO string for "primary"
        indexed_at_ok = True
        indexed_at_detail_parts: list[str] = []
        if not shape_chunks:
            indexed_at_ok = False
            indexed_at_detail_parts.append("no matched_chunks found")
        for i, chunk in enumerate(shape_chunks):
            ia = chunk.get("indexed_at")
            if not isinstance(ia, dict):
                indexed_at_ok = False
                indexed_at_detail_parts.append(f"chunk[{i}].indexed_at is not a dict: {ia!r}")
                continue
            primary_ts = ia.get(EMBEDDING_NAME)
            if primary_ts is None:
                indexed_at_ok = False
                indexed_at_detail_parts.append(f"chunk[{i}].indexed_at['{EMBEDDING_NAME}'] is null")
            elif not isinstance(primary_ts, str):
                indexed_at_ok = False
                indexed_at_detail_parts.append(
                    f"chunk[{i}].indexed_at['{EMBEDDING_NAME}'] is not a string: {primary_ts!r}"
                )

        run.step(
            label="D-chunk-13: matched_chunks.indexed_at is a map with ISO timestamp for 'primary'",
            passed=search_shape.ok and indexed_at_ok,
            detail="; ".join(indexed_at_detail_parts) if indexed_at_detail_parts else "",
            timing_ms=search_shape.timing_ms,
            tool_result=search_shape,
            server_logs=step_logs,
        )

        # ── Step 6: D-chunk-14 — span_start and span_end are null in v1 ──
        span_ok = True
        span_detail_parts: list[str] = []
        if not shape_chunks:
            span_ok = False
            span_detail_parts.append("no matched_chunks found for span check")
        for i, chunk in enumerate(shape_chunks):
            if chunk.get("span_start") is not None:
                span_ok = False
                span_detail_parts.append(
                    f"chunk[{i}].span_start={chunk['span_start']!r} (expected null)"
                )
            if chunk.get("span_end") is not None:
                span_ok = False
                span_detail_parts.append(
                    f"chunk[{i}].span_end={chunk['span_end']!r} (expected null)"
                )

        run.step(
            label="D-chunk-14: matched_chunks.span_start and span_end are null in v1",
            passed=span_ok,
            detail="; ".join(span_detail_parts) if span_detail_parts else "",
            timing_ms=0,
        )

        # ── Step 7: Create and archive second document for D-chunk-15 ──
        log_mark = ctx.server.log_position if ctx.server else 0
        create_archived = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=archived_doc_path,
            title=f"Archived Chunk Doc {suffix}",
            content=archived_body,
            tags=["fqc-test", "chunk-archived", suffix],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        archived_payload = parse_payload(create_archived)
        archived_fq_id = str(archived_payload.get("fq_id") or "")

        if archived_fq_id:
            ctx.cleanup.track_mcp_document(archived_fq_id)
            ctx.cleanup.track_file(archived_doc_path)
            # _test dir already tracked from main doc

        run.step(
            label="create second document for archive exclusion test",
            passed=create_archived.ok and bool(archived_fq_id),
            detail=expectation_detail(create_archived) or create_archived.error or json.dumps(archived_payload),
            timing_ms=create_archived.timing_ms,
            tool_result=create_archived,
            server_logs=step_logs,
        )

        # Now archive it
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=archived_fq_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="archive the second document",
            passed=archive_result.ok,
            detail=archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )

        # ── Step 8: D-chunk-15 — archived doc excluded from semantic search ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_archived = ctx.client.call_tool(
            "search",
            query=f"archived {suffix} document",
            mode="semantic",
            entity_types=["documents"],
            limit=10,
            limit_chunks_per_result=5,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        archived_payload2 = parse_payload(search_archived)
        archived_results = archived_payload2.get("results", [])
        archived_item = _find_doc_in_results(archived_results, archived_fq_id)

        checks_15 = {
            "search ok": search_archived.ok,
            "archived doc not in results": archived_item is None,
        }
        all_ok_15 = all(checks_15.values())
        detail_15 = ""
        if not all_ok_15:
            failed_15 = [k for k, v in checks_15.items() if not v]
            detail_15 = (
                f"Failed: {', '.join(failed_15)}. "
                f"archived_fq_id={archived_fq_id!r}, "
                f"result_count={len(archived_results)}, "
                f"found_item={archived_item!r}"
            )

        run.step(
            label="D-chunk-15: archived document excluded from semantic search results",
            passed=all_ok_15,
            detail=detail_15,
            timing_ms=search_archived.timing_ms,
            tool_result=search_archived,
            server_logs=step_logs,
        )

        # ── Step 9: D-chunk-16 — mixed mode returns doc-centric results with matched_chunks ──
        log_mark = ctx.server.log_position if ctx.server else 0
        search_mixed = ctx.client.call_tool(
            "search",
            query=f"topic {suffix} retrieval testing",
            mode="mixed",
            entity_types=["documents"],
            limit=10,
            limit_chunks_per_result=5,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        mixed_payload = parse_payload(search_mixed)
        mixed_results = mixed_payload.get("results", [])
        mixed_item = _find_doc_in_results(mixed_results, main_fq_id)
        mixed_chunks = _matched_chunks(mixed_item) if mixed_item else []

        checks_16 = {
            "search ok": search_mixed.ok,
            "doc found in mixed results": mixed_item is not None,
            "matched_chunks present in mixed result": len(mixed_chunks) >= 1,
        }
        all_ok_16 = all(checks_16.values())
        detail_16 = ""
        if not all_ok_16:
            failed_16 = [k for k, v in checks_16.items() if not v]
            detail_16 = (
                f"Failed: {', '.join(failed_16)}. "
                f"result_count={len(mixed_results)}, "
                f"doc_found={mixed_item is not None}, "
                f"chunk_count={len(mixed_chunks)}, "
                f"payload_keys={list(mixed_payload.keys())}"
            )

        run.step(
            label="D-chunk-16: mixed mode returns doc-centric results with matched_chunks",
            passed=all_ok_16,
            detail=detail_16,
            timing_ms=search_mixed.timing_ms,
            tool_result=search_mixed,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────
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
        description="Test: chunk search result shape — limit cap, span nulls, indexed_at, archived exclusion, mixed mode.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                        help="Path to flashquery-core directory.")
    parser.add_argument("--managed", action="store_true",
                        help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                        default=None,
                        help="Port range for managed server (default: 9100 9199).")
    parser.add_argument("--json", action="store_true", dest="output_json",
                        help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                        help="Retain test files for debugging (skip cleanup).")

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

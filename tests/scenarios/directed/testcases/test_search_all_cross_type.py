#!/usr/bin/env python3
"""
Test: search_all cross-type search across documents and memories.

Scenario:
    1. Create a distinctive document via MCP (create_document) with unique phrase + tag
    2. Save a distinctive memory via MCP (save_memory) with unique phrase + shared tag
    3. search_all by document phrase -> expect document in results (SA-01)
    4. search_all by memory phrase -> expect memory in results (SA-02)
    5. search_all with entity_types=['documents'] -> only documents section (SA-03)
    6. search_all with tags=[unique_tag] -> tag-restricted results (SA-04)
    7. (Second TestContext, embeddings disabled) Create a doc and run search_all
       -> filesystem fallback returns the doc, no error (SA-05)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: SA-01, SA-02, SA-03, SA-04, SA-05

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_search_all_cross_type.py                            # existing server
    python test_search_all_cross_type.py --managed                  # managed server
    python test_search_all_cross_type.py --managed --json           # structured JSON with server logs
    python test_search_all_cross_type.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["SA-01", "SA-02", "SA-03", "SA-04", "SA-05"]
REQUIRES_MANAGED = True

import argparse
import re
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_search_all_cross_type"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_memory_id(text: str) -> str:
    """save_memory returns 'Memory ID: <uuid>'."""
    return _extract_field(text, "Memory ID")


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    port_range = tuple(args.port_range) if args.port_range else None

    # Phase 1 unique fixtures (semantic mode)
    doc_phrase = f"quetzalcoatl thunder {run.run_id}"
    mem_phrase = f"palimpsest murmuration {run.run_id}"
    unique_tag = f"sa-test-{run.run_id}"
    shared_tag = f"sa-shared-{run.run_id}"
    doc_title = f"FQC Search-All Doc {run.run_id}"
    doc_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    doc_body = (
        f"## Cross-type search fixture\n\n"
        f"This document contains the phrase {doc_phrase} for SA-01 verification.\n"
    )
    mem_body = (
        f"Cross-type search fixture memory: {mem_phrase}. "
        f"Created by {TEST_NAME} (run {run.run_id})."
    )

    # ─────────────────────────────────────────────────────────────────────
    # PHASE 1 — embeddings ENABLED (SA-01..SA-04)
    # ─────────────────────────────────────────────────────────────────────
    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — require_embedding=True
        # configures the embedding provider; the shared suite server has none.
        managed=True,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:

        # ── Step 1: Create a distinctive document via MCP ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=doc_title,
            content=doc_body,
            path=doc_path,
            tags=["fqc-test", unique_tag, shared_tag, run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path")

        if created_path:
            ctx.cleanup.track_file(created_path)
            parts = Path(created_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        create_result.expect_contains(doc_title)

        run.step(
            label="create_document via MCP (fixture for SA-01/03/04)",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        # ── Step 2: Save a distinctive memory via MCP ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        mem_result = ctx.client.call_tool(
            "save_memory",
            content=mem_body,
            tags=["fqc-test", shared_tag, run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        memory_id = _extract_memory_id(mem_result.text)
        if memory_id:
            ctx.cleanup.track_mcp_memory(memory_id)
        # Memories are cleaned up via archive_memory; TestCleanup tracks
        # documents by archive_document, so manual archive in cleanup phase.
        # We'll archive at end of phase 1 explicitly.

        mem_result.expect_contains("Memory")

        run.step(
            label="save_memory via MCP (fixture for SA-02)",
            passed=(mem_result.ok and mem_result.status == "pass"),
            detail=expectation_detail(mem_result) or mem_result.error or "",
            timing_ms=mem_result.timing_ms,
            tool_result=mem_result,
            server_logs=step_logs,
        )
        if not mem_result.ok:
            return run

        # Make sure the document is indexed before search
        ctx.client.call_tool("force_file_scan", background=False)

        # ── Step 3: SA-01 — search_all finds documents by query ───
        log_mark = ctx.server.log_position if ctx.server else 0
        sa01_result = ctx.client.call_tool(
            "search_all",
            query=doc_phrase,
            limit=10,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        sa01_result.expect_contains("## Documents")
        sa01_result.expect_contains(doc_title)

        run.step(
            label="SA-01: search_all finds document by query",
            passed=(sa01_result.ok and sa01_result.status == "pass"),
            detail=expectation_detail(sa01_result) or sa01_result.error or "",
            timing_ms=sa01_result.timing_ms,
            tool_result=sa01_result,
            server_logs=step_logs,
        )

        # ── Step 4: SA-02 — search_all finds memories by query ────
        log_mark = ctx.server.log_position if ctx.server else 0
        sa02_result = ctx.client.call_tool(
            "search_all",
            query=mem_phrase,
            limit=10,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        sa02_result.expect_contains("## Memories")
        # The memory body should appear in the results (possibly truncated)
        sa02_result.expect_contains("palimpsest murmuration")

        run.step(
            label="SA-02: search_all finds memory by query",
            passed=(sa02_result.ok and sa02_result.status == "pass"),
            detail=expectation_detail(sa02_result) or sa02_result.error or "",
            timing_ms=sa02_result.timing_ms,
            tool_result=sa02_result,
            server_logs=step_logs,
        )

        # ── Step 5: SA-03 — entity_types filter restricts results ─
        log_mark = ctx.server.log_position if ctx.server else 0
        sa03_result = ctx.client.call_tool(
            "search_all",
            query=mem_phrase,
            entity_types=["documents"],
            limit=10,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Only the documents section should appear; no Memories section
        sa03_result.expect_contains("## Documents")
        sa03_result.expect_not_contains("## Memories")
        # And the memory body must NOT appear
        sa03_result.expect_not_contains("palimpsest murmuration")

        run.step(
            label="SA-03: entity_types=['documents'] restricts results",
            passed=(sa03_result.ok and sa03_result.status == "pass"),
            detail=expectation_detail(sa03_result) or sa03_result.error or "",
            timing_ms=sa03_result.timing_ms,
            tool_result=sa03_result,
            server_logs=step_logs,
        )

        # ── Step 6: SA-04 — tag filtering ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        sa04_result = ctx.client.call_tool(
            "search_all",
            query=doc_phrase,
            tags=[unique_tag],
            tag_match="any",
            limit=10,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Document carries unique_tag, so it should still come back
        sa04_result.expect_contains(doc_title)
        # Memory does NOT carry unique_tag, so its phrase must NOT appear
        sa04_result.expect_not_contains("palimpsest murmuration")

        run.step(
            label="SA-04: tag filter restricts results",
            passed=(sa04_result.ok and sa04_result.status == "pass"),
            detail=expectation_detail(sa04_result) or sa04_result.error or "",
            timing_ms=sa04_result.timing_ms,
            tool_result=sa04_result,
            server_logs=step_logs,
        )

        # ── Archive the test memory before leaving phase 1 ────────
        if memory_id:
            try:
                ctx.client.call_tool("archive_memory", memory_id=memory_id)
            except Exception:
                pass

        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            run.step(
                label="Cleanup skipped (--keep) [phase 1]",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After phase 1 `with` block: cleanup ran, server stopped
    phase1_cleanup_errors = list(ctx.cleanup_errors)

    # ─────────────────────────────────────────────────────────────────────
    # PHASE 2 — embeddings DISABLED (SA-05 filesystem fallback)
    # ─────────────────────────────────────────────────────────────────────
    fb_unique = f"zibblefrotz{run.run_id}"
    fb_title = f"FQC FS Fallback {fb_unique}"
    fb_path = f"_test/{TEST_NAME}_fallback_{run.run_id}.md"
    fb_body = (
        f"## Filesystem fallback fixture\n\n"
        f"Distinctive token: {fb_unique}.\n"
    )

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=False,
    ) as ctx2:

        # ── Step 7: Create a doc on the embedding-less server ─────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        fb_create = ctx2.client.call_tool(
            "create_document",
            title=fb_title,
            content=fb_body,
            path=fb_path,
            tags=["fqc-test", run.run_id],
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None

        fb_fqc_id = _extract_field(fb_create.text, "FQC ID")
        fb_created_path = _extract_field(fb_create.text, "Path")

        if fb_created_path:
            ctx2.cleanup.track_file(fb_created_path)
            parts = Path(fb_created_path).parts
            for i in range(1, len(parts)):
                ctx2.cleanup.track_dir(str(Path(*parts[:i])))
        if fb_fqc_id:
            ctx2.cleanup.track_mcp_document(fb_fqc_id)

        fb_create.expect_contains(fb_title)

        run.step(
            label="create_document on embedding-less server (SA-05 fixture)",
            passed=(fb_create.ok and fb_create.status == "pass"),
            detail=expectation_detail(fb_create) or fb_create.error or "",
            timing_ms=fb_create.timing_ms,
            tool_result=fb_create,
            server_logs=step_logs,
        )
        if not fb_create.ok:
            return run

        # Make sure the file is registered before search
        ctx2.client.call_tool("force_file_scan", background=False)

        # ── Step 8: SA-05 — search_all falls back to filesystem ───
        log_mark = ctx2.server.log_position if ctx2.server else 0
        sa05_result = ctx2.client.call_tool(
            "search_all",
            query=fb_unique,
            limit=10,
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None

        # Should NOT be an error response — graceful degradation
        # Document section should still appear and contain our doc
        sa05_result.expect_contains("## Documents")
        sa05_result.expect_contains(fb_title)
        # Memories section should appear with the fallback note (mixed mode)
        sa05_result.expect_contains("## Memories")
        sa05_result.expect_contains("Memory search requires embedding configuration")

        run.step(
            label="SA-05: search_all falls back to filesystem when embeddings disabled",
            passed=(sa05_result.ok and sa05_result.status == "pass"),
            detail=expectation_detail(sa05_result) or sa05_result.error or "",
            timing_ms=sa05_result.timing_ms,
            tool_result=sa05_result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx2.cleanup._vault_files.clear()
            ctx2.cleanup._mcp_identifiers.clear()
            ctx2.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep) [phase 2]",
                passed=True,
                detail=f"Files retained under: {ctx2.vault.vault_root / '_test'}",
            )

        # ── Attach phase-2 server logs (overwrites phase-1 attach) ─
        if ctx2.server:
            existing = run.server_logs or []
            run.attach_server_logs(existing + ["--- phase 2 ---"] + ctx2.server.captured_logs)

    # Combine cleanup errors from both phases
    all_cleanup_errors = phase1_cleanup_errors + list(ctx2.cleanup_errors)
    run.record_cleanup(all_cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: search_all cross-type search across documents and memories.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
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

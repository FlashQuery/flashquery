#!/usr/bin/env python3
"""
Test: search_documents tag_match='all' and limit parameter.

Scenario:
    1. Create 3 documents:
       - Doc A: tags = ["s03-alpha-{run_id}", "s03-beta-{run_id}"]  (has BOTH tags)
       - Doc B: tags = ["s03-alpha-{run_id}"]                        (has ONLY alpha)
       - Doc C: tags = ["s03-alpha-{run_id}", "s03-beta-{run_id}"]  (has BOTH tags)
    2. force_file_scan(background=False) to index all three

    S-03 — tag_match='all':
    3. search_documents with tags=[alpha, beta], tag_match="all"
    4. Verify Doc A appears in results
    5. Verify Doc C appears in results
    6. Verify Doc B does NOT appear (it only has alpha, not beta)

    S-06 — limit parameter:
    7. search_documents with tags=[alpha], limit=2
       (all 3 docs have this tag, but limit=2 means at most 2 returned)
    8. Verify result count is <= 2
    9. Verify at least 1 result IS returned (not empty)

    Cleanup: Archive + delete all 3 docs

Coverage points: S-03, S-06

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_search_tags_and_limits.py                            # existing server
    python test_search_tags_and_limits.py --managed                  # managed server
    python test_search_tags_and_limits.py --managed --json           # structured JSON with server logs
    python test_search_tags_and_limits.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["S-03", "S-06"]

import argparse
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_search_tags_and_limits"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Tag names unique to this run
    alpha_tag = f"s03-alpha-{run.run_id}"
    beta_tag = f"s03-beta-{run.run_id}"

    # Unique titles to identify each doc in search results
    title_a = f"S03 DocA Both Tags {run.run_id}"
    title_b = f"S03 DocB Alpha Only {run.run_id}"
    title_c = f"S03 DocC Both Tags {run.run_id}"

    body_a = (
        f"## Doc A\n\nCreated by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document has both alpha and beta tags."
    )
    body_b = (
        f"## Doc B\n\nCreated by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document has only the alpha tag."
    )
    body_c = (
        f"## Doc C\n\nCreated by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document has both alpha and beta tags."
    )

    path_a = f"_test/{TEST_NAME}_a_{run.run_id}.md"
    path_b = f"_test/{TEST_NAME}_b_{run.run_id}.md"
    path_c = f"_test/{TEST_NAME}_c_{run.run_id}.md"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create Doc A (both alpha + beta tags) via MCP ────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title=title_a,
            content=body_a,
            path=path_a,
            tags=[alpha_tag, beta_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_a = _extract_field(create_a.text, "FQC ID")
        created_path_a = _extract_field(create_a.text, "Path")

        if created_path_a:
            ctx.cleanup.track_file(created_path_a)
            parts = Path(created_path_a).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_a:
            ctx.cleanup.track_mcp_document(fqc_id_a)

        create_a.expect_contains(title_a)

        run.step(
            label="create_document Doc A (both tags)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            return run

        # ── Step 2: Create Doc B (alpha tag only) via MCP ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title=title_b,
            content=body_b,
            path=path_b,
            tags=[alpha_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_b = _extract_field(create_b.text, "FQC ID")
        created_path_b = _extract_field(create_b.text, "Path")

        if created_path_b:
            ctx.cleanup.track_file(created_path_b)
            parts = Path(created_path_b).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_b:
            ctx.cleanup.track_mcp_document(fqc_id_b)

        create_b.expect_contains(title_b)

        run.step(
            label="create_document Doc B (alpha only)",
            passed=(create_b.ok and create_b.status == "pass"),
            detail=expectation_detail(create_b) or create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            return run

        # ── Step 3: Create Doc C (both alpha + beta tags) via MCP ────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_c = ctx.client.call_tool(
            "create_document",
            title=title_c,
            content=body_c,
            path=path_c,
            tags=[alpha_tag, beta_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_c = _extract_field(create_c.text, "FQC ID")
        created_path_c = _extract_field(create_c.text, "Path")

        if created_path_c:
            ctx.cleanup.track_file(created_path_c)
            parts = Path(created_path_c).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_c:
            ctx.cleanup.track_mcp_document(fqc_id_c)

        create_c.expect_contains(title_c)

        run.step(
            label="create_document Doc C (both tags)",
            passed=(create_c.ok and create_c.status == "pass"),
            detail=expectation_detail(create_c) or create_c.error or "",
            timing_ms=create_c.timing_ms,
            tool_result=create_c,
            server_logs=step_logs,
        )
        if not create_c.ok:
            return run

        # ── Step 4: Force vault scan to index all three docs ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Step 5: S-03 — tag_match='all': search for both tags ─────
        # Docs A and C should appear; Doc B (alpha only) should NOT appear
        log_mark = ctx.server.log_position if ctx.server else 0
        all_tags_result = ctx.client.call_tool(
            "search_documents",
            tags=[alpha_tag, beta_tag],
            tag_match="all",
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        all_tags_result.expect_contains(title_a)
        all_tags_result.expect_contains(title_c)
        all_tags_result.expect_not_contains(
            title_b,
            label=f"Doc B (alpha-only) excluded from tag_match=all results",
        )

        run.step(
            label=f"search_documents(tags=[alpha, beta], tag_match='all') — S-03",
            passed=(all_tags_result.ok and all_tags_result.status == "pass"),
            detail=expectation_detail(all_tags_result) or all_tags_result.error or "",
            timing_ms=all_tags_result.timing_ms,
            tool_result=all_tags_result,
            server_logs=step_logs,
        )

        # ── Step 6: S-06 — limit=2: all 3 docs match, only 2 returned
        log_mark = ctx.server.log_position if ctx.server else 0
        limit_result = ctx.client.call_tool(
            "search_documents",
            tags=[alpha_tag],
            limit=2,
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Must return at least 1 result
        limit_result.expect_count_gte(1)

        # Must return at most 2 results — check manually since no expect_count_lte exists
        actual_count = limit_result._count_results()
        limit_respected = actual_count <= 2
        limit_result.expectations.append({
            "check": "count_lte",
            "expected": 2,
            "actual": actual_count,
            "passed": limit_respected,
            "label": f"result count <= 2 (limit=2 respected)",
        })

        run.step(
            label="search_documents(tags=[alpha], limit=2) — S-06",
            passed=(limit_result.ok and limit_result.status == "pass"),
            detail=expectation_detail(limit_result) or limit_result.error or "",
            timing_ms=limit_result.timing_ms,
            tool_result=limit_result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
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
        description="Test: search_documents tag_match='all' and limit parameter.",
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

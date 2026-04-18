#!/usr/bin/env python3
"""
Test: create_document → search (hit) → archive_document → search (miss) → empty-query search.

Scenario:
    1. Create a document via MCP (create_document) with a unique title and tag
    2. Search by unique tag (search_documents) — verify exactly 1 hit (baseline)
    3. Search for a guaranteed non-matching query — verify "No documents found." (S-04, X-09)
    4. Archive the document via MCP (archive_document)
    5. Verify on disk that frontmatter status is now "archived" (D-12)
    6. Search by the same unique tag again — verify archived doc is excluded (D-13, S-05, X-09)
    7. Search by the original title — verify archived doc is excluded
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-12, D-13, S-04, S-05, X-09

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_archive_and_search.py                            # existing server
    python test_document_archive_and_search.py --managed                  # managed server
    python test_document_archive_and_search.py --managed --json           # structured JSON with server logs
    python test_document_archive_and_search.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-12", "D-13", "S-04", "S-05", "X-09"]

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

TEST_NAME = "test_document_archive_and_search"


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

    unique_title = f"FQC Archive Test {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    body = (
        f"## Archive Target\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document will be archived and should disappear from search results."
    )
    unique_tag = f"archive-{run.run_id}"
    tags = ["fqc-test", "archive-test", unique_tag]

    # A query that should match nothing in the vault
    nonsense_query = f"zzz-no-match-{run.run_id}-qqq"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create document via MCP ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=unique_title,
            content=body,
            path=test_path,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path")

        # Register for cleanup — both filesystem and database
        if created_path:
            ctx.cleanup.track_file(created_path)
            parts = Path(created_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        create_result.expect_contains(unique_title)

        run.step(
            label="create_document via MCP",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        identifier = created_fqc_id or test_path

        # ── Step 2: Baseline search by unique tag (must hit) ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        baseline_result = ctx.client.call_tool(
            "search_documents",
            tags=[unique_tag],
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        baseline_result.expect_contains(unique_title)
        baseline_result.expect_count_eq(1)

        run.step(
            label=f"search_documents(tags=['{unique_tag}']) — baseline hit",
            passed=(baseline_result.ok and baseline_result.status == "pass"),
            detail=expectation_detail(baseline_result) or baseline_result.error or "",
            timing_ms=baseline_result.timing_ms,
            tool_result=baseline_result,
            server_logs=step_logs,
        )

        # ── Step 3: Search for a non-matching query (S-04, X-09) ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        miss_result = ctx.client.call_tool(
            "search_documents",
            query=nonsense_query,
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Empty search results should surface the canonical "No documents found." message
        miss_result.expect_contains("No documents found.")
        miss_result.expect_not_contains(unique_title)

        run.step(
            label=f"search_documents(query='{nonsense_query}') — empty result",
            passed=(miss_result.ok and miss_result.status == "pass"),
            detail=expectation_detail(miss_result) or miss_result.error or "",
            timing_ms=miss_result.timing_ms,
            tool_result=miss_result,
            server_logs=step_logs,
        )

        # ── Step 4: Archive document via MCP ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"archive_document(identifiers='{identifier}')",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if not archive_result.ok:
            return run

        # ── Step 5: Verify disk frontmatter shows status=archived (D-12) ─
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "status is archived": doc.status == "archived",
                "title preserved": doc.title == unique_title,
                "fqc_id unchanged": doc.fqc_id == created_fqc_id if created_fqc_id else True,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"status={doc.status!r}, title={doc.title!r}, "
                    f"fqc_id={doc.fqc_id!r}"
                )
            run.step("Verify archived frontmatter on disk", passed=all_ok,
                     detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("Verify archived frontmatter on disk", passed=False,
                     detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 6: Search by tag again — archived must be excluded (D-13, S-05) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        post_tag_result = ctx.client.call_tool(
            "search_documents",
            tags=[unique_tag],
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Archived doc should NOT appear; result set should be empty
        post_tag_result.expect_not_contains(unique_title)
        post_tag_result.expect_contains("No documents found.")

        run.step(
            label=f"search_documents(tags=['{unique_tag}']) — post-archive exclusion",
            passed=(post_tag_result.ok and post_tag_result.status == "pass"),
            detail=expectation_detail(post_tag_result) or post_tag_result.error or "",
            timing_ms=post_tag_result.timing_ms,
            tool_result=post_tag_result,
            server_logs=step_logs,
        )

        # ── Step 7: Search by title — archived must also be excluded ─
        log_mark = ctx.server.log_position if ctx.server else 0
        post_title_result = ctx.client.call_tool(
            "search_documents",
            query=unique_title,
            mode="filesystem",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        post_title_result.expect_not_contains(unique_title)

        run.step(
            label=f"search_documents(query='{unique_title}') — post-archive exclusion",
            passed=(post_title_result.ok and post_title_result.status == "pass"),
            detail=expectation_detail(post_title_result) or post_title_result.error or "",
            timing_ms=post_title_result.timing_ms,
            tool_result=post_title_result,
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
        description="Test: archive_document removes a doc from search, and empty searches return the canonical message.",
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

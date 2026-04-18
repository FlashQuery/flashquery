#!/usr/bin/env python3
"""
Test: create_document → get_document → update_document → get_document round-trip.

Scenario:
    1. Create a document via MCP (create_document) with a unique title, body, and tags
    2. Read it back via MCP (get_document) and verify the body content matches
    3. Verify frontmatter on disk (title, tags, fqc_id, status)
    4. Update the document via MCP (update_document) — change title, add a tag
    5. Read it back again via MCP (get_document) and verify the new body content
    6. Verify updated frontmatter on disk (new title, new tag present, fqc_id unchanged)
    Cleanup is automatic (filesystem + database) even if the test fails.

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_read_update.py                            # existing server
    python test_create_read_update.py --managed                  # managed server
    python test_create_read_update.py --managed --json           # structured JSON with server logs
    python test_create_read_update.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-01", "D-02", "D-03", "D-04", "D-05", "D-08", "X-01", "X-06", "X-07", "X-08"]

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

TEST_NAME = "test_create_read_update"


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

    unique_title = f"FQC Test {run.run_id}"
    updated_title = f"FQC Updated {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    original_body = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document tests the create → read → update cycle."
    )
    updated_body = (
        f"## Updated Content\n\n"
        f"Modified by {TEST_NAME} (run {run.run_id}).\n\n"
        f"The title, body, and tags have all been changed."
    )
    original_tags = ["fqc-test", "crud-test", run.run_id]
    added_tag = "updated-tag"

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
            content=original_body,
            path=test_path,
            tags=original_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse the fqc_id and path from the response for cleanup tracking
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

        # ── Step 2: Read back via MCP (get_document) ─────────────────
        # Use the fqc_id if available, otherwise fall back to path
        read_identifier = created_fqc_id or test_path

        log_mark = ctx.server.log_position if ctx.server else 0
        read_result = ctx.client.call_tool(
            "get_document",
            identifier=read_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The response should contain the original body content
        read_result.expect_contains("Original Content")
        read_result.expect_contains(run.run_id)

        run.step(
            label=f"get_document(identifier='{read_identifier}')",
            passed=(read_result.ok and read_result.status == "pass"),
            detail=expectation_detail(read_result) or read_result.error or "",
            timing_ms=read_result.timing_ms,
            tool_result=read_result,
            server_logs=step_logs,
        )

        # ── Step 3: Verify frontmatter on disk ───────────────────────
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title matches": doc.title == unique_title,
                "status is active": doc.status == "active",
                "run_id tag present": run.run_id in doc.tags,
                "crud-test tag present": "crud-test" in doc.tags,
                "fqc_id present": doc.fqc_id is not None,
                "fqc_id matches": doc.fqc_id == created_fqc_id if created_fqc_id else True,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc.title!r}, status={doc.status!r}, "
                    f"tags={doc.tags!r}, fqc_id={doc.fqc_id!r}"
                )
            run.step("Verify initial frontmatter on disk", passed=all_ok,
                     detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("Verify initial frontmatter on disk", passed=False,
                     detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 4: Update document via MCP ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        update_result = ctx.client.call_tool(
            "update_document",
            identifier=read_identifier,
            title=updated_title,
            content=updated_body,
            tags=original_tags + [added_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        update_result.expect_contains(updated_title)

        run.step(
            label="update_document (title + body + tags)",
            passed=(update_result.ok and update_result.status == "pass"),
            detail=expectation_detail(update_result) or update_result.error or "",
            timing_ms=update_result.timing_ms,
            tool_result=update_result,
            server_logs=step_logs,
        )
        if not update_result.ok:
            return run

        # ── Step 5: Read back again to confirm updates ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        read2_result = ctx.client.call_tool(
            "get_document",
            identifier=read_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Should contain the UPDATED body, not the original
        read2_result.expect_contains("Updated Content")
        read2_result.expect_not_contains("Original Content")

        run.step(
            label="get_document after update",
            passed=(read2_result.ok and read2_result.status == "pass"),
            detail=expectation_detail(read2_result) or read2_result.error or "",
            timing_ms=read2_result.timing_ms,
            tool_result=read2_result,
            server_logs=step_logs,
        )

        # ── Step 6: Verify updated frontmatter on disk ───────────────
        t0 = time.monotonic()
        try:
            doc2 = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title updated": doc2.title == updated_title,
                "status still active": doc2.status == "active",
                "original tags preserved": all(t in doc2.tags for t in original_tags),
                "new tag added": added_tag in doc2.tags,
                "fqc_id unchanged": doc2.fqc_id == created_fqc_id if created_fqc_id else True,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc2.title!r}, status={doc2.status!r}, "
                    f"tags={doc2.tags!r}, fqc_id={doc2.fqc_id!r}"
                )
            run.step("Verify updated frontmatter on disk", passed=all_ok,
                     detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("Verify updated frontmatter on disk", passed=False,
                     detail=f"Exception: {e}", timing_ms=elapsed)

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
        description="Test: create → read → update → read document round-trip.",
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

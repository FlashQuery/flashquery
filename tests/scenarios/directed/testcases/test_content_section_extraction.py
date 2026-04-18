#!/usr/bin/env python3
"""
Test: get_document sections filter and include_subheadings behavior.

Scenario:
    1. Create a document with rich multi-section content (Introduction,
       Main Content with nested Details/More Details, Conclusion).
    2. force_file_scan to index it.
    3. C-15: get_document with sections=["Introduction"] — verify only the
       Introduction section is returned, not Main Content or Conclusion.
    4. C-16: get_document with sections=["Main Content"], include_subheadings=True —
       verify the main section body AND its nested subheadings are present.
    5. C-17: get_document with sections=["Main Content"], include_subheadings=False —
       verify the main section body is present but nested subheadings are excluded.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: C-15, C-16, C-17

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_content_section_extraction.py                            # existing server
    python test_content_section_extraction.py --managed                  # managed server
    python test_content_section_extraction.py --managed --json           # structured JSON with server logs
    python test_content_section_extraction.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["C-15", "C-16", "C-17"]

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

TEST_NAME = "test_content_section_extraction"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_body(run_id: str) -> str:
    """Build a multi-section document body with nested subheadings."""
    return (
        "## Introduction\n\n"
        f"Introduction content here {run_id}.\n\n"
        "### Background\n\n"
        f"Background subsection content {run_id}.\n\n"
        "## Main Content\n\n"
        f"Main section content {run_id}.\n\n"
        "### Details\n\n"
        f"Details subsection content {run_id}.\n\n"
        "### More Details\n\n"
        f"More details subsection content {run_id}.\n\n"
        "## Conclusion\n\n"
        f"Conclusion content here {run_id}."
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_title = f"FQC Section Extraction {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    body = _build_body(run.run_id)
    tags = ["fqc-test", "section-extraction-test", run.run_id]

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
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
            label="create_document with multi-section body",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        identifier = created_fqc_id or test_path

        # ── Step 2: force_file_scan to index the document ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan to index document",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 3: C-15 — sections filter returns only requested section ──
        log_mark = ctx.server.log_position if ctx.server else 0
        c15_result = ctx.client.call_tool(
            "get_document",
            identifier=identifier,
            sections=["Introduction"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        c15_result.expect_contains(f"Introduction content here {run.run_id}")
        c15_result.expect_not_contains(f"Main section content {run.run_id}")
        c15_result.expect_not_contains(f"Conclusion content here {run.run_id}")

        run.step(
            label="C-15 get_document(sections=['Introduction']) — only that section returned",
            passed=(c15_result.ok and c15_result.status == "pass"),
            detail=expectation_detail(c15_result) or c15_result.error or "",
            timing_ms=c15_result.timing_ms,
            tool_result=c15_result,
            server_logs=step_logs,
        )

        # ── Step 4: C-16 — sections with include_subheadings=True ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        c16_result = ctx.client.call_tool(
            "get_document",
            identifier=identifier,
            sections=["Main Content"],
            include_subheadings=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        c16_result.expect_contains(f"Main section content {run.run_id}")
        c16_result.expect_contains(f"Details subsection content {run.run_id}")
        c16_result.expect_contains(f"More details subsection content {run.run_id}")

        run.step(
            label="C-16 get_document(sections=['Main Content'], include_subheadings=True) — subheadings included",
            passed=(c16_result.ok and c16_result.status == "pass"),
            detail=expectation_detail(c16_result) or c16_result.error or "",
            timing_ms=c16_result.timing_ms,
            tool_result=c16_result,
            server_logs=step_logs,
        )

        # ── Step 5: C-17 — sections with include_subheadings=False ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        c17_result = ctx.client.call_tool(
            "get_document",
            identifier=identifier,
            sections=["Main Content"],
            include_subheadings=False,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        c17_result.expect_contains(f"Main section content {run.run_id}")
        c17_result.expect_not_contains(f"Details subsection content {run.run_id}")

        run.step(
            label="C-17 get_document(sections=['Main Content'], include_subheadings=False) — subheadings excluded",
            passed=(c17_result.ok and c17_result.status == "pass"),
            detail=expectation_detail(c17_result) or c17_result.error or "",
            timing_ms=c17_result.timing_ms,
            tool_result=c17_result,
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
        description="Test: get_document sections filter and include_subheadings behavior.",
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

#!/usr/bin/env python3
"""
Test: get_document resolves both vault-relative path and filename-only identifiers.

Scenario:
    1. Create a document via MCP (create_document) at a specific path
    2. Call force_file_scan to ensure it is indexed in the database
    3. Get document by vault-relative path (e.g., "_test/myfile.md") — verify content
    4. Get document by filename only (e.g., "myfile") — verify content
    5. Verify both resolutions returned the same fqc_id
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage:
    D-06  Get document by vault-relative path
    D-07  Get document by filename only
    X-02  Identifier resolution: vault-relative path (cross-cutting guarantee)
    X-03  Identifier resolution: filename only (cross-cutting guarantee)

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_identifier_resolution.py                            # existing server
    python test_document_identifier_resolution.py --managed                  # managed server
    python test_document_identifier_resolution.py --managed --json           # structured JSON with server logs
    python test_document_identifier_resolution.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-06", "D-07", "X-02", "X-03"]

import argparse
import json
import re
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_document_identifier_resolution"


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

    unique_title = f"FQC Identifier Test {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    filename_only = Path(test_path).stem  # just "test_document_identifier_resolution_<run_id>" (no .md — per §6.6, '.md' identifiers are path lookups, not filename search)
    body_content = (
        f"## Identifier Resolution Test\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document tests vault-relative path and filename-only resolution."
    )

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
            content=body_content,
            path=test_path,
            tags=["fqc-test", "identifier-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse fqc_id and path from the response for cleanup tracking
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

        # ── Step 2: Force scan to ensure document is indexed ─────────
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
            return run  # cannot proceed without indexing; cleanup still runs

        # ── Step 3: Get document by vault-relative path (D-06, X-02) ─
        vault_relative_path = created_path or test_path
        log_mark = ctx.server.log_position if ctx.server else 0
        get_by_path_result = ctx.client.call_tool(
            "get_document",
            identifiers=vault_relative_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_by_path_result.expect_contains("Identifier Resolution Test")
        get_by_path_result.expect_contains(run.run_id)

        run.step(
            label=f"get_document(identifier='{vault_relative_path}') [vault-relative path]",
            passed=(get_by_path_result.ok and get_by_path_result.status == "pass"),
            detail=expectation_detail(get_by_path_result) or get_by_path_result.error or "",
            timing_ms=get_by_path_result.timing_ms,
            tool_result=get_by_path_result,
            server_logs=step_logs,
        )

        # ── Step 4: Get document by filename only (D-07, X-03) ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_by_filename_result = ctx.client.call_tool(
            "get_document",
            identifiers=filename_only,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_by_filename_result.expect_contains("Identifier Resolution Test")
        get_by_filename_result.expect_contains(run.run_id)

        run.step(
            label=f"get_document(identifier='{filename_only}') [filename only]",
            passed=(get_by_filename_result.ok and get_by_filename_result.status == "pass"),
            detail=expectation_detail(get_by_filename_result) or get_by_filename_result.error or "",
            timing_ms=get_by_filename_result.timing_ms,
            tool_result=get_by_filename_result,
            server_logs=step_logs,
        )

        # ── Step 5: Verify both resolutions resolved to the same document ─
        # get_document now returns a JSON envelope. The `identifier` field in
        # each envelope reflects the input identifier used in the request, so
        # the two envelopes will legitimately differ there. We compare fq_id
        # (the canonical document identity) and the body content instead.
        path_has_content = (
            get_by_path_result.ok
            and run.run_id in get_by_path_result.text
        )
        filename_has_content = (
            get_by_filename_result.ok
            and run.run_id in get_by_filename_result.text
        )
        # Parse envelopes and compare fq_id (canonical identity)
        same_fq_id = False
        fq_id_detail = ""
        try:
            env_path = json.loads(get_by_path_result.text)
            env_file = json.loads(get_by_filename_result.text)
            fq_id_path = env_path.get("fq_id") or env_path.get("fqc_id")
            fq_id_file = env_file.get("fq_id") or env_file.get("fqc_id")
            if fq_id_path and fq_id_file and fq_id_path == fq_id_file:
                same_fq_id = True
            else:
                fq_id_detail = f"fq_id_path={fq_id_path!r} fq_id_file={fq_id_file!r}"
        except Exception as exc:
            fq_id_detail = f"JSON parse error: {exc}"

        same_doc = path_has_content and filename_has_content and same_fq_id
        detail = ""
        if not same_doc:
            detail = (
                f"path_has_content={path_has_content}, "
                f"filename_has_content={filename_has_content}, "
                f"same_fq_id={same_fq_id}"
            )
            if fq_id_detail:
                detail += f" | {fq_id_detail}"
        run.step(
            label="Both resolutions returned same document (same fq_id, both bodies contain run_id)",
            passed=same_doc,
            detail=detail,
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
        description="Test: get_document resolves vault-relative path and filename-only identifiers.",
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

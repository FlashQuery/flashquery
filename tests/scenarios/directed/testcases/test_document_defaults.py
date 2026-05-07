#!/usr/bin/env python3
"""
Test: custom frontmatter fields (D-19) and default path assignment (D-20).

Scenario Part A — Custom frontmatter (D-19):
    1. Create a document via MCP with custom frontmatter fields
       (priority, category, project) beyond the standard set
    2. Force file scan so FQC indexes the document
    3. Get document by fqc_id and verify the response
    4. Read the vault file on disk and verify custom fields are in frontmatter

Scenario Part B — Default path (D-20):
    5. Create a document WITHOUT providing a path argument
    6. Force file scan
    7. Parse the assigned path from the create response
    8. Verify the path is non-empty (FQC assigned one)
    9. Verify the document is retrievable via the assigned path
   10. Verify the file exists on disk at the returned path
    Cleanup is automatic (filesystem + database) even if the test fails.

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_defaults.py                            # existing server
    python test_document_defaults.py --managed                  # managed server
    python test_document_defaults.py --managed --json           # structured JSON with server logs
    python test_document_defaults.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-19", "D-20"]

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

TEST_NAME = "test_document_defaults"


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

    # Part A identifiers
    custom_fm_title = f"Test Custom Frontmatter {run.run_id}"
    custom_fm_path = f"_test/test_document_defaults_custom_{run.run_id}.md"
    custom_frontmatter = {
        "priority": "high",
        "category": "test",
        "project": "fqc-testing",
    }

    # Part B identifiers
    default_path_title = f"Test Default Path {run.run_id}"
    default_path_tags = ["fqc-test", run.run_id]

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

        # ── Part A: Custom frontmatter (D-19) ─────────────────────────────

        # ── Step 1: Create document with custom frontmatter fields ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a_result = ctx.client.call_tool(
            "create_document",
            title=custom_fm_title,
            content="Custom frontmatter test content",
            path=custom_fm_path,
            frontmatter=custom_frontmatter,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse fqc_id and path for cleanup tracking
        created_fqc_id_a = _extract_field(create_a_result.text, "FQC ID")
        created_path_a = _extract_field(create_a_result.text, "Path")

        # Register for cleanup — both filesystem and database
        if created_path_a:
            ctx.cleanup.track_file(created_path_a)
            parts = Path(created_path_a).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        elif custom_fm_path:
            ctx.cleanup.track_file(custom_fm_path)
            parts = Path(custom_fm_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id_a:
            ctx.cleanup.track_mcp_document(created_fqc_id_a)

        create_a_result.expect_contains(custom_fm_title)

        run.step(
            label="create_document with custom frontmatter fields (D-19)",
            passed=(create_a_result.ok and create_a_result.status == "pass"),
            detail=expectation_detail(create_a_result) or create_a_result.error or "",
            timing_ms=create_a_result.timing_ms,
            tool_result=create_a_result,
            server_logs=step_logs,
        )
        if not create_a_result.ok:
            return run

        # ── Step 2: Force file scan ───────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_a_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after custom frontmatter create",
            passed=scan_a_result.ok,
            detail=scan_a_result.error or "",
            timing_ms=scan_a_result.timing_ms,
            tool_result=scan_a_result,
            server_logs=step_logs,
        )
        if not scan_a_result.ok:
            return run

        # ── Step 3: Get document by fqc_id ───────────────────────────────
        identifier_a = created_fqc_id_a or created_path_a or custom_fm_path

        log_mark = ctx.server.log_position if ctx.server else 0
        get_a_result = ctx.client.call_tool(
            "get_document",
            identifiers=identifier_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_a_result.expect_contains("Custom frontmatter test content")

        run.step(
            label=f"get_document(identifier='{identifier_a}') for custom frontmatter doc",
            passed=(get_a_result.ok and get_a_result.status == "pass"),
            detail=expectation_detail(get_a_result) or get_a_result.error or "",
            timing_ms=get_a_result.timing_ms,
            tool_result=get_a_result,
            server_logs=step_logs,
        )

        # ── Step 4: Verify custom frontmatter fields on disk ─────────────
        t0 = time.monotonic()
        try:
            disk_path_a = created_path_a or custom_fm_path
            doc_a = ctx.vault.read_file(disk_path_a)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title matches": doc_a.title == custom_fm_title,
                "priority field present": doc_a.frontmatter.get("priority") == "high",
                "category field present": doc_a.frontmatter.get("category") == "test",
                "project field present": doc_a.frontmatter.get("project") == "fqc-testing",
                "fqc_id present": doc_a.fqc_id is not None,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc_a.title!r}, "
                    f"priority={doc_a.frontmatter.get('priority')!r}, "
                    f"category={doc_a.frontmatter.get('category')!r}, "
                    f"project={doc_a.frontmatter.get('project')!r}, "
                    f"fqc_id={doc_a.fqc_id!r}"
                )
            run.step(
                label="Verify custom frontmatter fields on disk (D-19)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Verify custom frontmatter fields on disk (D-19)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Part B: Default path assignment (D-20) ────────────────────────

        # ── Step 5: Create document WITHOUT a path argument ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b_result = ctx.client.call_tool(
            "create_document",
            title=default_path_title,
            content="Default path test",
            tags=default_path_tags,
            # Deliberately omit `path` — FQC must assign one
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse the auto-assigned path and fqc_id
        created_path_b = _extract_field(create_b_result.text, "Path")
        created_fqc_id_b = _extract_field(create_b_result.text, "FQC ID")

        # Register for cleanup using the dynamically assigned path
        if created_path_b:
            ctx.cleanup.track_file(created_path_b)
            parts = Path(created_path_b).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id_b:
            ctx.cleanup.track_mcp_document(created_fqc_id_b)

        create_b_result.expect_contains(default_path_title)

        run.step(
            label="create_document without path argument (D-20)",
            passed=(create_b_result.ok and create_b_result.status == "pass"),
            detail=expectation_detail(create_b_result) or create_b_result.error or "",
            timing_ms=create_b_result.timing_ms,
            tool_result=create_b_result,
            server_logs=step_logs,
        )
        if not create_b_result.ok:
            return run

        # ── Step 6: Verify FQC assigned a non-empty path ─────────────────
        t0 = time.monotonic()
        path_assigned = bool(created_path_b and created_path_b.strip())
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="Verify FQC assigned a non-empty path (D-20)",
            passed=path_assigned,
            detail="" if path_assigned else f"Path was empty in response: {create_b_result.text[:300]}",
            timing_ms=elapsed,
        )
        if not path_assigned:
            return run

        # ── Step 7: Force file scan ───────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_b_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after default-path create",
            passed=scan_b_result.ok,
            detail=scan_b_result.error or "",
            timing_ms=scan_b_result.timing_ms,
            tool_result=scan_b_result,
            server_logs=step_logs,
        )
        if not scan_b_result.ok:
            return run

        # ── Step 8: Verify document is retrievable via assigned path ──────
        identifier_b = created_fqc_id_b or created_path_b

        log_mark = ctx.server.log_position if ctx.server else 0
        get_b_result = ctx.client.call_tool(
            "get_document",
            identifiers=identifier_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_b_result.expect_contains("Default path test")

        run.step(
            label=f"get_document(identifier='{identifier_b}') for default-path doc (D-20)",
            passed=(get_b_result.ok and get_b_result.status == "pass"),
            detail=expectation_detail(get_b_result) or get_b_result.error or "",
            timing_ms=get_b_result.timing_ms,
            tool_result=get_b_result,
            server_logs=step_logs,
        )

        # ── Step 9: Verify file exists on disk at the returned path ──────
        t0 = time.monotonic()
        try:
            file_exists_on_disk = ctx.vault.exists(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            detail = "" if file_exists_on_disk else (
                f"File not found on disk at vault-relative path: {created_path_b!r}. "
                f"vault_root={ctx.vault.vault_root}"
            )
            run.step(
                label=f"Verify file exists on disk at assigned path '{created_path_b}' (D-20)",
                passed=file_exists_on_disk,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Verify file exists on disk at assigned path (D-20)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Optionally retain files for debugging ─────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under vault root: {ctx.vault.vault_root}",
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
        description="Test: custom frontmatter fields (D-19) and default path assignment (D-20).",
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

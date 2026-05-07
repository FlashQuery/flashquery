#!/usr/bin/env python3
"""
Test: copy_document and move_document operations.

Scenario:
    Part A — Copy:
    1. Create original document via create_document with a specific path and content
    2. force_file_scan to index it
    3. Call copy_document to copy it to a new path (_test/copy_dest_{run_id}.md)
    4. force_file_scan again
    5. Verify copy has a different fqc_id but the same content (D-14)
    6. Verify original still exists and content is unchanged (D-15)

    Part B — Move:
    7. Create a second document to move
    8. force_file_scan
    9. Record the original fqc_id
    10. Call move_document to a nested path requiring directory creation
        (_test/subdir_{run_id}/moved_{run_id}.md)
    11. force_file_scan
    12. Verify new path exists in DB and file is at new location (D-16)
    13. Verify the intermediate directory was created on disk (D-17)
    14. Verify fqc_id is unchanged after move (D-18)

    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-14, D-15, D-16, D-17, D-18

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_copy_and_move.py                            # existing server
    python test_document_copy_and_move.py --managed                  # managed server
    python test_document_copy_and_move.py --managed --json           # structured JSON with server logs
    python test_document_copy_and_move.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-14", "D-15", "D-16", "D-17", "D-18"]

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

TEST_NAME = "test_document_copy_and_move"


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

    # Part A — Copy paths and content
    original_title = f"FQC Copy Source {run.run_id}"
    original_path = f"_test/{TEST_NAME}_src_{run.run_id}.md"
    copy_dest_path = f"_test/{TEST_NAME}_copy_{run.run_id}.md"
    original_body = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document will be copied to verify D-14 and D-15."
    )
    original_tags = ["fqc-test", "copy-test", run.run_id]

    # Part B — Move paths and content
    move_title = f"FQC Move Source {run.run_id}"
    move_source_path = f"_test/{TEST_NAME}_move_src_{run.run_id}.md"
    move_subdir = f"_test/subdir_{run.run_id}"
    move_dest_path = f"_test/subdir_{run.run_id}/moved_{run.run_id}.md"
    move_body = (
        f"## Move Target\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document will be moved to a nested path to verify D-16, D-17, D-18."
    )
    move_tags = ["fqc-test", "move-test", run.run_id]

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

        # ── Part A: Copy ──────────────────────────────────────────────

        # ── Step 1: Create original document via MCP ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_orig_result = ctx.client.call_tool(
            "create_document",
            title=original_title,
            content=original_body,
            path=original_path,
            tags=original_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        orig_fqc_id = _extract_field(create_orig_result.text, "FQC ID")
        orig_created_path = _extract_field(create_orig_result.text, "Path") or original_path

        # Register original for cleanup
        ctx.cleanup.track_file(orig_created_path)
        parts = Path(orig_created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if orig_fqc_id:
            ctx.cleanup.track_mcp_document(orig_fqc_id)

        create_orig_result.expect_contains(original_title)

        run.step(
            label="create_document (copy source) via MCP",
            passed=(create_orig_result.ok and create_orig_result.status == "pass"),
            detail=expectation_detail(create_orig_result) or create_orig_result.error or "",
            timing_ms=create_orig_result.timing_ms,
            tool_result=create_orig_result,
            server_logs=step_logs,
        )
        if not create_orig_result.ok:
            return run

        # ── Step 2: Scan vault to index the original ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after creating original",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── Step 3: Copy document to new path ─────────────────────────
        identifier_orig = orig_fqc_id or orig_created_path

        log_mark = ctx.server.log_position if ctx.server else 0
        copy_result = ctx.client.call_tool(
            "copy_document",
            identifier=identifier_orig,
            destination=copy_dest_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        copy_fqc_id = _extract_field(copy_result.text, "FQC ID")
        copy_created_path = _extract_field(copy_result.text, "Path") or copy_dest_path

        # Register copy for cleanup
        ctx.cleanup.track_file(copy_created_path)
        copy_parts = Path(copy_created_path).parts
        for i in range(1, len(copy_parts)):
            ctx.cleanup.track_dir(str(Path(*copy_parts[:i])))
        if copy_fqc_id:
            ctx.cleanup.track_mcp_document(copy_fqc_id)

        run.step(
            label=f"copy_document(identifier='{identifier_orig}', destination='{copy_dest_path}')",
            passed=(copy_result.ok and copy_result.status == "pass"),
            detail=expectation_detail(copy_result) or copy_result.error or "",
            timing_ms=copy_result.timing_ms,
            tool_result=copy_result,
            server_logs=step_logs,
        )
        if not copy_result.ok:
            return run

        # ── Step 4: Scan vault again to index the copy ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after copy",
            passed=scan2_result.ok,
            detail=scan2_result.error or "",
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )

        # ── Step 5: Verify copy has different fqc_id, same content (D-14) ─
        t0 = time.monotonic()
        try:
            copy_doc = ctx.vault.read_file(copy_created_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "copy fqc_id present": copy_doc.fqc_id is not None,
                "copy fqc_id differs from original (D-14)": (
                    copy_doc.fqc_id != orig_fqc_id
                ) if orig_fqc_id and copy_doc.fqc_id else True,
                "copy title matches original (D-14)": copy_doc.title == original_title,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"copy_fqc_id={copy_doc.fqc_id!r}, orig_fqc_id={orig_fqc_id!r}, "
                    f"copy_title={copy_doc.title!r}"
                )
            # Additionally verify copy content via MCP get_document
            copy_identifier = copy_fqc_id or copy_created_path
            get_copy_result = ctx.client.call_tool("get_document", identifiers=copy_identifier)
            content_matches = "Original Content" in get_copy_result.text and run.run_id in get_copy_result.text
            if not content_matches:
                all_ok = False
                detail += f" Content mismatch: {get_copy_result.text[:200]}"
            run.step(
                "D-14: copy has different fqc_id and preserved content",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-14: copy has different fqc_id and preserved content",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Step 6: Verify original still exists unchanged (D-15) ─────
        t0 = time.monotonic()
        try:
            orig_doc_check = ctx.vault.read_file(orig_created_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "original file still exists (D-15)": ctx.vault.exists(orig_created_path),
                "original title unchanged (D-15)": orig_doc_check.title == original_title,
                "original fqc_id unchanged (D-15)": (
                    orig_doc_check.fqc_id == orig_fqc_id
                ) if orig_fqc_id else True,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={orig_doc_check.title!r}, fqc_id={orig_doc_check.fqc_id!r}"
                )
            # Also verify content via MCP
            get_orig_result = ctx.client.call_tool("get_document", identifiers=identifier_orig)
            content_ok = "Original Content" in get_orig_result.text
            if not content_ok:
                all_ok = False
                detail += f" Original content missing from MCP response."
            run.step(
                "D-15: original document unchanged after copy",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-15: original document unchanged after copy",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Part B: Move ──────────────────────────────────────────────

        # ── Step 7: Create document to move ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_move_result = ctx.client.call_tool(
            "create_document",
            title=move_title,
            content=move_body,
            path=move_source_path,
            tags=move_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        move_src_fqc_id = _extract_field(create_move_result.text, "FQC ID")
        move_src_created_path = _extract_field(create_move_result.text, "Path") or move_source_path

        # Register source for cleanup (the file will move, but register original path
        # for tracking; we'll also register the destination below)
        ctx.cleanup.track_file(move_src_created_path)
        src_parts = Path(move_src_created_path).parts
        for i in range(1, len(src_parts)):
            ctx.cleanup.track_dir(str(Path(*src_parts[:i])))
        if move_src_fqc_id:
            ctx.cleanup.track_mcp_document(move_src_fqc_id)

        create_move_result.expect_contains(move_title)

        run.step(
            label="create_document (move source) via MCP",
            passed=(create_move_result.ok and create_move_result.status == "pass"),
            detail=expectation_detail(create_move_result) or create_move_result.error or "",
            timing_ms=create_move_result.timing_ms,
            tool_result=create_move_result,
            server_logs=step_logs,
        )
        if not create_move_result.ok:
            return run

        # ── Step 8: Scan vault to index the move source ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after creating move source",
            passed=scan3_result.ok,
            detail=scan3_result.error or "",
            timing_ms=scan3_result.timing_ms,
            tool_result=scan3_result,
            server_logs=step_logs,
        )
        if not scan3_result.ok:
            return run

        # ── Step 9: Record original fqc_id before move ────────────────
        # Already captured as move_src_fqc_id above

        # ── Step 10: Move document to nested path ─────────────────────
        move_identifier = move_src_fqc_id or move_src_created_path

        log_mark = ctx.server.log_position if ctx.server else 0
        move_result = ctx.client.call_tool(
            "move_document",
            identifier=move_identifier,
            destination=move_dest_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        move_new_fqc_id = _extract_field(move_result.text, "FQC ID")
        move_new_path = _extract_field(move_result.text, "Path") or move_dest_path

        # Register the moved destination for cleanup (file is now here)
        ctx.cleanup.track_file(move_new_path)
        dest_parts = Path(move_new_path).parts
        for i in range(1, len(dest_parts)):
            ctx.cleanup.track_dir(str(Path(*dest_parts[:i])))
        # Track the subdir explicitly so it gets cleaned up
        ctx.cleanup.track_dir(move_subdir)

        run.step(
            label=f"move_document(identifier='{move_identifier}', destination='{move_dest_path}')",
            passed=(move_result.ok and move_result.status == "pass"),
            detail=expectation_detail(move_result) or move_result.error or "",
            timing_ms=move_result.timing_ms,
            tool_result=move_result,
            server_logs=step_logs,
        )
        if not move_result.ok:
            return run

        # ── Step 11: Scan vault to pick up the move ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan4_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after move",
            passed=scan4_result.ok,
            detail=scan4_result.error or "",
            timing_ms=scan4_result.timing_ms,
            tool_result=scan4_result,
            server_logs=step_logs,
        )

        # ── Step 12: Verify new path in DB and file exists (D-16) ─────
        t0 = time.monotonic()
        try:
            elapsed = int((time.monotonic() - t0) * 1000)
            # File must exist at the new path on disk
            file_exists_at_dest = ctx.vault.exists(move_new_path)
            # File must NOT exist at old path
            file_gone_from_src = not ctx.vault.exists(move_src_created_path)
            # MCP should find the document at the new path (ok response = found)
            get_moved_result = ctx.client.call_tool(
                "get_document",
                identifiers=move_new_path,
            )
            mcp_found = get_moved_result.ok
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "file exists at new path (D-16)": file_exists_at_dest,
                "file gone from old path (D-16)": file_gone_from_src,
                "MCP get_document finds doc at new path (D-16)": mcp_found,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"new_path={move_new_path!r}, src_path={move_src_created_path!r}, "
                    f"get_moved error={get_moved_result.error!r}"
                )
            run.step(
                "D-16: move updates path in database",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-16: move updates path in database",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Step 13: Verify intermediate directory was created (D-17) ─
        t0 = time.monotonic()
        try:
            abs_subdir = ctx.vault.vault_root / move_subdir
            dir_exists = abs_subdir.is_dir()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-17: intermediate directory created on disk",
                passed=dir_exists,
                detail="" if dir_exists else f"Directory not found: {abs_subdir}",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-17: intermediate directory created on disk",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )

        # ── Step 14: Verify fqc_id preserved after move (D-18) ────────
        t0 = time.monotonic()
        try:
            moved_doc = ctx.vault.read_file(move_new_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            fqc_id_after = moved_doc.fqc_id
            # Compare against the fqc_id we captured after create
            fqc_id_unchanged = (fqc_id_after == move_src_fqc_id) if move_src_fqc_id else (fqc_id_after is not None)
            checks = {
                "fqc_id present after move (D-18)": fqc_id_after is not None,
                "fqc_id unchanged after move (D-18)": fqc_id_unchanged,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id_after={fqc_id_after!r}, fqc_id_before={move_src_fqc_id!r}"
                )
            run.step(
                "D-18: fqc_id preserved after move",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                "D-18: fqc_id preserved after move",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
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
        description="Test: copy_document and move_document operations (D-14, D-15, D-16, D-17, D-18).",
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

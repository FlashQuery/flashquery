#!/usr/bin/env python3
"""
Test: force_file_scan — background response, updated file detection, deleted file detection.

Scenario:
    F-02: force_file_scan(background=True) returns immediately (< 2000ms) with a
          response indicating the scan is running in the background.
    F-03: After a file's content is changed directly on disk, a synchronous
          force_file_scan picks up the change and get_document returns the new content.
    F-04: After a file is deleted directly from disk, a synchronous force_file_scan
          detects it's gone, and get_document returns an error/missing-file signal.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-02, F-03, F-04

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_file_scan_lifecycle.py                            # existing server
    python test_file_scan_lifecycle.py --managed                  # managed server
    python test_file_scan_lifecycle.py --managed --json           # structured JSON with server logs
    python test_file_scan_lifecycle.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-02", "F-03", "F-04"]

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

TEST_NAME = "test_file_scan_lifecycle"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _looks_like_clear_error(text: str, error_detail: str | None) -> tuple[bool, str]:
    """
    Check whether a failed get_document response looks like a clear 'file gone'
    or 'not found' error rather than a crash or unhelpful message.

    Returns (is_clear, reason).
    """
    haystack = f"{text}\n{error_detail or ''}".lower()
    keywords = [
        "not found",
        "not_found",          # JSON envelope error key (e.g. "document_not_found")
        "no document found",  # JSON envelope message prefix
        "document_not_found", # JSON envelope error field value
        "missing",
        "no such",
        "does not exist",
        "cannot be found",
        "could not be found",
        "unavailable",
        "deleted",
        "no longer",
        "gone",
        "archived",
        "enoent",             # filesystem error code in server logs / error field
    ]
    for kw in keywords:
        if kw in haystack:
            return True, f"matched keyword: {kw!r}"
    return False, "no clear missing-file signal in response text"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # F-03 document identifiers
    title_f03 = f"FQC ScanUpdate {run.run_id}"
    path_f03 = f"_test/{TEST_NAME}_f03_{run.run_id}.md"
    original_body_f03 = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}) for F-03.\n\n"
        f"This content will be changed directly on disk."
    )
    updated_body_f03 = (
        f"## Updated Content\n\n"
        f"UPDATED: This content was changed directly on disk (run {run.run_id})."
    )

    # F-04 document identifiers
    title_f04 = f"FQC ScanDelete {run.run_id}"
    path_f04 = f"_test/{TEST_NAME}_f04_{run.run_id}.md"
    original_body_f04 = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}) for F-04.\n\n"
        f"This file will be deleted directly from disk."
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

        # ── F-02: Background scan returns immediately ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        t_bg_start = time.monotonic()
        bg_scan_result = ctx.client.call_tool(
            "force_file_scan",
            background=True,
        )
        bg_elapsed_ms = int((time.monotonic() - t_bg_start) * 1000)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Verify: returned quickly (< 2000ms) and response signals background mode
        bg_response_text = bg_scan_result.text.lower()
        bg_signals_background = any(
            kw in bg_response_text
            for kw in ["background", "queued", "queue", "started", "running", "async", "triggered"]
        )
        f02_checks = {
            "call succeeded": bg_scan_result.ok,
            "returned within 2000ms": bg_elapsed_ms < 2000,
            "response signals background mode": bg_signals_background,
        }
        f02_ok = all(f02_checks.values())
        f02_detail_parts = []
        if not f02_ok:
            failed = [k for k, v in f02_checks.items() if not v]
            f02_detail_parts.append(f"Failed: {', '.join(failed)}")
        f02_detail_parts.append(f"timing_ms={bg_elapsed_ms}")
        f02_detail_parts.append(f"bg_signals_background={bg_signals_background}")
        f02_detail_parts.append(f"text_preview={bg_scan_result.text[:200]!r}")

        run.step(
            label="F-02: force_file_scan(background=True) returns immediately",
            passed=f02_ok,
            detail=" | ".join(f02_detail_parts),
            timing_ms=bg_elapsed_ms,
            tool_result=bg_scan_result,
            server_logs=step_logs,
        )

        # ── F-03 Step 1: Create document for update test ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_f03_result = ctx.client.call_tool(
            "create_document",
            title=title_f03,
            content=original_body_f03,
            path=path_f03,
            tags=["fqc-test", "scan-lifecycle", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_f03 = _extract_field(create_f03_result.text, "FQC ID")
        created_path_f03 = _extract_field(create_f03_result.text, "Path") or path_f03

        # Register for cleanup
        ctx.cleanup.track_file(created_path_f03)
        parts = Path(created_path_f03).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_f03:
            ctx.cleanup.track_mcp_document(fqc_id_f03)

        create_f03_result.expect_contains(title_f03)

        run.step(
            label="F-03: create_document (for update test)",
            passed=(create_f03_result.ok and create_f03_result.status == "pass"),
            detail=expectation_detail(create_f03_result) or create_f03_result.error or "",
            timing_ms=create_f03_result.timing_ms,
            tool_result=create_f03_result,
            server_logs=step_logs,
        )
        if not create_f03_result.ok:
            return run

        # ── F-03 Step 2: Initial sync scan to index F-03 document ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="F-03: force_file_scan (sync) — initial index",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── F-03 Step 3: Verify baseline — original content readable ──
        read_identifier_f03 = fqc_id_f03 or created_path_f03

        log_mark = ctx.server.log_position if ctx.server else 0
        baseline_f03_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier_f03,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        baseline_f03_result.expect_contains("Original Content")

        run.step(
            label="F-03: get_document baseline — original content present",
            passed=(baseline_f03_result.ok and baseline_f03_result.status == "pass"),
            detail=expectation_detail(baseline_f03_result) or baseline_f03_result.error or "",
            timing_ms=baseline_f03_result.timing_ms,
            tool_result=baseline_f03_result,
            server_logs=step_logs,
        )
        if not baseline_f03_result.ok:
            return run

        # ── F-03 Step 4: Overwrite file on disk with new content ──────
        t0 = time.monotonic()
        try:
            abs_path_f03 = ctx.vault.vault_root / created_path_f03
            new_content_f03 = (
                f"---\n"
                f"fqc_id: {fqc_id_f03}\n"
                f"status: active\n"
                f"title: {title_f03}\n"
                f"tags: [fqc-test, scan-lifecycle, {run.run_id}]\n"
                f"---\n\n"
                f"{updated_body_f03}\n"
            )
            abs_path_f03.write_text(new_content_f03, encoding="utf-8")
            file_still_exists = abs_path_f03.is_file()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="F-03: overwrite file on disk with new content",
                passed=file_still_exists,
                detail="" if file_still_exists else "File not found after write",
                timing_ms=elapsed,
            )
            if not file_still_exists:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="F-03: overwrite file on disk with new content",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── F-03 Step 5: Re-scan to pick up the file change ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="F-03: force_file_scan (sync) — after disk update",
            passed=scan2_result.ok,
            detail=scan2_result.error or "",
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )
        if not scan2_result.ok:
            return run

        # ── F-03 Step 6: Verify updated content is returned ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        updated_f03_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier_f03,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Must contain new content; must NOT contain only the old content
        new_content_present = "UPDATED:" in updated_f03_result.text
        old_content_still_only = (
            "Original Content" in updated_f03_result.text
            and "UPDATED:" not in updated_f03_result.text
        )

        f03_checks = {
            "call succeeded": updated_f03_result.ok,
            "new content present (UPDATED:)": new_content_present,
            "old-only content not returned": not old_content_still_only,
        }
        f03_ok = all(f03_checks.values())
        f03_detail_parts = []
        if not f03_ok:
            failed = [k for k, v in f03_checks.items() if not v]
            f03_detail_parts.append(f"Failed: {', '.join(failed)}")
        f03_detail_parts.append(f"new_content_present={new_content_present}")
        f03_detail_parts.append(f"old_content_still_only={old_content_still_only}")
        f03_detail_parts.append(f"text_preview={updated_f03_result.text[:300]!r}")

        run.step(
            label="F-03: get_document after scan reflects disk update",
            passed=f03_ok,
            detail=" | ".join(f03_detail_parts),
            timing_ms=updated_f03_result.timing_ms,
            tool_result=updated_f03_result,
            server_logs=step_logs,
        )

        # ── F-04 Step 1: Create document for delete test ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_f04_result = ctx.client.call_tool(
            "create_document",
            title=title_f04,
            content=original_body_f04,
            path=path_f04,
            tags=["fqc-test", "scan-lifecycle", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_f04 = _extract_field(create_f04_result.text, "FQC ID")
        created_path_f04 = _extract_field(create_f04_result.text, "Path") or path_f04

        # Register for cleanup — file may be deleted by the test, so also track MCP doc
        ctx.cleanup.track_file(created_path_f04)
        parts = Path(created_path_f04).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_f04:
            ctx.cleanup.track_mcp_document(fqc_id_f04)

        create_f04_result.expect_contains(title_f04)

        run.step(
            label="F-04: create_document (for delete test)",
            passed=(create_f04_result.ok and create_f04_result.status == "pass"),
            detail=expectation_detail(create_f04_result) or create_f04_result.error or "",
            timing_ms=create_f04_result.timing_ms,
            tool_result=create_f04_result,
            server_logs=step_logs,
        )
        if not create_f04_result.ok:
            return run

        # ── F-04 Step 2: Sync scan to index F-04 document ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="F-04: force_file_scan (sync) — initial index",
            passed=scan3_result.ok,
            detail=scan3_result.error or "",
            timing_ms=scan3_result.timing_ms,
            tool_result=scan3_result,
            server_logs=step_logs,
        )
        if not scan3_result.ok:
            return run

        # ── F-04 Step 3: Verify baseline — F-04 doc readable ─────────
        read_identifier_f04 = fqc_id_f04 or created_path_f04

        log_mark = ctx.server.log_position if ctx.server else 0
        baseline_f04_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier_f04,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        baseline_f04_result.expect_contains("Original Content")

        run.step(
            label="F-04: get_document baseline — doc present before delete",
            passed=(baseline_f04_result.ok and baseline_f04_result.status == "pass"),
            detail=expectation_detail(baseline_f04_result) or baseline_f04_result.error or "",
            timing_ms=baseline_f04_result.timing_ms,
            tool_result=baseline_f04_result,
            server_logs=step_logs,
        )
        if not baseline_f04_result.ok:
            return run

        # ── F-04 Step 4: Delete the file directly from disk ───────────
        t0 = time.monotonic()
        try:
            abs_path_f04 = ctx.vault.vault_root / created_path_f04
            existed_before = abs_path_f04.is_file()
            if existed_before:
                abs_path_f04.unlink()
            gone_after = not abs_path_f04.is_file()
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "file existed before delete": existed_before,
                "file absent after delete": gone_after,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"
            run.step(
                label="F-04: delete file directly from disk (out-of-band)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="F-04: delete file directly from disk (out-of-band)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # File is gone from disk — untrack from vault cleanup to avoid a
        # spurious cleanup error. MCP identifier stays so DB row can be archived.
        try:
            ctx.cleanup._vault_files.remove(created_path_f04)
        except ValueError:
            pass

        # ── F-04 Step 5: Re-scan to detect the deletion ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan4_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="F-04: force_file_scan (sync) — after disk delete",
            passed=scan4_result.ok,
            detail=scan4_result.error or "",
            timing_ms=scan4_result.timing_ms,
            tool_result=scan4_result,
            server_logs=step_logs,
        )
        if not scan4_result.ok:
            return run

        # ── F-04 Step 6: Verify deleted doc gives error/missing signal ─
        log_mark = ctx.server.log_position if ctx.server else 0
        deleted_f04_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier_f04,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The tool must not silently return the stale body as a success
        stale_body_returned = (
            deleted_f04_result.ok
            and deleted_f04_result.status == "pass"
            and "Original Content" in deleted_f04_result.text
        )
        clear_error, clear_reason = _looks_like_clear_error(
            deleted_f04_result.text,
            deleted_f04_result.error,
        )

        f04_checks = {
            "did not silently return stale body": not stale_body_returned,
            "clear missing-file signal present": clear_error,
        }
        f04_ok = all(f04_checks.values())
        f04_detail_parts = []
        if not f04_ok:
            failed = [k for k, v in f04_checks.items() if not v]
            f04_detail_parts.append(f"Failed: {', '.join(failed)}")
        f04_detail_parts.append(f"tool_ok={deleted_f04_result.ok}")
        f04_detail_parts.append(f"status={deleted_f04_result.status}")
        f04_detail_parts.append(f"stale_body_returned={stale_body_returned}")
        f04_detail_parts.append(f"clear_error={clear_error} ({clear_reason})")
        if deleted_f04_result.error:
            f04_detail_parts.append(f"error={deleted_f04_result.error[:200]!r}")
        f04_detail_parts.append(f"text_preview={deleted_f04_result.text[:300]!r}")

        run.step(
            label="F-04: get_document on deleted file returns clear error/missing signal",
            passed=f04_ok,
            detail=" | ".join(f04_detail_parts),
            timing_ms=deleted_f04_result.timing_ms,
            tool_result=deleted_f04_result,
            server_logs=step_logs,
        )

        # ── Housekeeping: reconcile so DB row of deleted doc can be archived ─
        log_mark = ctx.server.log_position if ctx.server else 0
        reconcile_result = ctx.client.call_tool(
            "reconcile_documents",
            dry_run=False,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="reconcile_documents (housekeeping for cleanup)",
            passed=reconcile_result.ok,
            detail=reconcile_result.error or "",
            timing_ms=reconcile_result.timing_ms,
            tool_result=reconcile_result,
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
        description="Test: force_file_scan — background response, updated file detection, deleted file detection.",
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

#!/usr/bin/env python3
"""
Test: reconcile_documents — dry run, moved files, and archiving gone files.

Scenario:
    F-05 — Dry run:
        1. Create a document via MCP, force_file_scan, verify retrievable
        2. Call reconcile_documents(dry_run=True) — no changes should be made
        3. Verify response contains dry-run language (no changes applied)
        4. Verify the original document is still retrievable

    F-06 — Detect moved files:
        5. Create a second document via MCP, force_file_scan
        6. Note its fqc_id from the creation response
        7. Physically move the file on disk (preserve frontmatter/fqc_id)
        8. Call reconcile_documents(dry_run=False)
        9. Verify response mentions the move (path updated or similar)
        10. Verify document is still retrievable after reconcile

    F-07 — Archive gone files:
        11. Create a third document via MCP, force_file_scan
        12. Delete the file from disk permanently (not via MCP)
        13. Call reconcile_documents(dry_run=False)
        14. Verify response mentions archiving/gone/missing the file
        15. Try to retrieve — expect archived status or an error

    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-05, F-06, F-07

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconcile_documents.py                            # existing server
    python test_reconcile_documents.py --managed                  # managed server
    python test_reconcile_documents.py --managed --json           # structured JSON with server logs
    python test_reconcile_documents.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-05", "F-06", "F-07"]

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

TEST_NAME = "test_reconcile_documents"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _looks_like_dry_run(text: str) -> tuple[bool, str]:
    """Check whether a reconcile response indicates a dry run (no changes applied).

    Acceptable responses include:
    - Explicit dry-run language ("dry", "would", "no changes applied", etc.)
    - "Nothing to do" / clean-state message (tool succeeded, nothing to change)
    The key property is that the tool must have succeeded (ok=True) and the
    document must still be intact afterwards.
    """
    haystack = text.lower()
    keywords = [
        "dry", "would", "no changes", "preview", "simulate", "not applied",
        "nothing to do", "no missing", "all", "valid",
    ]
    for kw in keywords:
        if kw in haystack:
            return True, f"matched keyword: {kw!r}"
    return False, "no dry-run/clean-state signal found in response text"


def _looks_like_move_detected(text: str) -> tuple[bool, str]:
    """Check whether a reconcile response indicates a moved file was detected."""
    haystack = text.lower()
    keywords = ["moved", "path updated", "relocated", "renamed", "new path", "updated path"]
    for kw in keywords:
        if kw in haystack:
            return True, f"matched keyword: {kw!r}"
    return False, "no move-detection signal found in response text"


def _looks_like_archived(text: str) -> tuple[bool, str]:
    """Check whether a reconcile response indicates a file was archived/gone."""
    haystack = text.lower()
    keywords = ["archived", "gone", "missing", "not found", "no longer", "deleted", "orphan", "removed"]
    for kw in keywords:
        if kw in haystack:
            return True, f"matched keyword: {kw!r}"
    return False, "no archive/gone signal found in response text"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Unique names for the three documents
    title_dry   = f"FQC Reconcile DryRun {run.run_id}"
    title_moved = f"FQC Reconcile Moved {run.run_id}"
    title_gone  = f"FQC Reconcile Gone {run.run_id}"

    path_dry    = f"_test/{TEST_NAME}_{run.run_id}_dry.md"
    path_moved  = f"_test/{TEST_NAME}_{run.run_id}_moved_src.md"
    path_gone   = f"_test/{TEST_NAME}_{run.run_id}_gone.md"
    path_moved_dest = f"_test/moved_{run.run_id}_reconcile.md"

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

        # ── F-05 setup: Create doc for dry-run test ───────────────────

        # ── Step 1: Create document via MCP ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_dry = ctx.client.call_tool(
            "create_document",
            title=title_dry,
            content=(
                f"## Dry Run Test\n\n"
                f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
                f"This document is for testing dry_run=True."
            ),
            path=path_dry,
            tags=["fqc-test", "reconcile-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_dry = _extract_field(create_dry.text, "FQC ID")
        created_path_dry = _extract_field(create_dry.text, "Path") or path_dry

        # Register for cleanup
        ctx.cleanup.track_file(created_path_dry)
        parts = Path(created_path_dry).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_dry:
            ctx.cleanup.track_mcp_document(fqc_id_dry)

        create_dry.expect_contains(title_dry)
        run.step(
            label="create_document (dry-run doc) via MCP",
            passed=(create_dry.ok and create_dry.status == "pass"),
            detail=expectation_detail(create_dry) or create_dry.error or "",
            timing_ms=create_dry.timing_ms,
            tool_result=create_dry,
            server_logs=step_logs,
        )
        if not create_dry.ok:
            return run

        # ── Step 2: force_file_scan ──────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after creating dry-run doc",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 3: Verify dry-run doc is retrievable ────────────────
        read_id_dry = fqc_id_dry or created_path_dry

        log_mark = ctx.server.log_position if ctx.server else 0
        get_dry_before = ctx.client.call_tool("get_document", identifier=read_id_dry)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_dry_before.expect_contains("Dry Run Test")
        run.step(
            label=f"get_document('{read_id_dry}') — baseline before dry run",
            passed=(get_dry_before.ok and get_dry_before.status == "pass"),
            detail=expectation_detail(get_dry_before) or get_dry_before.error or "",
            timing_ms=get_dry_before.timing_ms,
            tool_result=get_dry_before,
            server_logs=step_logs,
        )
        if not get_dry_before.ok:
            return run

        # ── Step 4: F-05 — Call reconcile_documents(dry_run=True) ────
        log_mark = ctx.server.log_position if ctx.server else 0
        reconcile_dry = ctx.client.call_tool("reconcile_documents", dry_run=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        is_dry_run, dry_reason = _looks_like_dry_run(reconcile_dry.text)
        f05_ok = reconcile_dry.ok and is_dry_run

        f05_detail_parts = []
        if not f05_ok:
            if not reconcile_dry.ok:
                f05_detail_parts.append(f"tool failed: {reconcile_dry.error}")
            if not is_dry_run:
                f05_detail_parts.append(f"dry-run signal absent ({dry_reason})")
        f05_detail_parts.append(f"tool_ok={reconcile_dry.ok}")
        f05_detail_parts.append(f"is_dry_run={is_dry_run} ({dry_reason})")
        f05_detail_parts.append(f"text_preview={reconcile_dry.text[:300]!r}")

        run.step(
            label="F-05: reconcile_documents(dry_run=True) reports without changing",
            passed=f05_ok,
            detail=" | ".join(f05_detail_parts),
            timing_ms=reconcile_dry.timing_ms,
            tool_result=reconcile_dry,
            server_logs=step_logs,
        )

        # ── Step 5: Verify dry-run doc still retrievable after dry run
        log_mark = ctx.server.log_position if ctx.server else 0
        get_dry_after = ctx.client.call_tool("get_document", identifier=read_id_dry)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_dry_after.expect_contains("Dry Run Test")
        run.step(
            label="get_document after dry run — doc unchanged",
            passed=(get_dry_after.ok and get_dry_after.status == "pass"),
            detail=expectation_detail(get_dry_after) or get_dry_after.error or "",
            timing_ms=get_dry_after.timing_ms,
            tool_result=get_dry_after,
            server_logs=step_logs,
        )

        # ── F-06 setup: Create doc to be moved ───────────────────────

        # ── Step 6: Create second document (to be moved) via MCP ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_moved = ctx.client.call_tool(
            "create_document",
            title=title_moved,
            content=(
                f"## Moved File Test\n\n"
                f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
                f"This document's file will be moved on disk."
            ),
            path=path_moved,
            tags=["fqc-test", "reconcile-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_moved = _extract_field(create_moved.text, "FQC ID")
        created_path_moved = _extract_field(create_moved.text, "Path") or path_moved

        # Register for cleanup — use the DESTINATION path since we'll move it
        # (the source file won't exist after the move)
        ctx.cleanup.track_file(path_moved_dest)
        parts_moved = Path(created_path_moved).parts
        for i in range(1, len(parts_moved)):
            ctx.cleanup.track_dir(str(Path(*parts_moved[:i])))
        if fqc_id_moved:
            ctx.cleanup.track_mcp_document(fqc_id_moved)

        create_moved.expect_contains(title_moved)
        run.step(
            label="create_document (moved doc) via MCP",
            passed=(create_moved.ok and create_moved.status == "pass"),
            detail=expectation_detail(create_moved) or create_moved.error or "",
            timing_ms=create_moved.timing_ms,
            tool_result=create_moved,
            server_logs=step_logs,
        )
        if not create_moved.ok:
            return run

        # ── Step 7: force_file_scan ──────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after creating moved doc",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 8: Physically move the file on disk ─────────────────
        t0 = time.monotonic()
        try:
            old_abs = ctx.vault.vault_root / created_path_moved
            new_abs = ctx.vault.vault_root / path_moved_dest

            existed_before = old_abs.is_file()
            new_abs.parent.mkdir(parents=True, exist_ok=True)
            old_abs.rename(new_abs)
            old_gone = not old_abs.is_file()
            new_present = new_abs.is_file()

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "source file existed before move": existed_before,
                "source file gone after move": old_gone,
                "destination file present after move": new_present,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed_chks = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed_chks)}"
            run.step(
                label="Physically move file on disk (preserve frontmatter)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Physically move file on disk (preserve frontmatter)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 9: F-06 — Call reconcile_documents(dry_run=False) ───
        log_mark = ctx.server.log_position if ctx.server else 0
        reconcile_move = ctx.client.call_tool("reconcile_documents", dry_run=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        is_move_detected, move_reason = _looks_like_move_detected(reconcile_move.text)
        f06_ok = reconcile_move.ok and is_move_detected

        f06_detail_parts = []
        if not f06_ok:
            if not reconcile_move.ok:
                f06_detail_parts.append(f"tool failed: {reconcile_move.error}")
            if not is_move_detected:
                f06_detail_parts.append(f"move signal absent ({move_reason})")
        f06_detail_parts.append(f"tool_ok={reconcile_move.ok}")
        f06_detail_parts.append(f"move_detected={is_move_detected} ({move_reason})")
        f06_detail_parts.append(f"text_preview={reconcile_move.text[:400]!r}")

        run.step(
            label="F-06: reconcile_documents detects moved file via fqc_id",
            passed=f06_ok,
            detail=" | ".join(f06_detail_parts),
            timing_ms=reconcile_move.timing_ms,
            tool_result=reconcile_move,
            server_logs=step_logs,
        )

        # ── Step 10: Verify moved doc still retrievable after reconcile
        read_id_moved = fqc_id_moved or path_moved_dest

        log_mark = ctx.server.log_position if ctx.server else 0
        get_moved_after = ctx.client.call_tool("get_document", identifier=read_id_moved)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_moved_after.expect_contains("Moved File Test")
        run.step(
            label=f"get_document('{read_id_moved}') — retrievable after reconcile move",
            passed=(get_moved_after.ok and get_moved_after.status == "pass"),
            detail=expectation_detail(get_moved_after) or get_moved_after.error or "",
            timing_ms=get_moved_after.timing_ms,
            tool_result=get_moved_after,
            server_logs=step_logs,
        )

        # ── F-07 setup: Create doc to be deleted ─────────────────────

        # ── Step 11: Create third document (to be deleted) via MCP ───
        log_mark = ctx.server.log_position if ctx.server else 0
        create_gone = ctx.client.call_tool(
            "create_document",
            title=title_gone,
            content=(
                f"## Gone File Test\n\n"
                f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
                f"This document's file will be deleted from disk."
            ),
            path=path_gone,
            tags=["fqc-test", "reconcile-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_gone = _extract_field(create_gone.text, "FQC ID")
        created_path_gone = _extract_field(create_gone.text, "Path") or path_gone

        # Register for cleanup — DB side only (file will be deleted before cleanup)
        parts_gone = Path(created_path_gone).parts
        for i in range(1, len(parts_gone)):
            ctx.cleanup.track_dir(str(Path(*parts_gone[:i])))
        if fqc_id_gone:
            ctx.cleanup.track_mcp_document(fqc_id_gone)
        # Note: we intentionally do NOT track the file path for filesystem cleanup
        # since we're deleting it below and cleanup would log a spurious error.

        create_gone.expect_contains(title_gone)
        run.step(
            label="create_document (gone doc) via MCP",
            passed=(create_gone.ok and create_gone.status == "pass"),
            detail=expectation_detail(create_gone) or create_gone.error or "",
            timing_ms=create_gone.timing_ms,
            tool_result=create_gone,
            server_logs=step_logs,
        )
        if not create_gone.ok:
            return run

        # ── Step 12: force_file_scan ─────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan after creating gone doc",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ── Step 13: Delete file from disk permanently ───────────────
        t0 = time.monotonic()
        try:
            abs_gone = ctx.vault.vault_root / created_path_gone
            existed_before = abs_gone.is_file()
            abs_gone.unlink()
            gone_after = not abs_gone.is_file()

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "file existed before delete": existed_before,
                "file absent after delete": gone_after,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed_chks = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed_chks)}"
            run.step(
                label="Delete file from disk permanently (not via MCP)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Delete file from disk permanently (not via MCP)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 14: F-07 — Call reconcile_documents(dry_run=False) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        reconcile_gone = ctx.client.call_tool("reconcile_documents", dry_run=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        is_archived, archive_reason = _looks_like_archived(reconcile_gone.text)
        f07_ok = reconcile_gone.ok and is_archived

        f07_detail_parts = []
        if not f07_ok:
            if not reconcile_gone.ok:
                f07_detail_parts.append(f"tool failed: {reconcile_gone.error}")
            if not is_archived:
                f07_detail_parts.append(f"archive/gone signal absent ({archive_reason})")
        f07_detail_parts.append(f"tool_ok={reconcile_gone.ok}")
        f07_detail_parts.append(f"is_archived={is_archived} ({archive_reason})")
        f07_detail_parts.append(f"text_preview={reconcile_gone.text[:400]!r}")

        run.step(
            label="F-07: reconcile_documents archives permanently gone file",
            passed=f07_ok,
            detail=" | ".join(f07_detail_parts),
            timing_ms=reconcile_gone.timing_ms,
            tool_result=reconcile_gone,
            server_logs=step_logs,
        )

        # ── Step 15: Try to retrieve archived doc ────────────────────
        # After reconcile archives the record, get_document should either
        # return an archived-status response or a clear error — not an
        # active document response.
        read_id_gone = fqc_id_gone or created_path_gone

        log_mark = ctx.server.log_position if ctx.server else 0
        get_gone_after = ctx.client.call_tool("get_document", identifier=read_id_gone)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        gone_text = get_gone_after.text.lower()
        # Acceptable: archived status in response, or a clear error/not-found
        get_archived_signal = any(kw in gone_text for kw in [
            "archived", "not found", "missing", "gone", "no longer", "deleted",
        ])
        # Unacceptable: active document returned as if nothing happened
        silently_active = (
            get_gone_after.ok
            and get_gone_after.status == "pass"
            and "Gone File Test" in get_gone_after.text
            and "archived" not in gone_text
        )
        f07b_ok = get_archived_signal and not silently_active

        f07b_detail_parts = []
        if not f07b_ok:
            if not get_archived_signal:
                f07b_detail_parts.append("no archived/gone signal in get_document response")
            if silently_active:
                f07b_detail_parts.append("silently returned active doc — reconcile did not archive")
        f07b_detail_parts.append(f"archived_signal={get_archived_signal}")
        f07b_detail_parts.append(f"silently_active={silently_active}")
        f07b_detail_parts.append(f"text_preview={get_gone_after.text[:300]!r}")

        run.step(
            label="get_document on reconcile-archived doc — expect archived or error",
            passed=f07b_ok,
            detail=" | ".join(f07b_detail_parts),
            timing_ms=get_gone_after.timing_ms,
            tool_result=get_gone_after,
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
        description="Test: reconcile_documents — dry run, moved files, archived gone files.",
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
    parser.add_argument("--vault-path", type=str, default=None,
                         help="Explicit vault path (overrides config).")

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

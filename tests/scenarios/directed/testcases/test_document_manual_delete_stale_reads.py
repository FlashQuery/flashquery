#!/usr/bin/env python3
"""
Test: create → scan → get (ok) → manual rm → get / search immediately (stale reads).

Scenario:
    1. Create a document via MCP (create_document) with unique title and tags
    2. Force file scan so FQC indexes the new file
    3. get_document via MCP — verify happy path (file present, body returned)
    4. Manually rm the file from disk (NOT via MCP) — simulates out-of-band delete
    5. get_document via MCP immediately (no scan, no reconcile) — verify a clear
       error response, not a crash or silent stale body return
    6. search_documents by the unique tag immediately — verify FQC either does not
       surface the stale hit, or if it does, that the hit carries a clear stale
       marker. A silent stale hit that then fails on follow-up get is a defect.
    7. Reconcile at the end so cleanup of the now-orphaned DB row can succeed.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-23, D-24

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_manual_delete_stale_reads.py                            # existing server
    python test_document_manual_delete_stale_reads.py --managed                  # managed server
    python test_document_manual_delete_stale_reads.py --managed --json           # structured JSON with server logs
    python test_document_manual_delete_stale_reads.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-23", "D-24"]

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

TEST_NAME = "test_document_manual_delete_stale_reads"


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
    error rather than a crash or unhelpful message.

    A clear error should mention the file/document being missing or unavailable.
    Returns (is_clear, reason).
    """
    haystack = f"{text}\n{error_detail or ''}".lower()
    keywords = [
        "not found",
        "not_found",          # JSON envelope error key (e.g. "document_not_found")
        "no document found",  # JSON envelope message prefix
        "missing",
        "no such",
        "does not exist",
        "cannot be found",
        "could not be found",
        "unavailable",
        "deleted",
        "no longer",
        "gone",
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

    unique_title = f"FQC StaleRead {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    original_body = (
        f"## Original Content\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This document will be manually removed from disk mid-test."
    )
    original_tags = ["fqc-test", "stale-read-test", run.run_id]

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
        created_path = _extract_field(create_result.text, "Path") or test_path

        # Register for cleanup — both filesystem and database
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

        # ── Step 2: Force file scan so FQC indexes the new file ──────
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

        # ── Step 3: get_document happy-path baseline ─────────────────
        read_identifier = created_fqc_id or created_path

        log_mark = ctx.server.log_position if ctx.server else 0
        read_ok_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        read_ok_result.expect_contains("Original Content")
        read_ok_result.expect_contains(run.run_id)

        run.step(
            label=f"get_document(identifier='{read_identifier}') — baseline",
            passed=(read_ok_result.ok and read_ok_result.status == "pass"),
            detail=expectation_detail(read_ok_result) or read_ok_result.error or "",
            timing_ms=read_ok_result.timing_ms,
            tool_result=read_ok_result,
            server_logs=step_logs,
        )
        if not read_ok_result.ok:
            return run

        # ── Step 4: Manually rm the file from disk (not via MCP) ─────
        t0 = time.monotonic()
        try:
            existed_before = ctx.vault.exists(created_path)
            deleted = ctx.vault.delete_file(created_path)
            gone_after = not ctx.vault.exists(created_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "file existed before rm": existed_before,
                "delete_file returned True": deleted,
                "file absent after rm": gone_after,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"
            run.step(
                label="Manually delete file from vault (out-of-band)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Manually delete file from vault (out-of-band)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # The file is now gone from disk but cleanup will still try to
        # delete it; untrack from the vault list so cleanup doesn't log a
        # spurious error. MCP identifier tracking stays so archive_document
        # can clear the DB row.
        try:
            ctx.cleanup._vault_files.remove(created_path)
        except ValueError:
            pass

        # ── Step 5: get_document immediately — expect clear error ────
        # D-23: DB row present, file gone, no scan/reconcile since delete.
        log_mark = ctx.server.log_position if ctx.server else 0
        read_stale_result = ctx.client.call_tool(
            "get_document",
            identifiers=read_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The call must not crash the server (raw.ok at transport level is
        # covered by absence of exception). The tool itself is allowed to
        # return isError=True — that's the expected contract. What we must
        # NOT see is the stale original body returned as if nothing happened.
        stale_body_returned = "Original Content" in read_stale_result.text
        clear_error, clear_reason = _looks_like_clear_error(
            read_stale_result.text,
            read_stale_result.error,
        )

        # Pass criteria for D-23:
        #   - Must not silently return the stale body as a successful read
        #   - Must surface a clear "missing file" signal in either the tool
        #     error text or the response text
        d23_checks = {
            "did not silently return stale body": not (
                read_stale_result.ok
                and read_stale_result.status == "pass"
                and stale_body_returned
            ),
            "clear missing-file signal present": clear_error,
        }
        d23_ok = all(d23_checks.values())
        d23_detail_parts = []
        if not d23_ok:
            failed = [k for k, v in d23_checks.items() if not v]
            d23_detail_parts.append(f"Failed: {', '.join(failed)}")
        d23_detail_parts.append(f"tool_ok={read_stale_result.ok}")
        d23_detail_parts.append(f"status={read_stale_result.status}")
        d23_detail_parts.append(f"stale_body_returned={stale_body_returned}")
        d23_detail_parts.append(f"clear_error={clear_error} ({clear_reason})")
        if read_stale_result.error:
            d23_detail_parts.append(f"error={read_stale_result.error[:200]!r}")
        d23_detail_parts.append(f"text_preview={read_stale_result.text[:200]!r}")

        run.step(
            label="D-23: get_document on manually-deleted file returns clear error",
            passed=d23_ok,
            detail=" | ".join(d23_detail_parts),
            timing_ms=read_stale_result.timing_ms,
            tool_result=read_stale_result,
            server_logs=step_logs,
        )

        # ── Step 6: search_documents immediately — stale hit check ───
        # D-24: search must not surface the deleted doc as a plain hit that
        # then fails on follow-up get. If it does return a result, there must
        # be a clear stale/missing marker in the response.
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_documents",
            tags=[run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_text = search_result.text
        search_text_lower = search_text.lower()
        # Count results using the same pattern the framework uses
        title_hits = len(re.findall(r"^Title: ", search_text, re.MULTILINE))
        mentions_title = unique_title in search_text
        mentions_unique_tag = run.run_id in search_text

        # A "stale marker" is any signal that the hit is known to be
        # missing/unavailable/orphaned/stale.
        stale_markers = [
            "not found",
            "missing",
            "unavailable",
            "stale",
            "orphan",
            "deleted",
            "no longer",
        ]
        has_stale_marker = any(m in search_text_lower for m in stale_markers)

        # Acceptable outcomes:
        #   (a) zero hits (FQC suppressed the stale doc entirely), OR
        #   (b) hits present but carry a clear stale marker
        # Unacceptable:
        #   a plain hit for the doc with no indication it's gone
        zero_hits = title_hits == 0 and not mentions_title
        marked_hit = (mentions_title or title_hits > 0) and has_stale_marker

        d24_ok = zero_hits or marked_hit

        d24_detail_parts = []
        if not d24_ok:
            d24_detail_parts.append(
                "Failed: search surfaced a stale hit with no missing-file marker "
                "(silent stale hit — user would call get_document on it and crash/404)"
            )
        d24_detail_parts.append(f"title_hits={title_hits}")
        d24_detail_parts.append(f"mentions_title={mentions_title}")
        d24_detail_parts.append(f"mentions_unique_tag={mentions_unique_tag}")
        d24_detail_parts.append(f"has_stale_marker={has_stale_marker}")
        d24_detail_parts.append(f"text_preview={search_text[:300]!r}")

        run.step(
            label="D-24: search_documents does not surface silent stale hits",
            passed=d24_ok,
            detail=" | ".join(d24_detail_parts),
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 7: Reconcile so cleanup can clear the orphaned row ──
        # This is housekeeping, not part of the behavior under test. It lets
        # archive_document succeed during TestContext cleanup.
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
        description="Test: stale reads after manual (out-of-band) file deletion.",
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

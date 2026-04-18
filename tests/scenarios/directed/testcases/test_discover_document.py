#!/usr/bin/env python3
"""
Test: discover_document — paths mode and flagged mode.

Scenario:
    F-17 — paths mode:
        1. Create a document via MCP (so it's in the database)
        2. Run force_file_scan to ensure the DB record is fully registered
        3. Call discover_document(mode='paths', paths=[vault_relative_path])
        4. Verify the response is a valid JSON discovery result (summary with total > 0)
        5. Verify the document path appears in the result documents list

    F-16 — flagged mode:
        6. Create a second document via MCP and scan it
        7. Use the Supabase REST API to set needs_discovery=true on that document
        8. Call discover_document(mode='flagged')
        9. Verify the response includes the flagged document

    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-16, F-17

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_discover_document.py                            # existing server
    python test_discover_document.py --managed                  # managed server
    python test_discover_document.py --managed --json           # structured JSON with server logs
    python test_discover_document.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-16", "F-17"]

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from fqc_client import _load_env_file, _find_project_dir

import requests


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_discover_document"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _load_supabase_creds() -> tuple[str, str]:
    """Load Supabase URL and service role key from the project's .env file."""
    project_dir = _find_project_dir()
    if project_dir:
        env = _load_env_file(project_dir)
        url = env.get("SUPABASE_URL", os.environ.get("SUPABASE_URL", ""))
        key = env.get("SUPABASE_SERVICE_ROLE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
        return url, key
    return os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _set_needs_discovery(fqc_id: str, value: bool) -> tuple[bool, str]:
    """
    Use the Supabase REST API to set needs_discovery on a document record.

    Returns (success, error_message).
    """
    supabase_url, supabase_key = _load_supabase_creds()
    if not supabase_url or not supabase_key:
        return False, "Supabase credentials not available"

    url = f"{supabase_url.rstrip('/')}/rest/v1/fqc_documents?id=eq.{fqc_id}"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    payload = {"needs_discovery": value}

    try:
        resp = requests.patch(url, json=payload, headers=headers, timeout=10)
        if resp.status_code in (200, 204):
            return True, ""
        return False, f"HTTP {resp.status_code}: {resp.text}"
    except Exception as e:
        return False, str(e)


def _parse_discovery_result(text: str) -> dict | None:
    """Try to parse the discover_document JSON response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # F-17 document identifiers
    title_f17 = f"FQC Discover Paths {run.run_id}"
    path_f17 = f"_test/{TEST_NAME}_f17_{run.run_id}.md"

    # F-16 document identifiers
    title_f16 = f"FQC Discover Flagged {run.run_id}"
    path_f16 = f"_test/{TEST_NAME}_f16_{run.run_id}.md"

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

        # ── Step 1: Create F-17 document via MCP ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_f17 = ctx.client.call_tool(
            "create_document",
            title=title_f17,
            content=f"## F-17 Paths Discovery\n\nCreated by {TEST_NAME} run {run.run_id}.",
            path=path_f17,
            tags=["fqc-test", "discover-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_f17 = _extract_field(create_f17.text, "FQC ID")
        created_path_f17 = _extract_field(create_f17.text, "Path") or path_f17

        if created_path_f17:
            ctx.cleanup.track_file(created_path_f17)
            parts = Path(created_path_f17).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_f17:
            ctx.cleanup.track_mcp_document(fqc_id_f17)

        create_f17.expect_contains(title_f17)
        run.step(
            label="create_document for F-17 (paths mode)",
            passed=(create_f17.ok and create_f17.status == "pass"),
            detail=expectation_detail(create_f17) or create_f17.error or "",
            timing_ms=create_f17.timing_ms,
            tool_result=create_f17,
            server_logs=step_logs,
        )
        if not create_f17.ok:
            return run

        # ── Step 2: Scan to ensure F-17 doc is registered in DB ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (register F-17 doc in DB)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 3: discover_document — paths mode (F-17) ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        discover_paths_result = ctx.client.call_tool(
            "discover_document",
            mode="paths",
            paths=[created_path_f17],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse JSON response
        parsed = _parse_discovery_result(discover_paths_result.text)
        paths_has_valid_json = parsed is not None
        paths_has_summary = paths_has_valid_json and "summary" in parsed
        paths_total_positive = paths_has_summary and parsed["summary"].get("total", 0) > 0
        paths_doc_listed = (
            paths_has_valid_json
            and "documents" in parsed
            and any(
                doc.get("path") == created_path_f17
                for doc in parsed.get("documents", [])
            )
        )

        f17_passed = discover_paths_result.ok and paths_has_valid_json and paths_has_summary and paths_total_positive and paths_doc_listed
        f17_detail = ""
        if not f17_passed:
            issues = []
            if not discover_paths_result.ok:
                issues.append(f"tool error: {discover_paths_result.error}")
            if not paths_has_valid_json:
                issues.append(f"response not valid JSON: {discover_paths_result.text[:200]}")
            elif not paths_has_summary:
                issues.append(f"no 'summary' in response: {list(parsed.keys())}")
            elif not paths_total_positive:
                issues.append(f"summary.total = {parsed['summary'].get('total')}, expected > 0")
            if not paths_doc_listed:
                issues.append(
                    f"path '{created_path_f17}' not found in documents list: "
                    f"{[d.get('path') for d in parsed.get('documents', [])] if parsed else '(no parsed)'}"
                )
            f17_detail = "; ".join(issues)

        run.step(
            label="discover_document(mode='paths') — F-17",
            passed=f17_passed,
            detail=f17_detail,
            timing_ms=discover_paths_result.timing_ms,
            tool_result=discover_paths_result,
            server_logs=step_logs,
        )

        # ── Step 4: Create F-16 document via MCP ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_f16 = ctx.client.call_tool(
            "create_document",
            title=title_f16,
            content=f"## F-16 Flagged Discovery\n\nCreated by {TEST_NAME} run {run.run_id}.",
            path=path_f16,
            tags=["fqc-test", "discover-flagged", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_f16 = _extract_field(create_f16.text, "FQC ID")
        created_path_f16 = _extract_field(create_f16.text, "Path") or path_f16

        if created_path_f16:
            ctx.cleanup.track_file(created_path_f16)
            parts = Path(created_path_f16).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_f16:
            ctx.cleanup.track_mcp_document(fqc_id_f16)

        create_f16.expect_contains(title_f16)
        run.step(
            label="create_document for F-16 (flagged mode)",
            passed=(create_f16.ok and create_f16.status == "pass"),
            detail=expectation_detail(create_f16) or create_f16.error or "",
            timing_ms=create_f16.timing_ms,
            tool_result=create_f16,
            server_logs=step_logs,
        )
        if not create_f16.ok or not fqc_id_f16:
            run.step(
                label="skip F-16 (no fqc_id from create)",
                passed=False,
                detail=f"Cannot proceed with F-16 test — fqc_id_f16={fqc_id_f16!r}",
            )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 5: Scan to register F-16 doc in DB ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result2 = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (register F-16 doc in DB)",
            passed=scan_result2.ok,
            detail=scan_result2.error or "",
            timing_ms=scan_result2.timing_ms,
            tool_result=scan_result2,
            server_logs=step_logs,
        )

        # ── Step 6: Set needs_discovery=true via Supabase REST API ───
        t0 = time.monotonic()
        flag_ok, flag_err = _set_needs_discovery(fqc_id_f16, True)
        elapsed = int((time.monotonic() - t0) * 1000)

        run.step(
            label=f"set needs_discovery=true on F-16 doc (id={fqc_id_f16[:8]}...)",
            passed=flag_ok,
            detail=flag_err if not flag_ok else "",
            timing_ms=elapsed,
        )
        if not flag_ok:
            run.step(
                label="skip F-16 discover_document (needs_discovery not set)",
                passed=False,
                detail=f"Cannot verify F-16: {flag_err}",
            )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 7: discover_document — flagged mode (F-16) ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        discover_flagged_result = ctx.client.call_tool(
            "discover_document",
            mode="flagged",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse JSON response
        parsed_flagged = _parse_discovery_result(discover_flagged_result.text)
        flagged_has_valid_json = parsed_flagged is not None
        flagged_has_summary = flagged_has_valid_json and "summary" in parsed_flagged
        flagged_total_positive = flagged_has_summary and parsed_flagged["summary"].get("total", 0) > 0
        flagged_doc_listed = (
            flagged_has_valid_json
            and "documents" in parsed_flagged
            and any(
                doc.get("path") == created_path_f16
                for doc in parsed_flagged.get("documents", [])
            )
        )

        f16_passed = (
            discover_flagged_result.ok
            and flagged_has_valid_json
            and flagged_has_summary
            and flagged_total_positive
            and flagged_doc_listed
        )
        f16_detail = ""
        if not f16_passed:
            issues = []
            if not discover_flagged_result.ok:
                issues.append(f"tool error: {discover_flagged_result.error}")
            if not flagged_has_valid_json:
                issues.append(f"response not valid JSON: {discover_flagged_result.text[:200]}")
            elif not flagged_has_summary:
                issues.append(f"no 'summary' in response: {list(parsed_flagged.keys())}")
            elif not flagged_total_positive:
                issues.append(
                    f"summary.total = {parsed_flagged['summary'].get('total')}, expected > 0; "
                    f"possibly other flagged docs were already processed by another test"
                )
            if not flagged_doc_listed:
                issues.append(
                    f"path '{created_path_f16}' not found in flagged discovery docs: "
                    f"{[d.get('path') for d in parsed_flagged.get('documents', [])] if parsed_flagged else '(no parsed)'}"
                )
            f16_detail = "; ".join(issues)

        run.step(
            label="discover_document(mode='flagged') — F-16",
            passed=f16_passed,
            detail=f16_detail,
            timing_ms=discover_flagged_result.timing_ms,
            tool_result=discover_flagged_result,
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
        description="Test: discover_document — paths mode (F-17) and flagged mode (F-16).",
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

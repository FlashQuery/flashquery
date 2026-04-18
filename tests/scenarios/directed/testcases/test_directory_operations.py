#!/usr/bin/env python3
"""
Test: remove_directory success, failure, and safety guards.

Scenario:
    1. Create an empty directory under the vault and call remove_directory on it
       (MCP tool: remove_directory) — expect success and verify the directory is gone.
    2. Create a non-empty directory containing a document, then call remove_directory
       on it — expect an error and verify the directory and its contents still exist.
    3. Attempt to remove the vault root (via "", ".", and "/") — expect an error each
       time; verify the vault root still exists.
    4. Attempt path-traversal removals ("_test/../../etc", "../outside") — expect an
       error each time; verify nothing outside the vault was touched.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-12, F-13, F-14, F-15

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_directory_operations.py                            # existing server
    python test_directory_operations.py --managed                  # managed server
    python test_directory_operations.py --managed --json           # structured JSON with server logs
    python test_directory_operations.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-12", "F-13", "F-14", "F-15"]

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

TEST_NAME = "test_directory_operations"


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

    base_dir = f"_test/{run.run_id}"
    empty_dir_rel = f"{base_dir}/empty_dir"
    nonempty_dir_rel = f"{base_dir}/nonempty_dir"
    nonempty_doc_rel = f"{nonempty_dir_rel}/doc.md"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # Track dirs we create so cleanup wipes them even if a step fails partway
        ctx.cleanup.track_dir(base_dir)
        ctx.cleanup.track_dir(empty_dir_rel)
        ctx.cleanup.track_dir(nonempty_dir_rel)

        vault_root = ctx.vault.vault_root

        # ── Step 1: Create an empty directory directly on disk ───────
        t0 = time.monotonic()
        try:
            empty_abs = ctx.vault._abs(empty_dir_rel)
            empty_abs.mkdir(parents=True, exist_ok=True)
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Create empty directory under vault",
                passed=empty_abs.is_dir(),
                detail=f"Created: {empty_abs}",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Create empty directory under vault",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 2: F-12 remove_directory on empty directory ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        rm_empty = ctx.client.call_tool(
            "remove_directory",
            path=empty_dir_rel,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        empty_gone = not ctx.vault._abs(empty_dir_rel).exists()
        passed_f12 = rm_empty.ok and rm_empty.status == "pass" and empty_gone
        detail_f12 = expectation_detail(rm_empty) or rm_empty.error or ""
        if not empty_gone:
            detail_f12 = (detail_f12 + " | dir still exists on disk").strip(" |")

        run.step(
            label="F-12: remove_directory succeeds on empty directory",
            passed=passed_f12,
            detail=detail_f12,
            timing_ms=rm_empty.timing_ms,
            tool_result=rm_empty,
            server_logs=step_logs,
        )

        # ── Step 3: Create a non-empty directory with a document ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=f"FQC RmDir Doc {run.run_id}",
            content=f"## Body\n\nCreated by {TEST_NAME} run {run.run_id}.",
            path=nonempty_doc_rel,
            tags=["fqc-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path") or nonempty_doc_rel

        # Track for cleanup
        ctx.cleanup.track_file(created_path)
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        run.step(
            label="Create document inside non-empty directory",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        # ── Step 4: F-13 remove_directory on non-empty directory ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        rm_nonempty = ctx.client.call_tool(
            "remove_directory",
            path=nonempty_dir_rel,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Expect a tool error (isError=True → result.ok=False)
        dir_still_there = ctx.vault._abs(nonempty_dir_rel).is_dir()
        doc_still_there = ctx.vault._abs(created_path).is_file()
        passed_f13 = (not rm_nonempty.ok) and dir_still_there and doc_still_there

        detail_f13_parts = []
        if rm_nonempty.ok:
            detail_f13_parts.append(
                "Expected error response, but tool succeeded. "
                f"text={rm_nonempty.text[:200]!r}"
            )
        else:
            detail_f13_parts.append(f"Got expected error: {rm_nonempty.error or rm_nonempty.text[:200]!r}")
        if not dir_still_there:
            detail_f13_parts.append("non-empty dir was deleted (data loss!)")
        if not doc_still_there:
            detail_f13_parts.append("document inside was deleted (data loss!)")

        run.step(
            label="F-13: remove_directory rejects non-empty directory",
            passed=passed_f13,
            detail=" | ".join(detail_f13_parts),
            timing_ms=rm_nonempty.timing_ms,
            tool_result=rm_nonempty,
            server_logs=step_logs,
        )

        # ── Step 5: F-14 vault root removal is refused ───────────────
        root_attempts = ["", ".", "/"]
        root_results = []
        for attempt in root_attempts:
            log_mark = ctx.server.log_position if ctx.server else 0
            r = ctx.client.call_tool("remove_directory", path=attempt)
            logs = ctx.server.logs_since(log_mark) if ctx.server else None
            root_results.append((attempt, r, logs))

        vault_root_intact = vault_root.is_dir()
        # Each attempt must NOT succeed; any clear error response is acceptable.
        all_refused = all(not r.ok for _, r, _ in root_results)
        passed_f14 = all_refused and vault_root_intact

        detail_f14_parts = []
        for attempt, r, _ in root_results:
            mark = "refused" if not r.ok else "ACCEPTED (defect)"
            detail_f14_parts.append(f"path={attempt!r}: {mark}")
        if not vault_root_intact:
            detail_f14_parts.append("vault root no longer exists (catastrophic)")

        run.step(
            label="F-14: remove_directory refuses vault root",
            passed=passed_f14,
            detail=" | ".join(detail_f14_parts),
            timing_ms=sum(r.timing_ms for _, r, _ in root_results),
            tool_result=root_results[0][1],
            server_logs=root_results[0][2],
        )

        # ── Step 6: F-15 path-traversal attempts are refused ─────────
        traversal_attempts = ["_test/../../etc", "../outside"]
        traversal_results = []
        for attempt in traversal_attempts:
            log_mark = ctx.server.log_position if ctx.server else 0
            r = ctx.client.call_tool("remove_directory", path=attempt)
            logs = ctx.server.logs_since(log_mark) if ctx.server else None
            traversal_results.append((attempt, r, logs))

        # Sanity checks: nothing outside the vault was touched
        etc_intact = Path("/etc").is_dir()
        parent_intact = vault_root.parent.is_dir()
        all_traversal_refused = all(not r.ok for _, r, _ in traversal_results)
        passed_f15 = all_traversal_refused and etc_intact and parent_intact

        detail_f15_parts = []
        for attempt, r, _ in traversal_results:
            mark = "refused" if not r.ok else "ACCEPTED (defect)"
            detail_f15_parts.append(f"path={attempt!r}: {mark}")
        if not etc_intact:
            detail_f15_parts.append("/etc no longer exists (catastrophic)")
        if not parent_intact:
            detail_f15_parts.append("vault parent dir no longer exists (catastrophic)")

        run.step(
            label="F-15: remove_directory blocks path traversal",
            passed=passed_f15,
            detail=" | ".join(detail_f15_parts),
            timing_ms=sum(r.timing_ms for _, r, _ in traversal_results),
            tool_result=traversal_results[0][1],
            server_logs=traversal_results[0][2],
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
        description="Test: remove_directory success, failure, and safety guards.",
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

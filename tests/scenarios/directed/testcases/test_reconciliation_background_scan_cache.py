#!/usr/bin/env python3
"""
Test: Reconciliation background scan cache — async force_file_scan does not prematurely
consume the staleness cache before the scan completes.

Scenario:
    1. Register a plugin with a watched folder (on_added: auto-track)
    2. Drop file 1 into the watched folder, run force_file_scan (sync) to index it
    3. Call search_records — reconciliation fires, auto-tracks file 1 (staleness cache populated)
    4. Drop file 2 into the watched folder externally (raw vault write, no MCP)
    5. Trigger force_file_scan(background=True) — returns immediately
    6. Wait for the background scan to complete (sleep 5s)
    7. Call search_records — reconciliation performs a full diff against updated
       fqc_documents, detects file 2 as added, and reports "Auto-tracked"
       (proves the staleness cache was NOT consumed prematurely by a pre-scan diff)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-70

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_background_scan_cache.py                            # existing server
    python test_reconciliation_background_scan_cache.py --managed                  # managed server
    python test_reconciliation_background_scan_cache.py --managed --json           # structured output
    python test_reconciliation_background_scan_cache.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-70"]

import argparse
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_background_scan_cache"
PLUGIN_ID = "recon_bg_cache"
DOC_TYPE_ID = "bg_cache_note"

# Seconds to wait after triggering the background scan.
# Background scans are typically fast, but we need to be generous enough
# that fqc_documents is fully updated before the reconciliation diff runs.
BACKGROUND_SCAN_WAIT_SECS = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track and a watched folder."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Background Scan Cache Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for RO-70 background scan cache coverage\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked background scan cache test notes\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      field_map:\n"
        "        title: title\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_bg_cache/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — the reconciliation staleness cache must be
        # fresh per run (no shared state with other tests or a live server).
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (declares watched folder) ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains("notes")

        run.step(
            label="register_plugin (declares watched folder with on_added: auto-track)",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Drop file 1 into the watched folder, sync scan ──────────
        # ctx.create_file writes directly to disk and registers cleanup.
        # The sync force_file_scan indexes the file into fqc_documents.
        file1_path = f"{folder}/bg-cache-note-1-{run.run_id[:8]}.md"
        ctx.create_file(
            file1_path,
            title=f"BG Cache Note 1 {run.run_id[:8]}",
            body=f"Body for background scan cache test file 1 (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-bg-cache"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_bg_cache")

        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="drop file 1 and force_file_scan (sync) — index file 1 into fqc_documents",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── Step 3: search_records — reconciliation fires, populates staleness cache
        # File 1 is in fqc_documents but has no plugin row → classified as 'added'
        # and auto-tracked. The staleness cache is now populated (last reconciliation = now).
        log_mark = ctx.server.log_position if ctx.server else 0
        search1_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search1_result.expect_contains("Auto-tracked")

        run.step(
            label="search_records (1st call) — reconciliation auto-tracks file 1, populates staleness cache",
            passed=(search1_result.ok and search1_result.status == "pass"),
            detail=expectation_detail(search1_result) or search1_result.error or "",
            timing_ms=search1_result.timing_ms,
            tool_result=search1_result,
            server_logs=step_logs,
        )
        if not search1_result.ok:
            return run

        # ── Step 4: Drop file 2 into the watched folder (raw vault write) ───
        # Write directly to disk — no MCP create, no scan yet.
        # fqc_documents does NOT yet know about file 2.
        file2_path = f"{folder}/bg-cache-note-2-{run.run_id[:8]}.md"
        ctx.create_file(
            file2_path,
            title=f"BG Cache Note 2 {run.run_id[:8]}",
            body=f"Body for background scan cache test file 2 (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-bg-cache"],
        )

        run.step(
            label="drop file 2 into watched folder on disk (no scan yet)",
            passed=True,
            detail=f"Created: {file2_path}",
        )

        # ── Step 5: Trigger background force_file_scan ──────────────────────
        # background=True: the call returns immediately before the scan completes.
        # The key invariant (RO-70): the server must NOT consume the staleness cache
        # at this point — that would trigger a premature reconciliation against
        # stale fqc_documents (file 2 not yet indexed).
        log_mark = ctx.server.log_position if ctx.server else 0
        bg_scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan(background=True) — returns immediately, scan running async",
            passed=bg_scan_result.ok,
            detail=bg_scan_result.error or "",
            timing_ms=bg_scan_result.timing_ms,
            tool_result=bg_scan_result,
            server_logs=step_logs,
        )
        if not bg_scan_result.ok:
            return run

        # ── Step 6: Wait for the background scan to complete ────────────────
        # Sleep generously so fqc_documents is fully updated with file 2
        # before we call the record tool. If we call too early, the reconciliation
        # diff would see 0 added (stale fqc_documents) and the test would be
        # indistinguishable from a bug scenario.
        t0_wait = time.monotonic()
        time.sleep(BACKGROUND_SCAN_WAIT_SECS)
        elapsed_wait = int((time.monotonic() - t0_wait) * 1000)

        run.step(
            label=f"wait {BACKGROUND_SCAN_WAIT_SECS}s for background scan to complete",
            passed=True,
            detail=f"Slept {elapsed_wait}ms to allow background scan to finish indexing file 2",
            timing_ms=elapsed_wait,
        )

        # ── Step 7: search_records — full reconciliation diff must run ───────
        # RO-70: The background force_file_scan updated fqc_documents with file 2
        # AND invalidated the staleness cache. The next search_records call must
        # perform a full reconciliation diff (not skip it due to the old staleness
        # window). The diff sees file 2 as 'added' and auto-tracks it.
        # If the staleness cache had been prematurely consumed (before the scan
        # finished), the diff would have run against stale data and missed file 2.
        log_mark = ctx.server.log_position if ctx.server else 0
        search2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The response must contain "Auto-tracked" — proving the full diff ran
        # (not skipped by the staleness cache) and file 2 was detected as added.
        search2_result.expect_contains(
            "Auto-tracked",
            label="RO-70: full reconciliation diff ran after background scan, file 2 detected as added",
        )

        run.step(
            label="RO-70: search_records after background scan — full diff runs, file 2 auto-tracked",
            passed=(search2_result.ok and search2_result.status == "pass"),
            detail=expectation_detail(search2_result) or search2_result.error or "",
            timing_ms=search2_result.timing_ms,
            tool_result=search2_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister the plugin ────────────────────────────────────
        if plugin_registered:
            try:
                teardown = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID,
                    plugin_instance=instance_name,
                    confirm_destroy=True,
                )
                if not teardown.ok:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin failed: {teardown.error or teardown.text}"
                    )
            except Exception as e:
                ctx.cleanup_errors.append(f"unregister_plugin exception: {e}")

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Plugin instance retained: {PLUGIN_ID}/{instance_name}",
            )

        # ── Attach full server logs to the run ────────────────────────────────
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
        description="Test: reconciliation background scan cache — RO-70.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
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

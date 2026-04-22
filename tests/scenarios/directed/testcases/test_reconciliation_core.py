#!/usr/bin/env python3
"""
Test: Plugin reconciliation — added classification and idempotency.

Scenario:
    1. Register a plugin with documents.types watching a specific folder (on_added: auto-track)
       (register_plugin)
    2. Drop a file directly into the watched folder on disk (ctx.create_file)
    3. Call force_file_scan to index the new file into fqc_documents
    4. Call search_records — reconciliation fires before the query, auto-tracks the new
       file, and the response contains "Auto-tracked" (proves RO-01 and RO-04)
    5. Call search_records again immediately — within the 30s staleness window, so
       reconciliation is skipped; no new auto-track lines appear (proves RO-03)
    Cleanup: unregister_plugin (confirm_destroy=True), file removed automatically.

Coverage points: RO-01, RO-04, RO-03

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_core.py                            # existing server
    python test_reconciliation_core.py --managed                  # managed server
    python test_reconciliation_core.py --managed --json           # structured JSON with server logs
    python test_reconciliation_core.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["RO-01", "RO-04", "RO-03"]

import argparse
import sys
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_core"
PLUGIN_ID = "recon_core"

# The folder the plugin watches — must be inside the vault root
WATCHED_FOLDER = "_test_recon_watched"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml() -> str:
    """Inline plugin schema YAML — single document type in a watched folder."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Core Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for reconciliation coverage\n"
        "\n"
        "documents:\n"
        "  types:\n"
        "    - id: recon_note\n"
        "      folder: " + WATCHED_FOLDER + "\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked reconciliation notes\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "      - name: notes\n"
        "        type: text\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Unique instance name per run — avoid collisions with parallel runs
    instance_name = f"test_{run.run_id}"
    schema_yaml = _build_schema_yaml()

    port_range = tuple(args.port_range) if args.port_range else None

    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — plugin reconciliation depends on a
        # clean DB state and the staleness cache being fresh per run.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (declares watched folder) ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains("Tables created")
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

        # ── Step 2: Drop a file directly into the watched folder ─────────
        # ctx.create_file writes to the vault filesystem and registers cleanup.
        watched_file_path = f"{WATCHED_FOLDER}/recon-note-{run.run_id}.md"
        ctx.create_file(
            watched_file_path,
            title=f"Recon Test Note {run.run_id}",
            body=f"Body content for reconciliation test run {run.run_id}.",
            tags=["recon-test", run.run_id],
        )

        run.step(
            label="drop file into watched folder on disk",
            passed=True,
            detail=f"Created: {watched_file_path}",
        )

        # ── Step 3: force_file_scan to index the new file ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync) — index new file into fqc_documents",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Step 4: search_records — reconciliation fires, auto-tracks file ─
        # RO-01: reconciliation is triggered before the search executes.
        # RO-04: the new file (no plugin row) is classified as 'added' and auto-tracked.
        # The response text will contain "Auto-tracked" from formatReconciliationSummary.
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
            label="search_records (1st call) — reconciliation auto-tracks added file (RO-01, RO-04)",
            passed=(search1_result.ok and search1_result.status == "pass"),
            detail=expectation_detail(search1_result) or search1_result.error or "",
            timing_ms=search1_result.timing_ms,
            tool_result=search1_result,
            server_logs=step_logs,
        )
        if not search1_result.ok:
            return run

        # ── Step 5: search_records again immediately — idempotency (RO-03) ─
        # Within the 30s staleness window: reconciliation is skipped entirely.
        # The response must NOT contain "Auto-tracked" a second time — if it did,
        # that would mean a duplicate row was inserted (not idempotent).
        log_mark = ctx.server.log_position if ctx.server else 0
        search2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Within the staleness window, no new auto-tracking should occur.
        search2_result.expect_not_contains("Auto-tracked")

        run.step(
            label="search_records (2nd call immediately after) — reconciliation idempotent (RO-03)",
            passed=(search2_result.ok and search2_result.status == "pass"),
            detail=expectation_detail(search2_result) or search2_result.error or "",
            timing_ms=search2_result.timing_ms,
            tool_result=search2_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister the plugin ────────────────────────────────
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

        # ── Optionally retain files for debugging ─────────────────────────
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
        description="Test: plugin reconciliation — added classification and idempotency.",
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

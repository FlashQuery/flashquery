#!/usr/bin/env python3
"""
Test: Reconciliation staleness — cache skips diff, force_file_scan invalidates cache.

Scenario:
    1. Register a plugin with on_added: auto-track, track_as: notes, template declared,
       and a field_map (register_plugin)
    2. Drop file 1 into the watched folder on disk (ctx.create_file), then force_file_scan
    3. Call search_records — reconciliation fires, auto-tracks file 1, creates a
       pending review row (proves on_added: auto-track + template → pending review)
    4. Call clear_pending_reviews (query mode) — verify "1 item(s)" (RO-08)
    5. Call search_records immediately again (within 30s staleness window):
       - Verify response does NOT contain "Auto-tracked" (diff was skipped)
       - Verify response DOES contain "pending review item(s)" (pending query still ran) (RO-05)
    6. Drop file 2 into the watched folder on disk (ctx.create_file) — still within the
       staleness window. Call force_file_scan to both index file 2 and invalidate the cache.
    7. Call search_records immediately — verify "Auto-tracked" appears (full diff ran
       after cache invalidation; file 2 detected as added) (RO-61)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-05, RO-08, RO-61

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_staleness.py                            # existing server
    python test_reconciliation_staleness.py --managed                  # managed server
    python test_reconciliation_staleness.py --managed --json           # structured JSON with server logs
    python test_reconciliation_staleness.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-05", "RO-08", "RO-61"]

import argparse
import sys
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_staleness"
PLUGIN_ID = "recon_stale"
DOC_TYPE_ID = "stale_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track, template declared, and field_map."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Staleness Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for staleness cache coverage\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked staleness test notes\n"
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
        "      template: \"review-template\"\n"
        "      field_map:\n"
        "        title: title\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_stale/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — reconciliation staleness cache must be
        # fresh per run (no shared state with other tests or a live server).
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (auto-track with template + field_map) ──
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
            label="register_plugin (auto-track, template declared, field_map)",
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

        # ── Step 2: Drop file 1 into the watched folder, then scan ──────────
        # ctx.create_file writes directly to disk (no MCP ownership yet) and
        # registers cleanup. The scan indexes the file into fqc_documents.
        file1_path = f"{folder}/stale-note-1-{run.run_id[:8]}.md"
        ctx.create_file(
            file1_path,
            title=f"Stale Note 1 {run.run_id[:8]}",
            body=f"Body for staleness test file 1 (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-stale"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_stale")

        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="drop file 1 and force_file_scan — index into fqc_documents",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── Step 3: search_records — reconciliation fires, auto-tracks file 1 ─
        # Because template is declared, auto-track also inserts a pending review row.
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
            label="search_records (1st call) — reconciliation auto-tracks file 1 with template",
            passed=(search1_result.ok and search1_result.status == "pass"),
            detail=expectation_detail(search1_result) or search1_result.error or "",
            timing_ms=search1_result.timing_ms,
            tool_result=search1_result,
            server_logs=step_logs,
        )
        if not search1_result.ok:
            return run

        # ── Step 4: clear_pending_reviews (query mode) — verify 1 pending row ─
        # RO-08: auto-track with template declared inserts a pending review row.
        # Empty fqc_ids list = query mode (lists without deleting).
        log_mark = ctx.server.log_position if ctx.server else 0
        pending1_result = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Response format: "Pending reviews for {plugin_id}: N item(s)\n[...]"
        pending1_result.expect_contains("1 item(s)")

        run.step(
            label="RO-08: clear_pending_reviews (query mode) — 1 pending review row from auto-track+template",
            passed=(pending1_result.ok and pending1_result.status == "pass"),
            detail=expectation_detail(pending1_result) or pending1_result.error or "",
            timing_ms=pending1_result.timing_ms,
            tool_result=pending1_result,
            server_logs=step_logs,
        )
        if not pending1_result.ok:
            return run

        # ── Step 5: search_records immediately — staleness window (RO-05) ────
        # Within 30s of the previous reconciliation run, the diff is skipped.
        # The response must NOT contain "Auto-tracked" (no diff ran).
        # The response MUST contain "pending review item(s)" (pending query still runs).
        log_mark = ctx.server.log_position if ctx.server else 0
        search2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Diff was skipped — no new auto-track lines
        search2_result.expect_not_contains("Auto-tracked")
        # Pending review query still ran despite staleness
        search2_result.expect_contains("pending review item(s)")

        run.step(
            label="RO-05: search_records (2nd call) — staleness skips diff but pending review query runs",
            passed=(search2_result.ok and search2_result.status == "pass"),
            detail=expectation_detail(search2_result) or search2_result.error or "",
            timing_ms=search2_result.timing_ms,
            tool_result=search2_result,
            server_logs=step_logs,
        )
        if not search2_result.ok:
            return run

        # ── Step 6: Drop file 2 and force_file_scan to invalidate the cache ──
        # Still within the staleness window — no wait needed.
        # force_file_scan both indexes file 2 and invalidates the reconciliation cache.
        file2_path = f"{folder}/stale-note-2-{run.run_id[:8]}.md"
        ctx.create_file(
            file2_path,
            title=f"Stale Note 2 {run.run_id[:8]}",
            body=f"Body for staleness test file 2 (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-stale"],
        )

        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="drop file 2 and force_file_scan — invalidates the staleness cache (RO-61)",
            passed=scan2_result.ok,
            detail=scan2_result.error or "",
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )
        if not scan2_result.ok:
            return run

        # ── Step 7: search_records after cache invalidation — full diff runs ─
        # RO-61: force_file_scan invalidated the cache, so the next search_records
        # call performs a full diff and detects file 2 as added → auto-tracks it.
        # File 1 may appear as 'modified' (ownership-bump artifact) — that's expected.
        log_mark = ctx.server.log_position if ctx.server else 0
        search3_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Full diff ran after cache invalidation — file 2 was detected as added and auto-tracked
        search3_result.expect_contains("Auto-tracked")

        run.step(
            label="RO-61: search_records (3rd call) — full diff runs after force_file_scan invalidation",
            passed=(search3_result.ok and search3_result.status == "pass"),
            detail=expectation_detail(search3_result) or search3_result.error or "",
            timing_ms=search3_result.timing_ms,
            tool_result=search3_result,
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
        description="Test: reconciliation staleness — cache skips diff, force_file_scan invalidates cache.",
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

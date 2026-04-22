#!/usr/bin/env python3
"""
Test: Reconciliation background scan race — an intermediate record tool call made
BEFORE a background force_file_scan completes does NOT consume the staleness cache.
After the scan finishes, a subsequent record tool call still performs a full diff
and sees the scan results.

Scenario:
    1. Register a plugin with a watched folder (on_added: auto-track)
    2. Create 10 seed files in the watched folder + force_file_scan (sync) to index them
    3. search_records (1st call) — reconciliation auto-tracks 10 seed files (fast, well
       under 30s), populates the staleness cache
    4. Create 100 bulk files in a NON-watched subfolder (these exist solely to slow down
       future background scans; they won't be auto-tracked)
    5. Drop one NEW file into the watched folder (no scan yet — this is the race target)
    6. Trigger force_file_scan(background=True) — returns immediately; now has to scan
       ~111 new files, taking ≥2s and providing a reliable race window
    7. IMMEDIATELY call search_records (2nd call, intermediate) — lands before scan
       completes; with the bug, cache was invalidated too early, so this call runs a
       full diff against stale fqc_documents and repopulates the cache
    8. Wait 6 seconds total from scan trigger to let the scan complete
    9. Call search_records (3rd call) — assert: response contains "Auto-tracked" for
       the new file
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-76

PIR-05 regression guard — this test is expected to FAIL against the unfixed codebase.

With bug: intermediate call (step 7) consumes the cache; third call (step 9) is within
the 30s window → skipped → new file not seen → "Auto-tracked" absent → FAILS (expected)

After fix: intermediate call (step 7) is within the staleness window (cache not yet
invalidated) → skipped; scan completes → cache invalidated → third call (step 9) runs
full diff → new file seen → "Auto-tracked" present → PASSES

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_background_scan_race.py                            # existing server
    python test_reconciliation_background_scan_race.py --managed                  # managed server
    python test_reconciliation_background_scan_race.py --managed --json           # structured output
    python test_reconciliation_background_scan_race.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-76"]

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

TEST_NAME = "test_reconciliation_background_scan_race"
PLUGIN_ID = "recon_bgrace"
DOC_TYPE_ID = "bgrace_item"

# Seed files in the watched folder — small enough to auto-track within the 30s timeout.
SEED_COUNT = 10

# Bulk files in a non-watched subfolder — slows down the background scan without
# triggering additional auto-tracking (outside the plugin's watched folder).
BULK_COUNT = 100

# Total seconds to wait from background scan trigger before the third call.
# 100 bulk file inserts on remote Supabase take ~20-25s; 30s gives safe headroom.
SCAN_WAIT_SECS = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track and a watched folder."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Background Scan Race Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: PIR-05 regression guard — intermediate record call during background scan\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Auto-tracked race test items\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: items\n"
        "      field_map:\n"
        "        title: title\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    rid = run.run_id[:8]
    instance_name = f"test_{rid}"
    # Plugin watches this folder — files here are auto-tracked.
    watched_folder = f"_test_recon_bgrace/{rid}/watched"
    # Bulk files live here — outside the watched folder so they are NOT auto-tracked,
    # but still scanned by force_file_scan, making the background scan take ≥2s.
    bulk_folder = f"_test_recon_bgrace/{rid}/bulk"
    base_folder = f"_test_recon_bgrace/{rid}"
    schema_yaml = _build_schema_yaml(watched_folder)

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
        register_result.expect_contains("items")

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

        # ── Step 2: Create seed files + sync scan → index into fqc_documents ─
        # Only SEED_COUNT (10) files so the first search_records auto-track
        # call stays well within the 30s HTTP timeout (110 files takes ~29s).
        ctx.cleanup.track_dir(watched_folder)
        ctx.cleanup.track_dir(bulk_folder)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_bgrace")

        for i in range(1, SEED_COUNT + 1):
            ctx.create_file(
                f"{watched_folder}/seed-{i:03d}-{rid}.md",
                title=f"Race Seed {i} {rid}",
                body=f"Seed file {i} for background scan race test.",
                tags=["fqc-test", "recon-bgrace"],
            )

        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"create {SEED_COUNT} seed files + force_file_scan (sync) — index into fqc_documents",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── Step 3: search_records (1st call) — populates staleness cache ────
        # The SEED_COUNT seed files are in fqc_documents but have no plugin rows
        # → classified as 'added' and auto-tracked. With only 10 files this
        # completes in ~3s, well within the 30s HTTP timeout.
        # Staleness cache is now populated (last reconciliation = now).
        log_mark = ctx.server.log_position if ctx.server else 0
        search1_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search1_result.expect_contains("Auto-tracked")

        run.step(
            label=f"search_records (1st call) — auto-tracks {SEED_COUNT} seed files, populates staleness cache",
            passed=(search1_result.ok and search1_result.status == "pass"),
            detail=expectation_detail(search1_result) or search1_result.error or "",
            timing_ms=search1_result.timing_ms,
            tool_result=search1_result,
            server_logs=step_logs,
        )
        if not search1_result.ok:
            return run

        # ── Step 4: Create bulk files in non-watched folder ──────────────────
        # These files exist solely to slow down the background scan (the scanner
        # must hash and process every vault file). They are outside the plugin's
        # watched folder and have no fqc_type frontmatter, so reconciliation
        # ignores them — no additional auto-tracking is triggered.
        for i in range(1, BULK_COUNT + 1):
            ctx.create_file(
                f"{bulk_folder}/bulk-{i:03d}-{rid}.md",
                title=f"Bulk File {i} {rid}",
                body=f"Bulk file {i} — not watched, just slows down the scan.",
                tags=["fqc-test", "recon-bgrace-bulk"],
            )

        run.step(
            label=f"create {BULK_COUNT} bulk files in non-watched folder (slows background scan)",
            passed=True,
            detail=f"Created {BULK_COUNT} files in {bulk_folder} (outside plugin watched folder)",
        )

        # ── Step 5: Drop one NEW file into the watched folder ────────────────
        # fqc_documents does NOT yet know about this file (no scan run since
        # step 2). This is the race target — the file the third call must detect.
        new_file_path = f"{watched_folder}/new-race-{rid}.md"
        ctx.create_file(
            new_file_path,
            title=f"New Race File {rid}",
            body=f"New file for background scan race test (run {rid}).",
            tags=["fqc-test", "recon-bgrace"],
        )

        run.step(
            label="drop new file into watched folder on disk (no scan yet — race target)",
            passed=True,
            detail=f"Created: {new_file_path}",
        )

        # ── Step 6: Trigger background force_file_scan ──────────────────────
        # background=True: returns immediately while the scan runs async.
        # The scan must process the 100 bulk + 1 new + 10 existing = 111 files,
        # which takes ≥2s and provides a reliable race window for step 7.
        log_mark = ctx.server.log_position if ctx.server else 0
        bg_scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Record the trigger time for calculating the remaining wait in step 8.
        t_scan_trigger = time.monotonic()

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

        # ── Step 7: Intermediate search_records call (race window) ───────────
        # IMMEDIATELY call search_records without sleeping — this call must land
        # while the background scan is still running (within the race window).
        #
        # Expected behavior (after fix, RO-76):
        #   The staleness cache has NOT yet been invalidated (scan still running),
        #   so this call is within the 30s staleness window → skipped (no diff).
        #
        # Bug behavior (PIR-05):
        #   The server invalidated the cache at scan trigger time (before scan
        #   completes), so this call sees an expired cache → runs a full diff
        #   against stale fqc_documents → new file not yet indexed → repopulates
        #   the cache with a fresh timestamp → third call (step 9) is skipped.
        log_mark = ctx.server.log_position if ctx.server else 0
        search2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records (2nd call, intermediate — in race window before scan completes)",
            passed=search2_result.ok,
            detail=search2_result.error or "",
            timing_ms=search2_result.timing_ms,
            tool_result=search2_result,
            server_logs=step_logs,
        )
        if not search2_result.ok:
            return run

        # ── Step 8: Wait for background scan to complete ─────────────────────
        # Sleep for the remainder of SCAN_WAIT_SECS from the scan trigger time.
        # This ensures fqc_documents is fully updated with the new file before
        # we make the third call.
        elapsed = time.monotonic() - t_scan_trigger
        remaining = max(0.0, float(SCAN_WAIT_SECS) - elapsed)
        if remaining > 0:
            time.sleep(remaining)
        elapsed_total_ms = int((time.monotonic() - t_scan_trigger) * 1000)

        run.step(
            label=f"wait for background scan to complete ({SCAN_WAIT_SECS}s total from trigger)",
            passed=True,
            detail=f"Total elapsed since scan trigger: {elapsed_total_ms}ms",
            timing_ms=elapsed_total_ms,
        )

        # ── Step 9: search_records (3rd call) — assert new file auto-tracked ─
        # RO-76: The background scan has completed and updated fqc_documents with
        # the new file. The staleness cache must have been invalidated ONLY after
        # the scan finished (not before, as the bug does). The intermediate call
        # in step 7 must NOT have consumed the cache. This call must perform a
        # full reconciliation diff and detect the new file as 'added'.
        #
        # If the bug is present: intermediate call consumed the cache → this call
        # is within the freshly-populated 30s window → skipped → new file not
        # seen → "Auto-tracked" absent → FAIL (regression detected, expected)
        #
        # After fix: intermediate call was a cache hit → skipped; scan completion
        # invalidated the cache → this call performs full diff → new file seen →
        # "Auto-tracked" present → PASS
        log_mark = ctx.server.log_position if ctx.server else 0
        search3_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search3_result.expect_contains(
            "Auto-tracked",
            label="RO-76: full reconciliation diff ran after background scan, new file detected as added",
        )

        run.step(
            label="RO-76: search_records (3rd call, post-scan) — full diff runs, new file auto-tracked",
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
                detail=f"Plugin instance retained: {PLUGIN_ID}/{instance_name} | watched: {watched_folder}",
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
        description="Test: reconciliation background scan race — RO-76 (PIR-05 regression guard).",
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

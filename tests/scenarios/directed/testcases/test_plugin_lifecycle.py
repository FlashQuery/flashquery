#!/usr/bin/env python3
"""
Test: register_plugin → get_plugin_info → create → get → update → search → archive → search (miss).

Scenario:
    1. Register a plugin from inline YAML schema (register_plugin)
    2. Inspect the plugin (get_plugin_info) — verify version and table column visible
    3. Create a record in the plugin table (create_record)
    4. Get the record by ID (get_record) — verify all fields
    5. Update one field on the record (update_record)
    6. Get the record again — verify only the updated field changed
    7. Search records with a text query (search_records) — verify hit
    8. Archive the record (archive_record)
    9. Search again — verify archived record is excluded
    Cleanup: the plugin is unregistered with confirm_destroy=True at the end of the test,
    dropping all tables and registry rows so the test is fully repeatable.

Coverage points: P-01, P-02, P-03, P-04, P-05, P-06, P-07, P-10

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_plugin_lifecycle.py                            # existing server
    python test_plugin_lifecycle.py --managed                  # managed server
    python test_plugin_lifecycle.py --managed --json           # structured JSON with server logs
    python test_plugin_lifecycle.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06", "P-07", "P-10"]

import argparse
import re
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_plugin_lifecycle"
PLUGIN_ID = "testlife"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _build_schema_yaml() -> str:
    """Inline plugin schema YAML for the test plugin."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Test Lifecycle Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture plugin (created and torn down per run)\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Test items\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: notes\n"
        "        type: text\n"
        "      - name: count\n"
        "        type: integer\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Use a unique instance name per run so parallel/repeat runs don't collide
    # plugin_instance must match /^[a-z0-9_]+$/ — use underscores, no hyphens
    instance_name = f"test_{run.run_id.replace('-', '_')}"
    schema_yaml = _build_schema_yaml()

    unique_marker = f"plugin-lifecycle-beacon-{run.run_id}"
    original_title = f"FQC Plugin Test {run.run_id}"
    original_notes = f"Initial notes containing marker {unique_marker}"
    updated_notes = f"REVISED notes containing marker {unique_marker}"
    initial_count = 7

    port_range = tuple(args.port_range) if args.port_range else None

    record_id: str = ""
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin from inline YAML (P-01, P-02) ────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Response contains the success line, instance name, and the created table.
        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains("Tables created")
        register_result.expect_contains("items")

        run.step(
            label="register_plugin (inline YAML)",
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

        # ── Step 2: Inspect plugin schema (P-03) ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        info_result = ctx.client.call_tool(
            "get_plugin_info",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Schema, tables, and version must all surface in the response text.
        info_result.expect_contains("Test Lifecycle Plugin")
        info_result.expect_contains("Version: 1.0.0")
        info_result.expect_contains("items")
        info_result.expect_contains("title")
        info_result.expect_contains("count")

        run.step(
            label="get_plugin_info — schema, tables, version",
            passed=(info_result.ok and info_result.status == "pass"),
            detail=expectation_detail(info_result) or info_result.error or "",
            timing_ms=info_result.timing_ms,
            tool_result=info_result,
            server_logs=step_logs,
        )

        # ── Step 3: Create a record (P-04) ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            fields={
                "title": original_title,
                "notes": original_notes,
                "count": initial_count,
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # create_record returns "Created record <uuid> in <table>"
        m = _UUID_RE.search(create_result.text)
        record_id = m.group(0) if m else ""
        create_result.expect_contains("Created record")

        run.step(
            label="create_record (items)",
            passed=(create_result.ok and create_result.status == "pass" and bool(record_id)),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok or not record_id:
            return run

        # ── Step 4: Get record by ID (P-05) ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_result = ctx.client.call_tool(
            "get_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            id=record_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # get_record returns JSON; verify each field round-trips intact.
        get_result.expect_contains(record_id)
        get_result.expect_contains(original_title)
        get_result.expect_contains(unique_marker)
        get_result.expect_contains(str(initial_count))

        run.step(
            label="get_record — full field round-trip",
            passed=(get_result.ok and get_result.status == "pass"),
            detail=expectation_detail(get_result) or get_result.error or "",
            timing_ms=get_result.timing_ms,
            tool_result=get_result,
            server_logs=step_logs,
        )

        # ── Step 5: Update one field (P-06) ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        update_result = ctx.client.call_tool(
            "update_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            id=record_id,
            fields={"notes": updated_notes},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        update_result.expect_contains("Updated record")
        update_result.expect_contains(record_id)

        run.step(
            label="update_record (notes only)",
            passed=(update_result.ok and update_result.status == "pass"),
            detail=expectation_detail(update_result) or update_result.error or "",
            timing_ms=update_result.timing_ms,
            tool_result=update_result,
            server_logs=step_logs,
        )
        if not update_result.ok:
            # Continue to cleanup but don't run further dependent steps
            pass

        # ── Step 6: Get record again — verify only notes changed ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        get2_result = ctx.client.call_tool(
            "get_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            id=record_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Updated body present, original notes string absent, other fields unchanged.
        get2_result.expect_contains("REVISED")
        get2_result.expect_not_contains("Initial notes containing marker")
        get2_result.expect_contains(original_title)
        get2_result.expect_contains(str(initial_count))

        run.step(
            label="get_record after update — partial-update semantics",
            passed=(get2_result.ok and get2_result.status == "pass"),
            detail=expectation_detail(get2_result) or get2_result.error or "",
            timing_ms=get2_result.timing_ms,
            tool_result=get2_result,
            server_logs=step_logs,
        )

        # ── Step 7: Search records — record present (baseline) ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            query=unique_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_result.expect_contains(record_id)
        search_result.expect_contains("REVISED")

        run.step(
            label="search_records — pre-archive hit",
            passed=(search_result.ok and search_result.status == "pass"),
            detail=expectation_detail(search_result) or search_result.error or "",
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 8: Archive the record (P-07) ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            id=record_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        archive_result.expect_contains("Archived record")
        archive_result.expect_contains(record_id)

        run.step(
            label="archive_record",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )

        # ── Step 9: Search again — archived must be excluded (P-10) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        post_search_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
            query=unique_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        post_search_result.expect_not_contains(record_id)

        run.step(
            label="search_records after archive — exclusion",
            passed=(post_search_result.ok and post_search_result.status == "pass"),
            detail=expectation_detail(post_search_result) or post_search_result.error or "",
            timing_ms=post_search_result.timing_ms,
            tool_result=post_search_result,
            server_logs=step_logs,
        )

        # ── Cleanup: tear down the plugin instance ───────────────────
        # Plugin teardown is not handled by TestCleanup; do it inline so the
        # test is fully repeatable. Failures are recorded as cleanup errors,
        # not test step failures.
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

        # ── Optionally retain files for debugging ─────────────────────
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
        description="Test: plugin register → record CRUD → archive → unregister lifecycle.",
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

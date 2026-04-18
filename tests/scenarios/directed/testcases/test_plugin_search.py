#!/usr/bin/env python3
"""
Test: search_records with text query and filter dict.

Scenario:
    1. Register a plugin with a schema containing name, category, and priority fields
    2. Create 3 records with distinct field values:
         - Record 1: name="Alpha Widget", category="hardware", priority="high"
         - Record 2: name="Beta Gadget",  category="software", priority="low"
         - Record 3: name="Gamma Device", category="hardware", priority="low"
    3. search_records with query="Widget" — expect Record 1 hit, Record 2 miss (P-08)
    4. search_records with filters={category: hardware, priority: low} — expect only
       Record 3 returned (AND logic); Records 1 and 2 must be absent (P-09)
    Cleanup: archive all 3 records, then unregister the plugin.

Coverage points: P-08, P-09

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_plugin_search.py                            # existing server
    python test_plugin_search.py --managed                  # managed server
    python test_plugin_search.py --managed --json           # structured JSON with server logs
    python test_plugin_search.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["P-08", "P-09"]

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

TEST_NAME = "test_plugin_search"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_schema_yaml(plugin_id: str) -> str:
    """Inline plugin schema YAML for the search test plugin."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Plugin Search Test\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for search_records (text + filter modes)\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Test items for search\n"
        "    columns:\n"
        "      - name: name\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: category\n"
        "        type: text\n"
        "      - name: priority\n"
        "        type: text\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Use a unique plugin_id and instance name per run so parallel/repeat runs don't collide.
    # plugin_id must be a valid identifier; plugin_instance must match /^[a-z0-9_]+$/
    plugin_id = f"plugin_search_test_{run.run_id}"
    instance_name = f"test_{run.run_id}"
    schema_yaml = _build_schema_yaml(plugin_id)

    port_range = tuple(args.port_range) if args.port_range else None

    record_id_1: str = ""
    record_id_2: str = ""
    record_id_3: str = ""
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:

        # ── Step 1: Register plugin (prerequisite) ────────────────────
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
        ctx.cleanup.track_plugin_registration(plugin_id, instance_name)

        # ── Step 2: Create Record 1 — Alpha Widget / hardware / high ──
        log_mark = ctx.server.log_position if ctx.server else 0
        create1 = ctx.client.call_tool(
            "create_record",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table="items",
            fields={
                "name": "Alpha Widget",
                "category": "hardware",
                "priority": "high",
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        m = _UUID_RE.search(create1.text)
        record_id_1 = m.group(0) if m else ""
        create1.expect_contains("Created record")

        run.step(
            label="create_record (Record 1: Alpha Widget / hardware / high)",
            passed=(create1.ok and create1.status == "pass" and bool(record_id_1)),
            detail=expectation_detail(create1) or create1.error or "",
            timing_ms=create1.timing_ms,
            tool_result=create1,
            server_logs=step_logs,
        )
        if not create1.ok or not record_id_1:
            return run

        # ── Step 3: Create Record 2 — Beta Gadget / software / low ───
        log_mark = ctx.server.log_position if ctx.server else 0
        create2 = ctx.client.call_tool(
            "create_record",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table="items",
            fields={
                "name": "Beta Gadget",
                "category": "software",
                "priority": "low",
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        m = _UUID_RE.search(create2.text)
        record_id_2 = m.group(0) if m else ""
        create2.expect_contains("Created record")

        run.step(
            label="create_record (Record 2: Beta Gadget / software / low)",
            passed=(create2.ok and create2.status == "pass" and bool(record_id_2)),
            detail=expectation_detail(create2) or create2.error or "",
            timing_ms=create2.timing_ms,
            tool_result=create2,
            server_logs=step_logs,
        )
        if not create2.ok or not record_id_2:
            return run

        # ── Step 4: Create Record 3 — Gamma Device / hardware / low ──
        log_mark = ctx.server.log_position if ctx.server else 0
        create3 = ctx.client.call_tool(
            "create_record",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table="items",
            fields={
                "name": "Gamma Device",
                "category": "hardware",
                "priority": "low",
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        m = _UUID_RE.search(create3.text)
        record_id_3 = m.group(0) if m else ""
        create3.expect_contains("Created record")

        run.step(
            label="create_record (Record 3: Gamma Device / hardware / low)",
            passed=(create3.ok and create3.status == "pass" and bool(record_id_3)),
            detail=expectation_detail(create3) or create3.error or "",
            timing_ms=create3.timing_ms,
            tool_result=create3,
            server_logs=step_logs,
        )
        if not create3.ok or not record_id_3:
            return run

        # ── Step 5: search_records — text query "Widget" (P-08) ───────
        # Expect Record 1 (Alpha Widget) to appear; Record 2 (Beta Gadget) absent.
        log_mark = ctx.server.log_position if ctx.server else 0
        text_search_result = ctx.client.call_tool(
            "search_records",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table="items",
            query="Widget",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        text_search_result.expect_contains(record_id_1)
        text_search_result.expect_contains("Alpha Widget")
        text_search_result.expect_not_contains(record_id_2)

        run.step(
            label="search_records text query='Widget' — R1 hit, R2 absent (P-08)",
            passed=(text_search_result.ok and text_search_result.status == "pass"),
            detail=expectation_detail(text_search_result) or text_search_result.error or "",
            timing_ms=text_search_result.timing_ms,
            tool_result=text_search_result,
            server_logs=step_logs,
        )

        # ── Step 6: search_records — filter {category: hardware, priority: low} (P-09) ──
        # Expect only Record 3 (Gamma Device); Records 1 and 2 absent.
        log_mark = ctx.server.log_position if ctx.server else 0
        filter_search_result = ctx.client.call_tool(
            "search_records",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table="items",
            filters={"category": "hardware", "priority": "low"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        filter_search_result.expect_contains(record_id_3)
        filter_search_result.expect_contains("Gamma Device")
        filter_search_result.expect_not_contains(record_id_1)
        filter_search_result.expect_not_contains(record_id_2)

        run.step(
            label="search_records filters={category:hardware, priority:low} — R3 only (P-09)",
            passed=(filter_search_result.ok and filter_search_result.status == "pass"),
            detail=expectation_detail(filter_search_result) or filter_search_result.error or "",
            timing_ms=filter_search_result.timing_ms,
            tool_result=filter_search_result,
            server_logs=step_logs,
        )

        # ── Cleanup: archive all records, then unregister plugin ──────
        for rec_id, label in [
            (record_id_1, "Record 1"),
            (record_id_2, "Record 2"),
            (record_id_3, "Record 3"),
        ]:
            if rec_id:
                try:
                    archive = ctx.client.call_tool(
                        "archive_record",
                        plugin_id=plugin_id,
                        plugin_instance=instance_name,
                        table="items",
                        id=rec_id,
                    )
                    if not archive.ok:
                        ctx.cleanup_errors.append(
                            f"archive_record {label} failed: {archive.error or archive.text}"
                        )
                except Exception as e:
                    ctx.cleanup_errors.append(f"archive_record {label} exception: {e}")

        if plugin_registered:
            try:
                teardown = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=plugin_id,
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
                detail=f"Plugin instance retained: {plugin_id}/{instance_name}",
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
        description="Test: search_records text query and filter dict (AND logic).",
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

#!/usr/bin/env python3
"""
Test: Plugin with document-backed and non-document-backed tables registers cleanly.

Scenario:
    1. Register a plugin whose schema has BOTH a document-backed table (projects,
       via track_as) and a plain relational table (milestones) — register_plugin
    2. Verify get_plugin_info returns both tables in the schema
    3. Create a record in the plain (non-document-backed) milestones table — create_record
    4. Get the milestones record by ID — get_record
    5. Create a record in the document-backed projects table — create_record
    6. Get the projects record by ID — get_record
    Cleanup: plugin is unregistered with confirm_destroy=True, dropping all data.

Coverage points: P-16

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_plugin_mixed_tables.py                            # existing server
    python test_plugin_mixed_tables.py --managed                  # managed server
    python test_plugin_mixed_tables.py --managed --json           # structured output
    python test_plugin_mixed_tables.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["P-16"]

import argparse
import re
import sys
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_plugin_mixed_tables"
PLUGIN_ID = "mixedtbl"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _build_schema_yaml(instance_name: str) -> str:
    """Plugin schema with one document-backed table (projects, via track_as)
    and one plain relational table (milestones).  Both tables must coexist
    without DDL conflicts or duplicate implicit-column errors."""
    folder = f"_test/{instance_name}/projects/"
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Mixed Tables Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario fixture — document-backed + plain tables in one plugin\n"
        "\n"
        "tables:\n"
        "  - name: projects\n"
        "    description: Document-backed project records\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: phase\n"
        "        type: text\n"
        "  - name: milestones\n"
        "    description: Plain relational milestone records\n"
        "    columns:\n"
        "      - name: name\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: notes\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        "    - id: project_doc\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: projects\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # plugin_instance must match /^[a-z0-9_]+$/ — underscores only, no hyphens
    instance_name = f"test_{run.run_id.replace('-', '_')}"
    schema_yaml = _build_schema_yaml(instance_name)

    milestone_name = f"Launch {run.run_id}"
    milestone_notes = f"First milestone for mixed-tables test run {run.run_id}"
    project_title = f"Project Alpha {run.run_id}"
    project_phase = "planning"

    port_range = tuple(args.port_range) if args.port_range else None

    milestone_id: str = ""
    project_id: str = ""
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin with mixed table types (P-16) ────
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

        run.step(
            label="register_plugin (document-backed + plain tables)",
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

        # ── Step 2: Verify get_plugin_info shows both tables ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        info_result = ctx.client.call_tool(
            "get_plugin_info",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        info_result.expect_contains("Mixed Tables Test Plugin")
        info_result.expect_contains("projects")
        info_result.expect_contains("milestones")

        run.step(
            label="get_plugin_info — both tables visible in schema",
            passed=(info_result.ok and info_result.status == "pass"),
            detail=expectation_detail(info_result) or info_result.error or "",
            timing_ms=info_result.timing_ms,
            tool_result=info_result,
            server_logs=step_logs,
        )

        # ── Step 3: Create a record in the plain milestones table ────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_ms_result = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="milestones",
            fields={
                "name": milestone_name,
                "notes": milestone_notes,
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        m = _UUID_RE.search(create_ms_result.text)
        milestone_id = m.group(0) if m else ""
        create_ms_result.expect_contains("Created record")

        run.step(
            label="create_record in plain milestones table",
            passed=(create_ms_result.ok and create_ms_result.status == "pass" and bool(milestone_id)),
            detail=expectation_detail(create_ms_result) or create_ms_result.error or "",
            timing_ms=create_ms_result.timing_ms,
            tool_result=create_ms_result,
            server_logs=step_logs,
        )
        if not create_ms_result.ok or not milestone_id:
            return run

        # ── Step 4: Get milestones record by ID ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_ms_result = ctx.client.call_tool(
            "get_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="milestones",
            id=milestone_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_ms_result.expect_contains(milestone_id)
        get_ms_result.expect_contains(milestone_name)

        run.step(
            label="get_record — milestones record retrieved by ID",
            passed=(get_ms_result.ok and get_ms_result.status == "pass"),
            detail=expectation_detail(get_ms_result) or get_ms_result.error or "",
            timing_ms=get_ms_result.timing_ms,
            tool_result=get_ms_result,
            server_logs=step_logs,
        )

        # ── Step 5: Create a record in the document-backed projects table
        log_mark = ctx.server.log_position if ctx.server else 0
        create_proj_result = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="projects",
            fields={
                "title": project_title,
                "phase": project_phase,
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        m2 = _UUID_RE.search(create_proj_result.text)
        project_id = m2.group(0) if m2 else ""
        create_proj_result.expect_contains("Created record")

        run.step(
            label="create_record in document-backed projects table",
            passed=(create_proj_result.ok and create_proj_result.status == "pass" and bool(project_id)),
            detail=expectation_detail(create_proj_result) or create_proj_result.error or "",
            timing_ms=create_proj_result.timing_ms,
            tool_result=create_proj_result,
            server_logs=step_logs,
        )
        if not create_proj_result.ok or not project_id:
            return run

        # ── Step 6: Get projects record by ID ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_proj_result = ctx.client.call_tool(
            "get_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="projects",
            id=project_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        get_proj_result.expect_contains(project_id)
        get_proj_result.expect_contains(project_title)

        run.step(
            label="get_record — projects record retrieved by ID",
            passed=(get_proj_result.ok and get_proj_result.status == "pass"),
            detail=expectation_detail(get_proj_result) or get_proj_result.error or "",
            timing_ms=get_proj_result.timing_ms,
            tool_result=get_proj_result,
            server_logs=step_logs,
        )

        # ── Cleanup: tear down the plugin instance ───────────────────
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
        description="Test: plugin with document-backed + plain tables registers without DDL errors.",
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

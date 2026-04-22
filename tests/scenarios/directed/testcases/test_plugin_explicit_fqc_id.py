#!/usr/bin/env python3
"""
Test: Plugin schema that explicitly declares fqc_id on a document-backed table
registers without a DDL error (PIR-03 regression guard).

Scenario:
    1. Register a plugin whose schema explicitly includes `fqc_id uuid` as a
       user-declared column on the document-backed contacts table — register_plugin
    2. Assert that registration succeeds (response contains "registered successfully")
    3. Call get_plugin_info to confirm the contacts table is visible in the plugin
    Cleanup: plugin is unregistered with confirm_destroy=True.

Coverage points: P-17

PIR-03 regression guard:
    With the bug: Postgres rejects the DDL with "column fqc_id specified more
    than once" because buildPluginTableDDL emits fqc_id twice — once from the
    user-declared column and once as the implicit FK to fqc_documents.
    The test will FAIL (isError response) against the unfixed codebase.

    After fix (de-duplication in buildPluginTableDDL): registration succeeds
    and the test PASSES.

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_plugin_explicit_fqc_id.py                            # existing server
    python test_plugin_explicit_fqc_id.py --managed                  # managed server
    python test_plugin_explicit_fqc_id.py --managed --json           # structured output
    python test_plugin_explicit_fqc_id.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["P-17"]

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

TEST_NAME = "test_plugin_explicit_fqc_id"
PLUGIN_ID = "expfqcid"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_schema_yaml(instance_name: str) -> str:
    """Plugin schema with a document-backed contacts table that explicitly
    declares fqc_id as a user column.  This is the §8.4.7 CRM plugin pattern
    and is the trigger for PIR-03: without the de-duplication fix in
    buildPluginTableDDL the DDL will contain two fqc_id columns and Postgres
    will reject it."""
    folder = f"_test/expfqcid/{instance_name}/contacts/"
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Explicit fqc_id Column Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: PIR-03 regression guard — explicit fqc_id on document-backed table\n"
        "\n"
        "tables:\n"
        "  - name: contacts\n"
        "    description: Document-backed contacts table with explicit fqc_id column\n"
        "    columns:\n"
        "      - name: fqc_id\n"
        "        type: uuid\n"
        "        references: fqc_documents(id)\n"
        "      - name: full_name\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: crm_contact\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: contacts\n"
        "      field_map:\n"
        "        title: full_name\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # plugin_instance must match /^[a-z0-9_]+$/ — underscores only, no hyphens
    instance_name = f"test_{run.run_id.replace('-', '_')}"
    schema_yaml = _build_schema_yaml(instance_name)

    port_range = tuple(args.port_range) if args.port_range else None

    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin with explicit fqc_id column (P-17) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)

        # Build a clear defect note for when the bug is present
        defect_note = (
            "DEFECT (PIR-03): register_plugin returned an error when the schema "
            "explicitly declares 'fqc_id' on a document-backed table. "
            "This is a FlashQuery bug, not a test bug. "
            "buildPluginTableDDL emits fqc_id twice — once from the user-declared "
            "column and once as the implicit FK to fqc_documents — causing Postgres "
            "to reject the DDL with 'column fqc_id specified more than once'. "
            "Fix: de-duplicate the fqc_id column in buildPluginTableDDL before "
            "emitting DDL for document-backed tables."
        )

        step_passed = register_result.ok and register_result.status == "pass"
        detail = expectation_detail(register_result) or register_result.error or ""
        if not step_passed:
            detail = f"{defect_note}\n\nServer response: {register_result.text or register_result.error or '(empty)'}"

        run.step(
            label="register_plugin — explicit fqc_id column on document-backed table (PIR-03)",
            passed=step_passed,
            detail=detail,
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            # Attach server logs before bailing so the JSON report is useful
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Confirm contacts table is visible via get_plugin_info ─
        log_mark = ctx.server.log_position if ctx.server else 0
        info_result = ctx.client.call_tool(
            "get_plugin_info",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        info_result.expect_contains("Explicit fqc_id Column Test Plugin")
        info_result.expect_contains("contacts")

        run.step(
            label="get_plugin_info — contacts table visible in schema",
            passed=(info_result.ok and info_result.status == "pass"),
            detail=expectation_detail(info_result) or info_result.error or "",
            timing_ms=info_result.timing_ms,
            tool_result=info_result,
            server_logs=step_logs,
        )

        # ── Cleanup: tear down the plugin instance ───────────────────────
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
        description=(
            "Test: plugin schema with explicit fqc_id on document-backed table "
            "registers without DDL error (PIR-03 regression guard, P-17)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
    parser.add_argument("--vault-path", type=str, default=None,
                         dest="vault_path",
                         help="Override vault path (ignored with --managed).")
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

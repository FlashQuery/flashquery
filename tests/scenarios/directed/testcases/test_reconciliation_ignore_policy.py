#!/usr/bin/env python3
"""
Test: Reconciliation ignore policy — on_added: ignore takes no action; missing policy fields default to ignore.

Scenario:
    Block A — RO-11 (explicit on_added: ignore):
    1. Register plugin A with a document type that explicitly declares on_added: ignore (register_plugin)
    2. Drop a test file into the watched folder (ctx.create_file)
    3. Index the file into fqc_documents (force_file_scan)
    4. Trigger reconciliation via search_records — verify no "Auto-tracked" in response,
       response contains "0 record(s)" (no plugin row inserted)
    5. Read the vault file from disk — verify no fqc_owner and no fqc_type in frontmatter
    6. Unregister plugin A explicitly before Block B

    Block B — RO-12 (no policy fields → defaults to ignore):
    7. Register plugin B with a document type that has NO on_added/on_moved/on_modified fields
       (register_plugin)
    8. Drop a test file into the watched folder (ctx.create_file)
    9. Index the file into fqc_documents (force_file_scan)
    10. Trigger reconciliation via search_records — verify no "Auto-tracked" in response,
        response contains "0 record(s)"
    11. Read the vault file from disk — verify no fqc_owner and no fqc_type in frontmatter
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-11, RO-12

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_ignore_policy.py                            # existing server
    python test_reconciliation_ignore_policy.py --managed                  # managed server
    python test_reconciliation_ignore_policy.py --managed --json           # structured JSON with server logs
    python test_reconciliation_ignore_policy.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-11", "RO-12"]

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

TEST_NAME = "test_reconciliation_ignore_policy"
PLUGIN_ID_A = "recon_ignore"
PLUGIN_ID_B = "recon_defaults"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml_a(folder: str, instance_name: str) -> str:
    """Plugin A schema: explicit on_added: ignore — reconciliation must take no action."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_A}\n"
        "  name: Reconciliation Ignore Policy Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: \"Scenario-test fixture for on_added: ignore\"\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Items table for ignore-policy test\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: ignore_doc\n"
        f"      folder: {folder}\n"
        "      on_added: ignore\n"
        "      track_as: items\n"
    )


def _build_schema_yaml_b(folder: str, instance_name: str) -> str:
    """Plugin B schema: no policy fields at all — missing fields must default to ignore."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_B}\n"
        "  name: Reconciliation Defaults Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for missing policy defaults\n"
        "\n"
        "tables:\n"
        "  - name: items2\n"
        "    description: Items table for defaults-policy test\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: defaults_doc\n"
        f"      folder: {folder}\n"
        "      track_as: items2\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — ignore-policy tests require clean DB state
        # so reconciliation fires fresh and we can verify no plugin rows are created.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ====================================================================
        # Block A — RO-11: explicit on_added: ignore
        # ====================================================================

        instance_name_a = f"test_a_{run.run_id[:8]}"
        folder_a = f"_test_recon_ignore/{run.run_id[:8]}"
        schema_yaml_a = _build_schema_yaml_a(folder_a, instance_name_a)
        watched_file_path_a = f"{folder_a}/ignore-note-{run.run_id[:8]}.md"

        plugin_a_registered = False

        # ── Step 1: Register plugin A (explicit on_added: ignore) ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_a = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_a,
            plugin_instance=instance_name_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_a.expect_contains("registered successfully")
        register_a.expect_contains(instance_name_a)
        register_a.expect_contains("items")

        run.step(
            label="Block A — register_plugin (on_added: ignore, table: items)",
            passed=(register_a.ok and register_a.status == "pass"),
            detail=expectation_detail(register_a) or register_a.error or "",
            timing_ms=register_a.timing_ms,
            tool_result=register_a,
            server_logs=step_logs,
        )
        if not register_a.ok:
            return run
        plugin_a_registered = True
        # Track for fallback cleanup — explicit unregister below, but this catches crashes.
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_A, instance_name_a)

        # ── Step 2: Drop test file into watched folder (Block A) ────────
        ctx.create_file(
            watched_file_path_a,
            title=f"Ignore Policy Note {run.run_id[:8]}",
            body=f"Body for {TEST_NAME} Block A (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-ignore"],
        )
        ctx.cleanup.track_dir(folder_a)
        ctx.cleanup.track_dir("_test_recon_ignore")

        run.step(
            label="Block A — drop test file into watched folder",
            passed=True,
            detail=f"Created: {watched_file_path_a}",
        )

        # ── Step 3: force_file_scan — index into fqc_documents (Block A) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_a = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="Block A — force_file_scan (sync) — index file into fqc_documents",
            passed=scan_a.ok,
            detail=scan_a.error or "",
            timing_ms=scan_a.timing_ms,
            tool_result=scan_a,
            server_logs=step_logs,
        )
        if not scan_a.ok:
            return run

        # ── Step 4: RO-11 — search_records fires reconciliation; on_added: ignore → no action ──
        # File is in fqc_documents with no plugin row → classified as 'added'.
        # Because on_added: ignore, no plugin row is inserted and no frontmatter is written.
        # The response must NOT contain "Auto-tracked" and must contain "0 record(s)".
        log_mark = ctx.server.log_position if ctx.server else 0
        search_a = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_A,
            plugin_instance=instance_name_a,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_a.expect_not_contains("Auto-tracked")
        search_a.expect_contains("0 record(s)")

        run.step(
            label="RO-11: search_records — on_added: ignore takes no action (no Auto-tracked, 0 records)",
            passed=(search_a.ok and search_a.status == "pass"),
            detail=expectation_detail(search_a) or search_a.error or "",
            timing_ms=search_a.timing_ms,
            tool_result=search_a,
            server_logs=step_logs,
        )
        if not search_a.ok:
            return run

        # ── Step 5: RO-11 — read vault file from disk; no fqc_owner or fqc_type ──
        # Reconciliation took no action, so frontmatter is exactly what ctx.create_file wrote.
        t0 = time.monotonic()
        try:
            disk_doc_a = ctx.vault.read_file(watched_file_path_a)
            fm_a = disk_doc_a.frontmatter

            checks_a = {
                "no fqc_owner written (RO-11)": fm_a.get("fqc_owner") is None,
                "no fqc_type written (RO-11)": fm_a.get("fqc_type") is None,
            }
            all_ok_a = all(checks_a.values())
            detail_a = ""
            if not all_ok_a:
                failed_a = [k for k, v in checks_a.items() if not v]
                detail_a = (
                    f"Failed: {', '.join(failed_a)}. "
                    f"fqc_owner={fm_a.get('fqc_owner')!r}, "
                    f"fqc_type={fm_a.get('fqc_type')!r}"
                )

            elapsed_a = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-11: disk check — no fqc_owner and no fqc_type in frontmatter",
                passed=all_ok_a,
                detail=detail_a,
                timing_ms=elapsed_a,
            )
            if not all_ok_a:
                return run

        except Exception as e:
            elapsed_a = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-11: disk check — no fqc_owner and no fqc_type in frontmatter",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=elapsed_a,
            )
            return run

        # ── Step 6: Explicit unregister of plugin A before Block B ─────
        # Explicit cleanup prevents state leakage into Block B's reconciliation cycle.
        # The cleanup.track_plugin_registration fallback remains in place.
        if plugin_a_registered:
            try:
                teardown_a = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID_A,
                    plugin_instance=instance_name_a,
                    confirm_destroy=True,
                )
                if not teardown_a.ok:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin A failed: {teardown_a.error or teardown_a.text}"
                    )
                else:
                    plugin_a_registered = False
            except Exception as e:
                ctx.cleanup_errors.append(f"unregister_plugin A exception: {e}")

        run.step(
            label="Block A — explicit unregister plugin A before Block B",
            passed=True,
            detail=f"Plugin A ({PLUGIN_ID_A}/{instance_name_a}) unregistered",
        )

        # ====================================================================
        # Block B — RO-12: no policy fields → conservative defaults (ignore)
        # ====================================================================

        instance_name_b = f"test_b_{run.run_id[:8]}"
        folder_b = f"_test_recon_defaults/{run.run_id[:8]}"
        schema_yaml_b = _build_schema_yaml_b(folder_b, instance_name_b)
        watched_file_path_b = f"{folder_b}/defaults-note-{run.run_id[:8]}.md"

        # ── Step 7: Register plugin B (no policy fields at all) ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_b = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_b,
            plugin_instance=instance_name_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_b.expect_contains("registered successfully")
        register_b.expect_contains(instance_name_b)
        register_b.expect_contains("items2")

        run.step(
            label="Block B — register_plugin (no policy fields, table: items2)",
            passed=(register_b.ok and register_b.status == "pass"),
            detail=expectation_detail(register_b) or register_b.error or "",
            timing_ms=register_b.timing_ms,
            tool_result=register_b,
            server_logs=step_logs,
        )
        if not register_b.ok:
            return run
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_B, instance_name_b)

        # ── Step 8: Drop test file into watched folder (Block B) ────────
        ctx.create_file(
            watched_file_path_b,
            title=f"Defaults Policy Note {run.run_id[:8]}",
            body=f"Body for {TEST_NAME} Block B (run {run.run_id[:8]}).",
            tags=["fqc-test", "recon-defaults"],
        )
        ctx.cleanup.track_dir(folder_b)
        ctx.cleanup.track_dir("_test_recon_defaults")

        run.step(
            label="Block B — drop test file into watched folder",
            passed=True,
            detail=f"Created: {watched_file_path_b}",
        )

        # ── Step 9: force_file_scan — index into fqc_documents (Block B) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_b = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="Block B — force_file_scan (sync) — index file into fqc_documents",
            passed=scan_b.ok,
            detail=scan_b.error or "",
            timing_ms=scan_b.timing_ms,
            tool_result=scan_b,
            server_logs=step_logs,
        )
        if not scan_b.ok:
            return run

        # ── Step 10: RO-12 — search_records fires reconciliation; defaults → ignore ──
        # Missing on_added field defaults to 'ignore' — same "no action" result as Block A.
        log_mark = ctx.server.log_position if ctx.server else 0
        search_b = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_B,
            plugin_instance=instance_name_b,
            table="items2",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_b.expect_not_contains("Auto-tracked")
        search_b.expect_contains("0 record(s)")

        run.step(
            label="RO-12: search_records — missing policy fields default to ignore (no Auto-tracked, 0 records)",
            passed=(search_b.ok and search_b.status == "pass"),
            detail=expectation_detail(search_b) or search_b.error or "",
            timing_ms=search_b.timing_ms,
            tool_result=search_b,
            server_logs=step_logs,
        )
        if not search_b.ok:
            return run

        # ── Step 11: RO-12 — read vault file from disk; no fqc_owner or fqc_type ──
        t0 = time.monotonic()
        try:
            disk_doc_b = ctx.vault.read_file(watched_file_path_b)
            fm_b = disk_doc_b.frontmatter

            checks_b = {
                "no fqc_owner written (RO-12)": fm_b.get("fqc_owner") is None,
                "no fqc_type written (RO-12)": fm_b.get("fqc_type") is None,
            }
            all_ok_b = all(checks_b.values())
            detail_b = ""
            if not all_ok_b:
                failed_b = [k for k, v in checks_b.items() if not v]
                detail_b = (
                    f"Failed: {', '.join(failed_b)}. "
                    f"fqc_owner={fm_b.get('fqc_owner')!r}, "
                    f"fqc_type={fm_b.get('fqc_type')!r}"
                )

            elapsed_b = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-12: disk check — no fqc_owner and no fqc_type in frontmatter",
                passed=all_ok_b,
                detail=detail_b,
                timing_ms=elapsed_b,
            )

        except Exception as e:
            elapsed_b = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-12: disk check — no fqc_owner and no fqc_type in frontmatter",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=elapsed_b,
            )

        # ── Optionally retain files for debugging ──────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under vault. Plugin instances: {PLUGIN_ID_A}/{instance_name_a}, {PLUGIN_ID_B}/{instance_name_b}",
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
        description="Test: reconciliation ignore policy — on_added: ignore takes no action; missing fields default to ignore.",
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

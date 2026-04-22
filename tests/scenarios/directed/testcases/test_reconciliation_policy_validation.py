#!/usr/bin/env python3
"""
Test: Policy validation at register_plugin time — invalid auto-track schema rejected,
      read-only folder write emits a warning in the tool response.

Scenario A (RO-35, RO-36):
    Register a plugin whose schema declares on_added: auto-track but omits the
    required track_as field. FlashQuery should reject or warn at register_plugin
    time (not silently accept and fail later at reconciliation time).

    If registration SUCCEEDS with no warning, that is an RO-35/RO-36 defect:
    validation did not fire at registration time.

Scenario B (RO-60):
    Register a valid plugin schema with access_level: read-only on a document
    folder. Write a file directly to disk (bypassing MCP), scan it into
    fqc_documents, then call an MCP write tool (update_document) on it.
    The tool response should contain a warning or error indicating the folder
    is read-only.

Coverage points: RO-35, RO-36, RO-60

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_policy_validation.py                            # existing server
    python test_reconciliation_policy_validation.py --managed                  # managed server
    python test_reconciliation_policy_validation.py --managed --json           # structured JSON with server logs
    python test_reconciliation_policy_validation.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-35", "RO-36", "RO-60"]

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

TEST_NAME = "test_reconciliation_policy_validation"
PLUGIN_ID_BAD = "recon_pv_bad"    # Scenario A: invalid schema (on_added: auto-track, no track_as)
PLUGIN_ID_RO  = "recon_pv_ro"     # Scenario B: read-only folder


# ---------------------------------------------------------------------------
# Schema builders
# ---------------------------------------------------------------------------

def _build_invalid_schema_yaml() -> str:
    """Schema with on_added: auto-track but NO track_as — intentionally invalid."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_BAD}\n"
        "  name: Invalid Auto-Track Plugin\n"
        "  version: 1.0.0\n"
        "  description: Missing track_as — should be rejected\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Would be the tracking table\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        "    - id: bad_note\n"
        "      folder: _test_recon_pv/bad\n"
        "      on_added: auto-track\n"
        # track_as intentionally omitted
    )


def _build_valid_schema_yaml(folder: str) -> str:
    """Valid schema with access_level: read-only on the document folder."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_RO}\n"
        "  name: Read-Only Folder Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Tests read-only access level warning\n"
        "\n"
        "tables:\n"
        "  - name: docs\n"
        "    description: Tracked read-only documents\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        "    - id: ro_doc\n"
        f"      folder: {folder}\n"
        "      access_level: read-only\n"
        "      on_added: auto-track\n"
        "      track_as: docs\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name_bad = f"pv_bad_{run.run_id[:8]}"
    instance_name_ro  = f"pv_ro_{run.run_id[:8]}"
    folder_ro = f"_test_recon_pv/ro/{run.run_id[:8]}"
    watched_file_path = f"{folder_ro}/ro-doc-{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None

    bad_plugin_registered = False
    ro_plugin_registered  = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register the INVALID schema (on_added: auto-track, no track_as) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        invalid_yaml = _build_invalid_schema_yaml()
        bad_register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=invalid_yaml,
            plugin_instance=instance_name_bad,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Determine how FlashQuery responded:
        #   Expected path: registration is rejected (ok=False OR text lacks "registered successfully")
        #   Defect path:   registration succeeds with no warning → RO-35/RO-36 defect
        response_text_bad = bad_register_result.text or ""
        registered_successfully_bad = (
            bad_register_result.ok
            and "registered successfully" in response_text_bad.lower()
        )

        # RO-35: register_plugin should NOT report "registered successfully"
        # RO-36: validation must have fired at registration time (we are in registration step now)
        ro35_ok = not registered_successfully_bad
        step1_detail: str
        if registered_successfully_bad:
            # DEFECT: accepted invalid schema
            bad_plugin_registered = True
            ctx.cleanup.track_plugin_registration(PLUGIN_ID_BAD, instance_name_bad)
            step1_detail = (
                "DEFECT — register_plugin accepted on_added: auto-track without track_as "
                "and returned 'registered successfully'. Validation did NOT fire at "
                "registration time (RO-35/RO-36 violated)."
            )
        elif not bad_register_result.ok:
            # Tool call failed (isError=True) — this is the expected rejection path
            step1_detail = (
                f"Correctly rejected at register_plugin time (tool error). "
                f"Error: {bad_register_result.error or response_text_bad[:200]!r}"
            )
        else:
            # ok=True but no "registered successfully" — warning or partial rejection
            step1_detail = (
                f"Correctly did not confirm successful registration (warning or soft rejection). "
                f"Response preview: {response_text_bad[:200]!r}"
            )

        run.step(
            label=(
                "RO-35 + RO-36: register_plugin with on_added: auto-track and no track_as "
                "— should be rejected or warned at registration time"
            ),
            passed=ro35_ok,
            detail=step1_detail,
            timing_ms=bad_register_result.timing_ms,
            tool_result=bad_register_result,
            server_logs=step_logs,
        )

        # If this was a defect (registration succeeded), try to clean up inline,
        # then continue to Scenario B so we still cover RO-60.
        if registered_successfully_bad:
            try:
                ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID_BAD,
                    plugin_instance=instance_name_bad,
                    confirm_destroy=True,
                )
                bad_plugin_registered = False
                ctx.cleanup._plugin_registrations = [
                    r for r in ctx.cleanup._plugin_registrations
                    if r != (PLUGIN_ID_BAD, instance_name_bad)
                ]
            except Exception:
                pass  # cleanup will handle it

        # ── Step 2: Confirm PLUGIN_ID_BAD is still available via a valid registration ──
        # Only run this confirmation if the invalid schema was properly rejected
        # (i.e., no defect detected) — to confirm the rejection was schema-specific.
        if not registered_successfully_bad:
            log_mark = ctx.server.log_position if ctx.server else 0
            # Re-register with a VALID schema using the same plugin_id to confirm availability
            valid_confirmation_yaml = (
                "plugin:\n"
                f"  id: {PLUGIN_ID_BAD}\n"
                "  name: Confirmation Plugin\n"
                "  version: 1.0.0\n"
                "  description: Confirms plugin_id was not locked by rejected registration\n"
                "\n"
                "tables:\n"
                "  - name: notes\n"
                "    description: Confirmation table\n"
                "    columns:\n"
                "      - name: label\n"
                "        type: text\n"
                "\n"
                "documents:\n"
                "  types:\n"
                "    - id: confirm_note\n"
                "      folder: _test_recon_pv/confirm\n"
                "      on_added: auto-track\n"
                "      track_as: notes\n"
            )
            confirm_result = ctx.client.call_tool(
                "register_plugin",
                schema_yaml=valid_confirmation_yaml,
                plugin_instance=instance_name_bad,
            )
            step_logs_confirm = ctx.server.logs_since(log_mark) if ctx.server else None

            # The valid schema should register successfully
            confirm_ok = confirm_result.ok and "registered successfully" in (confirm_result.text or "").lower()
            if confirm_ok:
                bad_plugin_registered = True
                ctx.cleanup.track_plugin_registration(PLUGIN_ID_BAD, instance_name_bad)

            run.step(
                label=(
                    "RO-36 (confirmation): valid schema with same plugin_id registers successfully "
                    "— confirms rejection was schema-specific, not general failure"
                ),
                passed=confirm_ok,
                detail=(
                    f"Valid re-registration {'succeeded' if confirm_ok else 'failed (unexpected)'}. "
                    f"Response preview: {(confirm_result.text or '')[:200]!r}"
                ),
                timing_ms=confirm_result.timing_ms,
                tool_result=confirm_result,
                server_logs=step_logs_confirm,
            )

            # Unregister the confirmation plugin before moving to Scenario B
            if bad_plugin_registered:
                try:
                    teardown_bad = ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=PLUGIN_ID_BAD,
                        plugin_instance=instance_name_bad,
                        confirm_destroy=True,
                    )
                    if teardown_bad.ok:
                        bad_plugin_registered = False
                        ctx.cleanup._plugin_registrations = [
                            r for r in ctx.cleanup._plugin_registrations
                            if r != (PLUGIN_ID_BAD, instance_name_bad)
                        ]
                    else:
                        ctx.cleanup_errors.append(
                            f"unregister_plugin (bad) failed: {teardown_bad.error or teardown_bad.text}"
                        )
                except Exception as e:
                    ctx.cleanup_errors.append(f"unregister_plugin (bad) exception: {e}")

        # ── Step 3: Register the READ-ONLY plugin schema ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        ro_schema_yaml = _build_valid_schema_yaml(folder_ro)
        ro_register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=ro_schema_yaml,
            plugin_instance=instance_name_ro,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        ro_register_result.expect_contains("registered successfully")
        ro_register_result.expect_contains(instance_name_ro)

        ro_reg_ok = ro_register_result.ok and ro_register_result.status == "pass"
        run.step(
            label="register_plugin (read-only schema) — should succeed",
            passed=ro_reg_ok,
            detail=expectation_detail(ro_register_result) or ro_register_result.error or "",
            timing_ms=ro_register_result.timing_ms,
            tool_result=ro_register_result,
            server_logs=step_logs,
        )
        if not ro_reg_ok:
            # Cannot proceed with RO-60 scenario
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        ro_plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_RO, instance_name_ro)

        # ── Step 4: Create a file in the read-only folder (direct to disk) ───
        ctx.create_file(
            watched_file_path,
            title=f"Read-Only Test Doc {run.run_id[:8]}",
            body="## Read-Only Document\n\nCreated directly on disk (bypassing MCP).",
            tags=["fqc-test", "recon-pv"],
        )
        ctx.cleanup.track_dir(folder_ro)
        ctx.cleanup.track_dir(f"_test_recon_pv/ro")
        ctx.cleanup.track_dir("_test_recon_pv")

        run.step(
            label="create file in read-only watched folder (direct to disk, no MCP)",
            passed=True,
            detail=f"Created: {watched_file_path}",
        )

        # ── Step 5: force_file_scan — index the file into fqc_documents ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index read-only doc into fqc_documents",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 6: Trigger auto-track via search_records so the plugin row exists ──
        log_mark = ctx.server.log_position if ctx.server else 0
        track_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_RO,
            plugin_instance=instance_name_ro,
            table="docs",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — trigger auto-track for the read-only folder doc",
            passed=track_result.ok,
            detail=track_result.error or track_result.text[:200] if not track_result.ok else "",
            timing_ms=track_result.timing_ms,
            tool_result=track_result,
            server_logs=step_logs,
        )
        if not track_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 7: RO-60 — attempt a write via update_document ───────────────
        # The folder is marked access_level: read-only. The write tool should emit
        # a warning or return an error that mentions the read-only restriction.
        log_mark = ctx.server.log_position if ctx.server else 0
        write_result = ctx.client.call_tool(
            "update_document",
            identifier=watched_file_path,
            content="## Attempted Write\n\nThis content was written by the test.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        write_response_text = write_result.text or ""
        write_error_text    = write_result.error or ""
        combined_text = (write_response_text + " " + write_error_text).lower()

        # RO-60: the response must contain a read-only-related keyword OR the tool
        # must have returned an error (isError=True). Either form counts as the warning.
        read_only_keywords = ["read-only", "read only", "readonly", "restricted", "access", "permission"]
        has_keyword = any(kw in combined_text for kw in read_only_keywords)
        tool_returned_error = not write_result.ok  # isError=True counts as warning in error form

        ro60_ok = has_keyword or tool_returned_error

        if ro60_ok:
            if has_keyword:
                matched_kw = [kw for kw in read_only_keywords if kw in combined_text]
                detail_ro60 = (
                    f"PASS — response contains read-only keyword(s): {matched_kw}. "
                    f"Response preview: {write_response_text[:300]!r}"
                )
            else:
                detail_ro60 = (
                    f"PASS — tool returned an error (isError=True), no silent write. "
                    f"Error: {write_error_text[:200]!r}"
                )
        else:
            detail_ro60 = (
                "DEFECT — write tool on read-only folder emitted no warning and succeeded silently. "
                f"Response preview: {write_response_text[:300]!r}"
            )

        run.step(
            label=(
                "RO-60: update_document on read-only folder "
                "— expect warning or error mentioning read-only restriction"
            ),
            passed=ro60_ok,
            detail=detail_ro60,
            timing_ms=write_result.timing_ms,
            tool_result=write_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister the read-only plugin ───────────────────────────
        if ro_plugin_registered:
            try:
                teardown_ro = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID_RO,
                    plugin_instance=instance_name_ro,
                    confirm_destroy=True,
                )
                if not teardown_ro.ok:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin (ro) failed: {teardown_ro.error or teardown_ro.text}"
                    )
            except Exception as e:
                ctx.cleanup_errors.append(f"unregister_plugin (ro) exception: {e}")

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=(
                    f"Plugins retained: {PLUGIN_ID_BAD}/{instance_name_bad}, "
                    f"{PLUGIN_ID_RO}/{instance_name_ro}"
                ),
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
        description=(
            "Test: policy validation at register_plugin time (RO-35, RO-36) "
            "and read-only folder write warning (RO-60)."
        ),
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

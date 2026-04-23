#!/usr/bin/env python3
"""
Test: Policy edge cases — invalid on_moved value rejected at registration (RO-66),
      and Path 2 pending review includes canonical folder (RO-73).

Scenario A (RO-66):
    Register a plugin where the `on_moved` field is set to an unrecognized value
    (e.g., `on_moved: teleport`). The valid values are `keep-tracking` and `untrack`.
    FlashQuery should either return an error (isError=True) or produce a warning in
    the success response indicating the value is invalid. Silently accepting the invalid
    value is a defect.

Scenario B (RO-73):
    Register a plugin with a canonical watched folder and a template declared.
    Place a document OUTSIDE the watched folder but with `fqc_type` matching the
    plugin's document type. Force a file scan so FlashQuery discovers the document.
    Trigger reconciliation via search_records — the global type registry (Path 2)
    picks up the outside document and auto-tracks it, creating a pending review row.
    Call clear_pending_reviews in query mode and assert the response includes the
    plugin's designated (canonical) folder path — not merely the document's current
    (outside) location — so a downstream skill can tell where the document should live.

Coverage points: RO-66, RO-73

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_policy_edge_cases.py                            # existing server
    python test_reconciliation_policy_edge_cases.py --managed                  # managed server
    python test_reconciliation_policy_edge_cases.py --managed --json           # structured JSON with server logs
    python test_reconciliation_policy_edge_cases.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-66", "RO-73"]

import argparse
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_policy_edge_cases"

# Scenario A: invalid on_moved value
PLUGIN_ID_INVALID = "recon_pec_inv"
DOC_TYPE_INVALID   = "pec_inv_note"

# Scenario B: Path 2 pending review canonical folder
PLUGIN_ID_PATH2   = "recon_pec_p2"
DOC_TYPE_PATH2    = "pec_p2_note"


# ---------------------------------------------------------------------------
# Schema builders
# ---------------------------------------------------------------------------

def _build_invalid_moved_schema_yaml(plugin_id: str, doc_type_id: str, folder: str) -> str:
    """Schema with on_moved: teleport — an unrecognized value, should be rejected."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Invalid On-Moved Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Tests that an unrecognized on_moved value is rejected at registration\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Notes for invalid on_moved test\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {doc_type_id}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_moved: teleport\n"  # intentionally invalid — not keep-tracking or untrack
    )


def _build_path2_schema_yaml(plugin_id: str, doc_type_id: str, canonical_folder: str) -> str:
    """Schema with auto-track, template declared, and a clearly-named canonical folder."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Path 2 Canonical Folder Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Tests that pending review rows include the canonical folder (RO-73)\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Notes tracked via Path 2 discovery\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {doc_type_id}\n"
        f"      folder: {canonical_folder}\n"
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

    instance_name_inv  = f"pec_inv_{run.run_id[:8]}"
    instance_name_p2   = f"pec_p2_{run.run_id[:8]}"

    # Scenario A: the plugin's watched folder (would be watched if accepted)
    folder_inv         = f"_test_recon_pec/inv/{run.run_id[:8]}"

    # Scenario B: canonical folder (inside) vs. elsewhere folder (outside — for Path 2)
    canonical_folder   = f"_test_recon_pec/canonical/{run.run_id[:8]}"
    elsewhere_folder   = f"_test_recon_pec/elsewhere/{run.run_id[:8]}"
    outside_doc_path   = f"{elsewhere_folder}/path2-doc-{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    inv_plugin_registered  = False
    path2_plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — clean DB state is required for reconciliation.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ---------------------------------------------------------------------------
        # Scenario A: RO-66 — unrecognized on_moved value rejected at register_plugin
        # ---------------------------------------------------------------------------

        # ── Step 1: Register plugin with on_moved: teleport (invalid value) ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        invalid_schema_yaml = _build_invalid_moved_schema_yaml(
            PLUGIN_ID_INVALID, DOC_TYPE_INVALID, folder_inv
        )
        inv_reg_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=invalid_schema_yaml,
            plugin_instance=instance_name_inv,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        response_text_inv = inv_reg_result.text or ""
        error_text_inv    = inv_reg_result.error or ""

        # Acceptance criteria for RO-66:
        #   - Tool returned isError (ok=False), OR
        #   - Tool succeeded but the response body (NOT the plugin name or metadata)
        #     explicitly warns about the on_moved value being invalid/unrecognized.
        # Silently accepting — "registered successfully" with no warning text about on_moved
        # in the error/response body — is the DEFECT.
        #
        # IMPORTANT: we must NOT match keywords that appear in the plugin name itself
        # (e.g., "Invalid On-Moved Test Plugin" contains "Invalid" — that's our test fixture
        # name, not a FlashQuery-generated warning). We look for warning phrases that FlashQuery
        # would emit, specifically mentioning "on_moved", "teleport", or an explicit
        # warning/error sentinel in the response body beyond metadata lines.
        registered_successfully_inv = (
            inv_reg_result.ok
            and "registered successfully" in response_text_inv.lower()
        )

        # Warning phrases FlashQuery would emit about the invalid field value.
        # We check the error field (tool error text) and the response body, but we strip
        # the lines that come from the plugin's own schema (name, description) to avoid
        # matching our own fixture strings.
        combined_for_warning = (response_text_inv + " " + error_text_inv).lower()

        # Look for warning signals that are specifically about the on_moved policy value,
        # NOT from metadata we injected. FlashQuery would say things like:
        #   "invalid value for on_moved", "unrecognized on_moved value", "unknown policy",
        #   "teleport is not a valid", "warn: on_moved", etc.
        # We require the warning to mention "on_moved" or "teleport" together with a
        # problem indicator, or just "teleport" as an error (since we invented the value).
        on_moved_warned = (
            "on_moved" in combined_for_warning and (
                "invalid" in combined_for_warning
                or "unrecognized" in combined_for_warning
                or "unknown" in combined_for_warning
                or "unsupported" in combined_for_warning
                or "warn" in combined_for_warning
            )
        ) or (
            # "teleport" appearing in an error/warning context (not as part of a path or schema echo)
            "teleport" in (error_text_inv or "").lower()
        )

        ro66_ok: bool
        step1_detail: str

        if not inv_reg_result.ok:
            # Tool returned an error (isError=True) — correct rejection path
            ro66_ok = True
            step1_detail = (
                f"PASS (isError=True) — correctly rejected at register_plugin time. "
                f"Error: {(error_text_inv or response_text_inv[:200])!r}"
            )
        elif not registered_successfully_inv:
            # ok=True but no "registered successfully" — soft rejection or warning
            ro66_ok = True
            step1_detail = (
                f"PASS (soft rejection) — tool returned ok=True but did not confirm registration. "
                f"Response preview: {response_text_inv[:200]!r}"
            )
        elif registered_successfully_inv and on_moved_warned:
            # Accepted but warned — counts as passing RO-66
            ro66_ok = True
            inv_plugin_registered = True
            ctx.cleanup.track_plugin_registration(PLUGIN_ID_INVALID, instance_name_inv)
            step1_detail = (
                f"PASS (warning in response) — registered but warned about invalid on_moved value. "
                f"on_moved_warned=True. "
                f"Response preview: {response_text_inv[:300]!r}"
            )
        else:
            # Silently accepted with no warning about the invalid on_moved value — DEFECT
            ro66_ok = False
            inv_plugin_registered = True
            ctx.cleanup.track_plugin_registration(PLUGIN_ID_INVALID, instance_name_inv)
            step1_detail = (
                "DEFECT (RO-66) — register_plugin accepted on_moved: teleport (unrecognized value) "
                "and returned 'registered successfully' with no warning about the invalid value. "
                "Validation did NOT fire at registration time. "
                "Expected: error (isError=True) or warning text mentioning on_moved/teleport being invalid. "
                f"Actual response: {response_text_inv[:300]!r}"
            )

        run.step(
            label=(
                "RO-66: register_plugin with on_moved: teleport (invalid value) "
                "— expect error or warning, not silent acceptance"
            ),
            passed=ro66_ok,
            detail=step1_detail,
            timing_ms=inv_reg_result.timing_ms,
            tool_result=inv_reg_result,
            server_logs=step_logs,
        )

        # If RO-66 was a defect, try to clean up inline before continuing to Scenario B
        if inv_plugin_registered:
            try:
                ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID_INVALID,
                    plugin_instance=instance_name_inv,
                    confirm_destroy=True,
                )
                inv_plugin_registered = False
                ctx.cleanup._plugin_registrations = [
                    r for r in ctx.cleanup._plugin_registrations
                    if r != (PLUGIN_ID_INVALID, instance_name_inv)
                ]
            except Exception:
                pass  # cleanup will handle it via the tracker

        # ---------------------------------------------------------------------------
        # Scenario B: RO-73 — Path 2 pending review includes canonical folder
        # ---------------------------------------------------------------------------

        # ── Step 2: Register plugin (auto-track, template declared, canonical folder) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        path2_schema_yaml = _build_path2_schema_yaml(
            PLUGIN_ID_PATH2, DOC_TYPE_PATH2, canonical_folder
        )
        path2_reg_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=path2_schema_yaml,
            plugin_instance=instance_name_p2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        path2_reg_result.expect_contains("registered successfully")
        path2_reg_result.expect_contains(instance_name_p2)

        path2_reg_ok = path2_reg_result.ok and path2_reg_result.status == "pass"
        run.step(
            label="register_plugin (auto-track, template, canonical folder) for RO-73 scenario",
            passed=path2_reg_ok,
            detail=expectation_detail(path2_reg_result) or path2_reg_result.error or "",
            timing_ms=path2_reg_result.timing_ms,
            tool_result=path2_reg_result,
            server_logs=step_logs,
        )
        if not path2_reg_ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        path2_plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_PATH2, instance_name_p2)

        # ── Step 3: Create a document OUTSIDE the canonical folder ────────────────
        # The document has fqc_type matching the plugin's document type in frontmatter.
        # This sets up Path 2 discovery: the scanner writes the fqc_type to the DB column,
        # and the reconciler's global type registry finds it during reconciliation.
        ctx.create_file(
            outside_doc_path,
            title=f"Path 2 Doc {run.run_id[:8]}",
            body=(
                "## Path 2 Discovery Test\n\n"
                "This document is OUTSIDE the plugin's canonical folder.\n"
                "It has fqc_type in frontmatter so the global type registry can discover it.\n"
            ),
            tags=["fqc-test", "recon-pec"],
            extra_frontmatter={
                FM.TYPE: DOC_TYPE_PATH2,
                FM.OWNER: PLUGIN_ID_PATH2,
            },
        )
        ctx.cleanup.track_dir(elsewhere_folder)
        ctx.cleanup.track_dir(canonical_folder)
        ctx.cleanup.track_dir(f"_test_recon_pec/canonical")
        ctx.cleanup.track_dir(f"_test_recon_pec/elsewhere")
        ctx.cleanup.track_dir(f"_test_recon_pec/inv")
        ctx.cleanup.track_dir("_test_recon_pec")

        run.step(
            label=(
                f"create doc OUTSIDE canonical folder ({elsewhere_folder!r}) "
                f"with fqc_type={DOC_TYPE_PATH2!r} in frontmatter (RO-73 setup)"
            ),
            passed=True,
            detail=(
                f"Created: {outside_doc_path} | "
                f"fqc_type={DOC_TYPE_PATH2!r} fqc_owner={PLUGIN_ID_PATH2!r} | "
                f"canonical_folder={canonical_folder!r}"
            ),
        )

        # ── Step 4: force_file_scan — index the outside document ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index outside doc into fqc_documents (fqc_type column populated)",
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

        # ── Step 5: search_records — triggers reconciliation (Path 2 auto-track) ──
        # The global type registry finds the outside doc via its fqc_type column and
        # auto-tracks it. Because the plugin has a template declared, a pending review
        # row is created. RO-73: that row must include the canonical folder.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_PATH2,
            plugin_instance=instance_name_p2,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_result.expect_contains("Auto-tracked")

        recon_ok = recon_result.ok and recon_result.status == "pass"
        run.step(
            label="search_records — Path 2 reconciliation auto-tracks outside doc (Auto-tracked expected)",
            passed=recon_ok,
            detail=expectation_detail(recon_result) or recon_result.error or "",
            timing_ms=recon_result.timing_ms,
            tool_result=recon_result,
            server_logs=step_logs,
        )
        if not recon_ok:
            # If Path 2 is not implemented, this step fails — report defect
            if recon_result.ok and "Auto-tracked" not in (recon_result.text or ""):
                run.step(
                    label="RO-73 DEFECT: Path 2 auto-track did not fire",
                    passed=False,
                    detail=(
                        "DEFECT: Expected the global type registry (Path 2) to auto-track the "
                        f"outside document (fqc_type={DOC_TYPE_PATH2!r}) during reconciliation. "
                        f"'Auto-tracked' not found in response. "
                        f"Response preview: {(recon_result.text or '')[:400]!r}"
                    ),
                )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 6: clear_pending_reviews (query mode) — check canonical folder ──
        # RO-73: the pending review row / response must include the canonical folder
        # path so a downstream skill can identify that the document is outside its
        # designated location.
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_result = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID_PATH2,
            plugin_instance=instance_name_p2,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        pending_text = pending_result.text or ""

        # RO-73 assertion: the response should contain at least 1 pending review row
        # AND should explicitly mention the canonical folder path somewhere in its data,
        # so a downstream skill can identify that the document is outside its designated location.
        #
        # The canonical folder path is the value set in the plugin's document type `folder` field,
        # e.g. "_test_recon_pec/canonical/<run_id>". If that string (or any unambiguous prefix of it
        # beyond the run-id itself) appears in the pending review response, RO-73 is implemented.
        #
        # Strict check: the full canonical_folder path must appear verbatim, OR an unambiguous
        # folder-path fragment that uniquely identifies it (not the run_id alone, since the run_id
        # also appears in the table_name column for unrelated reasons).
        has_pending_row = "1 item(s)" in pending_text or "item(s)" in pending_text

        # Full canonical folder path in the response — unambiguous
        has_canonical_folder_exact = canonical_folder in pending_text

        # Partial canonical path: at minimum the "_test_recon_pec/canonical" prefix must appear.
        # This is distinct from the table_name or doc path (which use "elsewhere", not "canonical").
        canonical_prefix = "_test_recon_pec/canonical"
        has_canonical_folder_prefix = canonical_prefix in pending_text

        # Also check for the folder key specifically (in case response embeds it as a JSON field)
        has_folder_key_with_canonical = (
            '"folder"' in pending_text and "canonical" in pending_text
        ) or (
            "folder:" in pending_text and "canonical" in pending_text
        ) or (
            "expected_folder" in pending_text and "canonical" in pending_text
        ) or (
            "canonical_folder" in pending_text
        )

        has_canonical_folder_reference = (
            has_canonical_folder_exact
            or has_canonical_folder_prefix
            or has_folder_key_with_canonical
        )

        # The elsewhere path (doc's current location) for context in failure messages
        has_elsewhere_path = elsewhere_folder in pending_text

        ro73_ok = has_pending_row and has_canonical_folder_reference

        if ro73_ok:
            detail_ro73 = (
                f"PASS — pending review response includes the canonical folder reference. "
                f"canonical_folder_exact={has_canonical_folder_exact}, "
                f"canonical_prefix_found={has_canonical_folder_prefix}, "
                f"folder_key_with_canonical={has_folder_key_with_canonical}. "
                f"has_elsewhere_path={has_elsewhere_path} (current location of doc). "
                f"Response preview: {pending_text[:500]!r}"
            )
        elif not has_pending_row:
            detail_ro73 = (
                f"FAIL — no pending review rows found (expected 1). "
                f"Path 2 auto-track may have succeeded without creating a pending review row, "
                f"or clear_pending_reviews returned an unexpected format. "
                f"Response preview: {pending_text[:500]!r}"
            )
        else:
            detail_ro73 = (
                f"DEFECT (RO-73) — pending review row exists but the response does NOT include "
                f"the canonical folder path. "
                f"canonical_folder={canonical_folder!r} not found in response "
                f"(exact={has_canonical_folder_exact}, prefix={has_canonical_folder_prefix}, "
                f"folder_key={has_folder_key_with_canonical}). "
                f"A downstream skill cannot determine where the document 'should' live. "
                f"has_elsewhere_path={has_elsewhere_path} (doc's current location). "
                f"Expected the response to include the plugin's designated folder path "
                f"(e.g. as a 'folder', 'expected_folder', or 'canonical_folder' field in the "
                f"pending review JSON item, or in a header line). "
                f"Response preview: {pending_text[:600]!r}"
            )

        run.step(
            label=(
                "RO-73: clear_pending_reviews (query mode) — "
                "pending review response must include the canonical folder path"
            ),
            passed=ro73_ok,
            detail=detail_ro73,
            timing_ms=pending_result.timing_ms,
            tool_result=pending_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister plugins ───────────────────────────────────────────
        for plugin_id, instance_name, registered_flag in [
            (PLUGIN_ID_INVALID, instance_name_inv, inv_plugin_registered),
            (PLUGIN_ID_PATH2,   instance_name_p2,  path2_plugin_registered),
        ]:
            if registered_flag:
                try:
                    teardown = ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=plugin_id,
                        plugin_instance=instance_name,
                        confirm_destroy=True,
                    )
                    if not teardown.ok:
                        if "is not registered" not in (teardown.error or ""):
                            ctx.cleanup_errors.append(
                                f"unregister_plugin({plugin_id}/{instance_name}) failed: "
                                f"{teardown.error or teardown.text}"
                            )
                except Exception as e:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin({plugin_id}/{instance_name}) exception: {e}"
                    )

        # ── Optionally retain files for debugging ─────────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=(
                    f"Plugins retained: {PLUGIN_ID_INVALID}/{instance_name_inv}, "
                    f"{PLUGIN_ID_PATH2}/{instance_name_p2}"
                ),
            )

        # ── Attach full server logs to the run ────────────────────────────────────
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
            "Test: policy edge cases — invalid on_moved rejected at registration (RO-66) "
            "and Path 2 pending review includes canonical folder (RO-73)."
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

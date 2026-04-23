#!/usr/bin/env python3
"""
Test: PIR-04 regression guard — pending review context for Path 2 auto-tracked document
      includes a `discoveryPath` field with value `'frontmatter-type'` (RO-75).

Scenario — RO-75 (discoveryPath in pending review context):
    Register a plugin with a canonical folder and a template declared.
    Create a document OUTSIDE the canonical folder but with `fqc_type` matching
    the plugin's document type in frontmatter (Path 2 setup).
    Force a file scan so the scanner writes `ownership_type` to the DB column.
    Trigger reconciliation via search_records — the global type registry (Path 2)
    auto-tracks the outside document and creates a pending review row (because a
    template is declared).
    Call clear_pending_reviews in query mode. Parse the context JSONB from the
    response and assert: the context contains a key `discoveryPath` with value
    `"frontmatter-type"`.

    This test is a PIR-04 regression guard: it FAILS against the current (unfixed)
    codebase because `discoveryPath` is absent from `DocumentInfo` and from all
    pending review context writes. After the fix, `discoveryPath` will be present
    and the test will PASS.

Coverage points: RO-75

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_discovery_path_context.py                            # existing server
    python test_reconciliation_discovery_path_context.py --managed                  # managed server
    python test_reconciliation_discovery_path_context.py --managed --json           # structured JSON with server logs
    python test_reconciliation_discovery_path_context.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-75"]

import argparse
import json as _json
import sys
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_discovery_path_context"

PLUGIN_ID   = "recon_dpc"
DOC_TYPE_ID = "dpc_contact"


# ---------------------------------------------------------------------------
# Schema builder
# ---------------------------------------------------------------------------

def _build_schema_yaml(plugin_id: str, doc_type_id: str, canonical_folder: str) -> str:
    """Plugin schema with auto-track, template declared, and a canonical folder."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Discovery Path Context Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: PIR-04 regression guard — discoveryPath in pending review context\n"
        "\n"
        "tables:\n"
        "  - name: contacts\n"
        "    description: Auto-tracked contacts\n"
        "    columns:\n"
        "      - name: full_name\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {doc_type_id}\n"
        f"      folder: {canonical_folder}\n"
        "      on_added: auto-track\n"
        "      track_as: contacts\n"
        "      template: \"review-template\"\n"
        "      field_map:\n"
        "        title: full_name\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name    = f"dpc_{run.run_id[:8]}"
    rid              = run.run_id[:8]

    # Canonical folder: the folder the plugin watches and where docs "should" live
    canonical_folder = f"_test_recon_dpc/{rid}/contacts"
    # Outside folder: where the Path 2 doc actually lives (outside canonical)
    outside_folder   = f"_test_recon_dpc/{rid}/outside"
    outside_doc_path = f"{outside_folder}/dpc-doc-{rid}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — reconciliation needs clean DB state.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (auto-track, template, canonical folder) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        schema_yaml = _build_schema_yaml(PLUGIN_ID, DOC_TYPE_ID, canonical_folder)
        reg_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_result.expect_contains("registered successfully")
        reg_result.expect_contains(instance_name)

        reg_ok = reg_result.ok and reg_result.status == "pass"
        run.step(
            label="register_plugin (auto-track, template declared, canonical folder) — RO-75 setup",
            passed=reg_ok,
            detail=expectation_detail(reg_result) or reg_result.error or "",
            timing_ms=reg_result.timing_ms,
            tool_result=reg_result,
            server_logs=step_logs,
        )
        if not reg_ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Create a document OUTSIDE the canonical folder ────────────
        # The document has fqc_type matching the plugin's document type AND
        # fqc_owner pointing to the plugin. This is the Path 2 setup: the scanner
        # writes ownership_type to the DB column so reconciliation can find it
        # via the global type registry.
        ctx.create_file(
            outside_doc_path,
            title=f"DPC Contact {rid}",
            body=(
                "## Discovery Path Context Test\n\n"
                "This document is OUTSIDE the plugin's canonical folder.\n"
                "It has fqc_type in frontmatter so the global type registry can discover it.\n"
                "The pending review context must include discoveryPath='frontmatter-type' (RO-75).\n"
            ),
            tags=["fqc-test", "recon-dpc"],
            extra_frontmatter={
                FM.TYPE: DOC_TYPE_ID,
                FM.OWNER: PLUGIN_ID,
            },
        )
        ctx.cleanup.track_dir(outside_folder)
        ctx.cleanup.track_dir(canonical_folder)
        ctx.cleanup.track_dir(f"_test_recon_dpc/{rid}")
        ctx.cleanup.track_dir("_test_recon_dpc")

        run.step(
            label=(
                f"create doc OUTSIDE canonical folder ({outside_folder!r}) "
                f"with fqc_type={DOC_TYPE_ID!r} + fqc_owner={PLUGIN_ID!r} "
                f"in frontmatter (Path 2 setup)"
            ),
            passed=True,
            detail=(
                f"Created: {outside_doc_path} | "
                f"fqc_type={DOC_TYPE_ID!r} fqc_owner={PLUGIN_ID!r} | "
                f"canonical_folder={canonical_folder!r}"
            ),
        )

        # ── Step 3: force_file_scan — index the outside doc ───────────────────
        # The scanner reads fqc_type from frontmatter and writes it to the
        # ownership_type column in fqc_documents, enabling Path 2 discovery.
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index outside doc (ownership_type column populated)",
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

        # ── Step 4: search_records — triggers reconciliation (Path 2 auto-track) ──
        # The global type registry finds the outside doc via its fqc_type column.
        # Auto-track fires and, because the plugin has a template declared,
        # a pending review row is created. The context in that row should include
        # discoveryPath='frontmatter-type' (RO-75).
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="contacts",
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
            # If Path 2 auto-track didn't fire, report the defect clearly
            if recon_result.ok and "Auto-tracked" not in (recon_result.text or ""):
                run.step(
                    label="DEFECT: Path 2 auto-track did not fire — cannot test RO-75",
                    passed=False,
                    detail=(
                        "DEFECT: Expected the global type registry (Path 2) to auto-track the "
                        f"outside document (fqc_type={DOC_TYPE_ID!r}) during reconciliation. "
                        f"'Auto-tracked' not found in response. "
                        f"Response preview: {(recon_result.text or '')[:400]!r}"
                    ),
                )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 5: clear_pending_reviews (query mode) — retrieve pending rows ──
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_result = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        pending_text = pending_result.text or ""

        # First verify we actually got at least one pending review row back
        has_pending_row = "item(s)" in pending_text

        run.step(
            label="clear_pending_reviews (query mode, fqc_ids=[]) — pending review row exists",
            passed=pending_result.ok and has_pending_row,
            detail=(
                f"ok={pending_result.ok} has_pending_row={has_pending_row} | "
                f"Response preview: {pending_text[:300]!r}"
            ),
            timing_ms=pending_result.timing_ms,
            tool_result=pending_result,
            server_logs=step_logs,
        )
        if not pending_result.ok or not has_pending_row:
            if not has_pending_row:
                run.step(
                    label="DEFECT: no pending review row found — cannot test RO-75 discoveryPath assertion",
                    passed=False,
                    detail=(
                        "Expected at least 1 pending review row after Path 2 auto-track "
                        f"(template was declared). Response: {pending_text[:400]!r}"
                    ),
                )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 6: Parse the context JSONB and assert discoveryPath ─────────
        # The response text looks like:
        #   Pending reviews for <plugin_id>/<instance>: 1 item(s)
        #
        #   1. FQC ID: <uuid>
        #      Context: {"template": "review-template", "folder": "...", ...}
        #
        # Extract the JSON object embedded in the response, then check for
        # discoveryPath="frontmatter-type".
        #
        # RO-75 CRITICAL: we must assert on the `discoveryPath` key specifically,
        # NOT merely on the presence of the canonical folder string — that passes
        # regardless because policy.folder is already in context (RO-73). This test
        # exists to guard that discoveryPath is written for Path 2 docs so a skill
        # can distinguish Path 2 discovery from Path 1 (folder) discovery.

        # Response format: "Pending reviews for ...: N item(s)\n[...JSON array...]"
        # Parse the JSON array directly — the regex approach can't handle the
        # quoted-key format ("context": {...}) emitted by JSON.stringify.
        parsed_context: dict | None = None
        parse_error: str = ""

        try:
            bracket_idx = pending_text.index('[')
            items_json = _json.loads(pending_text[bracket_idx:])
            if items_json and isinstance(items_json, list) and len(items_json) > 0:
                first_item = items_json[0]
                if isinstance(first_item, dict) and 'context' in first_item:
                    ctx_val = first_item['context']
                    if isinstance(ctx_val, dict):
                        parsed_context = ctx_val
                    else:
                        parse_error = f"'context' value is not a dict: {ctx_val!r}"
                else:
                    parse_error = (
                        f"First item has no 'context' key. "
                        f"Keys: {sorted(first_item.keys() if isinstance(first_item, dict) else [])!r}"
                    )
            else:
                parse_error = f"JSON array is empty or not a list: {items_json!r}"
        except (ValueError, _json.JSONDecodeError) as exc:
            parse_error = f"Failed to parse JSON response: {exc} | Response: {pending_text[:500]!r}"

        if parsed_context is None:
            # Could not parse context — report as failure
            run.step(
                label=(
                    "RO-75: parse pending review context JSONB — "
                    "assert discoveryPath='frontmatter-type'"
                ),
                passed=False,
                detail=(
                    f"FAIL — could not extract/parse context JSONB from clear_pending_reviews response. "
                    f"{parse_error}"
                ),
                timing_ms=pending_result.timing_ms,
            )
        else:
            # Context was parsed — now check for discoveryPath key specifically
            discovery_path_value = parsed_context.get("discoveryPath")
            has_discovery_path_key = "discoveryPath" in parsed_context
            discovery_path_correct = discovery_path_value == "frontmatter-type"

            ro75_ok = has_discovery_path_key and discovery_path_correct

            if ro75_ok:
                detail_ro75 = (
                    f"PASS — context JSONB contains discoveryPath='frontmatter-type'. "
                    f"parsed_context={parsed_context!r}"
                )
            elif not has_discovery_path_key:
                detail_ro75 = (
                    f"DEFECT (RO-75 / PIR-04) — pending review context JSONB does NOT contain "
                    f"the 'discoveryPath' key. "
                    f"A skill cannot distinguish Path 2 (frontmatter-type) discovery from "
                    f"Path 1 (folder) discovery without this field. "
                    f"Expected: context['discoveryPath'] == 'frontmatter-type'. "
                    f"Actual context keys: {sorted(parsed_context.keys())!r}. "
                    f"Full context: {parsed_context!r}"
                )
            else:
                # Key present but wrong value
                detail_ro75 = (
                    f"DEFECT (RO-75 / PIR-04) — 'discoveryPath' key is present in context "
                    f"but has unexpected value. "
                    f"Expected: 'frontmatter-type'. "
                    f"Actual: {discovery_path_value!r}. "
                    f"Full context: {parsed_context!r}"
                )

            run.step(
                label=(
                    "RO-75: pending review context JSONB contains "
                    "discoveryPath='frontmatter-type' (PIR-04 regression guard)"
                ),
                passed=ro75_ok,
                detail=detail_ro75,
                timing_ms=pending_result.timing_ms,
            )

        # ── Cleanup: unregister plugin ────────────────────────────────────────
        if plugin_registered:
            try:
                teardown = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID,
                    plugin_instance=instance_name,
                    confirm_destroy=True,
                )
                if not teardown.ok:
                    if "is not registered" not in (teardown.error or ""):
                        ctx.cleanup_errors.append(
                            f"unregister_plugin({PLUGIN_ID}/{instance_name}) failed: "
                            f"{teardown.error or teardown.text}"
                        )
            except Exception as e:
                ctx.cleanup_errors.append(
                    f"unregister_plugin({PLUGIN_ID}/{instance_name}) exception: {e}"
                )

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Plugin retained: {PLUGIN_ID}/{instance_name}",
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
            "Test: PIR-04 regression guard — pending review context for Path 2 "
            "auto-tracked document includes discoveryPath='frontmatter-type' (RO-75)."
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

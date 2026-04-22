#!/usr/bin/env python3
"""
Test: Reconciliation resurrection — missing-then-reappearing document un-archives the existing
plugin row rather than creating a new one. Path/folder are irrelevant to resurrection (fqc_id match
only). Template is NOT re-applied; field_map IS re-applied from current frontmatter.

Scenario:
    1.  Register plugin with on_added: auto-track, field_map, and template (register_plugin)
    2.  Create test doc in watched folder with priority frontmatter (ctx.create_file)
    3.  Scan vault — index into fqc_documents (force_file_scan)
    4.  Trigger first reconciliation — auto-tracks doc (search_records)
    5.  Read fqc_id written to frontmatter; capture original plugin record ID
    6.  Wait 32s past staleness window
    7.  Physically delete the vault file (simulates disappearance)
    8.  Scan vault — marks doc status='missing' in fqc_documents
    9.  Trigger second reconciliation — classifies as 'deleted', archives plugin row
    10. Wait 32s past staleness window
    11. Re-create file at DIFFERENT PATH with SAME fqc_id (different priority for field_map check)
    12. Scan vault — indexes resurrected file into fqc_documents
    13. Trigger third reconciliation — classifies as 'resurrected', un-archives plugin row
    14. RO-19: Verify same plugin row un-archived (same record ID as step 4, not a new row)
    15. RO-20: Verify resurrection happened despite different path (path irrelevance)
    16. RO-22a: Verify template NOT re-applied in body (body should not contain template text)
    17. RO-22b: Verify field_map IS re-applied (priority updated to 'critical' from frontmatter)
    18. RO-22c: Verify no new pending review (template not surfaced on resurrection)
    Cleanup is automatic.

Coverage points: RO-19, RO-20, RO-22

Note: This test requires two 32s staleness sleeps; total runtime is approximately 70s.

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_resurrection.py                            # existing server
    python test_reconciliation_resurrection.py --managed                  # managed server
    python test_reconciliation_resurrection.py --managed --json           # structured output
    python test_reconciliation_resurrection.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-19", "RO-20", "RO-22"]

import argparse
import json as _json
import re
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_resurrection"
PLUGIN_ID = "recon_res"
DOC_TYPE_ID = "res_item"

TEMPLATE_TEXT = "This section is added by the template on first track."
TEMPLATE_MARKER = "Template Section"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track, field_map, and template — all needed to test RO-22."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Resurrection Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for resurrection reconciliation\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Tracked items with field_map\n"
        "    columns:\n"
        "      - name: priority\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: items\n"
        "      field_map:\n"
        "        priority: priority\n"
        f"      template: \"## {TEMPLATE_MARKER}\\n\\n{TEMPLATE_TEXT}\"\n"
        "      on_modified: ignore\n"
        "      on_moved: keep-tracking\n"
    )


def _extract_first_record(text: str) -> dict:
    """Parse the first record from a search_records response (JSON array)."""
    start = text.find("[")
    if start == -1:
        return {}
    depth = 0
    end = start
    for i, ch in enumerate(text[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    try:
        records = _json.loads(text[start: end + 1])
        return records[0] if isinstance(records, list) and records else {}
    except _json.JSONDecodeError:
        return {}


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_res/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    original_file_path = f"{folder}/res_doc_{run.run_id[:8]}.md"
    resurrected_file_path = f"{folder}/res_doc_resurrected_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a dedicated managed server — reconciliation requires clean DB state.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin ───────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)

        run.step(
            label="register_plugin (auto-track schema with field_map and template)",
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

        # ── Step 2: Create test doc in watched folder ─────────────────────────
        ctx.create_file(
            original_file_path,
            title=f"Resurrection Test {run.run_id[:8]}",
            body="## Main Content\n\nThis document will be deleted and resurrected.",
            tags=["fqc-test", "recon-res"],
            extra_frontmatter={"priority": "high"},
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_res")

        run.step(
            label="create test doc in watched folder (with priority: high frontmatter)",
            passed=True,
            detail=f"Created: {original_file_path}",
        )

        # ── Step 3: Scan vault — index into fqc_documents ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index test doc into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 4: Trigger first reconciliation — auto-tracks doc ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        first_search = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        first_search.expect_contains("Auto-tracked")

        run.step(
            label="search_records — first reconciliation fires, auto-tracks doc",
            passed=(first_search.ok and first_search.status == "pass"),
            detail=expectation_detail(first_search) or first_search.error or "",
            timing_ms=first_search.timing_ms,
            tool_result=first_search,
            server_logs=step_logs,
        )
        if not first_search.ok:
            return run

        # ── Step 5: Capture fqc_id and original record ID ─────────────────────
        t0 = time.monotonic()
        original_fqc_id = None
        original_record_id = None

        try:
            disk_doc = ctx.vault.read_file(original_file_path)
            original_fqc_id = disk_doc.frontmatter.get("fqc_id")

            # Also get the record ID from search_records result
            record = _extract_first_record(first_search.text)
            original_record_id = record.get("id")

            checks = {
                "fqc_id present in frontmatter after auto-track": original_fqc_id is not None,
                "plugin record returned in search_records": bool(record),
                "record has id field": original_record_id is not None,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id={original_fqc_id!r}, "
                    f"record_id={original_record_id!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from frontmatter and original plugin record ID",
                passed=all_ok,
                detail=detail or f"fqc_id={original_fqc_id!r}, record_id={original_record_id!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from frontmatter and original plugin record ID",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6: Wait 32s past staleness window ────────────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (needed for deletion cycle)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 7: Physically delete the vault file ──────────────────────────
        t0 = time.monotonic()
        try:
            abs_original = ctx.vault.vault_root / original_file_path
            existed = abs_original.is_file()
            abs_original.unlink()
            gone = not abs_original.is_file()

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "file existed before delete": existed,
                "file absent after delete": gone,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"

            run.step(
                label="physically delete original vault file (simulate disappearance)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="physically delete original vault file (simulate disappearance)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 8: Scan vault — marks doc as missing ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner marks deleted doc as status=missing",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 9: Trigger second reconciliation — archives the plugin row ────
        log_mark = ctx.server.log_position if ctx.server else 0
        second_search = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        second_recon = _extract_recon_summary(second_search.text)
        # Deleted docs should be archived — look for "Archived" in summary
        archived_in_deletion = "Archived" in second_recon or "archived" in second_recon.lower()

        run.step(
            label="search_records — second reconciliation classifies doc as deleted, archives row",
            passed=(second_search.ok and archived_in_deletion),
            detail=(
                f"recon_summary={second_recon!r} | "
                f"archived_detected={archived_in_deletion}"
            ),
            timing_ms=second_search.timing_ms,
            tool_result=second_search,
            server_logs=step_logs,
        )
        if not second_search.ok or not archived_in_deletion:
            return run

        # ── Step 10: Wait 32s past staleness window again ──────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (needed for resurrection cycle)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 11: Re-create file at DIFFERENT PATH with SAME fqc_id ────────
        # RO-20: resurrection is determined solely by fqc_id match —
        # path/folder are irrelevant. Use a different filename in the same folder.
        # The file must have the original fqc_id in frontmatter for recognition.
        # Use priority: "critical" (was "high") to verify field_map re-application (RO-22b).
        t0 = time.monotonic()
        try:
            # Use vault.create_file with explicit fqc_id to plant the original ID
            ctx.vault.create_file(
                resurrected_file_path,
                title=f"Resurrection Test {run.run_id[:8]} (resurrected)",
                body="## Resurrected Content\n\nThis document was resurrected at a different path.",
                tags=["fqc-test", "recon-res", "resurrected"],
                fqc_id=original_fqc_id,  # SAME fqc_id — key for RO-20
                extra_frontmatter={
                    "priority": "critical",  # Updated priority — will be re-mapped by field_map
                    "fqc_owner": PLUGIN_ID,
                    "fqc_type": DOC_TYPE_ID,
                },
            )
            ctx.cleanup.track_file(resurrected_file_path)

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create file at DIFFERENT PATH with SAME fqc_id and priority: critical (RO-20 setup)",
                passed=True,
                detail=(
                    f"Created: {resurrected_file_path} | "
                    f"fqc_id={original_fqc_id!r} (same as original) | "
                    f"priority=critical (was high)"
                ),
                timing_ms=elapsed,
            )

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create file at DIFFERENT PATH with SAME fqc_id and priority: critical (RO-20 setup)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 12: Scan vault — indexes resurrected file ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — indexes resurrected file into fqc_documents",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ── Step 13: Trigger third reconciliation — resurrection fires ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        third_search = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        third_recon = _extract_recon_summary(third_search.text)
        # Resurrection should be reported in the summary
        resurrection_detected = (
            "resurrected" in third_recon.lower()
            or "resurrection" in third_recon.lower()
            or "Resurrected" in third_recon
        )

        run.step(
            label="search_records — third reconciliation classifies doc as resurrected",
            passed=(third_search.ok and resurrection_detected),
            detail=(
                f"recon_summary={third_recon!r} | "
                f"resurrection_detected={resurrection_detected}"
            ),
            timing_ms=third_search.timing_ms,
            tool_result=third_search,
            server_logs=step_logs,
        )
        if not third_search.ok or not resurrection_detected:
            return run

        # ── Step 14: RO-19 — Verify same plugin row un-archived (not a new row) ─
        # After resurrection, search_records should return the SAME record ID.
        t0 = time.monotonic()
        resurrected_record = _extract_first_record(third_search.text)
        resurrected_record_id = resurrected_record.get("id")

        checks = {
            "record returned after resurrection": bool(resurrected_record),
            "same record ID as original (RO-19 — un-archived, not new row)": (
                resurrected_record_id is not None
                and original_record_id is not None
                and resurrected_record_id == original_record_id
            ),
        }
        all_ok = all(checks.values())
        detail_parts = []
        if not all_ok:
            failed = [k for k, v in checks.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"original_record_id={original_record_id!r} | "
            f"resurrected_record_id={resurrected_record_id!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-19: verify same plugin row un-archived — record ID unchanged after resurrection",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )
        if not all_ok:
            return run

        # ── Step 15: RO-20 — Path irrelevance confirmed ───────────────────────
        # The resurrection happened despite the new file being at a different path.
        # If we got here (same record ID), RO-20 is proven — path/folder were irrelevant.
        t0 = time.monotonic()
        paths_differ = original_file_path != resurrected_file_path

        run.step(
            label="RO-20: resurrection determined by fqc_id match only — paths differ but row was resurrected",
            passed=paths_differ,
            detail=(
                f"original_path={original_file_path!r} | "
                f"resurrected_path={resurrected_file_path!r} | "
                f"paths_differ={paths_differ} | "
                f"same_record_id={resurrected_record_id == original_record_id}"
            ),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Step 16: RO-22a — Verify template NOT re-applied ─────────────────
        t0 = time.monotonic()
        try:
            resurrected_doc = ctx.vault.read_file(resurrected_file_path)
            body = resurrected_doc.body

            template_in_body = TEMPLATE_MARKER in body or TEMPLATE_TEXT in body

            checks = {
                "body readable from disk": True,
                "template marker NOT in body (RO-22a)": not template_in_body,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"template_in_body={template_in_body} | "
                    f"body_preview={body[:200]!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-22a: template NOT re-applied on resurrection — body lacks template text",
                passed=all_ok,
                detail=detail or f"body_preview={body[:120]!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-22a: template NOT re-applied on resurrection — body lacks template text",
                passed=False,
                detail=f"Exception reading resurrected file: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 17: RO-22b — Verify field_map IS re-applied ─────────────────
        # The resurrected file has priority: critical in frontmatter.
        # After resurrection + field_map re-application, the plugin row should
        # have priority = "critical" (not the original "high").
        t0 = time.monotonic()
        resurrected_priority = resurrected_record.get("priority")

        checks = {
            "record has priority field": resurrected_priority is not None,
            "priority updated to 'critical' (RO-22b — field_map re-applied from current frontmatter)": (
                resurrected_priority == "critical"
            ),
        }
        all_ok = all(checks.values())
        detail_parts = []
        if not all_ok:
            failed = [k for k, v in checks.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"priority={resurrected_priority!r} (expected 'critical', original was 'high')"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-22b: field_map IS re-applied on resurrection — priority updated to 'critical'",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )
        if not all_ok:
            return run

        # ── Step 18: RO-22c — Verify no TEMPLATE pending review after resurrection ──
        # Template was declared but should NOT produce a template-type pending review on
        # resurrection. FlashQuery may create a 'resurrected' review type to notify the
        # user of the resurrection, but should NOT insert a template review for applying
        # template content (the template is suppressed on resurrection).
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_result = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # RO-22c: the template text is not surfaced — no "template" review_type should exist.
        # A "resurrected" review type is permitted (lifecycle notification), but not a template review.
        pending_text = pending_result.text
        has_template_review = '"review_type": "template"' in pending_text or "'review_type': 'template'" in pending_text
        no_template_review = not has_template_review

        ro22c_ok = pending_result.ok and no_template_review

        run.step(
            label="RO-22c: no TEMPLATE pending review after resurrection — template suppressed on resurrection",
            passed=ro22c_ok,
            detail=(
                f"no_template_review={no_template_review} | "
                f"pending_text_preview={pending_text[:300]!r}"
            ),
            timing_ms=pending_result.timing_ms,
            tool_result=pending_result,
            server_logs=step_logs,
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
        description=(
            "Test: reconciliation resurrection — un-archives existing plugin row on "
            "reappearing document; path irrelevant; template suppressed, field_map re-applied."
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

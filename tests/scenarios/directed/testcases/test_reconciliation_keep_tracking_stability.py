#!/usr/bin/env python3
"""
Test: Reconciliation keep-tracking stability — after a keep-tracking document moves
      OUTSIDE its watched folder and the first reconciliation updates the stored path,
      a SECOND reconciliation classifies the document as unchanged (not moved again).

This test covers the PIR-09 infinite re-flag bug. Without Path 2 (frontmatter
fqc_type) re-discovery, the reconciler keeps re-classifying the document as 'moved'
on every subsequent reconciliation because the document is outside the watched folder
and the scanner can't find it via folder-based path matching. Path 2 reads fqc_type
from frontmatter and matches it to the plugin, letting the outside-folder document
be identified and classified correctly as unchanged.

Scenario:
    1. Register a plugin watching a specific folder (on_moved: keep-tracking).
    2. Create a doc inside the watched folder.
    3. force_file_scan — index the doc into fqc_documents.
    4. First reconcile (search_records) — auto-track fires, plugin row created.
    5. Verify plugin row active (doc fqc_id in results).
    6. Move the doc OUTSIDE the watched folder using copy+delete.
    7. force_file_scan — scanner detects move; fqc_documents.path updated.
    8. Wait 32s to expire staleness window.
    9. Second reconcile — first pass after move: classified as 'moved',
       path updated, plugin row stays active.
    10. Verify plugin row still active (fqc_id in results after first-move reconcile).
    11. Wait 32s to expire staleness window again.
    12. Third reconcile — second pass (key step for RO-65): should classify as
        'unchanged', NOT 'moved' again.
    13. Verify: second-pass reconciliation does NOT contain 'Updated paths' or
        'moved' language; plugin row still active.
    Cleanup is automatic.

Coverage points: RO-65

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_keep_tracking_stability.py                            # existing server
    python test_reconciliation_keep_tracking_stability.py --managed                  # managed server
    python test_reconciliation_keep_tracking_stability.py --managed --json           # structured output
    python test_reconciliation_keep_tracking_stability.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-65"]

import argparse
import re
import shutil
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

TEST_NAME = "test_reconciliation_keep_tracking_stability"
PLUGIN_ID = "recon_kts"
DOC_TYPE_ID = "kts_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(watched_folder: str) -> str:
    """Plugin schema with on_moved: keep-tracking, auto-track on add."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Keep-Tracking Stability Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for keep-tracking stability (RO-65)\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Tracked notes\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {watched_folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
        "      on_moved: keep-tracking\n"
    )


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_kts_{run.run_id[:8]}"

    base_folder = f"_test_recon_kts/{run.run_id[:8]}"
    watched_folder = f"{base_folder}/watched"
    outside_folder = f"{base_folder}/outside"

    # Doc starts inside the watched folder
    doc_path = f"{watched_folder}/doc_{run.run_id[:8]}.md"
    # After move, it ends up outside the watched folder
    doc_new_path = f"{outside_folder}/doc_moved_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (on_moved: keep-tracking) ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_yaml(watched_folder),
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg.expect_contains("registered successfully")
        run.step(
            label="register_plugin (on_moved: keep-tracking) — RO-65",
            passed=(reg.ok and reg.status == "pass"),
            detail=expectation_detail(reg) or reg.error or "",
            timing_ms=reg.timing_ms,
            tool_result=reg,
            server_logs=step_logs,
        )
        if not reg.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Create doc inside the watched folder ───────────────────────
        ctx.create_file(
            doc_path,
            title=f"Keep-Tracking Stability Doc {run.run_id[:8]}",
            body="## Keep-Tracking Stability Test\n\nThis doc will move outside the watched folder.\nRO-65: second reconciliation must not re-classify as moved.",
            tags=["fqc-test", "recon-kts"],
        )
        ctx.cleanup.track_dir(watched_folder)
        ctx.cleanup.track_dir(outside_folder)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_kts")

        run.step(
            label="create doc inside watched folder (no fqc_owner yet)",
            passed=True,
            detail=f"Created: {doc_path}",
        )

        # ── Step 3: force_file_scan — index the doc ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index doc into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 4: First reconcile — auto-track fires, seeds staleness cache ──
        log_mark = ctx.server.log_position if ctx.server else 0
        prime = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime.expect_contains("Auto-tracked")
        run.step(
            label="search_records (prime) — auto-tracks doc; seeds staleness cache",
            passed=(prime.ok and prime.status == "pass"),
            detail=expectation_detail(prime) or prime.error or "",
            timing_ms=prime.timing_ms,
            tool_result=prime,
            server_logs=step_logs,
        )
        if not prime.ok:
            return run

        # ── Step 5: Read frontmatter — capture fqc_id written by auto-track ───
        t0 = time.monotonic()
        fqc_id = None
        try:
            doc_disk = ctx.vault.read_file(doc_path)
            fqc_id = doc_disk.frontmatter.get(FM.ID)

            checks = {
                "doc has fqc_id (auto-track assigned one)": bool(fqc_id),
                "doc has fqc_owner": bool(doc_disk.frontmatter.get(FM.OWNER)),
                "doc fqc_id in search results": bool(fqc_id) and fqc_id in prime.text,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="verify auto-track wrote fqc_id/fqc_owner; plugin row active",
                passed=all_ok,
                detail=detail or f"fqc_id={fqc_id!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="verify auto-track wrote fqc_id/fqc_owner; plugin row active",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6: Move doc OUTSIDE the watched folder ────────────────────────
        t0 = time.monotonic()
        try:
            outside_abs = ctx.vault.vault_root / outside_folder
            outside_abs.mkdir(parents=True, exist_ok=True)

            old_abs = ctx.vault.vault_root / doc_path
            new_abs = ctx.vault.vault_root / doc_new_path
            shutil.copy2(str(old_abs), str(new_abs))
            old_abs.unlink()
            ctx.cleanup.track_file(doc_new_path)

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "old path gone": not old_abs.is_file(),
                "new path exists (outside)": new_abs.is_file(),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"

            run.step(
                label="move doc OUTSIDE watched folder to trigger 'moved' classification",
                passed=all_ok,
                detail=detail or f"{doc_path} → {doc_new_path}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="move doc OUTSIDE watched folder to trigger 'moved' classification",
                passed=False,
                detail=f"Exception during move: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7: force_file_scan — detect the move ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect move (path updated to outside folder)",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 8: Wait 32s to expire staleness window ───────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s to expire reconciliation staleness window (30s) — before first-move reconcile",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 9: Second reconcile — first pass after move ──────────────────
        # This reconcile should classify the doc as 'moved' (path update applied),
        # keep the plugin row active, and update the stored path.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — first-move reconcile (should classify as 'moved', update path)",
            passed=recon2.ok,
            detail=recon2.error or "",
            timing_ms=recon2.timing_ms,
            tool_result=recon2,
            server_logs=step_logs,
        )
        if not recon2.ok:
            return run

        recon_summary2 = _extract_recon_summary(recon2.text)

        # ── Step 10: Verify first-move reconcile: path updated, row still active ─
        t0 = time.monotonic()

        path_updated = bool(re.search(r"Updated paths? for \d+ moved document", recon_summary2))
        fqc_id_in_results2 = bool(fqc_id) and fqc_id in recon2.text
        archived_in_2 = bool(re.search(r"Archived \d+ record", recon_summary2))

        checks_first_move: dict[str, bool] = {
            "first-move reconcile: path updated in summary (keep-tracking applied)": path_updated,
            "first-move reconcile: fqc_id still in results (plugin row active)": fqc_id_in_results2,
            "first-move reconcile: no archival (keep-tracking preserves row)": not archived_in_2,
        }
        all_ok_first = all(checks_first_move.values())
        detail_parts = []
        if not all_ok_first:
            failed = [k for k, v in checks_first_move.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"path_updated={path_updated} | fqc_id_in_results={fqc_id_in_results2} | "
            f"archived={archived_in_2} | recon_summary={recon_summary2!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="first-move reconcile: path updated; plugin row still active (RO-24 satisfied)",
            passed=all_ok_first,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )
        if not all_ok_first:
            return run

        # ── Step 11: Wait 32s to expire staleness window again ────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s to expire staleness window — before second-pass reconcile (RO-65 key step)",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 12: Third reconcile — second pass (key step for RO-65) ───────
        # This is the critical reconcile. The document is now:
        #   - Outside the watched folder (so not found via folder-based path matching)
        #   - Stored in fqc_documents at the outside path (path was updated in step 9)
        #   - Has fqc_type=DOC_TYPE_ID in frontmatter (Path 2 can re-discover it)
        #
        # With RO-65 implemented (Path 2 discovery):
        #   The reconciler finds the doc via fqc_type frontmatter, matches it to the
        #   plugin's already-tracked row, and classifies it as 'unchanged' — no path
        #   update, no archival.
        #
        # Without RO-65 (the PIR-09 bug):
        #   The reconciler doesn't find the doc via folder scan, thinks the tracked
        #   path is missing, and re-classifies it as 'moved' again.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon3 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — second-pass reconcile (RO-65: should be unchanged, not moved again)",
            passed=recon3.ok,
            detail=recon3.error or "",
            timing_ms=recon3.timing_ms,
            tool_result=recon3,
            server_logs=step_logs,
        )
        if not recon3.ok:
            return run

        recon_summary3 = _extract_recon_summary(recon3.text)

        # ── Step 13: RO-65 — verify second-pass reconcile is unchanged ─────────
        # The doc should NOT appear as 'moved' again. The reconciler should recognize
        # the outside-folder doc via Path 2 (fqc_type frontmatter) and classify it as
        # unchanged. If it re-flags as 'moved', PIR-09 is present.
        t0 = time.monotonic()

        re_moved = bool(re.search(r"Updated paths? for \d+ moved document", recon_summary3))
        fqc_id_in_results3 = bool(fqc_id) and fqc_id in recon3.text
        archived_in_3 = bool(re.search(r"Archived \d+ record", recon_summary3))

        checks_ro65: dict[str, bool] = {
            "RO-65: second-pass reconcile does NOT re-flag doc as 'moved' (no path update)": not re_moved,
            "RO-65: plugin row still active (fqc_id in results)": fqc_id_in_results3,
            "RO-65: no archival in second-pass reconcile (keep-tracking preserved)": not archived_in_3,
        }
        all_ok_ro65 = all(checks_ro65.values())
        detail_65_parts = []
        if not all_ok_ro65:
            failed = [k for k, v in checks_ro65.items() if not v]
            detail_65_parts.append(f"Failed: {', '.join(failed)}")
            if re_moved:
                detail_65_parts.append(
                    "DEFECT (PIR-09): The reconciler re-classified the outside-folder doc as 'moved' "
                    "on the second reconciliation pass. This means Path 2 (frontmatter fqc_type) "
                    "re-discovery is not working: the reconciler cannot find the already-tracked doc "
                    "at its outside-folder path and keeps re-applying the keep-tracking path update. "
                    "RO-65 requires that after the first keep-tracking path update, subsequent "
                    "reconciliations classify the doc as 'unchanged'."
                )
        detail_65_parts.append(
            f"re_moved={re_moved} | fqc_id_in_results={fqc_id_in_results3} | "
            f"archived={archived_in_3} | recon_summary={recon_summary3!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-65: second-pass reconcile is 'unchanged' — doc not re-flagged as moved (PIR-09 absent)",
            passed=all_ok_ro65,
            detail=" | ".join(detail_65_parts),
            timing_ms=elapsed,
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
            "Test: reconciliation keep-tracking stability — outside-folder doc "
            "is classified unchanged on the second reconciliation pass (RO-65 / PIR-09)."
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

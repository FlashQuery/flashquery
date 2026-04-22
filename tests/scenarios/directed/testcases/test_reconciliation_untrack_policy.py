#!/usr/bin/env python3
"""
Test: Reconciliation untrack policy — `on_moved: untrack` is accepted at plugin
      registration time AND causes the plugin row to be archived (with vault
      frontmatter preserved) when a tracked document moves outside the watched
      folder.

This test is a focused, dedicated regression test for RO-64.  It differs from
test_reconciliation_movement in two ways:
  1. It uses only the `untrack` vocabulary word (not `stop-tracking`), which is
     the spec-specified term.
  2. It explicitly asserts both parts of RO-64:
       a. Registration does NOT fail — `untrack` is accepted vocabulary.
       b. After the document moves, the plugin row is ARCHIVED (not left active
          as a no-op would leave it).

PIR-01 note:
    At the time this test was written, the reconciler only handles `keep-tracking`
    and `stop-tracking`.  The value `untrack` falls through to the no-op else
    branch, so the plugin row is NOT archived after the move.  If PIR-01 is not
    yet fixed, Step 8 (archive assertion) will fail — this is a FAIL_DEFECT
    outcome.  Do NOT modify the assertion to accept the incorrect no-op behavior.

Scenario:
    1. Register plugin with `on_moved: untrack` — assert registration succeeds
       (RO-64 first part: the vocabulary word is accepted).
    2. Create a file in the watched folder (no fqc_owner yet).
    3. force_file_scan — index the file into fqc_documents.
    4. First reconcile (search_records) — auto-track fires, plugin row is
       created, fqc_owner/fqc_type written to vault frontmatter.
    5. Read the file from disk — verify fqc_owner and fqc_type are present.
    6. Move the file OUTSIDE the watched folder using filesystem copy+delete,
       then force_file_scan so fqc_documents.path is updated.
    7. Wait 32 s to expire the staleness window.
    8. Second reconcile (search_records) — file is now outside the watched
       folder, classified as `moved`; `on_moved: untrack` should fire →
       plugin row ARCHIVED.  Assert search_records returns 0 results for the
       fqc_id (archived rows excluded) OR the summary reports an archival.
    9. Read the file from disk at the NEW path — assert fqc_owner and fqc_type
       are STILL in the frontmatter (preserved, not stripped — RO-64 second
       part; also required by D-06 "Do NOT touch frontmatter").
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-64

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_untrack_policy.py                            # existing server
    python test_reconciliation_untrack_policy.py --managed                  # managed server
    python test_reconciliation_untrack_policy.py --managed --json           # structured JSON
    python test_reconciliation_untrack_policy.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-64"]

import argparse
import json as _json
import re
import shutil
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_untrack_policy"
PLUGIN_ID = "recon_untrack"
DOC_TYPE_ID = "untrack_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str, run_id: str) -> str:
    """Plugin schema with on_moved: untrack (the spec vocabulary for RO-64)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Untrack Policy Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for on_moved untrack vocabulary (RO-64)\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Tracked untrack-policy notes\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
        "      on_moved: untrack\n"
    )


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary section from a search_records response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"

    base_folder = f"_test_recon_ut/{run.run_id[:8]}"
    watched_folder = f"{base_folder}/watched"
    outside_folder = f"{base_folder}/outside"

    doc_path = f"{watched_folder}/untrack_doc_{run.run_id[:8]}.md"
    doc_new_path = f"{outside_folder}/untrack_doc_moved_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always spin up a dedicated managed server so the test has a clean
        # DB state and is not affected by shared-server plugin registration.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin with on_moved: untrack ────────────────────
        # RO-64 (first part): `untrack` must be accepted vocabulary — registration
        # must NOT return an error or rejection.
        log_mark = ctx.server.log_position if ctx.server else 0
        schema_yaml = _build_schema_yaml(watched_folder, run.run_id)
        reg = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg.expect_contains("registered successfully")
        run.step(
            label="register_plugin with on_moved: untrack — RO-64 (vocabulary accepted at registration)",
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

        # ── Step 2: Create file in the watched folder ─────────────────────────
        ctx.create_file(
            doc_path,
            title=f"Untrack Policy Doc {run.run_id[:8]}",
            body=(
                "## Untrack Policy Test\n\n"
                "This document will be moved outside its watched folder.\n"
                "The on_moved: untrack policy should archive the plugin row."
            ),
            tags=["fqc-test", "recon-untrack"],
        )
        ctx.cleanup.track_file(doc_path)
        ctx.cleanup.track_dir(watched_folder)
        ctx.cleanup.track_dir(outside_folder)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_ut")

        run.step(
            label="create file in watched folder (no fqc_owner yet)",
            passed=True,
            detail=f"Created: {doc_path}",
        )

        # ── Step 3: force_file_scan — index file into fqc_documents ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index file into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 4: First reconcile — auto-track fires ────────────────────────
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
            label="search_records (prime) — auto-track fires, plugin row created, frontmatter written",
            passed=(prime.ok and prime.status == "pass"),
            detail=expectation_detail(prime) or prime.error or "",
            timing_ms=prime.timing_ms,
            tool_result=prime,
            server_logs=step_logs,
        )
        if not prime.ok:
            return run

        # ── Step 5: Read file from disk — verify fqc_owner/fqc_type written ──
        t0 = time.monotonic()
        fqc_id = None
        try:
            doc_disk = ctx.vault.read_file(doc_path)
            fm = doc_disk.frontmatter

            fqc_id = fm.get("fqc_id")
            checks_before: dict[str, bool] = {
                "fqc_id present after auto-track": bool(fqc_id),
                "fqc_owner present after auto-track": bool(fm.get("fqc_owner")),
                "fqc_type present after auto-track": bool(fm.get("fqc_type")),
            }
            all_ok_before = all(checks_before.values())
            detail_before = ""
            if not all_ok_before:
                failed = [k for k, v in checks_before.items() if not v]
                detail_before = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id={fqc_id!r}, fqc_owner={fm.get('fqc_owner')!r}, "
                    f"fqc_type={fm.get('fqc_type')!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read file from disk — verify auto-track wrote fqc_owner/fqc_type",
                passed=all_ok_before,
                detail=detail_before or (
                    f"fqc_id={fqc_id!r}, fqc_owner={fm.get('fqc_owner')!r}, "
                    f"fqc_type={fm.get('fqc_type')!r}"
                ),
                timing_ms=elapsed,
            )
            if not all_ok_before:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read file from disk — verify auto-track wrote fqc_owner/fqc_type",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6: Move file OUTSIDE the watched folder ──────────────────────
        # Moving to outside_folder — not watched by any plugin — causes the
        # reconciler to classify the document as 'moved' (not 'modified').
        t0 = time.monotonic()
        try:
            outside_abs = ctx.vault.vault_root / outside_folder
            outside_abs.mkdir(parents=True, exist_ok=True)

            old_abs = ctx.vault.vault_root / doc_path
            new_abs = ctx.vault.vault_root / doc_new_path
            shutil.copy2(str(old_abs), str(new_abs))
            old_abs.unlink()

            # Switch cleanup tracking from old path to new path
            ctx.cleanup.track_file(doc_new_path)

            checks_move: dict[str, bool] = {
                "old path is gone": not (ctx.vault.vault_root / doc_path).is_file(),
                "new path exists (outside watched folder)": (ctx.vault.vault_root / doc_new_path).is_file(),
            }
            all_ok_move = all(checks_move.values())
            detail_move = ""
            if not all_ok_move:
                failed = [k for k, v in checks_move.items() if not v]
                detail_move = f"Failed: {', '.join(failed)}"

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="move file OUTSIDE watched folder (triggers 'moved' classification on next reconcile)",
                passed=all_ok_move,
                detail=detail_move or f"{doc_path} → {doc_new_path}",
                timing_ms=elapsed,
            )
            if not all_ok_move:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="move file OUTSIDE watched folder (triggers 'moved' classification on next reconcile)",
                passed=False,
                detail=f"Exception during move: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7: force_file_scan — detect the move ─────────────────────────
        # Scanner sees: old path gone (status → missing), new path present with
        # same fqc_id in frontmatter → fqc_documents.path updated to new location.
        # After the scan the new path is OUTSIDE the plugin's watched folder,
        # so the reconciler will classify it as 'moved'.
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect move; fqc_documents.path updated to outside folder",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 8: Wait 32 s to expire the staleness window (30 s) ──────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32 s to expire reconciliation staleness window (30 s)",
            passed=True,
            detail=f"Slept {elapsed} ms",
            timing_ms=elapsed,
        )

        # ── Step 9: Second reconcile — on_moved: untrack should archive row ───
        # RO-64 (second part): `on_moved: untrack` must cause the plugin row to
        # be ARCHIVED, not left active (no-op).  If PIR-01 is not fixed, this
        # step will report FAIL_DEFECT: the row is still active and fqc_id
        # appears in the search results.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — second reconcile (after move + staleness expiry)",
            passed=recon.ok,
            detail=recon.error or "",
            timing_ms=recon.timing_ms,
            tool_result=recon,
            server_logs=step_logs,
        )
        if not recon.ok:
            return run

        recon_summary = _extract_recon_summary(recon.text)

        # ── Step 10: Assert plugin row archived (fqc_id absent from results) ──
        # on_moved: untrack must behave like stop-tracking: archive the plugin
        # row so that it is excluded from active search_records results.
        # If PIR-01 is still present, archived_count == 0 and fqc_id is still
        # in the response text — that is the defect.
        t0 = time.monotonic()

        m_archived = re.search(r"Archived (\d+) record", recon_summary)
        archived_count = int(m_archived.group(1)) if m_archived else 0
        fqc_id_in_results = bool(fqc_id and fqc_id in recon.text)

        checks_archive: dict[str, bool] = {
            # PIR-01: `untrack` hits the no-op branch — archived_count stays 0
            "RO-64: at least 1 plugin row archived (on_moved: untrack policy fired)": archived_count >= 1,
            # Corollary: archived row must not appear in active search results
            "RO-64: doc fqc_id absent from search results (row is archived)": not fqc_id_in_results,
        }
        all_ok_archive = all(checks_archive.values())
        detail_archive_parts = []
        if not all_ok_archive:
            failed = [k for k, v in checks_archive.items() if not v]
            detail_archive_parts.append(f"FAIL_DEFECT (PIR-01): {', '.join(failed)}")
        detail_archive_parts.append(
            f"archived_count={archived_count} | fqc_id_in_results={fqc_id_in_results} | "
            f"recon_summary={recon_summary!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-64: on_moved: untrack archives plugin row; fqc_id absent from active results",
            passed=all_ok_archive,
            detail=" | ".join(detail_archive_parts),
            timing_ms=elapsed,
        )
        if not all_ok_archive:
            return run

        # ── Step 11: Verify vault frontmatter preserved at new path ───────────
        # D-06 / RO-64: the reconciler must NOT strip fqc_owner or fqc_type from
        # the file on disk when it archives the plugin row.  The vault file at the
        # new (outside) path must still have both fields.
        t0 = time.monotonic()
        try:
            doc_moved_disk = ctx.vault.read_file(doc_new_path)
            fm_moved = doc_moved_disk.frontmatter

            checks_fm: dict[str, bool] = {
                "RO-64: fqc_owner preserved in moved file after untrack archival": bool(
                    fm_moved.get("fqc_owner")
                ),
                "RO-64: fqc_type preserved in moved file after untrack archival": bool(
                    fm_moved.get("fqc_type")
                ),
            }
            all_ok_fm = all(checks_fm.values())
            detail_fm = ""
            if not all_ok_fm:
                failed = [k for k, v in checks_fm.items() if not v]
                detail_fm = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_owner={fm_moved.get('fqc_owner')!r}, "
                    f"fqc_type={fm_moved.get('fqc_type')!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-64: vault frontmatter preserved at new path — fqc_owner/fqc_type intact",
                passed=all_ok_fm,
                detail=detail_fm or (
                    f"fqc_owner={fm_moved.get('fqc_owner')!r}, "
                    f"fqc_type={fm_moved.get('fqc_type')!r}"
                ),
                timing_ms=elapsed,
            )
            if not all_ok_fm:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-64: vault frontmatter preserved at new path — fqc_owner/fqc_type intact",
                passed=False,
                detail=f"Exception reading moved file: {e} (path: {doc_new_path})",
                timing_ms=elapsed,
            )
            return run

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
            "Test: reconciliation untrack policy — `on_moved: untrack` accepted at "
            "registration and archives the plugin row on move (RO-64)."
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
                        help="Port range for managed server (default: 9100–9199).")
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

#!/usr/bin/env python3
"""
Test: Reconciliation resurrection with on_moved policy — when a document reappears at a path
      outside the plugin's watched folders, resurrection fires unconditionally first, then
      on_moved follow-up policy determines the final outcome:
        - on_moved: untrack  → row re-archived after resurrection (net: archived)
        - on_moved: keep-tracking → row stays active at the new out-of-folder path

Scenario:
    For each policy variant (two independent plugins):
    1.  Register plugin with on_added: auto-track and the relevant on_moved policy
    2.  Create a doc INSIDE the watched folder — trigger first reconciliation (auto-track)
    3.  Read the fqc_id written to frontmatter by auto-track
    4.  Delete the original file and trigger reconciliation to archive the plugin row
    5.  Wait for staleness window to expire
    6.  Re-create the file at a NEW PATH outside the watched folder with the SAME fqc_id
    7.  force_file_scan — index the new file
    8.  Trigger reconciliation:
        - untrack variant: plugin row ends up archived
        - keep-tracking variant: plugin row ends up active at the new path
    9.  Assert outcomes
    Cleanup is automatic.

Coverage points: RO-71, RO-72

Note: This test requires two 32s staleness sleeps per variant; total runtime ~80s.

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_resurrection_with_on_moved.py                            # existing server
    python test_reconciliation_resurrection_with_on_moved.py --managed                  # managed server
    python test_reconciliation_resurrection_with_on_moved.py --managed --json           # structured output
    python test_reconciliation_resurrection_with_on_moved.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-71", "RO-72"]

import argparse
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

TEST_NAME = "test_reconciliation_resurrection_with_on_moved"

# Plugin IDs for the two variants
PLUGIN_ID_UNTRACK = "recon_res_untrack"
PLUGIN_ID_KEEP = "recon_res_keep"

DOC_TYPE_ID_UNTRACK = "res_om_untrack"
DOC_TYPE_ID_KEEP = "res_om_keep"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_untrack(folder: str) -> str:
    """Plugin with on_added: auto-track and on_moved: untrack. Tests RO-71."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_UNTRACK}\n"
        "  name: Resurrection Untrack Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for resurrection + untrack on_moved\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Tracked items\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID_UNTRACK}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: items\n"
        "      on_modified: ignore\n"
        "      on_moved: untrack\n"
    )


def _build_schema_keep(folder: str) -> str:
    """Plugin with on_added: auto-track and on_moved: keep-tracking. Tests RO-72."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_KEEP}\n"
        "  name: Resurrection Keep-Tracking Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for resurrection + keep-tracking on_moved\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Tracked items\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID_KEEP}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: items\n"
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

    rid = run.run_id[:8]
    instance_untrack = f"test_ut_{rid}"
    instance_keep = f"test_kt_{rid}"

    base_folder = f"_test_recon_res_om/{rid}"
    folder_untrack = f"{base_folder}/watch_untrack"
    folder_keep = f"{base_folder}/watch_keep"
    # A folder outside both watched folders for resurrected files
    folder_outside = f"{base_folder}/outside"

    # Original file paths (inside watched folders)
    doc_untrack_path = f"{folder_untrack}/doc_ut_{rid}.md"
    doc_keep_path = f"{folder_keep}/doc_kt_{rid}.md"

    # Resurrected file paths (outside watched folders)
    doc_untrack_resurrected = f"{folder_outside}/doc_ut_res_{rid}.md"
    doc_keep_resurrected = f"{folder_outside}/doc_kt_res_{rid}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_untrack_registered = False
    plugin_keep_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a dedicated managed server — reconciliation requires clean DB state.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ---------------------------------------------------------------------------
        # Register both plugins
        # ---------------------------------------------------------------------------

        # ── Step 1: Register plugin UNTRACK (on_moved: untrack) ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_untrack = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_untrack(folder_untrack),
            plugin_instance=instance_untrack,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_untrack.expect_contains("registered successfully")
        run.step(
            label="register_plugin UNTRACK (on_moved: untrack) — RO-71 setup",
            passed=(reg_untrack.ok and reg_untrack.status == "pass"),
            detail=expectation_detail(reg_untrack) or reg_untrack.error or "",
            timing_ms=reg_untrack.timing_ms,
            tool_result=reg_untrack,
            server_logs=step_logs,
        )
        if not reg_untrack.ok:
            return run
        plugin_untrack_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_UNTRACK, instance_untrack)

        # ── Step 2: Register plugin KEEP (on_moved: keep-tracking) ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_keep = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_keep(folder_keep),
            plugin_instance=instance_keep,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_keep.expect_contains("registered successfully")
        run.step(
            label="register_plugin KEEP (on_moved: keep-tracking) — RO-72 setup",
            passed=(reg_keep.ok and reg_keep.status == "pass"),
            detail=expectation_detail(reg_keep) or reg_keep.error or "",
            timing_ms=reg_keep.timing_ms,
            tool_result=reg_keep,
            server_logs=step_logs,
        )
        if not reg_keep.ok:
            return run
        plugin_keep_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_KEEP, instance_keep)

        # ---------------------------------------------------------------------------
        # UNTRACK variant — setup: create, auto-track, delete, archive
        # ---------------------------------------------------------------------------

        # ── Step 3: Create doc in UNTRACK watched folder ──────────────────────────
        ctx.create_file(
            doc_untrack_path,
            title=f"Untrack Resurrection {rid}",
            body="## Content\n\nThis document will be deleted and resurrected outside watched folder.",
            tags=["fqc-test", "recon-res-om"],
        )
        ctx.cleanup.track_dir(folder_untrack)
        ctx.cleanup.track_dir(folder_outside)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_res_om")

        run.step(
            label="create doc in UNTRACK watched folder",
            passed=True,
            detail=f"Created: {doc_untrack_path}",
        )

        # ── Step 4: force_file_scan — index UNTRACK doc ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_ut = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index UNTRACK doc into fqc_documents",
            passed=scan1_ut.ok,
            detail=scan1_ut.error or "",
            timing_ms=scan1_ut.timing_ms,
            tool_result=scan1_ut,
            server_logs=step_logs,
        )
        if not scan1_ut.ok:
            return run

        # ── Step 5: First reconciliation — auto-tracks UNTRACK doc ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_ut = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_UNTRACK,
            plugin_instance=instance_untrack,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_ut.expect_contains("Auto-tracked")
        run.step(
            label="search_records — first reconciliation auto-tracks UNTRACK doc",
            passed=(prime_ut.ok and prime_ut.status == "pass"),
            detail=expectation_detail(prime_ut) or prime_ut.error or "",
            timing_ms=prime_ut.timing_ms,
            tool_result=prime_ut,
            server_logs=step_logs,
        )
        if not prime_ut.ok:
            return run

        # ── Step 6: Read fqc_id from UNTRACK doc frontmatter ─────────────────────
        t0 = time.monotonic()
        fqc_id_untrack = None
        try:
            disk_ut = ctx.vault.read_file(doc_untrack_path)
            fqc_id_untrack = disk_ut.frontmatter.get("fq_id")

            checks = {
                "fqc_id present in frontmatter after auto-track": fqc_id_untrack is not None,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. fqc_id={fqc_id_untrack!r}"

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from UNTRACK doc frontmatter",
                passed=all_ok,
                detail=detail or f"fqc_id={fqc_id_untrack!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from UNTRACK doc frontmatter",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7: Delete UNTRACK doc from disk ──────────────────────────────────
        t0 = time.monotonic()
        try:
            abs_ut = ctx.vault.vault_root / doc_untrack_path
            existed = abs_ut.is_file()
            abs_ut.unlink()
            gone = not abs_ut.is_file()

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
                label="physically delete UNTRACK original vault file",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="physically delete UNTRACK original vault file",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 8: force_file_scan — mark UNTRACK doc as missing ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_ut = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner marks UNTRACK doc as status=missing",
            passed=scan2_ut.ok,
            detail=scan2_ut.error or "",
            timing_ms=scan2_ut.timing_ms,
            tool_result=scan2_ut,
            server_logs=step_logs,
        )
        if not scan2_ut.ok:
            return run

        # ── Step 9: Second reconciliation — archives UNTRACK plugin row ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        del_recon_ut = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_UNTRACK,
            plugin_instance=instance_untrack,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        del_recon_summary_ut = _extract_recon_summary(del_recon_ut.text)
        archived_on_deletion = (
            "Archived" in del_recon_summary_ut
            or "archived" in del_recon_summary_ut.lower()
        )

        run.step(
            label="search_records — second reconciliation archives UNTRACK plugin row (deleted)",
            passed=(del_recon_ut.ok and archived_on_deletion),
            detail=(
                f"recon_summary={del_recon_summary_ut!r} | "
                f"archived_detected={archived_on_deletion}"
            ),
            timing_ms=del_recon_ut.timing_ms,
            tool_result=del_recon_ut,
            server_logs=step_logs,
        )
        if not del_recon_ut.ok or not archived_on_deletion:
            return run

        # ---------------------------------------------------------------------------
        # KEEP variant — setup: create, auto-track, delete, archive (parallel track)
        # ---------------------------------------------------------------------------

        # ── Step 10: Create doc in KEEP watched folder ────────────────────────────
        ctx.create_file(
            doc_keep_path,
            title=f"Keep Resurrection {rid}",
            body="## Content\n\nThis document will be deleted and resurrected outside watched folder.",
            tags=["fqc-test", "recon-res-om"],
        )
        ctx.cleanup.track_dir(folder_keep)

        run.step(
            label="create doc in KEEP watched folder",
            passed=True,
            detail=f"Created: {doc_keep_path}",
        )

        # ── Step 11: force_file_scan — index KEEP doc ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_kt = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index KEEP doc into fqc_documents",
            passed=scan1_kt.ok,
            detail=scan1_kt.error or "",
            timing_ms=scan1_kt.timing_ms,
            tool_result=scan1_kt,
            server_logs=step_logs,
        )
        if not scan1_kt.ok:
            return run

        # ── Step 12: First reconciliation — auto-tracks KEEP doc ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_kt = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_KEEP,
            plugin_instance=instance_keep,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_kt.expect_contains("Auto-tracked")
        run.step(
            label="search_records — first reconciliation auto-tracks KEEP doc",
            passed=(prime_kt.ok and prime_kt.status == "pass"),
            detail=expectation_detail(prime_kt) or prime_kt.error or "",
            timing_ms=prime_kt.timing_ms,
            tool_result=prime_kt,
            server_logs=step_logs,
        )
        if not prime_kt.ok:
            return run

        # ── Step 13: Read fqc_id from KEEP doc frontmatter ───────────────────────
        t0 = time.monotonic()
        fqc_id_keep = None
        try:
            disk_kt = ctx.vault.read_file(doc_keep_path)
            fqc_id_keep = disk_kt.frontmatter.get("fq_id")

            checks = {
                "fqc_id present in frontmatter after auto-track": fqc_id_keep is not None,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. fqc_id={fqc_id_keep!r}"

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from KEEP doc frontmatter",
                passed=all_ok,
                detail=detail or f"fqc_id={fqc_id_keep!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="capture fqc_id from KEEP doc frontmatter",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 14: Delete KEEP doc from disk ────────────────────────────────────
        t0 = time.monotonic()
        try:
            abs_kt = ctx.vault.vault_root / doc_keep_path
            existed = abs_kt.is_file()
            abs_kt.unlink()
            gone = not abs_kt.is_file()

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
                label="physically delete KEEP original vault file",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="physically delete KEEP original vault file",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 15: force_file_scan — mark KEEP doc as missing ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_kt = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner marks KEEP doc as status=missing",
            passed=scan2_kt.ok,
            detail=scan2_kt.error or "",
            timing_ms=scan2_kt.timing_ms,
            tool_result=scan2_kt,
            server_logs=step_logs,
        )
        if not scan2_kt.ok:
            return run

        # ── Step 16: Second reconciliation — archives KEEP plugin row ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        del_recon_kt = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_KEEP,
            plugin_instance=instance_keep,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        del_recon_summary_kt = _extract_recon_summary(del_recon_kt.text)
        archived_on_deletion_kt = (
            "Archived" in del_recon_summary_kt
            or "archived" in del_recon_summary_kt.lower()
        )

        run.step(
            label="search_records — second reconciliation archives KEEP plugin row (deleted)",
            passed=(del_recon_kt.ok and archived_on_deletion_kt),
            detail=(
                f"recon_summary={del_recon_summary_kt!r} | "
                f"archived_detected={archived_on_deletion_kt}"
            ),
            timing_ms=del_recon_kt.timing_ms,
            tool_result=del_recon_kt,
            server_logs=step_logs,
        )
        if not del_recon_kt.ok or not archived_on_deletion_kt:
            return run

        # ---------------------------------------------------------------------------
        # Wait for staleness window to expire before resurrection cycle
        # ---------------------------------------------------------------------------

        # ── Step 17: Wait 32s past staleness window ───────────────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (for resurrection cycle)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ---------------------------------------------------------------------------
        # Resurrect both docs at paths OUTSIDE their watched folders
        # ---------------------------------------------------------------------------

        # ── Step 18: Re-create UNTRACK doc at outside path with same fqc_id ───────
        t0 = time.monotonic()
        try:
            outside_abs = ctx.vault.vault_root / folder_outside
            outside_abs.mkdir(parents=True, exist_ok=True)

            ctx.vault.create_file(
                doc_untrack_resurrected,
                title=f"Untrack Resurrection {rid} (resurrected)",
                body="## Resurrected Content\n\nResurrected outside the watched folder.",
                tags=["fqc-test", "recon-res-om", "resurrected"],
                fqc_id=fqc_id_untrack,  # SAME fqc_id — key for resurrection matching
                extra_frontmatter={
                    "fq_owner": PLUGIN_ID_UNTRACK,
                    "fq_type": DOC_TYPE_ID_UNTRACK,
                },
            )
            ctx.cleanup.track_file(doc_untrack_resurrected)

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create UNTRACK doc OUTSIDE watched folder with same fqc_id (resurrection setup)",
                passed=True,
                detail=(
                    f"Created: {doc_untrack_resurrected} | "
                    f"fqc_id={fqc_id_untrack!r} (same as original) | "
                    f"path is outside watched folder: {folder_untrack!r}"
                ),
                timing_ms=elapsed,
            )

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create UNTRACK doc OUTSIDE watched folder with same fqc_id (resurrection setup)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 19: Re-create KEEP doc at outside path with same fqc_id ─────────
        t0 = time.monotonic()
        try:
            ctx.vault.create_file(
                doc_keep_resurrected,
                title=f"Keep Resurrection {rid} (resurrected)",
                body="## Resurrected Content\n\nResurrected outside the watched folder.",
                tags=["fqc-test", "recon-res-om", "resurrected"],
                fqc_id=fqc_id_keep,  # SAME fqc_id — key for resurrection matching
                extra_frontmatter={
                    "fq_owner": PLUGIN_ID_KEEP,
                    "fq_type": DOC_TYPE_ID_KEEP,
                },
            )
            ctx.cleanup.track_file(doc_keep_resurrected)

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create KEEP doc OUTSIDE watched folder with same fqc_id (resurrection setup)",
                passed=True,
                detail=(
                    f"Created: {doc_keep_resurrected} | "
                    f"fqc_id={fqc_id_keep!r} (same as original) | "
                    f"path is outside watched folder: {folder_keep!r}"
                ),
                timing_ms=elapsed,
            )

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="re-create KEEP doc OUTSIDE watched folder with same fqc_id (resurrection setup)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 20: force_file_scan — index both resurrected files ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — indexes both resurrected files into fqc_documents",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ---------------------------------------------------------------------------
        # Trigger resurrection reconciliation for both variants
        # ---------------------------------------------------------------------------

        # ── Step 21: Third reconciliation — UNTRACK plugin (resurrection + untrack) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_ut = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_UNTRACK,
            plugin_instance=instance_untrack,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_summary_ut = _extract_recon_summary(recon_ut.text)
        resurrection_detected_ut = (
            "resurrected" in recon_summary_ut.lower()
            or "resurrection" in recon_summary_ut.lower()
            or "Resurrected" in recon_summary_ut
        )

        run.step(
            label="search_records — third reconciliation for UNTRACK plugin (resurrection detected)",
            passed=(recon_ut.ok and resurrection_detected_ut),
            detail=(
                f"recon_summary={recon_summary_ut!r} | "
                f"resurrection_detected={resurrection_detected_ut}"
            ),
            timing_ms=recon_ut.timing_ms,
            tool_result=recon_ut,
            server_logs=step_logs,
        )
        if not recon_ut.ok or not resurrection_detected_ut:
            return run

        # ── Step 22: Third reconciliation — KEEP plugin (resurrection + keep-tracking) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_kt = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_KEEP,
            plugin_instance=instance_keep,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_summary_kt = _extract_recon_summary(recon_kt.text)
        resurrection_detected_kt = (
            "resurrected" in recon_summary_kt.lower()
            or "resurrection" in recon_summary_kt.lower()
            or "Resurrected" in recon_summary_kt
        )

        run.step(
            label="search_records — third reconciliation for KEEP plugin (resurrection detected)",
            passed=(recon_kt.ok and resurrection_detected_kt),
            detail=(
                f"recon_summary={recon_summary_kt!r} | "
                f"resurrection_detected={resurrection_detected_kt}"
            ),
            timing_ms=recon_kt.timing_ms,
            tool_result=recon_kt,
            server_logs=step_logs,
        )
        if not recon_kt.ok or not resurrection_detected_kt:
            return run

        # ---------------------------------------------------------------------------
        # RO-71: UNTRACK follow-up — wait for staleness to expire, then re-reconcile
        # so the reconciler classifies the active row at an out-of-folder path as 'moved'
        # and applies on_moved: untrack → archives the row.
        # ---------------------------------------------------------------------------

        # ── Step 23: Wait 32s for staleness window to expire (UNTRACK follow-up cycle) ─
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s for staleness window expiry (UNTRACK on_moved follow-up cycle)",
            passed=True,
            detail=f"Slept {elapsed}ms — after resurrection, need a new reconciliation cycle for on_moved to apply",
            timing_ms=elapsed,
        )

        # ── Step 24: Fourth reconciliation — UNTRACK plugin (on_moved: untrack fires) ─
        # Now the plugin row is active, the doc is at an out-of-folder path, and
        # pluginRow.path has been updated to the new path from the resurrection cycle.
        # Wait — resurrection sets path = ref.path (the new path). So after resurrection
        # the plugin row's path == fqcDoc.path. That means the 'moved' classification
        # (which requires pluginRow.path != fqcDoc.path) won't fire.
        #
        # But: the doc IS outside the watched folder. With on_moved: untrack, does the
        # reconciler re-check the path against the watched folder? Let's trigger and observe.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_ut2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_UNTRACK,
            plugin_instance=instance_untrack,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_summary_ut2 = _extract_recon_summary(recon_ut2.text)

        run.step(
            label="search_records — fourth reconciliation for UNTRACK plugin (on_moved follow-up)",
            passed=recon_ut2.ok,
            detail=(
                f"recon_summary={recon_summary_ut2!r} | "
                f"response_preview={recon_ut2.text[:300]!r}"
            ),
            timing_ms=recon_ut2.timing_ms,
            tool_result=recon_ut2,
            server_logs=step_logs,
        )
        if not recon_ut2.ok:
            return run

        # ---------------------------------------------------------------------------
        # Assert final outcomes
        # ---------------------------------------------------------------------------

        # ── Step 25: RO-71 — UNTRACK: plugin row is archived after resurrection ───
        # on_moved: untrack → resurrection un-archives the row (cycle 3), then the
        # on_moved policy fires in the follow-up cycle (cycle 4) when the reconciler
        # sees the active row at an out-of-folder path and classifies it as 'moved'.
        # net result: plugin row is archived.
        #
        # NOTE: If the 'moved' classification requires pluginRow.path != fqcDoc.path,
        # and resurrection already set pluginRow.path = new path, then 'moved' won't
        # classify in cycle 4 (paths match). In that case RO-71 behavior (the spec's
        # claim that untrack re-archives) may not be implemented — which is a defect.
        # We check: is the row archived after cycle 4? If still active, that's a defect.
        archived_after_cycle4 = (
            "Archived" in recon_summary_ut2
            or "archived" in recon_summary_ut2.lower()
        )
        # Also check: is fqc_id absent from the results (indicating archived)?
        ut_id_in_results = bool(fqc_id_untrack and fqc_id_untrack in recon_ut2.text)

        t0 = time.monotonic()
        checks_71: dict[str, bool] = {
            "RO-71: UNTRACK plugin row archived after resurrection+on_moved follow-up": archived_after_cycle4,
            "RO-71: fqc_id not in active search results after archival": not ut_id_in_results,
        }
        all_ok_71 = all(checks_71.values())
        detail_71_parts = []
        if not all_ok_71:
            failed = [k for k, v in checks_71.items() if not v]
            detail_71_parts.append(f"Failed: {', '.join(failed)}")
        detail_71_parts.append(
            f"archived_after_cycle4={archived_after_cycle4} | "
            f"ut_id_in_results={ut_id_in_results} | "
            f"recon_summary_ut2={recon_summary_ut2!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-71: UNTRACK — resurrection+untrack policy results in archived plugin row",
            passed=all_ok_71,
            detail=" | ".join(detail_71_parts),
            timing_ms=elapsed,
        )
        if not all_ok_71:
            return run

        # ── Step 26: RO-72 — KEEP: plugin row is active at new out-of-folder path ──
        # on_moved: keep-tracking → resurrection un-archives the row AND keeps it active
        # at the new path (outside the watched folder).
        # The fqc_id should appear in search results (row active).
        t0 = time.monotonic()

        # Verify fqc_id is in search results from the resurrection reconciliation (step 22)
        fqc_id_keep_in_results = bool(fqc_id_keep and fqc_id_keep in recon_kt.text)
        # Verify the row shows status active from search results (not archived)
        kt_archived_in_summary = (
            "Archived" in recon_summary_kt
            and fqc_id_keep not in recon_kt.text
        ) if fqc_id_keep else False
        kt_is_active = fqc_id_keep_in_results and not kt_archived_in_summary

        checks_72: dict[str, bool] = {
            "RO-72: KEEP plugin row is active after resurrection+keep-tracking (fqc_id in search results)": kt_is_active,
            "RO-72: fqc_id present in search results (active row)": fqc_id_keep_in_results,
        }
        all_ok_72 = all(checks_72.values())
        detail_72_parts = []
        if not all_ok_72:
            failed = [k for k, v in checks_72.items() if not v]
            detail_72_parts.append(f"Failed: {', '.join(failed)}")
        detail_72_parts.append(
            f"kt_is_active={kt_is_active} | "
            f"fqc_id_in_results={fqc_id_keep_in_results} | "
            f"recon_summary_kt={recon_summary_kt!r} | "
            f"response_preview={recon_kt.text[:200]!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-72: KEEP — resurrection+keep-tracking policy keeps plugin row active at new path",
            passed=all_ok_72,
            detail=" | ".join(detail_72_parts),
            timing_ms=elapsed,
        )

        # ---------------------------------------------------------------------------
        # Cleanup: unregister both plugins
        # ---------------------------------------------------------------------------
        for plugin_id, instance_name, registered in [
            (PLUGIN_ID_UNTRACK, instance_untrack, plugin_untrack_registered),
            (PLUGIN_ID_KEEP, instance_keep, plugin_keep_registered),
        ]:
            if registered:
                try:
                    teardown = ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=plugin_id,
                        plugin_instance=instance_name,
                        confirm_destroy=True,
                    )
                    if not teardown.ok:
                        ctx.cleanup_errors.append(
                            f"unregister_plugin failed for {plugin_id}/{instance_name}: "
                            f"{teardown.error or teardown.text}"
                        )
                except Exception as e:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin exception for {plugin_id}/{instance_name}: {e}"
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
                    f"Plugins retained: {PLUGIN_ID_UNTRACK}/{instance_untrack}, "
                    f"{PLUGIN_ID_KEEP}/{instance_keep}"
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
            "Test: reconciliation resurrection with on_moved policy — "
            "untrack re-archives row after resurrection; keep-tracking keeps row active."
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

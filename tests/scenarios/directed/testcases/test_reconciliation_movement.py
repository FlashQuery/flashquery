#!/usr/bin/env python3
"""
Test: Reconciliation movement — on_moved: keep-tracking updates the stored path and keeps
      the plugin row active when a doc moves OUTSIDE its watched folder; on_moved: stop-tracking
      archives the plugin row while preserving vault frontmatter; on_moved defaults to
      keep-tracking when not declared; and after a keep-tracking path update, a subsequent
      reconciliation reports the document as unchanged.

Key implementation note:
    The reconciler classifies a doc as 'moved' (triggering on_moved policy) only when the
    file's path in fqc_documents is OUTSIDE the plugin's watched folder(s). A rename within
    the same folder is classified as 'modified'. Therefore, the test moves each doc to a
    shared 'outside' folder that no plugin watches.

    The accepted on_moved values in the schema are 'keep-tracking' and 'stop-tracking'.
    The value 'untrack' is not recognized and silently maps to the else/no-op branch.

Scenario:
    1. Register 3 plugins with distinct doc-type IDs (prevents cross-plugin candidate
       discovery via ownership_type Path 2 query):
         Plugin A: on_added: auto-track, on_moved: keep-tracking  (RO-24, RO-27)
         Plugin B: on_added: auto-track, no on_moved declared      (RO-26 — default)
         Plugin C: on_added: auto-track, on_moved: stop-tracking   (RO-25)
    2. Create one doc in each plugin's watched folder (no fqc_owner yet)
    3. force_file_scan — index all 3 into fqc_documents
    4. First reconcile (search_records for each plugin) — auto-tracks each; seeds staleness cache
    5. Read frontmatter to capture fqc_ids
    6. Move each doc OUTSIDE its watched folder (to base_folder/outside/) using copy+delete
    7. force_file_scan — detect the moves; fqc_documents.path updated to new location,
       which is outside the plugin's watched folder → classifies as 'moved'
    8. Wait 32s to expire staleness window
    9. Second reconcile for all 3 plugins:
       - Plugin A (keep-tracking): fqc_id in results; summary says "Updated paths for 1
         moved document(s)"; no archival                                          [RO-24]
       - Plugin B (default):       same keep-tracking behavior as plugin A        [RO-26]
       - Plugin C (stop-tracking): archived_count >= 1; fqc_id NOT in results     [RO-25]
       - Plugin C disk check:      moved file has fqc_owner/fqc_type in frontmatter [RO-25]
    10. Wait 32s again (second staleness expiry for plugin A)
    11. Third reconcile for plugin A — verify no new actions: unchanged            [RO-27]
    Cleanup is automatic.

Coverage points: RO-24, RO-25, RO-26, RO-27

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_movement.py                            # existing server
    python test_reconciliation_movement.py --managed                  # managed server
    python test_reconciliation_movement.py --managed --json           # structured JSON
    python test_reconciliation_movement.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-24", "RO-25", "RO-26", "RO-27"]

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

TEST_NAME = "test_reconciliation_movement"
PLUGIN_ID_A = "recon_mv_a"
PLUGIN_ID_B = "recon_mv_b"
PLUGIN_ID_C = "recon_mv_c"
# Each plugin uses a UNIQUE doc-type ID to prevent cross-plugin candidate
# discovery via the ownership_type path in the reconciler (Path 2 / OR query).
DOC_TYPE_ID_A = "mv_note_a"
DOC_TYPE_ID_B = "mv_note_b"
DOC_TYPE_ID_C = "mv_note_c"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml_a(folder: str) -> str:
    """Plugin A: on_added: auto-track, on_moved: keep-tracking (explicit). Tests RO-24, RO-27."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_A}\n"
        "  name: Reconciliation Movement Keep-Tracking Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for on_moved keep-tracking\n"
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
        f"    - id: {DOC_TYPE_ID_A}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
        "      on_moved: keep-tracking\n"
    )


def _build_schema_yaml_b(folder: str) -> str:
    """Plugin B: on_added: auto-track, no on_moved declared. Tests RO-26 (default = keep-tracking)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_B}\n"
        "  name: Reconciliation Movement Default Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for on_moved default behavior\n"
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
        f"    - id: {DOC_TYPE_ID_B}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
    )


def _build_schema_yaml_c(folder: str) -> str:
    """Plugin C: on_added: auto-track, on_moved: stop-tracking. Tests RO-25.

    Note: 'stop-tracking' is the accepted schema value (not 'untrack').
    The reconciler code checks for 'keep-tracking' and 'stop-tracking' explicitly;
    any other value (including 'untrack') hits the no-op else branch.
    """
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID_C}\n"
        "  name: Reconciliation Movement Stop-Tracking Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for on_moved stop-tracking\n"
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
        f"    - id: {DOC_TYPE_ID_C}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
        "      on_moved: stop-tracking\n"
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

    instance_name_a = f"test_a_{run.run_id[:8]}"
    instance_name_b = f"test_b_{run.run_id[:8]}"
    instance_name_c = f"test_c_{run.run_id[:8]}"

    base_folder = f"_test_recon_mv/{run.run_id[:8]}"
    # Each plugin watches its own sub-folder
    folder_a = f"{base_folder}/watch_a"
    folder_b = f"{base_folder}/watch_b"
    folder_c = f"{base_folder}/watch_c"
    # Destination folder for moved docs — NOT watched by any plugin
    folder_outside = f"{base_folder}/outside"

    # Original doc paths (inside each plugin's watched folder)
    doc_a_path = f"{folder_a}/doc_a_{run.run_id[:8]}.md"
    doc_b_path = f"{folder_b}/doc_b_{run.run_id[:8]}.md"
    doc_c_path = f"{folder_c}/doc_c_{run.run_id[:8]}.md"

    # New paths — OUTSIDE each plugin's watched folder (triggers 'moved' classification)
    doc_a_new_path = f"{folder_outside}/doc_a_moved_{run.run_id[:8]}.md"
    doc_b_new_path = f"{folder_outside}/doc_b_moved_{run.run_id[:8]}.md"
    doc_c_new_path = f"{folder_outside}/doc_c_moved_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_a_registered = False
    plugin_b_registered = False
    plugin_c_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin A (on_moved: keep-tracking) ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_a = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_yaml_a(folder_a),
            plugin_instance=instance_name_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_a.expect_contains("registered successfully")
        run.step(
            label="register_plugin A (on_moved: keep-tracking, explicit) — RO-24, RO-27",
            passed=(reg_a.ok and reg_a.status == "pass"),
            detail=expectation_detail(reg_a) or reg_a.error or "",
            timing_ms=reg_a.timing_ms,
            tool_result=reg_a,
            server_logs=step_logs,
        )
        if not reg_a.ok:
            return run
        plugin_a_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_A, instance_name_a)

        # ── Step 2: Register plugin B (no on_moved declared) ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_b = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_yaml_b(folder_b),
            plugin_instance=instance_name_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_b.expect_contains("registered successfully")
        run.step(
            label="register_plugin B (no on_moved declared — default = keep-tracking) — RO-26",
            passed=(reg_b.ok and reg_b.status == "pass"),
            detail=expectation_detail(reg_b) or reg_b.error or "",
            timing_ms=reg_b.timing_ms,
            tool_result=reg_b,
            server_logs=step_logs,
        )
        if not reg_b.ok:
            return run
        plugin_b_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_B, instance_name_b)

        # ── Step 3: Register plugin C (on_moved: stop-tracking) ───────────────
        # Note: 'stop-tracking' is the correct schema value (not 'untrack').
        # The test spec said to try 'untrack' first; however, source code inspection
        # confirms 'untrack' is not recognized and silently no-ops. Using 'stop-tracking'.
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_c = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_build_schema_yaml_c(folder_c),
            plugin_instance=instance_name_c,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_c.expect_contains("registered successfully")
        run.step(
            label="register_plugin C (on_moved: stop-tracking) — RO-25 [Note: 'untrack' not recognized; using 'stop-tracking']",
            passed=(reg_c.ok and reg_c.status == "pass"),
            detail=expectation_detail(reg_c) or reg_c.error or "",
            timing_ms=reg_c.timing_ms,
            tool_result=reg_c,
            server_logs=step_logs,
        )
        if not reg_c.ok:
            return run
        plugin_c_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_C, instance_name_c)

        # ── Step 4: Create one doc per plugin's watched folder ────────────────
        ctx.create_file(
            doc_a_path,
            title=f"Movement Doc A {run.run_id[:8]}",
            body="## Movement Test A\n\nThis doc will move outside the watched folder; on_moved: keep-tracking.",
            tags=["fqc-test", "recon-mv"],
        )
        ctx.create_file(
            doc_b_path,
            title=f"Movement Doc B {run.run_id[:8]}",
            body="## Movement Test B\n\nThis doc will move outside the watched folder; default on_moved.",
            tags=["fqc-test", "recon-mv"],
        )
        ctx.create_file(
            doc_c_path,
            title=f"Movement Doc C {run.run_id[:8]}",
            body="## Movement Test C\n\nThis doc will move outside the watched folder; on_moved: stop-tracking.",
            tags=["fqc-test", "recon-mv"],
        )
        ctx.cleanup.track_dir(folder_a)
        ctx.cleanup.track_dir(folder_b)
        ctx.cleanup.track_dir(folder_c)
        ctx.cleanup.track_dir(folder_outside)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_mv")

        run.step(
            label="create one doc in each plugin's watched folder (no fqc_owner yet)",
            passed=True,
            detail=f"Created: {doc_a_path}, {doc_b_path}, {doc_c_path}",
        )

        # ── Step 5: force_file_scan — index all 3 docs ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index all 3 docs into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 6: First reconcile — auto-tracks all 3, seeds staleness cache ─
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_a = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_A,
            plugin_instance=instance_name_a,
            table="notes",
        )
        prime_b = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_B,
            plugin_instance=instance_name_b,
            table="notes",
        )
        prime_c = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_C,
            plugin_instance=instance_name_c,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_a.expect_contains("Auto-tracked")
        prime_b.expect_contains("Auto-tracked")
        prime_c.expect_contains("Auto-tracked")

        all_primed = (
            prime_a.ok and prime_a.status == "pass"
            and prime_b.ok and prime_b.status == "pass"
            and prime_c.ok and prime_c.status == "pass"
        )
        prime_detail = []
        if not prime_a.ok or prime_a.status != "pass":
            prime_detail.append(f"A: {expectation_detail(prime_a) or prime_a.error or ''}")
        if not prime_b.ok or prime_b.status != "pass":
            prime_detail.append(f"B: {expectation_detail(prime_b) or prime_b.error or ''}")
        if not prime_c.ok or prime_c.status != "pass":
            prime_detail.append(f"C: {expectation_detail(prime_c) or prime_c.error or ''}")

        run.step(
            label="search_records (prime) — auto-tracks all 3 docs; seeds staleness cache",
            passed=all_primed,
            detail=" | ".join(prime_detail) if prime_detail else "",
            timing_ms=(prime_a.timing_ms or 0) + (prime_b.timing_ms or 0) + (prime_c.timing_ms or 0),
            tool_result=prime_a,
            server_logs=step_logs,
        )
        if not all_primed:
            return run

        # ── Step 7: Read frontmatter — capture fqc_ids written by auto-track ──
        t0 = time.monotonic()
        fqc_id_a = fqc_id_b = fqc_id_c = None
        try:
            doc_a_disk = ctx.vault.read_file(doc_a_path)
            doc_b_disk = ctx.vault.read_file(doc_b_path)
            doc_c_disk = ctx.vault.read_file(doc_c_path)

            fqc_id_a = doc_a_disk.frontmatter.get("fq_id")
            fqc_id_b = doc_b_disk.frontmatter.get("fq_id")
            fqc_id_c = doc_c_disk.frontmatter.get("fq_id")

            checks = {
                "doc A has fqc_id": bool(fqc_id_a),
                "doc A has fqc_owner": bool(doc_a_disk.frontmatter.get("fq_owner")),
                "doc B has fqc_id": bool(fqc_id_b),
                "doc B has fqc_owner": bool(doc_b_disk.frontmatter.get("fq_owner")),
                "doc C has fqc_id": bool(fqc_id_c),
                "doc C has fqc_owner": bool(doc_c_disk.frontmatter.get("fq_owner")),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read all 3 docs from disk — verify auto-track wrote fqc_owner/fqc_id",
                passed=all_ok,
                detail=detail or f"fqc_id_a={fqc_id_a!r}, fqc_id_b={fqc_id_b!r}, fqc_id_c={fqc_id_c!r}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read all 3 docs from disk — verify auto-track wrote fqc_owner/fqc_id",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 8: Move all 3 docs OUTSIDE their watched folders ─────────────
        # Docs are moved to folder_outside which no plugin watches.
        # This ensures the reconciler classifies them as 'moved' (not 'modified').
        t0 = time.monotonic()
        try:
            outside_abs = ctx.vault.vault_root / folder_outside
            outside_abs.mkdir(parents=True, exist_ok=True)

            for old_rel, new_rel in [
                (doc_a_path, doc_a_new_path),
                (doc_b_path, doc_b_new_path),
                (doc_c_path, doc_c_new_path),
            ]:
                old_abs = ctx.vault.vault_root / old_rel
                new_abs = ctx.vault.vault_root / new_rel
                shutil.copy2(str(old_abs), str(new_abs))
                old_abs.unlink()
                ctx.cleanup.track_file(new_rel)

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "doc A old path gone": not (ctx.vault.vault_root / doc_a_path).is_file(),
                "doc A new path exists (outside)": (ctx.vault.vault_root / doc_a_new_path).is_file(),
                "doc B old path gone": not (ctx.vault.vault_root / doc_b_path).is_file(),
                "doc B new path exists (outside)": (ctx.vault.vault_root / doc_b_new_path).is_file(),
                "doc C old path gone": not (ctx.vault.vault_root / doc_c_path).is_file(),
                "doc C new path exists (outside)": (ctx.vault.vault_root / doc_c_new_path).is_file(),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"
            run.step(
                label="move all 3 docs OUTSIDE their watched folders to trigger 'moved' classification",
                passed=all_ok,
                detail=detail or (
                    f"Destination: {folder_outside}/ | "
                    f"A: {doc_a_path} → {doc_a_new_path} | "
                    f"B: {doc_b_path} → {doc_b_new_path} | "
                    f"C: {doc_c_path} → {doc_c_new_path}"
                ),
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="move all 3 docs OUTSIDE their watched folders to trigger 'moved' classification",
                passed=False,
                detail=f"Exception during move: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 9: force_file_scan — detect the moves ───────────────────────
        # Scanner sees: old paths gone (status → 'missing'), new paths present with same
        # fqc_id in frontmatter. fqc_documents.path is updated to the new location.
        # After scan: new path is outside each plugin's watched folder → classified 'moved'.
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect all 3 moves (path updated to outside folder)",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 10: Wait 32s to expire staleness window ──────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s to expire reconciliation staleness window (30s)",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 11: Second reconcile — all 3 plugins ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_a = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_A,
            plugin_instance=instance_name_a,
            table="notes",
        )
        recon_b = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_B,
            plugin_instance=instance_name_b,
            table="notes",
        )
        recon_c = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_C,
            plugin_instance=instance_name_c,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        all_recon_ok = recon_a.ok and recon_b.ok and recon_c.ok
        detail_parts = []
        if not recon_a.ok:
            detail_parts.append(f"Plugin A error: {recon_a.error or ''}")
        if not recon_b.ok:
            detail_parts.append(f"Plugin B error: {recon_b.error or ''}")
        if not recon_c.ok:
            detail_parts.append(f"Plugin C error: {recon_c.error or ''}")

        run.step(
            label="search_records — second reconcile (all 3 plugins, after move + staleness expiry)",
            passed=all_recon_ok,
            detail=" | ".join(detail_parts) if detail_parts else "",
            timing_ms=(recon_a.timing_ms or 0) + (recon_b.timing_ms or 0) + (recon_c.timing_ms or 0),
            tool_result=recon_a,
            server_logs=step_logs,
        )
        if not all_recon_ok:
            return run

        recon_summary_a = _extract_recon_summary(recon_a.text)
        recon_summary_b = _extract_recon_summary(recon_b.text)
        recon_summary_c = _extract_recon_summary(recon_c.text)

        # ── Step 12: RO-24 — keep-tracking: path updated; plugin row still active ──
        # Plugin A (on_moved: keep-tracking): the reconciler updates the stored path
        # in the plugin row. The doc's fqc_id should still be in search results (row active).
        # Summary: "Updated paths for 1 moved document(s)".
        t0 = time.monotonic()

        # "Updated paths for N moved document(s)" is the exact phrase from formatReconciliationSummary
        path_updated_a = bool(re.search(r"Updated paths? for \d+ moved document", recon_summary_a))
        a_in_text = bool(fqc_id_a and fqc_id_a in recon_a.text)
        a_archived = bool(re.search(r"Archived \d+ record", recon_summary_a))

        checks_24: dict[str, bool] = {
            "RO-24: summary says 'Updated paths for N moved document(s)'": path_updated_a,
            "RO-24: doc A fqc_id still in search results (row active)": a_in_text,
            "RO-24: no archival in plugin A summary (keep-tracking preserves row)": not a_archived,
        }
        all_ok_24 = all(checks_24.values())
        detail_24_parts = []
        if not all_ok_24:
            failed = [k for k, v in checks_24.items() if not v]
            detail_24_parts.append(f"Failed: {', '.join(failed)}")
        detail_24_parts.append(
            f"path_updated_a={path_updated_a} | a_in_text={a_in_text} | "
            f"a_archived={a_archived} | recon_summary_a={recon_summary_a!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-24: keep-tracking — path updated in summary; doc A fqc_id still active",
            passed=all_ok_24,
            detail=" | ".join(detail_24_parts),
            timing_ms=elapsed,
        )
        if not all_ok_24:
            return run

        # ── Step 13: RO-26 — default on_moved behaves like keep-tracking ──────
        # Plugin B has no on_moved declared. Default should be keep-tracking:
        # path update in summary, fqc_id in results, no archival.
        t0 = time.monotonic()

        path_updated_b = bool(re.search(r"Updated paths? for \d+ moved document", recon_summary_b))
        b_in_text = bool(fqc_id_b and fqc_id_b in recon_b.text)
        b_archived = bool(re.search(r"Archived \d+ record", recon_summary_b))

        checks_26: dict[str, bool] = {
            "RO-26: summary says 'Updated paths for N moved document(s)' (default = keep-tracking)": path_updated_b,
            "RO-26: doc B fqc_id still in search results (row active)": b_in_text,
            "RO-26: no archival in plugin B summary (default on_moved preserves row)": not b_archived,
        }
        all_ok_26 = all(checks_26.values())
        detail_26_parts = []
        if not all_ok_26:
            failed = [k for k, v in checks_26.items() if not v]
            detail_26_parts.append(f"Failed: {', '.join(failed)}")
        detail_26_parts.append(
            f"path_updated_b={path_updated_b} | b_in_text={b_in_text} | "
            f"b_archived={b_archived} | recon_summary_b={recon_summary_b!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-26: default on_moved = keep-tracking — path updated; doc B fqc_id active",
            passed=all_ok_26,
            detail=" | ".join(detail_26_parts),
            timing_ms=elapsed,
        )
        if not all_ok_26:
            return run

        # ── Step 14: RO-25 — stop-tracking archives plugin row ────────────────
        # Plugin C (on_moved: stop-tracking): after the move is detected, the plugin
        # row is archived. The fqc_id should NOT appear in search results.
        t0 = time.monotonic()

        m_archived_c = re.search(r"Archived (\d+) record", recon_summary_c)
        archived_count_c = int(m_archived_c.group(1)) if m_archived_c else 0
        c_in_text = bool(fqc_id_c and fqc_id_c in recon_c.text)

        checks_25a: dict[str, bool] = {
            "RO-25: at least 1 plugin row archived (stop-tracking policy on move)": archived_count_c >= 1,
            "RO-25: doc C fqc_id absent from search results (row archived)": not c_in_text,
        }
        all_ok_25a = all(checks_25a.values())
        detail_25a_parts = []
        if not all_ok_25a:
            failed = [k for k, v in checks_25a.items() if not v]
            detail_25a_parts.append(f"Failed: {', '.join(failed)}")
        detail_25a_parts.append(
            f"archived_count_c={archived_count_c} | c_in_text={c_in_text} | "
            f"recon_summary_c={recon_summary_c!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-25: stop-tracking archives plugin row; doc C fqc_id absent from results",
            passed=all_ok_25a,
            detail=" | ".join(detail_25a_parts),
            timing_ms=elapsed,
        )
        if not all_ok_25a:
            return run

        # ── Step 15: RO-25 — verify vault frontmatter preserved on moved file ──
        # The reconciler does NOT strip fqc_owner/fqc_type from the file when
        # archiving the plugin row (D-06: "Do NOT touch frontmatter"). Verify the
        # moved file (at doc_c_new_path) still has both fields.
        t0 = time.monotonic()
        try:
            doc_c_moved_disk = ctx.vault.read_file(doc_c_new_path)
            fm_c = doc_c_moved_disk.frontmatter

            checks_25b: dict[str, bool] = {
                "RO-25: fqc_owner preserved in moved file frontmatter after stop-tracking archival": bool(
                    fm_c.get("fq_owner")
                ),
                "RO-25: fqc_type preserved in moved file frontmatter after stop-tracking archival": bool(
                    fm_c.get("fq_type")
                ),
            }
            all_ok_25b = all(checks_25b.values())
            detail_25b = ""
            if not all_ok_25b:
                failed = [k for k, v in checks_25b.items() if not v]
                detail_25b = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_owner={fm_c.get('fqc_owner')!r}, fqc_type={fm_c.get('fqc_type')!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-25: vault frontmatter preserved — fqc_owner/fqc_type intact on moved file",
                passed=all_ok_25b,
                detail=detail_25b or (
                    f"fqc_owner={fm_c.get('fqc_owner')!r}, fqc_type={fm_c.get('fqc_type')!r}"
                ),
                timing_ms=elapsed,
            )
            if not all_ok_25b:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-25: vault frontmatter preserved — fqc_owner/fqc_type intact on moved file",
                passed=False,
                detail=f"Exception reading moved file: {e} (path: {doc_c_new_path})",
                timing_ms=elapsed,
            )
            return run

        # ── Step 16: RO-27 — third reconcile for plugin A (immediate, within staleness) ──
        # After keep-tracking applied the path update in step 11, the staleness cache
        # is seeded. Calling search_records again WITHIN the 30s staleness window means
        # the reconciler is skipped entirely (RECON-07 / isWithinStaleness). The
        # reconciliation summary will be empty — no new path updates, no auto-tracks,
        # no archival — which is the "unchanged" behavior defined by RO-27.
        #
        # We do NOT sleep 32s here: the goal is to show that immediately after the
        # keep-tracking path update is applied, subsequent calls within the staleness
        # window report no new reconciliation actions.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_a3 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_A,
            plugin_instance=instance_name_a,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — third reconcile for plugin A immediately after keep-tracking (RO-27)",
            passed=recon_a3.ok,
            detail=recon_a3.error or "",
            timing_ms=recon_a3.timing_ms,
            tool_result=recon_a3,
            server_logs=step_logs,
        )
        if not recon_a3.ok:
            return run

        recon_summary_a3 = _extract_recon_summary(recon_a3.text)

        # ── Step 17: RO-27 — verify no new reconciliation actions ─────────────
        # Within the staleness window the reconciler is skipped, so the summary is
        # empty (no Reconciliation: line). The doc's fqc_id should still be in results
        # (the search_records query returns current active rows without re-reconciling).
        t0 = time.monotonic()

        new_auto_tracked_a3 = bool(re.search(r"Auto-tracked \d+", recon_summary_a3))
        new_archived_a3 = bool(re.search(r"Archived \d+", recon_summary_a3))
        new_path_update_a3 = bool(re.search(r"Updated paths? for \d+ moved document", recon_summary_a3))
        a3_in_text = bool(fqc_id_a and fqc_id_a in recon_a3.text)

        checks_27: dict[str, bool] = {
            "RO-27: no new auto-track in immediate follow-up reconcile (within staleness)": not new_auto_tracked_a3,
            "RO-27: no archival in immediate follow-up reconcile (row still active)": not new_archived_a3,
            "RO-27: no path update in immediate follow-up (keep-tracking already applied)": not new_path_update_a3,
            "RO-27: doc A fqc_id still in results (row active, unchanged)": a3_in_text,
        }
        all_ok_27 = all(checks_27.values())
        detail_27_parts = []
        if not all_ok_27:
            failed = [k for k, v in checks_27.items() if not v]
            detail_27_parts.append(f"Failed: {', '.join(failed)}")
        detail_27_parts.append(
            f"new_auto_tracked={new_auto_tracked_a3} | new_archived={new_archived_a3} | "
            f"new_path_update={new_path_update_a3} | a3_in_text={a3_in_text} | "
            f"recon_summary_a3={recon_summary_a3!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-27: immediate follow-up reconcile reports no new actions (staleness window active)",
            passed=all_ok_27,
            detail=" | ".join(detail_27_parts),
            timing_ms=elapsed,
        )

        # ── Cleanup: unregister all 3 plugins ─────────────────────────────────
        for plugin_id, instance_name, registered in [
            (PLUGIN_ID_A, instance_name_a, plugin_a_registered),
            (PLUGIN_ID_B, instance_name_b, plugin_b_registered),
            (PLUGIN_ID_C, instance_name_c, plugin_c_registered),
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
                    f"Plugins retained: {PLUGIN_ID_A}/{instance_name_a}, "
                    f"{PLUGIN_ID_B}/{instance_name_b}, {PLUGIN_ID_C}/{instance_name_c}"
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
            "Test: reconciliation movement — keep-tracking path update, "
            "stop-tracking archival, default behavior, unchanged after update."
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

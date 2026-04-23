#!/usr/bin/env python3
"""
Test: Frontmatter-based discovery — global type registry (RO-31) and scanner
      ownership column sync (RO-32).

Scenario A — RO-31 (Global type registry discovery):
    1. Register a plugin watching a specific folder.
    2. Create a doc OUTSIDE the watched folder, with fqc_type and fqc_owner
       matching the plugin in its frontmatter.
    3. Scan vault to index the outside doc into fqc_documents.
    4. Trigger reconciliation via search_records — global type registry should
       discover the doc and auto-track it even though it's outside the watched
       folder.
    5. Verify: reconciliation summary contains "Auto-tracked".

Scenario B — RO-32 (Scanner syncs ownership columns on every pass):
    1. Create a second doc OUTSIDE the watched folder with the same plugin's
       fqc_owner and fqc_type frontmatter fields.
    2. Scan — scanner writes fqc_owner/fqc_type to ownership_plugin_id/type cols.
    3. Trigger reconciliation (prime) — doc is tracked.
    4. Wait 32s past the staleness window.
    5. Rewrite doc_b's frontmatter so fqc_owner points to a different plugin.
    6. Scan again — scanner reads new frontmatter, updates ownership_plugin_id
       in fqc_documents.
    7. Trigger reconciliation — doc_b should appear as disassociated/archived
       because ownership_plugin_id now points to a different plugin.
    8. Remove fqc_owner/fqc_type entirely from a doc's frontmatter (yaml.dump
       + tmp-rename pattern).
    9. Scan — ownership_plugin_id/type set to NULL.
    10. Wait 32s + reconcile — any active plugin row for that doc should now be
        classified as disassociated (NULL owner clears linkage).

Coverage points: RO-31, RO-32

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_frontmatter_discovery.py                            # existing server
    python test_reconciliation_frontmatter_discovery.py --managed                  # managed server
    python test_reconciliation_frontmatter_discovery.py --managed --json           # structured output
    python test_reconciliation_frontmatter_discovery.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-31", "RO-32"]

import argparse
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_frontmatter_discovery"
PLUGIN_ID = "recon_fd"
DOC_TYPE_ID = "fd_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(watched_folder: str) -> str:
    """Plugin schema with auto-track policy watching a specific folder."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Frontmatter Discovery Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for frontmatter-based discovery\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Notes tracked via frontmatter discovery\n"
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


def _remove_fqc_ownership(ctx: TestContext, relative_path: str) -> tuple[bool, str]:
    """
    Remove fqc_owner and fqc_type from a file's frontmatter entirely.

    Uses the yaml.dump + tmp-rename pattern (same as the disassociation test)
    because write_frontmatter() merges — it cannot delete keys.

    Returns (success, detail_message).
    """
    import yaml
    try:
        doc = ctx.vault.read_file(relative_path)
        fm_kept = {
            k: v for k, v in doc.frontmatter.items()
            if k not in (FM.OWNER, FM.TYPE)
        }
        # Touch the updated timestamp so the scanner detects a modification
        fm_kept[FM.UPDATED] = (
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
        )
        fm_yaml = yaml.dump(fm_kept, default_flow_style=False, sort_keys=False, allow_unicode=True)
        new_content = f"---\n{fm_yaml}---\n\n{doc.body}"
        abs_path = ctx.vault.vault_root / relative_path
        tmp_path = abs_path.with_name(abs_path.name + ".fqc-tmp")
        tmp_path.write_text(new_content, encoding="utf-8")
        tmp_path.rename(abs_path)

        # Verify
        verify = ctx.vault.read_file(relative_path)
        owner_absent = FM.OWNER not in verify.frontmatter
        type_absent = FM.TYPE not in verify.frontmatter
        if owner_absent and type_absent:
            return True, "fqc_owner and fqc_type removed successfully"
        return False, f"Keys still present: fm={dict(verify.frontmatter)!r}"
    except Exception as e:
        return False, f"Exception: {e}"


def _rewrite_fqc_ownership(
    ctx: TestContext,
    relative_path: str,
    new_owner: str,
    new_type: str,
) -> tuple[bool, str]:
    """
    Overwrite fqc_owner and fqc_type in a file's frontmatter to new values.

    Uses yaml.dump + tmp-rename pattern to ensure exact keys are written.
    """
    import yaml
    try:
        doc = ctx.vault.read_file(relative_path)
        fm = dict(doc.frontmatter)
        fm[FM.OWNER] = new_owner
        fm[FM.TYPE] = new_type
        fm[FM.UPDATED] = (
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
        )
        fm_yaml = yaml.dump(fm, default_flow_style=False, sort_keys=False, allow_unicode=True)
        new_content = f"---\n{fm_yaml}---\n\n{doc.body}"
        abs_path = ctx.vault.vault_root / relative_path
        tmp_path = abs_path.with_name(abs_path.name + ".fqc-tmp")
        tmp_path.write_text(new_content, encoding="utf-8")
        tmp_path.rename(abs_path)

        # Verify
        verify = ctx.vault.read_file(relative_path)
        ok = (
            verify.frontmatter.get(FM.OWNER) == new_owner
            and verify.frontmatter.get(FM.TYPE) == new_type
        )
        if ok:
            return True, f"fqc_owner={new_owner!r} fqc_type={new_type!r} written"
        return False, f"Verify failed: fm={dict(verify.frontmatter)!r}"
    except Exception as e:
        return False, f"Exception: {e}"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    # The plugin watches this folder — docs created HERE are auto-tracked via normal path
    watched_folder = f"_test_recon_fd/{run.run_id[:8]}/watched"
    # Docs created HERE are outside the watched folder — only global type registry can find them
    outside_folder = f"_test_recon_fd/{run.run_id[:8]}/outside"
    base_folder    = f"_test_recon_fd/{run.run_id[:8]}"

    schema_yaml = _build_schema_yaml(watched_folder)

    doc_a_path = f"{outside_folder}/doc_a_{run.run_id[:8]}.md"   # RO-31: global type registry
    doc_b_path = f"{outside_folder}/doc_b_{run.run_id[:8]}.md"   # RO-32: scanner ownership sync

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
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
            label="register_plugin (auto-track schema, watched folder)",
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

        # ── Step 2: Create doc_a OUTSIDE the watched folder ───────────────────
        # doc_a has fqc_type=DOC_TYPE_ID and fqc_owner=PLUGIN_ID in frontmatter.
        # The plugin does NOT watch outside_folder — only the global type registry
        # can pick this up during reconciliation (RO-31).
        ctx.create_file(
            doc_a_path,
            title=f"FD Doc A {run.run_id[:8]}",
            body="## Frontmatter Discovery Test A\n\nThis doc is outside the watched folder.\nGlobal type registry should discover it via fqc_type.",
            tags=["fqc-test", "recon-fd"],
            extra_frontmatter={
                FM.TYPE: DOC_TYPE_ID,
                FM.OWNER: PLUGIN_ID,
            },
        )
        ctx.cleanup.track_dir(outside_folder)
        ctx.cleanup.track_dir(base_folder)
        ctx.cleanup.track_dir("_test_recon_fd")

        run.step(
            label="create doc_a OUTSIDE watched folder with fqc_type/fqc_owner frontmatter (RO-31 setup)",
            passed=True,
            detail=f"Created: {doc_a_path} | fqc_type={DOC_TYPE_ID!r} fqc_owner={PLUGIN_ID!r}",
        )

        # ── Step 3: Create doc_b OUTSIDE the watched folder ───────────────────
        # doc_b is for RO-32: we'll later change its ownership frontmatter and
        # verify the scanner syncs those changes to the DB columns.
        ctx.create_file(
            doc_b_path,
            title=f"FD Doc B {run.run_id[:8]}",
            body="## Frontmatter Discovery Test B\n\nThis doc tests scanner ownership sync (RO-32).",
            tags=["fqc-test", "recon-fd"],
            extra_frontmatter={
                FM.TYPE: DOC_TYPE_ID,
                FM.OWNER: PLUGIN_ID,
            },
        )

        run.step(
            label="create doc_b OUTSIDE watched folder with fqc_type/fqc_owner frontmatter (RO-32 setup)",
            passed=True,
            detail=f"Created: {doc_b_path} | fqc_type={DOC_TYPE_ID!r} fqc_owner={PLUGIN_ID!r}",
        )

        # ── Step 4: force_file_scan — index both outside docs ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index doc_a and doc_b into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 5 (RO-31): Trigger reconciliation — global type registry ──────
        # The plugin watches watched_folder only. doc_a is in outside_folder.
        # If the reconciler implements the global type registry (Path 2), it should
        # find doc_a via its fqc_type=DOC_TYPE_ID frontmatter field and auto-track it.
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # RO-31 assertion: reconciliation should have auto-tracked doc_a
        prime_result.expect_contains("Auto-tracked")

        recon_summary_prime = _extract_recon_summary(prime_result.text)
        auto_tracked_in_prime = "Auto-tracked" in recon_summary_prime

        run.step(
            label="RO-31: search_records — global type registry discovers outside doc (Auto-tracked)",
            passed=(prime_result.ok and auto_tracked_in_prime),
            detail=(
                expectation_detail(prime_result)
                or (
                    f"recon_summary={recon_summary_prime!r}"
                    if not auto_tracked_in_prime
                    else f"Auto-tracked confirmed | recon_summary={recon_summary_prime!r}"
                )
                or prime_result.error
                or ""
            ),
            timing_ms=prime_result.timing_ms,
            tool_result=prime_result,
            server_logs=step_logs,
        )
        if not prime_result.ok or not auto_tracked_in_prime:
            # If RO-31 is not implemented, report a clear defect and stop
            if prime_result.ok and not auto_tracked_in_prime:
                run.step(
                    label="RO-31 DEFECT: global type registry not implemented",
                    passed=False,
                    detail=(
                        "DEFECT: Expected reconciler to auto-track doc_a (outside watched folder) "
                        f"via global type registry (fqc_type={DOC_TYPE_ID!r}). "
                        f"Got recon_summary={recon_summary_prime!r}. "
                        "The reconciler appears to only scan watched folders and ignores the "
                        "global type registry (Path 2). This is a FlashQuery defect."
                    ),
                )
            return run

        # ── Step 5b: Verify doc_a fqc_id appears in search results ───────────
        t0 = time.monotonic()
        try:
            disk_doc_a = ctx.vault.read_file(doc_a_path)
            fqc_id_a = disk_doc_a.frontmatter.get(FM.ID)
            # Also check fqc_owner/fqc_type on disk (auto-track may have re-written them)
            fqc_owner_a = disk_doc_a.frontmatter.get(FM.OWNER)
            fqc_type_a = disk_doc_a.frontmatter.get(FM.TYPE)

            doc_a_in_results = bool(fqc_id_a) and fqc_id_a in prime_result.text

            checks = {
                "doc_a has fqc_id (auto-track assigned one)": bool(fqc_id_a),
                "doc_a fqc_id present in search_records response": doc_a_in_results,
            }
            all_ok = all(checks.values())
            detail_parts = []
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail_parts.append(f"Failed: {', '.join(failed)}")
            detail_parts.append(
                f"fqc_id_a={fqc_id_a!r} | fqc_owner={fqc_owner_a!r} | "
                f"fqc_type={fqc_type_a!r} | in_results={doc_a_in_results}"
            )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-31: verify doc_a fqc_id in search_records response (outside doc tracked)",
                passed=all_ok,
                detail=" | ".join(detail_parts),
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-31: verify doc_a fqc_id in search_records response",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6: Wait 32s to expire the staleness window ──────────────────
        # The staleness cache is 30s. After the prime reconcile seeds the cache,
        # subsequent calls within 30s are skipped. We must wait past 30s to get
        # a fresh reconcile pass for RO-32 assertions.
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (30s)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 7 (RO-32): Change doc_b's ownership frontmatter ─────────────
        # We rewrite fqc_owner to a different plugin. The scanner should read this
        # new value on the next scan and update ownership_plugin_id in fqc_documents.
        # When reconciliation runs for PLUGIN_ID, doc_b should then appear as
        # disassociated (owned by other_plugin, not recon_fd).
        t0 = time.monotonic()
        other_owner = "other_plugin"
        other_type = "other_type"
        ok_b, detail_b = _rewrite_fqc_ownership(ctx, doc_b_path, other_owner, other_type)

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label=f"RO-32 setup: rewrite doc_b frontmatter to fqc_owner={other_owner!r}",
            passed=ok_b,
            detail=detail_b,
            timing_ms=elapsed,
        )
        if not ok_b:
            return run

        # ── Step 8: Scan again — scanner syncs new ownership fields to DB ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner reads new fqc_owner, syncs ownership_plugin_id",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 9 (RO-32): Second reconciliation — doc_b should be disassociated ──
        # If the scanner correctly synced doc_b's ownership_plugin_id to "other_plugin",
        # the reconciler for PLUGIN_ID=recon_fd will see doc_b as no longer owned by us
        # and classify it as disassociated (archived plugin row).
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_summary2 = _extract_recon_summary(recon2_result.text)
        archived_in_recon2 = "Archived" in recon_summary2

        # RO-32 assertion: doc_b's changed ownership should cause its plugin row to be archived
        m_archived = re.search(r"Archived (\d+) record", recon_summary2)
        archived_count2 = int(m_archived.group(1)) if m_archived else 0

        checks_32a = {
            "RO-32: reconciliation ran (non-empty summary)": len(recon_summary2) > 0,
            "RO-32: at least 1 plugin row archived (doc_b ownership changed away)": archived_count2 >= 1,
        }
        all_ok_32a = all(checks_32a.values())
        detail_32a_parts = []
        if not all_ok_32a:
            failed = [k for k, v in checks_32a.items() if not v]
            detail_32a_parts.append(f"Failed: {', '.join(failed)}")
            if not archived_in_recon2:
                detail_32a_parts.append(
                    "DEFECT: Expected doc_b to be disassociated (archived) after scanner synced "
                    f"ownership_plugin_id to {other_owner!r}. If the scanner did not update the "
                    "ownership column, the reconciler would still see doc_b as owned by PLUGIN_ID "
                    "and would NOT archive it. This proves RO-32 is not implemented."
                )
        detail_32a_parts.append(
            f"archived_count={archived_count2} | recon_summary={recon_summary2!r}"
        )

        run.step(
            label="RO-32: search_records — doc_b archived because scanner synced changed ownership",
            passed=all_ok_32a,
            detail=" | ".join(detail_32a_parts),
            timing_ms=recon2_result.timing_ms,
            tool_result=recon2_result,
            server_logs=step_logs,
        )
        if not all_ok_32a:
            return run

        # ── Step 10: Wait 32s again ───────────────────────────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s (second staleness window — before NULL-removal sub-scenario)",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 11 (RO-32 null removal): Remove fqc_owner/fqc_type from doc_a ──
        # Removing ownership fields entirely → scanner sets columns to NULL next scan →
        # reconciler no longer sees any active plugin row for doc_a, or classifies it
        # as disassociated.
        t0 = time.monotonic()
        ok_null, detail_null = _remove_fqc_ownership(ctx, doc_a_path)

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-32 null-removal: remove fqc_owner/fqc_type entirely from doc_a",
            passed=ok_null,
            detail=detail_null,
            timing_ms=elapsed,
        )
        if not ok_null:
            return run

        # ── Step 12: Scan — scanner sets ownership columns to NULL ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner reads absent fqc_owner, sets ownership_plugin_id to NULL",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ── Step 13 (RO-32 null-removal): Third reconciliation ────────────────
        # With ownership_plugin_id = NULL, the reconciler for PLUGIN_ID should
        # classify doc_a as disassociated (the ownership link is gone).
        log_mark = ctx.server.log_position if ctx.server else 0
        recon3_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon_summary3 = _extract_recon_summary(recon3_result.text)
        m_archived3 = re.search(r"Archived (\d+) record", recon_summary3)
        archived_count3 = int(m_archived3.group(1)) if m_archived3 else 0

        checks_32b = {
            "RO-32 null: reconciliation ran": len(recon_summary3) > 0,
            "RO-32 null: at least 1 plugin row archived (NULL ownership disassociation)": archived_count3 >= 1,
        }
        all_ok_32b = all(checks_32b.values())
        detail_32b_parts = []
        if not all_ok_32b:
            failed = [k for k, v in checks_32b.items() if not v]
            detail_32b_parts.append(f"Failed: {', '.join(failed)}")
            if archived_count3 == 0:
                detail_32b_parts.append(
                    "DEFECT: Expected doc_a to be disassociated after removing fqc_owner/fqc_type "
                    "from frontmatter (scanner should have set ownership_plugin_id to NULL). "
                    "If archived_count=0, the scanner did NOT sync NULL to the DB column — "
                    "RO-32 (NULL removal path) is not implemented."
                )
        detail_32b_parts.append(
            f"archived_count={archived_count3} | recon_summary={recon_summary3!r}"
        )

        run.step(
            label="RO-32 null: search_records — doc_a archived after removing fqc_owner (NULL ownership)",
            passed=all_ok_32b,
            detail=" | ".join(detail_32b_parts),
            timing_ms=recon3_result.timing_ms,
            tool_result=recon3_result,
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
        description="Test: frontmatter-based discovery — global type registry (RO-31) and scanner ownership sync (RO-32).",
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

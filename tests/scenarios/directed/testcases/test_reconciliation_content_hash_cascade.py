#!/usr/bin/env python3
"""
Test: Content-hash cascade after auto-track frontmatter write (RO-67, RO-68, RO-69).

Scenario:
    After auto-track writes fqc_owner/fqc_type into a document's frontmatter, the
    system must update content_hash and last_seen_updated_at to match the post-write
    file state. If it doesn't, the scanner's next pass will re-detect the frontmatter
    write as a modification, causing a spurious 'modified' classification on the next
    reconciliation pass (PIR-02 bug).

    This test explicitly runs force_file_scan BETWEEN auto-track and the second
    reconciliation pass — giving the scanner a chance to re-examine the file.
    If RO-67 is correct (content_hash updated after auto-track write), the scanner
    sees no change and does nothing. If RO-68 is correct (last_seen_updated_at
    matches post-write updated_at), the next reconciliation classifies the doc as
    'unchanged'. If either is wrong, the next reconciliation reports 'modified'.

    1. Register plugin with on_added: auto-track (register_plugin)
    2. Drop a file WITHOUT fqc_owner/fqc_type into the watched folder (ctx.create_file)
    3. Index the file (force_file_scan — sync)
    4. Trigger reconciliation — auto-track fires, writes fqc_owner/fqc_type to frontmatter
       (search_records)
    5. Verify plugin row was created (search_records response)
    6. Verify fqc_owner/fqc_type written to file on disk (read via ctx.vault)
    7. Run force_file_scan again (sync) — RO-69: scanner re-examines file; if RO-67 is
       correct the hash already matches and no updated_at bump occurs
    8. Wait past the 30s reconciliation staleness window
    9. Trigger second reconciliation — RO-67/RO-68 correct: doc is 'unchanged', NOT 'modified'
   10. Assert second reconciliation does NOT classify the document as 'modified'
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-67, RO-68, RO-69

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_content_hash_cascade.py                            # existing server
    python test_reconciliation_content_hash_cascade.py --managed                  # managed server
    python test_reconciliation_content_hash_cascade.py --managed --json           # structured JSON
    python test_reconciliation_content_hash_cascade.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-67", "RO-68", "RO-69"]

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

TEST_NAME = "test_reconciliation_content_hash_cascade"
PLUGIN_ID = "recon_chc"
DOC_TYPE_ID = "chc_item"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track policy; no template (no pending review)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Content-Hash Cascade Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for RO-67/RO-68/RO-69 content-hash cascade\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Auto-tracked items\n"
        "    columns:\n"
        "      - name: doc_title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      on_modified: ignore\n"
        "      track_as: items\n"
        "      field_map:\n"
        "        title: doc_title\n"
    )


def _extract_records(text: str) -> list:
    """Parse the records JSON array from a search_records response."""
    start = text.find("[")
    if start == -1:
        return []
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
        records = _json.loads(text[start : end + 1])
        return records if isinstance(records, list) else []
    except _json.JSONDecodeError:
        return []


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary block from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    rid = run.run_id[:8]
    instance_name = f"test_{rid}"
    folder = f"_test_recon_chc/{rid}"
    schema_yaml = _build_schema_yaml(folder)

    doc_title = f"HashCascade Doc {rid}"
    doc_body = (
        f"## Content-Hash Cascade Test\n\n"
        f"Body content for {TEST_NAME} (run {rid}).\n\n"
        f"The frontmatter will be modified by auto-track — hash must update accordingly."
    )
    watched_file_path = f"{folder}/chc-item-{rid}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — requires a clean, isolated DB state.
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
        register_result.expect_contains("items")

        run.step(
            label="register_plugin (auto-track schema; on_modified: ignore)",
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

        # ── Step 2: Drop test file into watched folder ────────────────────────
        # Write a plain file WITHOUT fqc_owner/fqc_type so auto-track has something to do.
        ctx.create_file(
            watched_file_path,
            title=doc_title,
            body=doc_body,
            tags=["fqc-test", "recon-chc"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_chc")

        run.step(
            label="drop test file into watched folder (no fqc_owner/fqc_type — auto-track will add them)",
            passed=True,
            detail=f"Created: {watched_file_path}",
        )

        # ── Step 3: force_file_scan — index file into fqc_documents ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan #1 (sync) — index file into fqc_documents (pre-auto-track hash)",
            passed=scan1_result.ok,
            detail=scan1_result.error or "",
            timing_ms=scan1_result.timing_ms,
            tool_result=scan1_result,
            server_logs=step_logs,
        )
        if not scan1_result.ok:
            return run

        # ── Step 4: search_records — reconciliation fires, auto-tracks the file ──
        # Auto-track:
        #   1. Creates plugin row in 'items' table
        #   2. Writes fqc_owner + fqc_type into the file's frontmatter on disk
        #   3. (RO-67) Must update content_hash in fqc_documents to reflect post-write content
        #   4. (RO-68) Must set last_seen_updated_at = post-write updated_at (not pre-write)
        log_mark = ctx.server.log_position if ctx.server else 0
        recon1_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon1_result.expect_contains("Auto-tracked")

        run.step(
            label="search_records — reconciliation #1 fires; auto-track writes fqc_owner/fqc_type to frontmatter",
            passed=(recon1_result.ok and recon1_result.status == "pass"),
            detail=expectation_detail(recon1_result) or recon1_result.error or "",
            timing_ms=recon1_result.timing_ms,
            tool_result=recon1_result,
            server_logs=step_logs,
        )
        if not recon1_result.ok:
            return run

        # ── Step 5: Verify plugin row was created ─────────────────────────────
        t0 = time.monotonic()
        records = _extract_records(recon1_result.text)

        checks_row = {
            "plugin row created (records present in response)": len(records) > 0,
        }
        all_ok_row = all(checks_row.values())
        detail_parts = []
        if not all_ok_row:
            failed = [k for k, v in checks_row.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(f"record_count={len(records)}")

        run.step(
            label="verify plugin row created in 'items' table",
            passed=all_ok_row,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_row:
            return run

        # ── Step 6: RO-07 baseline — verify fqc_owner/fqc_type on disk ───────
        t0 = time.monotonic()
        try:
            disk_doc = ctx.vault.read_file(watched_file_path)
            fm = disk_doc.frontmatter

            checks_fm = {
                "fqc_owner written to frontmatter by auto-track": fm.get("fqc_owner") == PLUGIN_ID,
                "fqc_type written to frontmatter by auto-track": fm.get("fqc_type") == DOC_TYPE_ID,
            }
            all_ok_fm = all(checks_fm.values())
            detail_fm = ""
            if not all_ok_fm:
                failed = [k for k, v in checks_fm.items() if not v]
                detail_fm = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_owner={fm.get('fqc_owner')!r}, "
                    f"fqc_type={fm.get('fqc_type')!r}"
                )
            else:
                detail_fm = (
                    f"fqc_owner={fm.get('fqc_owner')!r}, fqc_type={fm.get('fqc_type')!r} "
                    f"(both present — auto-track wrote frontmatter)"
                )

            run.step(
                label="verify fqc_owner/fqc_type written to frontmatter on disk (auto-track completed)",
                passed=all_ok_fm,
                detail=detail_fm,
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            if not all_ok_fm:
                return run

        except Exception as e:
            run.step(
                label="verify fqc_owner/fqc_type written to frontmatter on disk (auto-track completed)",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            return run

        # ── Step 7: RO-69 — force_file_scan #2 (the critical scanner pass) ───
        # This is the key differentiator from RO-54 (covered by test_reconciliation_multi_table).
        # We explicitly give the scanner a chance to re-examine the file after auto-track
        # wrote to it. If RO-67 is correct (content_hash updated to post-write state),
        # the scanner will see hash match → no updated_at bump → RO-69 passes.
        # If RO-67 is wrong (hash still reflects pre-write content), the scanner sees
        # hash mismatch → bumps updated_at → last_seen_updated_at < updated_at → next
        # reconciliation sees 'modified' (the PIR-02 bug).
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan #2 (sync) — RO-69: scanner re-examines post-frontmatter-write file",
            passed=scan2_result.ok,
            detail=(
                (scan2_result.error or "")
                + " | If RO-67 correct: hash matches → no updated_at bump; if wrong: hash mismatch → bump → PIR-02"
            ),
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )
        if not scan2_result.ok:
            return run

        # ── Step 8: Wait past the 30s reconciliation staleness window ─────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window (30s) — force next reconcile to re-evaluate file",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 9: RO-67 + RO-68 — second reconciliation pass ───────────────
        # If RO-67 (content_hash updated post-write) and RO-68 (last_seen_updated_at = post-write
        # updated_at) are both correct, the scanner's second pass (step 7) did NOT bump updated_at,
        # so last_seen_updated_at still equals updated_at → reconciler classifies doc as 'unchanged'.
        # If either is wrong, the doc is classified as 'modified'.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — reconciliation #2 (post-scan; testing RO-67/RO-68 outcome)",
            passed=recon2_result.ok,
            detail=expectation_detail(recon2_result) or recon2_result.error or "",
            timing_ms=recon2_result.timing_ms,
            tool_result=recon2_result,
            server_logs=step_logs,
        )
        if not recon2_result.ok:
            return run

        # ── Step 10: RO-67 + RO-68 + RO-69 — assert no spurious 'modified' ──
        # Observable assertion: the second reconciliation should NOT classify this
        # document as 'modified'. A 'modified' result would mean:
        #   - Scanner bumped updated_at (because content_hash was stale — RO-67 failed), OR
        #   - last_seen_updated_at was set to pre-write state (RO-68 failed)
        # Either failure path leads to last_seen_updated_at < updated_at → 'modified'.
        t0 = time.monotonic()
        recon2_summary = _extract_recon_summary(recon2_result.text)

        # The 'Synced fields on N modified' line appears when reconciler processes modified docs.
        # Its presence means auto-track frontmatter write was misclassified as a user change.
        summary_has_synced_modified = bool(
            re.search(r"Synced fields on \d+ modified", recon2_summary, re.IGNORECASE)
        )
        # Broader check: any 'Synced fields' activity (could be 0 modified, but be safe)
        summary_has_any_synced = bool(re.search(r"Synced fields", recon2_summary, re.IGNORECASE))

        # Also check that the plugin row still exists and has the correct count
        recon2_records = _extract_records(recon2_result.text)

        checks_cascade = {
            "RO-67+RO-68+RO-69: no 'Synced fields on N modified' in second reconcile summary": not summary_has_synced_modified,
            "RO-67+RO-68+RO-69: no 'Synced fields' activity (frontmatter write hash accounted for)": not summary_has_any_synced,
            "plugin row still present after second reconcile": len(recon2_records) > 0,
        }
        all_ok_cascade = all(checks_cascade.values())
        detail_parts = []
        if not all_ok_cascade:
            failed = [k for k, v in checks_cascade.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
            if summary_has_any_synced:
                detail_parts.append(
                    "DEFECT (PIR-02): auto-track frontmatter write was re-detected as user "
                    "modification — content_hash or last_seen_updated_at not updated post-write"
                )
        detail_parts.append(
            f"recon2_records={len(recon2_records)}, "
            f"summary_has_synced={summary_has_any_synced}, "
            f"summary={recon2_summary!r}"
        )

        run.step(
            label="RO-67+RO-68+RO-69: second reconcile shows no spurious 'modified' — hash cascade correct",
            passed=all_ok_cascade,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Cleanup: unregister the plugin ────────────────────────────────────
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
            "Test: content-hash cascade after auto-track frontmatter write "
            "(RO-67, RO-68, RO-69)."
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

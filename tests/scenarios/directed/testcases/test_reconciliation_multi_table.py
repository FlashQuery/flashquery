#!/usr/bin/env python3
"""
Test: Multi-table reconciliation — two-folder plugin with per-folder track_as routing.

Scenario:
    Plugin with two watched folders, each routing to a different table:
        folder_alpha → type_alpha table
        folder_beta  → type_beta  table

    1. Register the plugin with two document types (register_plugin)
    2. Create files in folder_alpha (multiple, to test RO-52 bulk count format)
    3. Create files in folder_beta
    4. Scan vault to index all files (force_file_scan)
    5. Trigger reconciliation via search_records on type_alpha (auto-tracks both folders) (RO-56)
    6. RO-58: Verify alpha files went to type_alpha, beta files went to type_beta
    7. RO-52: Verify reconciliation summary uses count format (e.g. "Auto-tracked N") not file enumeration
    8. Wait 32s past staleness window, then trigger second reconciliation pass
    9. RO-54: Verify second pass shows no spurious modified flags (fqc_owner/fqc_type writes don't
             look like modifications to the reconciler)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-52, RO-54, RO-56, RO-58

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_multi_table.py                            # existing server
    python test_reconciliation_multi_table.py --managed                  # managed server
    python test_reconciliation_multi_table.py --managed --json           # structured JSON with server logs
    python test_reconciliation_multi_table.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-52", "RO-54", "RO-56", "RO-58"]

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

TEST_NAME = "test_reconciliation_multi_table"
PLUGIN_ID = "recon_mt"
DOC_TYPE_ALPHA = "mt_alpha"
DOC_TYPE_BETA = "mt_beta"

# Number of files to create in folder_alpha — must exceed any inline-listing threshold
# so that RO-52 (count-not-enumeration) is exercised with a realistic bulk.
# The current reconciliation formatter always uses count format regardless of N,
# so we create 4 files to ensure the "Auto-tracked N" line is clearly bulk.
ALPHA_FILE_COUNT = 4
BETA_FILE_COUNT = 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder_alpha: str, folder_beta: str) -> str:
    """Plugin schema with two document types, each in a different folder and table."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Multi-Table Reconciliation Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for multi-table auto-track routing\n"
        "\n"
        "tables:\n"
        "  - name: type_alpha\n"
        "    description: Alpha table — receives files from folder_alpha\n"
        "    columns:\n"
        "      - name: doc_title\n"
        "        type: text\n"
        "  - name: type_beta\n"
        "    description: Beta table — receives files from folder_beta\n"
        "    columns:\n"
        "      - name: doc_title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ALPHA}\n"
        f"      folder: {folder_alpha}\n"
        "      on_added: auto-track\n"
        "      track_as: type_alpha\n"
        "      field_map:\n"
        "        title: doc_title\n"
        f"    - id: {DOC_TYPE_BETA}\n"
        f"      folder: {folder_beta}\n"
        "      on_added: auto-track\n"
        "      track_as: type_beta\n"
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
    """Extract the reconciliation summary line from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    rid = run.run_id[:8]
    instance_name = f"test_{rid}"
    folder_alpha = f"_test_recon_mt/{rid}/alpha"
    folder_beta = f"_test_recon_mt/{rid}/beta"
    schema_yaml = _build_schema_yaml(folder_alpha, folder_beta)

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — multi-table routing requires a clean, isolated DB.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin with two tables and two watched folders ──
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains("type_alpha")
        register_result.expect_contains("type_beta")

        run.step(
            label="register_plugin (two tables: type_alpha, type_beta; two watched folders)",
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

        # ── Step 2: Create files in folder_alpha ─────────────────────────────
        alpha_paths = []
        for i in range(ALPHA_FILE_COUNT):
            path = f"{folder_alpha}/alpha-{rid}-{i}.md"
            ctx.create_file(
                path,
                title=f"Alpha Doc {i} {rid}",
                body=f"## Alpha {i}\n\nContent for alpha file {i} in run {rid}.",
                tags=["fqc-test", "recon-mt", "alpha"],
            )
            alpha_paths.append(path)
        ctx.cleanup.track_dir(folder_alpha)
        ctx.cleanup.track_dir(f"_test_recon_mt/{rid}")
        ctx.cleanup.track_dir("_test_recon_mt")

        run.step(
            label=f"create {ALPHA_FILE_COUNT} files in folder_alpha",
            passed=True,
            detail=f"Paths: {alpha_paths}",
        )

        # ── Step 3: Create files in folder_beta ──────────────────────────────
        beta_paths = []
        for i in range(BETA_FILE_COUNT):
            path = f"{folder_beta}/beta-{rid}-{i}.md"
            ctx.create_file(
                path,
                title=f"Beta Doc {i} {rid}",
                body=f"## Beta {i}\n\nContent for beta file {i} in run {rid}.",
                tags=["fqc-test", "recon-mt", "beta"],
            )
            beta_paths.append(path)
        ctx.cleanup.track_dir(folder_beta)

        run.step(
            label=f"create {BETA_FILE_COUNT} files in folder_beta",
            passed=True,
            detail=f"Paths: {beta_paths}",
        )

        # ── Step 4: Scan vault to index all files ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync) — index all alpha and beta files into fqc_documents",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Step 5: RO-56 — Reconcile by calling search_records on type_alpha ──
        # The reconciliation pass must scan ALL document types for this plugin in
        # a single pass — including type_beta files even though we called with
        # table=type_alpha. We verify this by checking beta records appear after.
        log_mark = ctx.server.log_position if ctx.server else 0
        search_alpha = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="type_alpha",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_alpha.expect_contains("Auto-tracked")

        run.step(
            label="search_records(type_alpha) — reconciliation fires; should auto-track alpha AND beta folders",
            passed=(search_alpha.ok and search_alpha.status == "pass"),
            detail=expectation_detail(search_alpha) or search_alpha.error or "",
            timing_ms=search_alpha.timing_ms,
            tool_result=search_alpha,
            server_logs=step_logs,
        )
        if not search_alpha.ok:
            return run

        # ── Step 6a: RO-52 — Verify reconciliation summary uses count format ──
        # The formatReconciliationSummary function always uses "Auto-tracked N new document(s)"
        # format — it never enumerates individual file paths or titles. With ALPHA_FILE_COUNT
        # alpha files plus BETA_FILE_COUNT beta files, we should see a count >= total files.
        t0 = time.monotonic()
        recon_summary_1 = _extract_recon_summary(search_alpha.text)
        total_tracked = ALPHA_FILE_COUNT + BETA_FILE_COUNT

        # Count format: "Auto-tracked N new document(s)" where N is numeric
        auto_tracked_match = re.search(r"Auto-tracked\s+(\d+)\s+new document", recon_summary_1)
        count_present = auto_tracked_match is not None
        count_value = int(auto_tracked_match.group(1)) if auto_tracked_match else 0

        # Verify: summary should use count format (numeric), not enumerate individual file names
        # The alpha filenames like "alpha-{rid}-0.md" should NOT appear in the summary
        alpha_filenames_in_summary = any(
            f"alpha-{rid}-{i}" in recon_summary_1 for i in range(ALPHA_FILE_COUNT)
        )
        beta_filenames_in_summary = any(
            f"beta-{rid}-{i}" in recon_summary_1 for i in range(BETA_FILE_COUNT)
        )

        checks_ro52 = {
            "RO-52: reconciliation summary present": bool(recon_summary_1),
            "RO-52: summary contains 'Auto-tracked N' count format": count_present,
            f"RO-52: count >= total files ({total_tracked})": count_value >= total_tracked,
            "RO-52: alpha file names not enumerated in summary": not alpha_filenames_in_summary,
            "RO-52: beta file names not enumerated in summary": not beta_filenames_in_summary,
        }
        all_ok_ro52 = all(checks_ro52.values())
        detail_parts = []
        if not all_ok_ro52:
            failed = [k for k, v in checks_ro52.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"count_value={count_value}, total_expected={total_tracked}, "
            f"summary={recon_summary_1!r}"
        )

        run.step(
            label="RO-52: reconciliation summary uses count format, not per-file enumeration",
            passed=all_ok_ro52,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_ro52:
            return run

        # ── Step 6b: RO-58 — Verify alpha files went to type_alpha ───────────
        t0 = time.monotonic()
        alpha_records = _extract_records(search_alpha.text)

        checks_ro58_alpha = {
            "RO-58: alpha records present in type_alpha response": len(alpha_records) > 0,
            f"RO-58: type_alpha has {ALPHA_FILE_COUNT} record(s)": len(alpha_records) == ALPHA_FILE_COUNT,
        }
        all_ok_alpha = all(checks_ro58_alpha.values())
        detail_parts = []
        if not all_ok_alpha:
            failed = [k for k, v in checks_ro58_alpha.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(f"alpha_record_count={len(alpha_records)}")

        run.step(
            label=f"RO-58: type_alpha contains {ALPHA_FILE_COUNT} alpha record(s) from folder_alpha",
            passed=all_ok_alpha,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_alpha:
            return run

        # ── Step 6c: RO-56 + RO-58 — Verify beta files went to type_beta ─────
        # Beta files were auto-tracked in the SAME reconciliation pass that targeted type_alpha.
        # If RO-56 is correct, type_beta should have records now without needing a separate call.
        log_mark = ctx.server.log_position if ctx.server else 0
        search_beta = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="type_beta",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records(type_beta) — verify beta table has records (RO-56 + RO-58)",
            passed=search_beta.ok,
            detail=expectation_detail(search_beta) or search_beta.error or "",
            timing_ms=search_beta.timing_ms,
            tool_result=search_beta,
            server_logs=step_logs,
        )
        if not search_beta.ok:
            return run

        t0 = time.monotonic()
        beta_records = _extract_records(search_beta.text)
        recon_summary_beta = _extract_recon_summary(search_beta.text)

        # RO-56: Beta records must already exist (tracked by the type_alpha reconcile pass).
        # If reconciliation only scanned type_alpha's table, beta would still be untracked
        # and search_beta would show "Auto-tracked N" here. After the first reconcile already
        # tracked both, the second call should either show 0 auto-tracked (within staleness)
        # or the same count again. The key assertion is that beta records ARE present.
        checks_ro56_ro58 = {
            "RO-56+RO-58: beta records exist in type_beta (single-pass reconcile covered both tables)": len(beta_records) > 0,
            f"RO-58: type_beta has {BETA_FILE_COUNT} record(s)": len(beta_records) == BETA_FILE_COUNT,
        }
        all_ok_ro56 = all(checks_ro56_ro58.values())
        detail_parts = []
        if not all_ok_ro56:
            failed = [k for k, v in checks_ro56_ro58.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"beta_record_count={len(beta_records)}, "
            f"beta_recon_summary={recon_summary_beta!r}"
        )

        run.step(
            label="RO-56 + RO-58: type_beta has beta records — single-pass reconcile covered both folders",
            passed=all_ok_ro56,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_ro56:
            return run

        # ── Step 7: Wait 32s past the 30s staleness window ───────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window (30s) — force next reconcile to re-evaluate files",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 8: RO-54 — Second reconciliation pass on type_alpha ─────────
        # After auto-track wrote fqc_owner/fqc_type to frontmatter, the file's
        # content_hash will have changed. A correct reconciler should NOT classify
        # this as a user-authored modification (RO-54).
        # The second pass should show "unchanged" or no modification activity.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_alpha = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="type_alpha",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records(type_alpha) — second reconcile pass (RO-54 staleness check)",
            passed=recon2_alpha.ok,
            detail=expectation_detail(recon2_alpha) or recon2_alpha.error or "",
            timing_ms=recon2_alpha.timing_ms,
            tool_result=recon2_alpha,
            server_logs=step_logs,
        )
        if not recon2_alpha.ok:
            return run

        # ── Step 9: RO-54 — Verify no spurious modified flags ────────────────
        t0 = time.monotonic()
        recon_summary_2 = _extract_recon_summary(recon2_alpha.text)

        # The second pass should NOT report any "Synced fields on N modified" activity.
        # fqc_owner/fqc_type frontmatter writes by auto-track must not trigger on_modified.
        # An empty summary or a summary with only non-modification activity passes RO-54.
        summary_has_synced = bool(re.search(r"Synced fields", recon_summary_2, re.IGNORECASE))
        # Allow "Auto-tracked" only if there were genuinely new files (there shouldn't be any here)
        # The key negative assertion: no spurious "modified" activity reported
        summary_has_spurious_modified = bool(
            re.search(r"Synced fields on \d+ modified", recon_summary_2, re.IGNORECASE)
        )

        # Also verify alpha records still have correct count (not corrupted by second pass)
        alpha_records_2 = _extract_records(recon2_alpha.text)

        checks_ro54 = {
            "RO-54: no 'Synced fields on N modified' in second reconcile summary": not summary_has_spurious_modified,
            "RO-54: no 'Synced fields' activity (frontmatter write not seen as modification)": not summary_has_synced,
            f"RO-54: type_alpha still has {ALPHA_FILE_COUNT} record(s) after second pass": len(alpha_records_2) == ALPHA_FILE_COUNT,
        }
        all_ok_ro54 = all(checks_ro54.values())
        detail_parts = []
        if not all_ok_ro54:
            failed = [k for k, v in checks_ro54.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"summary_has_synced={summary_has_synced}, "
            f"alpha_count={len(alpha_records_2)}, "
            f"second_pass_summary={recon_summary_2!r}"
        )

        run.step(
            label="RO-54: second pass — no spurious modified flags from auto-track frontmatter writes",
            passed=all_ok_ro54,
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
            "Test: multi-table reconciliation — two-folder plugin with per-folder "
            "track_as routing (RO-52, RO-54, RO-56, RO-58)."
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

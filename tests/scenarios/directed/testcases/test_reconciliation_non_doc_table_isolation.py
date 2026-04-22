#!/usr/bin/env python3
"""
Test: Non-document-backed table isolation during reconciliation.

Scenario:
    Plugin with one document-backed table (track_as, watched folder) and
    one plain relational table (no track_as, no document association):

    1. Register the plugin (register_plugin)
    2. Create files in the watched folder (vault write)
    3. Scan vault to index the files (force_file_scan)
    4. Trigger first reconciliation pass via search_records on the doc-backed table
    5. Verify doc-backed table has auto-tracked records; summary does not mention plain table
    6. Create records in the plain relational table (create_record x PLAIN_COUNT)
    7. Wait 32s past the 30s staleness window
    8. Trigger second reconciliation pass via search_records on the doc-backed table
    9. Verify doc-backed records unchanged; reconciliation summary does not mention plain table
    10. Query the plain table and verify its records are intact (reconciliation did not touch them)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-56

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_non_doc_table_isolation.py                            # existing server
    python test_reconciliation_non_doc_table_isolation.py --managed                  # managed server
    python test_reconciliation_non_doc_table_isolation.py --managed --json           # structured JSON with server logs
    python test_reconciliation_non_doc_table_isolation.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-56"]

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

TEST_NAME = "test_reconciliation_non_doc_table_isolation"
PLUGIN_ID = "recon_ndt"
DOC_TABLE = "tracked_items"
PLAIN_TABLE = "plain_metadata"
DOC_TYPE = "ndt_item"

# Files to create in the watched folder (auto-track candidates)
DOC_COUNT = 2
# Records to create manually in the plain relational table
PLAIN_COUNT = 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(watched_folder: str) -> str:
    """Plugin schema: one document-backed table + one plain relational table."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Non-Doc Table Isolation Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Verifies reconciliation ignores non-document-backed tables\n"
        "\n"
        "tables:\n"
        f"  - name: {DOC_TABLE}\n"
        "    description: Document-backed table — auto-tracked from watched folder\n"
        "    columns:\n"
        "      - name: doc_title\n"
        "        type: text\n"
        f"  - name: {PLAIN_TABLE}\n"
        "    description: Plain relational table — no document association\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "      - name: notes\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE}\n"
        f"      folder: {watched_folder}\n"
        "      on_added: auto-track\n"
        f"      track_as: {DOC_TABLE}\n"
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
    """Extract the Reconciliation: summary block from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _extract_record_id(text: str) -> str:
    """Extract the record UUID from a create_record response ('Created record <uuid> ...')."""
    m = _UUID_RE.search(text)
    return m.group(0) if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    rid = run.run_id[:8]
    instance_name = f"test_{rid}"
    watched_folder = f"_test_recon_ndt/{rid}/items"
    schema_yaml = _build_schema_yaml(watched_folder)

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — multi-table isolation
        # requires a clean, isolated database instance.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin with doc-backed + plain tables ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains(DOC_TABLE)
        register_result.expect_contains(PLAIN_TABLE)

        run.step(
            label=f"register_plugin (doc-backed: {DOC_TABLE}, plain: {PLAIN_TABLE})",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Create files in watched folder ────────────────────────────
        doc_paths = []
        for i in range(DOC_COUNT):
            path = f"{watched_folder}/item-{rid}-{i}.md"
            ctx.create_file(
                path,
                title=f"Item {i} {rid}",
                body=f"## Item {i}\n\nContent for item {i} in run {rid}.",
                tags=["fqc-test", "recon-ndt"],
            )
            doc_paths.append(path)
        ctx.cleanup.track_dir(watched_folder)
        ctx.cleanup.track_dir(f"_test_recon_ndt/{rid}")
        ctx.cleanup.track_dir("_test_recon_ndt")

        run.step(
            label=f"create {DOC_COUNT} files in watched folder",
            passed=True,
            detail=f"Paths: {doc_paths}",
        )

        # ── Step 3: Scan vault ────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync) — index watched folder files into fqc_documents",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Step 4: First reconciliation pass via doc-backed table ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon1_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table=DOC_TABLE,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon1_result.expect_contains("Auto-tracked")

        run.step(
            label=f"search_records({DOC_TABLE}) — triggers first reconciliation pass",
            passed=(recon1_result.ok and recon1_result.status == "pass"),
            detail=expectation_detail(recon1_result) or recon1_result.error or "",
            timing_ms=recon1_result.timing_ms,
            tool_result=recon1_result,
            server_logs=step_logs,
        )
        if not recon1_result.ok:
            return run

        # ── Step 5: Verify doc-backed table auto-tracked; summary silent on plain table ──
        t0 = time.monotonic()
        recon1_summary = _extract_recon_summary(recon1_result.text)
        doc_records_1 = _extract_records(recon1_result.text)

        # Summary must mention auto-tracking for the doc-backed table.
        # It must NOT mention PLAIN_TABLE by name — reconciliation does not scan
        # non-document-backed tables, so they should be invisible to the reconciler.
        auto_tracked_match = re.search(r"Auto-tracked\s+(\d+)\s+new document", recon1_summary)
        count_1 = int(auto_tracked_match.group(1)) if auto_tracked_match else 0

        checks_step5 = {
            f"first recon auto-tracked {DOC_COUNT} doc(s)": count_1 >= DOC_COUNT,
            f"doc-backed table has {DOC_COUNT} record(s)": len(doc_records_1) == DOC_COUNT,
            f"reconciliation summary does not mention '{PLAIN_TABLE}'": PLAIN_TABLE not in recon1_summary,
        }
        all_ok_5 = all(checks_step5.values())
        detail_parts = []
        if not all_ok_5:
            failed = [k for k, v in checks_step5.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"auto_tracked={count_1}, doc_record_count={len(doc_records_1)}, "
            f"summary={recon1_summary!r}"
        )

        run.step(
            label=f"RO-56: first recon — {DOC_TABLE} auto-tracked; plain table absent from summary",
            passed=all_ok_5,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_5:
            return run

        # ── Step 6: Create records in the plain relational table ──────────────
        plain_record_ids = []
        for i in range(PLAIN_COUNT):
            log_mark = ctx.server.log_position if ctx.server else 0
            create_plain = ctx.client.call_tool(
                "create_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=instance_name,
                table=PLAIN_TABLE,
                fields={
                    "label": f"Metadata {i} {rid}",
                    "notes": f"Manually created plain record {i}",
                },
            )
            record_id = _extract_record_id(create_plain.text)
            if record_id:
                plain_record_ids.append(record_id)

        run.step(
            label=f"create {PLAIN_COUNT} records in {PLAIN_TABLE} (plain relational table)",
            passed=len(plain_record_ids) == PLAIN_COUNT,
            detail=f"record_ids={plain_record_ids}",
        )
        if len(plain_record_ids) != PLAIN_COUNT:
            return run

        # ── Step 7: Wait 32s past staleness window ────────────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window — force next reconcile to re-evaluate",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 8: Second reconciliation pass via doc-backed table ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table=DOC_TABLE,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"search_records({DOC_TABLE}) — second reconciliation pass",
            passed=recon2_result.ok,
            detail=expectation_detail(recon2_result) or recon2_result.error or "",
            timing_ms=recon2_result.timing_ms,
            tool_result=recon2_result,
            server_logs=step_logs,
        )
        if not recon2_result.ok:
            return run

        # ── Step 9: Verify second recon does not touch plain table ────────────
        t0 = time.monotonic()
        recon2_summary = _extract_recon_summary(recon2_result.text)
        doc_records_2 = _extract_records(recon2_result.text)

        # Second pass should see all files as unchanged; plain table stays invisible.
        # A non-empty summary here would indicate spurious activity.
        synced_or_archived = bool(
            re.search(r"(Synced fields|Archived|Auto-tracked)", recon2_summary, re.IGNORECASE)
        )

        checks_step9 = {
            f"doc-backed table still has {DOC_COUNT} record(s)": len(doc_records_2) == DOC_COUNT,
            f"reconciliation summary does not mention '{PLAIN_TABLE}'": PLAIN_TABLE not in recon2_summary,
            "no spurious sync/archive activity on second pass": not synced_or_archived,
        }
        all_ok_9 = all(checks_step9.values())
        detail_parts = []
        if not all_ok_9:
            failed = [k for k, v in checks_step9.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"doc_record_count={len(doc_records_2)}, "
            f"synced_or_archived={synced_or_archived}, "
            f"summary={recon2_summary!r}"
        )

        run.step(
            label=f"RO-56: second recon — {DOC_TABLE} unchanged; {PLAIN_TABLE} not touched by reconciler",
            passed=all_ok_9,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_9:
            return run

        # ── Step 10: Confirm plain table records are intact ───────────────────
        # Calling search_records on PLAIN_TABLE may itself trigger a reconciliation
        # pass, but that's fine — the assertion is that our manually-created records
        # are still present and unmodified (reconciliation did not archive or alter them).
        log_mark = ctx.server.log_position if ctx.server else 0
        plain_search = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table=PLAIN_TABLE,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"search_records({PLAIN_TABLE}) — confirm plain records intact after reconciliation",
            passed=plain_search.ok,
            detail=expectation_detail(plain_search) or plain_search.error or "",
            timing_ms=plain_search.timing_ms,
            tool_result=plain_search,
            server_logs=step_logs,
        )
        if not plain_search.ok:
            return run

        t0 = time.monotonic()
        plain_records = _extract_records(plain_search.text)

        checks_step10 = {
            f"plain table still has exactly {PLAIN_COUNT} record(s)": len(plain_records) == PLAIN_COUNT,
            "all plain records are status active": all(
                r.get("status") == "active" for r in plain_records
            ),
        }
        all_ok_10 = all(checks_step10.values())
        detail_parts = []
        if not all_ok_10:
            failed = [k for k, v in checks_step10.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"plain_record_count={len(plain_records)}, "
            f"expected={PLAIN_COUNT}"
        )

        run.step(
            label=f"RO-56: {PLAIN_TABLE} has {PLAIN_COUNT} record(s) — reconciliation did not archive or modify them",
            passed=all_ok_10,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
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
            "Test: non-document-backed table isolation during reconciliation (RO-56)."
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

#!/usr/bin/env python3
"""
Test: Reconciliation archives plugin rows for deleted/MCP-archived docs; vault files untouched.

Scenario:
    1. Register a plugin with on_added: auto-track, no template (register_plugin)
    2. Create 2 docs in watched folder — one will be physically deleted, one MCP-archived
    3. Scan vault (force_file_scan) — index both docs into fqc_documents
    4. Trigger first reconciliation — auto-tracks both docs (search_records)
    5. Wait 32s past staleness window
    6a. (RO-13 setup) Physically delete doc_missing from disk — scanner will mark it 'missing'
    6b. (RO-14 setup) MCP-archive doc_archived via archive_document — scanner marks status='archived'
        Verify vault file for doc_archived still exists on disk after MCP archival (RO-15 baseline)
    7. Scan vault again — scanner detects missing/archived states
    8. Trigger second full reconciliation (search_records)
    9. RO-13 + RO-14: Verify reconciliation summary shows archived count >= 2
   10. RO-15: Verify MCP-archived doc's vault file is still on disk (archiving plugin row ≠ deleting vault file)
    Cleanup: unregister_plugin(confirm_destroy=True)

Coverage points: RO-13, RO-14, RO-15

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_deletion.py                            # existing server
    python test_reconciliation_deletion.py --managed                  # managed server
    python test_reconciliation_deletion.py --managed --json           # structured output
    python test_reconciliation_deletion.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-13", "RO-14", "RO-15"]

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

TEST_NAME = "test_reconciliation_deletion"
PLUGIN_ID = "recon_del"
DOC_TYPE_ID = "del_item"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track policy; no template (no pending review)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Deletion Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for deletion/archival reconciliation\n"
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
        f"    - id: {DOC_TYPE_ID}\n"
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


def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery's key-value response format."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_del/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    doc_missing_path = f"{folder}/doc_missing_{run.run_id[:8]}.md"
    doc_archived_path = f"{folder}/doc_archived_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a dedicated managed server — reconciliation tests require clean DB state.
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
            label="register_plugin (auto-track schema, no template)",
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

        # ── Step 2: Create 2 docs in watched folder ───────────────────────────
        # doc_missing: will be physically deleted from disk (→ RO-13)
        # doc_archived: will be MCP-archived (→ RO-14)
        ctx.create_file(
            doc_missing_path,
            title=f"Del Missing {run.run_id[:8]}",
            body="## Missing Doc\n\nThis doc will be physically deleted.",
            tags=["fqc-test", "recon-del"],
        )
        ctx.create_file(
            doc_archived_path,
            title=f"Del Archived {run.run_id[:8]}",
            body="## Archived Doc\n\nThis doc will be MCP-archived.",
            tags=["fqc-test", "recon-del"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_del")

        run.step(
            label="create 2 docs in watched folder (doc_missing and doc_archived)",
            passed=True,
            detail=f"Created: {doc_missing_path}, {doc_archived_path}",
        )

        # ── Step 3: Scan vault — index both docs into fqc_documents ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index both docs into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 4: First reconciliation — auto-tracks both docs ──────────────
        # The staleness cache starts here; we'll need to wait 32s before the next
        # full reconciliation pass.
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_result.expect_contains("Auto-tracked")

        run.step(
            label="search_records (prime) — auto-tracks both docs",
            passed=(prime_result.ok and prime_result.status == "pass"),
            detail=expectation_detail(prime_result) or prime_result.error or "",
            timing_ms=prime_result.timing_ms,
            tool_result=prime_result,
            server_logs=step_logs,
        )
        if not prime_result.ok:
            return run

        # ── Step 5: Wait 32s past 30s staleness window ────────────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (30s)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 6a: RO-13 setup — physically delete doc_missing from disk ─────
        t0 = time.monotonic()
        try:
            abs_missing = ctx.vault.vault_root / doc_missing_path
            existed = abs_missing.is_file()
            abs_missing.unlink()
            gone = not abs_missing.is_file()

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "doc_missing existed before delete": existed,
                "doc_missing absent after delete": gone,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"
            run.step(
                label="RO-13 setup: physically delete doc_missing from disk",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-13 setup: physically delete doc_missing from disk",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6b: RO-14 setup — MCP-archive doc_archived ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=doc_archived_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        archive_result.expect_contains("archived")

        run.step(
            label="RO-14 setup: archive_document — MCP-archive doc_archived",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if not archive_result.ok:
            return run

        # ── Step 6b continued: RO-15 baseline — verify vault file still exists ─
        # archive_document archives the fqc_documents row; vault file must remain.
        t0 = time.monotonic()
        try:
            vault_file_exists_after_mcp_archive = (ctx.vault.vault_root / doc_archived_path).is_file()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-15 baseline: verify vault file still on disk after MCP archive_document",
                passed=vault_file_exists_after_mcp_archive,
                detail=(
                    f"vault_file_exists={vault_file_exists_after_mcp_archive} "
                    f"path={doc_archived_path}"
                ),
                timing_ms=elapsed,
            )
            if not vault_file_exists_after_mcp_archive:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-15 baseline: verify vault file still on disk after MCP archive_document",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7: Scan vault — scanner detects missing/archived states ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — scanner detects missing and archived document states",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 8: Second full reconciliation — staleness has expired ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — triggers full reconciliation (staleness expired)",
            passed=recon_result.ok,
            detail=expectation_detail(recon_result) or recon_result.error or "",
            timing_ms=recon_result.timing_ms,
            tool_result=recon_result,
            server_logs=step_logs,
        )
        if not recon_result.ok:
            return run

        # ── Step 9: RO-13 + RO-14 — verify reconciliation archived >= 2 rows ──
        t0 = time.monotonic()
        response_text = recon_result.text
        recon_summary = _extract_recon_summary(response_text)

        checks: dict[str, bool] = {}
        detail_parts: list[str] = []

        # Reconciliation must have run (non-empty summary)
        checks["reconciliation ran (non-empty summary)"] = len(recon_summary) > 0
        if not recon_summary:
            detail_parts.append(
                "Reconciliation summary is empty — staleness cache may still be active. "
                "Ensure the 32s sleep elapsed before the main call."
            )

        # Both doc_missing (status='missing' → RO-13) and doc_archived (status='archived' → RO-14)
        # should result in their plugin rows being archived. Archived count >= 2.
        m_archived = re.search(r"Archived (\d+) record", recon_summary)
        archived_count = int(m_archived.group(1)) if m_archived else 0
        checks["RO-13 + RO-14: archived count >= 2 (missing doc + archived doc)"] = archived_count >= 2
        if archived_count < 2:
            detail_parts.append(
                f"Expected 'Archived >= 2' (for missing + archived docs), got {archived_count}. "
                f"recon_summary={recon_summary!r}"
            )

        all_ok = all(checks.values())
        detail_parts.append(f"archived_count={archived_count}")
        detail_parts.append(f"recon_summary={recon_summary!r}")
        if not all_ok:
            detail_parts.append(f"full_response_preview={response_text[:400]!r}")

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-13 + RO-14: reconciliation archives plugin rows for missing and MCP-archived docs",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )
        if not all_ok:
            return run

        # ── Step 10: RO-15 — vault file still on disk after reconciliation archival ──
        # Reconciliation archived the plugin row for doc_archived — but the vault file
        # must remain untouched. (doc_missing was already gone before reconciliation.)
        t0 = time.monotonic()
        try:
            vault_file_still_exists = (ctx.vault.vault_root / doc_archived_path).is_file()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-15: vault file for MCP-archived doc still on disk after reconciliation",
                passed=vault_file_still_exists,
                detail=(
                    f"vault_file_exists={vault_file_still_exists} "
                    f"path={doc_archived_path} "
                    f"(archiving plugin row must not delete vault file)"
                ),
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-15: vault file for MCP-archived doc still on disk after reconciliation",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
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
        description="Test: reconciliation archives plugin rows for deleted/MCP-archived docs; vault files untouched.",
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

#!/usr/bin/env python3
"""
Test: Spurious sync-fields on modified — PIR-02 regression guard (RO-74).

Scenario:
    After auto-track writes fqc_owner/fqc_type into a document's frontmatter,
    the system must update content_hash and last_seen_updated_at to match the
    post-write file state. If it doesn't, the scanner's next pass will re-detect
    the frontmatter write as a modification, causing a spurious 'modified'
    classification on the next reconciliation pass (PIR-02 bug).

    This test uses on_modified: sync-fields (NOT ignore) so that the spurious
    'modified' classification produces a visible "Synced fields on N modified"
    line in the reconciliation summary. With on_modified: ignore, the bug fires
    silently and this test would pass even against the unfixed codebase — making
    it useless as a regression guard.

    Expected to FAIL against the current (unfixed) codebase. After the PIR-02 fix,
    the doc is correctly classified as 'unchanged' and the test passes.

    1. Register plugin with on_added: auto-track, on_modified: sync-fields (register_plugin)
    2. Drop a file WITHOUT fqc_owner/fqc_type into the watched folder (ctx.create_file)
    3. force_file_scan (sync) — indexes file with pre-auto-track content hash
    4. search_records — reconciliation fires; auto-track writes fqc_owner/fqc_type to
       frontmatter. Bug leaves content_hash stale.
    5. force_file_scan again (sync) — with the bug, scanner sees hash mismatch, bumps
       updated_at
    6. Wait 32 seconds past the 30s staleness window
    7. search_records — second reconciliation: with bug, updated_at > last_seen_updated_at
       → classified as 'modified' → sync-fields fires → "Synced fields on 1 modified"
       appears in summary

    Assert: "Synced fields on" is NOT in the second reconciliation summary.
    - With bug: "Synced fields on 1 modified" appears → FAILS (regression detected)
    - After fix: doc is 'unchanged' → no sync-fields → PASSES

    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-74

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_spurious_sync_fields.py                            # existing server
    python test_reconciliation_spurious_sync_fields.py --managed                  # managed server
    python test_reconciliation_spurious_sync_fields.py --managed --json           # structured JSON
    python test_reconciliation_spurious_sync_fields.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-74"]

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

TEST_NAME = "test_reconciliation_spurious_sync_fields"
PLUGIN_ID = "recon_sfs"
DOC_TYPE_ID = "sfs_item"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track + sync-fields policy (the key distinction from RO-67/68/69)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Spurious Sync-Fields Regression Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for RO-74 — on_modified sync-fields spurious modified\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Auto-tracked items for sync-fields regression test\n"
        "    columns:\n"
        "      - name: doc_title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      on_modified: sync-fields\n"
        "      track_as: items\n"
        "      field_map:\n"
        "        title: doc_title\n"
    )


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
    folder = f"_test_recon_sfs/{rid}"
    schema_yaml = _build_schema_yaml(folder)

    doc_title = f"SpuriousSyncFields Doc {rid}"
    doc_body = (
        f"## Spurious Sync-Fields Regression Test\n\n"
        f"Body content for {TEST_NAME} (run {rid}).\n\n"
        f"The frontmatter will be modified by auto-track — if content_hash is not "
        f"updated post-write, the scanner's next pass will detect a spurious modification."
    )
    watched_file_path = f"{folder}/sfs-item-{rid}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — reconciliation staleness cache must be
        # fresh per run (no shared state with other tests or a live server).
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin ───────────────────────────────────────────
        # on_modified: sync-fields is the critical policy — it makes the spurious
        # 'modified' classification visible in the reconciliation summary.
        # on_modified: ignore would mask the bug (no observable output).
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
            label="register_plugin (auto-track schema; on_modified: sync-fields — PIR-02 observable signal)",
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
        # Write a plain file WITHOUT fqc_owner/fqc_type so auto-track has something
        # to do. The missing frontmatter fields are important: auto-track will write
        # them in, changing the file content and (with the bug) leaving content_hash stale.
        ctx.create_file(
            watched_file_path,
            title=doc_title,
            body=doc_body,
            tags=["fqc-test", "recon-sfs"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_sfs")

        run.step(
            label="drop test file into watched folder (no fqc_owner/fqc_type — auto-track will add them)",
            passed=True,
            detail=f"Created: {watched_file_path}",
        )

        # ── Step 3: force_file_scan #1 — index file into fqc_documents ───────
        # Indexes the file with its pre-auto-track content hash. This is the hash
        # that will become stale when auto-track writes frontmatter fields.
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

        # ── Step 4: search_records — reconciliation #1 fires, auto-tracks ────
        # Auto-track:
        #   1. Creates plugin row in 'items' table
        #   2. Writes fqc_owner + fqc_type into the file's frontmatter on disk
        #   3. (Bug) Leaves content_hash in fqc_documents pointing to pre-write content
        #   4. (Bug) last_seen_updated_at reflects pre-write file state
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

        # ── Step 5: force_file_scan #2 — the bug-triggering scanner pass ─────
        # This is the critical step. With the bug:
        #   - content_hash in fqc_documents still reflects pre-auto-track content
        #   - File on disk has been modified by auto-track (fqc_owner/fqc_type added)
        #   - Scanner detects hash mismatch → bumps updated_at in fqc_documents
        #   - Now updated_at > last_seen_updated_at on the plugin row
        # Without the bug:
        #   - content_hash was updated to post-write state after auto-track
        #   - Scanner sees hash match → no updated_at bump
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=(
                "force_file_scan #2 (sync) — with bug: scanner detects stale hash, "
                "bumps updated_at; without bug: hash matches, no bump"
            ),
            passed=scan2_result.ok,
            detail=(
                (scan2_result.error or "")
                + " | Bug path: hash mismatch → updated_at bumped → PIR-02 fires on next reconcile"
            ),
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )
        if not scan2_result.ok:
            return run

        # ── Step 6: Wait 32s past the 30s reconciliation staleness window ─────
        # The reconciler caches its last run time and skips re-evaluation within the
        # staleness window. We must wait past 30s so the next search_records call
        # performs a full reconciliation diff rather than returning cached results.
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window (30s) — force next reconcile to re-evaluate file",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 7: search_records — reconciliation #2 (the defect detector) ─
        # With the bug:
        #   - updated_at (bumped by scanner in step 5) > last_seen_updated_at
        #   - Reconciler classifies doc as 'modified'
        #   - on_modified: sync-fields fires → "Synced fields on 1 modified" in summary
        # Without the bug:
        #   - updated_at == last_seen_updated_at (no spurious bump occurred)
        #   - Reconciler classifies doc as 'unchanged'
        #   - No sync-fields activity → "Synced fields on" absent from summary
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — reconciliation #2 (post-scan; RO-74 defect detector)",
            passed=recon2_result.ok,
            detail=expectation_detail(recon2_result) or recon2_result.error or "",
            timing_ms=recon2_result.timing_ms,
            tool_result=recon2_result,
            server_logs=step_logs,
        )
        if not recon2_result.ok:
            return run

        # ── Step 8: RO-74 — assert no spurious "Synced fields on" ────────────
        # The observable signal: on_modified: sync-fields emits "Synced fields on N modified"
        # when it processes documents classified as 'modified'. If that string appears in
        # the second reconciliation summary, the auto-track frontmatter write was mis-
        # classified as a user modification — PIR-02 is present.
        t0 = time.monotonic()
        recon2_summary = _extract_recon_summary(recon2_result.text)

        summary_has_synced_fields = bool(
            re.search(r"Synced fields on", recon2_summary, re.IGNORECASE)
        )

        checks_sfs = {
            "RO-74: 'Synced fields on' absent from second reconciliation summary": not summary_has_synced_fields,
        }
        all_ok_sfs = all(checks_sfs.values())
        detail_parts = []
        if not all_ok_sfs:
            failed = [k for k, v in checks_sfs.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
            detail_parts.append(
                "DEFECT (PIR-02): auto-track frontmatter write was re-detected as user "
                "modification — content_hash or last_seen_updated_at not updated post-write; "
                "on_modified: sync-fields fired spuriously"
            )
        detail_parts.append(
            f"summary_has_synced_fields={summary_has_synced_fields}, "
            f"summary={recon2_summary!r}"
        )

        run.step(
            label="RO-74: second reconcile summary must NOT contain 'Synced fields on' (no spurious modified)",
            passed=all_ok_sfs,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Cleanup: unregister the plugin ────────────────────────────────────
        # NOTE: do NOT inline unregister_plugin here — ctx.cleanup.track_plugin_registration
        # handles unregistration on context exit. The explicit call below is retained for
        # immediate teardown to avoid leaving DB state dirty if the context __exit__ errors.
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
            "Test: spurious sync-fields on modified — PIR-02 regression guard (RO-74)."
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

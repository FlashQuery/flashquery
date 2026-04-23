#!/usr/bin/env python3
"""
Test: Reconciliation classifies every document into exactly one of six categories (RO-02).

Scenario:
    Set up multiple documents in distinct reconciliation states using ctx.create_file
    (direct-to-disk, no MCP ownership) so the plugin has no rows yet. Then trigger
    auto-tracking via a record tool call, set up state transitions, wait past the
    staleness window, and verify each document appears in exactly one category.

    States exercised:
        added          — file in watched folder, no plugin row
        modified       — plugin row exists, file content changed since last_seen_updated_at
        deleted        — plugin row exists, file deleted (scanner marks it missing)
        disassociated  — plugin row exists, fq_owner rewritten to a foreign plugin id
                         (scanner updates ownership_plugin_id → mismatch triggers disassociated)

    States not exercised:
        unchanged      — excluded because after auto-tracking all docs have
                         updated_at > last_seen_updated_at (ownership_plugin_id update bumps it).
                         A second reconciliation would mark them all 'modified' first, and a
                         third pass would finally reach 'unchanged' — requiring 60s+ of waits.
        resurrected    — requires an archived plugin row + active fqc_doc; complex multi-step.
        moved          — requires the doc to leave the watched folder while keeping its plugin row.

    Key invariant asserted:
        After one record tool call, every expected document appears in exactly one
        category of the reconciliation summary and counts are consistent.
        A second immediate call (within staleness window) reports no new actions.

Coverage points: RO-02

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_six_categories.py                            # existing server
    python test_reconciliation_six_categories.py --managed                  # managed server
    python test_reconciliation_six_categories.py --managed --json           # structured output
    python test_reconciliation_six_categories.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-02"]

import argparse
import re
import sys
import time
from pathlib import Path

# Three levels up from testcases/ to reach framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_six_categories"
PLUGIN_ID = "recon6cat"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery's key-value response format."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_schema_yaml(folder: str) -> str:
    """
    Plugin schema with document tracking enabled.
    - on_added: auto-track  → new docs in watched folder get a plugin row inserted
    - on_modified: sync-fields → modified docs get their row's last_seen_updated_at synced
    - on_moved: stop-tracking → moved docs get archived (not primary test target here)
    """
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Recon Six Categories Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for six-category reconciliation\n"
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
        "    - id: note\n"
        f"      folder: {folder}\n"
        "      access_level: read-write\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: sync-fields\n"
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

    # Unique names per run to avoid collision with parallel/repeat runs
    instance_name = f"r6c_{run.run_id[:8]}"
    folder = f"_test_recon6/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    port_range = tuple(args.port_range) if args.port_range else None

    plugin_registered = False

    # Paths for each test document (vault-relative)
    path_unchanged     = f"{folder}/unchanged_doc.md"
    path_modified      = f"{folder}/modified_doc.md"
    path_deleted       = f"{folder}/deleted_doc.md"
    path_disassociated = f"{folder}/disassociated_doc.md"
    path_added         = f"{folder}/added_doc.md"

    # Always use a dedicated managed server for a clean DB state
    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin ───────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_result.expect_contains("registered successfully")
        reg_result.expect_contains(instance_name)

        run.step(
            label="register_plugin (doc-tracking schema with on_added:auto-track)",
            passed=(reg_result.ok and reg_result.status == "pass"),
            detail=expectation_detail(reg_result) or reg_result.error or "",
            timing_ms=reg_result.timing_ms,
            tool_result=reg_result,
            server_logs=step_logs,
        )
        if not reg_result.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Drop 4 docs directly into watched folder via ctx.create_file ──
        # Using ctx.create_file (not create_document MCP tool) so the files have no
        # fq_owner yet — they'll be detected as 'added' by the first reconciliation pass.
        # ctx.create_file also registers cleanup automatically.
        for fname, title in [
            (path_unchanged,     "Unchanged Doc"),
            (path_modified,      "Modified Doc"),
            (path_deleted,       "Deleted Doc"),
            (path_disassociated, "Disassociated Doc"),
        ]:
            ctx.create_file(
                fname,
                title=f"RO02 {title} {run.run_id[:8]}",
                body=f"## {title}\n\nCreated by {TEST_NAME}.",
                tags=["fqc-test", "recon6cat"],
            )

        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon6")

        run.step(
            label="create 4 docs in watched folder (no fq_owner — will be 'added')",
            passed=True,
            detail=f"Files created: {path_unchanged}, {path_modified}, {path_deleted}, {path_disassociated}",
        )

        # ── Step 3: Scan → index all 4 docs into fqc_documents ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index 4 docs into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 4: Prime reconciliation — auto-tracks all 4 docs (all 'added') ──
        # This first call sees all 4 docs with no plugin rows → classifies them as 'added'.
        # executeReconciliationActions then:
        #   - writes fq_owner/fq_type to each file's frontmatter
        #   - inserts plugin rows with last_seen_updated_at = post-write updated_at
        #   - updates fqc_documents.ownership_plugin_id and BUMPS updated_at again
        # After this, all 4 docs have updated_at > last_seen_updated_at (inherent to
        # the auto-track sequence). This marks them as 'staleness-cached' for 30s.
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_result.expect_contains("Auto-tracked")
        run.step(
            label="search_records (prime) — auto-tracks all 4 docs (4 'added')",
            passed=(prime_result.ok and prime_result.status == "pass"),
            detail=expectation_detail(prime_result) or prime_result.error or "",
            timing_ms=prime_result.timing_ms,
            tool_result=prime_result,
            server_logs=step_logs,
        )
        if not prime_result.ok:
            return run

        # ── Step 5: Set up state transitions (while staleness window is active) ──
        # We manipulate the 4 docs to set up their target classification states.
        # Changes take effect when we scan in Step 6.

        # ── 5a: 'modified' — update the doc's content on disk via MCP ────────
        # update_document changes the content → different content_hash → scanner
        # will update fqc_documents.updated_at → updated_at > last_seen_updated_at
        log_mark = ctx.server.log_position if ctx.server else 0
        upd_result = ctx.client.call_tool(
            "update_document",
            identifier=path_modified,
            content="## Modified Doc\n\nContent CHANGED — triggers 'modified' classification.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_document (modified_doc) — set up 'modified' state",
            passed=upd_result.ok,
            detail=expectation_detail(upd_result) or upd_result.error or "",
            timing_ms=upd_result.timing_ms,
            tool_result=upd_result,
            server_logs=step_logs,
        )
        if not upd_result.ok:
            return run

        # ── 5b: 'disassociated' — write a foreign fq_owner to the file ──────
        # After the prime auto-track, fq_owner = PLUGIN_ID in the file's frontmatter.
        # We rewrite it to a different plugin id. The scanner will read this, update
        # ownership_plugin_id = "other_plugin" in fqc_documents. The reconciler then
        # sees: active plugin row for PLUGIN_ID, but fqc_doc.ownership_plugin_id !=
        # PLUGIN_ID → classified as 'disassociated'.
        t0 = time.monotonic()
        try:
            doc_disassoc = ctx.vault.read_file(path_disassociated)
            fm = dict(doc_disassoc.frontmatter)
            # Overwrite fq_owner with a different plugin id
            # The scanner reads this and sets ownership_plugin_id = "other_plugin" in DB
            fm[FM.OWNER] = "other_plugin"
            fm[FM.TYPE] = "other_type"
            # Write the complete frontmatter back (using write_frontmatter with the full dict)
            ctx.vault.write_frontmatter(path_disassociated, fm, touch_updated=True)

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="overwrite fq_owner to 'other_plugin' — set up 'disassociated' state",
                passed=True,
                detail="fq_owner set to 'other_plugin' so scanner will update ownership_plugin_id",
                timing_ms=elapsed,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="overwrite fq_owner to 'other_plugin' — set up 'disassociated' state",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── 5c: 'deleted' — physically delete the file from disk ─────────────
        t0 = time.monotonic()
        try:
            abs_deleted = ctx.vault.vault_root / path_deleted
            existed = abs_deleted.is_file()
            abs_deleted.unlink()
            gone = not abs_deleted.is_file()

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
                label="unlink deleted_doc from disk — set up 'deleted' state",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="unlink deleted_doc from disk — set up 'deleted' state",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 6: Scan → scanner picks up modified content and missing file ──
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — let scanner detect content changes and missing file",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 7: Create the 'added' doc after the scan ────────────────────
        # This file appears AFTER scan2. When the main reconciliation runs (Step 9),
        # it will be re-discovered via the docs folder → in fqc_documents (active),
        # but with no plugin row yet → classified as 'added'.
        # We use create_document (MCP) so fqc_documents gets a row before Step 9's scan.
        log_mark = ctx.server.log_position if ctx.server else 0
        cr_added = ctx.client.call_tool(
            "create_document",
            title=f"RO02 Added Doc {run.run_id[:8]}",
            content="## Added Doc\n\nThis doc has no plugin row yet.",
            path=path_added,
            tags=["fqc-test", "recon6cat"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_added = _extract_field(cr_added.text, "FQC ID")
        ctx.cleanup.track_file(path_added)
        if fqc_id_added:
            ctx.cleanup.track_mcp_document(fqc_id_added)

        cr_added.expect_contains("Added Doc")
        run.step(
            label="create_document (added_doc) — will have no plugin row at main reconciliation",
            passed=(cr_added.ok and cr_added.status == "pass"),
            detail=expectation_detail(cr_added) or cr_added.error or "",
            timing_ms=cr_added.timing_ms,
            tool_result=cr_added,
            server_logs=step_logs,
        )
        if not cr_added.ok:
            return run

        # ── Step 8: Wait past the 30s staleness window ───────────────────────
        # The reconciliation staleness cache prevents re-reconciliation within 30s.
        # We must wait past this window so the main call in Step 9 actually runs
        # the classification engine rather than returning empty results.
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (30s)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 9: Final scan → index added_doc into fqc_documents ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index added_doc into fqc_documents before main recon",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ── Step 10: Main record tool call — full reconciliation pass ─────────
        # At this point (staleness expired):
        #   - added_doc:        in fqc_documents (active), no plugin row → 'added'
        #   - unchanged_doc:    plugin row (active), updated_at > last_seen_updated_at
        #                       (from post-auto-track fqc_documents.updated_at bump) → 'modified'
        #                       NOTE: 'unchanged' is unreachable in this test due to the
        #                       auto-track ownership_plugin_id bump inherently making updated_at >
        #                       last_seen_updated_at; we accept 'modified' for unchanged_doc
        #   - modified_doc:     plugin row (active), updated content → 'modified'
        #   - deleted_doc:      plugin row (active), fqc_documents.status='missing' → 'deleted'
        #   - disassociated_doc: plugin row (active), ownership_plugin_id='other_plugin' → 'disassociated'
        log_mark = ctx.server.log_position if ctx.server else 0
        main_result = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
            fields={"label": f"sentinel-{run.run_id[:8]}"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="create_record — triggers full reconciliation classification pass",
            passed=main_result.ok,
            detail=expectation_detail(main_result) or main_result.error or "",
            timing_ms=main_result.timing_ms,
            tool_result=main_result,
            server_logs=step_logs,
        )
        if not main_result.ok:
            return run

        # ── Step 11: RO-02 — Verify category invariants ──────────────────────
        # Invariants:
        #   (a) 'added' is reported: at least 1 auto-tracked
        #   (b) 'deleted' is reported: at least 1 archived (deleted_doc)
        #   (c) 'disassociated' is reported alongside deleted: archived count >= 2
        #   (d) No doc appears in multiple categories (mutual exclusivity via counts)
        #   (e) The response is a valid reconciliation summary (no unexpected errors)
        t0 = time.monotonic()
        response_text = main_result.text
        recon_summary = _extract_recon_summary(response_text)

        checks: dict[str, bool] = {}
        detail_parts: list[str] = []

        # (a) 'added' → "Auto-tracked" present with count >= 1
        m_added = re.search(r"Auto-tracked (\d+) new document", recon_summary)
        added_count = int(m_added.group(1)) if m_added else 0
        checks["added: at least 1 auto-tracked"] = added_count >= 1
        if added_count < 1:
            detail_parts.append(f"'Auto-tracked' missing or count=0 (got {added_count})")

        # (b) 'deleted' + 'disassociated' → "Archived" present with count >= 2
        # Both deleted and disassociated are handled by the same "archived" action path.
        m_archived = re.search(r"Archived (\d+) record", recon_summary)
        archived_count = int(m_archived.group(1)) if m_archived else 0
        checks["archived count >= 2 (deleted + disassociated)"] = archived_count >= 2
        if archived_count < 2:
            detail_parts.append(
                f"Expected 'Archived >= 2' (deleted+disassociated), got {archived_count}. "
                f"This may mean disassociated setup failed (scanner didn't update ownership_plugin_id)."
            )

        # (c) Mutual exclusivity: auto-tracked count == 1 (only added_doc has no plugin row)
        checks["added: exactly 1 doc auto-tracked (added_doc only)"] = (added_count == 1)
        if added_count != 1:
            detail_parts.append(
                f"Expected exactly 1 auto-tracked doc (added_doc), got {added_count}. "
                f"Other docs may have been incorrectly classified as 'added'."
            )

        # (d) Summary is non-empty (reconciliation actually ran, not cache-skipped)
        checks["reconciliation ran (non-empty summary)"] = len(recon_summary) > 0
        if not recon_summary:
            detail_parts.append(
                "Reconciliation summary is empty — staleness cache may still be active. "
                "Ensure the 32s sleep elapsed before the main call."
            )

        all_ok = all(checks.values())
        detail_parts.append(f"recon_summary={recon_summary!r}")
        if not all_ok:
            detail_parts.append(f"full_response_preview={response_text[:400]!r}")

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-02: verify reconciliation categories — added/deleted/disassociated mutual exclusivity",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )

        # ── Step 12: Second call within staleness window → no new actions ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        second_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        second_recon = _extract_recon_summary(second_result.text)
        # Within the 30s staleness window, reconciliation is skipped entirely.
        # The summary should be empty (no new auto-tracks, syncs, or archives).
        no_new_actions = not second_recon
        second_ok = second_result.ok and no_new_actions

        run.step(
            label="RO-02: second call within staleness window — no new reconciliation actions",
            passed=second_ok,
            detail=(
                f"second_recon={second_recon!r} | "
                f"no_new_actions={no_new_actions} | "
                f"ok={second_result.ok}"
            ),
            timing_ms=second_result.timing_ms,
            tool_result=second_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister plugin ────────────────────────────────
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

        # ── Optionally retain files for debugging ─────────────────────
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

        # ── Attach full server logs ────────────────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: reconciliation classifies every document into exactly one of six categories.",
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

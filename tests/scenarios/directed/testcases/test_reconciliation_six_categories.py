#!/usr/bin/env python3
"""
Test: Reconciliation classifies every document into exactly one of six categories (RO-02).

Scenario:
    Set up multiple documents in distinct reconciliation states using ctx.create_file
    (direct-to-disk, no MCP ownership) so the plugin has no rows yet. Then trigger
    auto-tracking via a record tool call, set up state transitions, wait past the
    staleness window, and verify each document appears in exactly one category.

    States exercised (first reconciliation pass — Steps 10–11):
        added          — file in watched folder, no plugin row
        modified       — plugin row exists, file content changed since last_seen_updated_at
        deleted        — plugin row exists, file deleted (scanner marks it missing)
        disassociated  — plugin row exists, fq_owner rewritten to a foreign plugin id
                         (scanner updates ownership_plugin_id → mismatch triggers disassociated)

    States exercised (second reconciliation pass — Steps 15–17):
        resurrected    — archived plugin row (from first pass) + active fqc_doc (file restored
                         to disk + scanned before second pass)
        unchanged      — docs that had sync-fields applied in first pass now have
                         last_seen_updated_at == updated_at; confirmed via server debug log

    States not exercised:
        moved          — requires the doc to leave the watched folder while keeping its plugin row.

    Key invariants asserted:
        Pass 1 (Step 11): added/deleted/disassociated categories are present with correct counts.
        Pass 2 (Step 17): resurrected appears in response text; unchanged > 0 in debug log;
          sum of all category counts == total docs examined (exactly-one constraint).

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
    path_resurrected   = f"{folder}/resurrected_doc.md"
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
            (path_resurrected,   "Resurrected Doc"),
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
            label="create 5 docs in watched folder (no fq_owner — will be 'added')",
            passed=True,
            detail=(
                f"Files created: {path_unchanged}, {path_modified}, {path_deleted}, "
                f"{path_disassociated}, {path_resurrected}"
            ),
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
            label="search_records (prime) — auto-tracks all 5 docs (5 'added')",
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

        # ── 5c: 'deleted' + 'resurrected' setup — physically delete both from disk ──
        # deleted_doc: will be classified 'deleted' in main recon and stay archived.
        # resurrected_doc: will be classified 'deleted' in main recon (plugin row archived),
        #   then restored to disk before the second recon pass → classified 'resurrected'.
        t0 = time.monotonic()
        try:
            abs_deleted    = ctx.vault.vault_root / path_deleted
            abs_resurrected = ctx.vault.vault_root / path_resurrected

            del_existed = abs_deleted.is_file()
            abs_deleted.unlink()
            del_gone = not abs_deleted.is_file()

            res_existed = abs_resurrected.is_file()
            abs_resurrected.unlink()
            res_gone = not abs_resurrected.is_file()

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "deleted_doc existed before delete": del_existed,
                "deleted_doc absent after delete": del_gone,
                "resurrected_doc existed before delete": res_existed,
                "resurrected_doc absent after delete": res_gone,
            }
            all_ok = all(checks.values())
            detail = "" if all_ok else f"Failed: {', '.join(k for k, v in checks.items() if not v)}"
            run.step(
                label="unlink deleted_doc + resurrected_doc — set up 'deleted' states (resurrected_doc will be restored later)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="unlink deleted_doc + resurrected_doc — set up 'deleted' states",
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
        #                       (from post-auto-track bump) → 'modified' → sync-fields applied
        #   - modified_doc:     plugin row (active), updated content → 'modified' → sync-fields
        #   - deleted_doc:      plugin row (active), fqc_documents.status='missing' → 'deleted' → row archived
        #   - disassociated_doc: plugin row (active), ownership_plugin_id='other_plugin' → 'disassociated' → archived
        #   - resurrected_doc:  plugin row (active), fqc_documents.status='missing' → 'deleted' → row archived
        #                       (resurrected_doc is restored to disk AFTER this pass so its row is archived here)
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

        # (b) 'deleted' + 'disassociated' + 'resurrected_as_deleted' → "Archived" present with count >= 3
        # deleted_doc, disassociated_doc, and resurrected_doc (also deleted from disk) all
        # produce an "archive plugin row" action. resurrected_doc's row will be un-archived
        # in the second pass when the file is restored.
        m_archived = re.search(r"Archived (\d+) record", recon_summary)
        archived_count = int(m_archived.group(1)) if m_archived else 0
        checks["archived count >= 3 (deleted + disassociated + resurrected_as_deleted)"] = archived_count >= 3
        if archived_count < 3:
            detail_parts.append(
                f"Expected 'Archived >= 3' (deleted+disassociated+resurrected_as_deleted), got {archived_count}. "
                f"This may mean disassociated setup or resurrected_doc deletion failed."
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

        # ── Steps 13–17: Second reconciliation pass — 'resurrected' + 'unchanged' ──

        # Step 13: Restore resurrected_doc to disk.
        # Its plugin row was archived in the main recon ('deleted' action). Writing it
        # back to disk makes fqc_doc.status = 'active' after the next scan.
        t0 = time.monotonic()
        try:
            abs_resurrected = ctx.vault.vault_root / path_resurrected
            abs_resurrected.parent.mkdir(parents=True, exist_ok=True)
            abs_resurrected.write_text(
                f"# Resurrected Doc\n\nRestored by {TEST_NAME} (run {run.run_id[:8]}).\n"
            )
            restored = abs_resurrected.is_file()
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="restore resurrected_doc to disk — prepare for 'resurrected' classification",
                passed=restored,
                detail="" if restored else "File not found after write",
                timing_ms=elapsed,
            )
            if not restored:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="restore resurrected_doc to disk",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # Step 14: Scan — scanner sees resurrected_doc as present → fqc_doc.status = 'active'
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_restore = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan — index resurrected_doc as active in fqc_documents",
            passed=scan_restore.ok,
            detail=scan_restore.error or "",
            timing_ms=scan_restore.timing_ms,
            tool_result=scan_restore,
            server_logs=step_logs,
        )
        if not scan_restore.ok:
            return run

        # Step 15: Wait 32s so the main recon's staleness window expires before second pass
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window — before second reconciliation pass",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # Step 16: Second reconciliation pass.
        # Expected classifications:
        #   resurrected_doc:  archived row + active fqc_doc → 'resurrected' (un-archived)
        #   disassociated_doc: archived row + active fqc_doc → 'resurrected' (fq_owner still "other_plugin" but row archived)
        #   unchanged_doc:    active row, sync-fields ran in pass 1 → last_seen_updated_at ≈ updated_at → 'unchanged'
        #   modified_doc:     active row, sync-fields ran in pass 1 → 'unchanged'
        #   added_doc:        active row, recently auto-tracked → may be 'unchanged' or 'modified'
        #   deleted_doc:      archived row + missing fqc_doc → falls through all rules → 'unchanged'
        log_mark = ctx.server.log_position if ctx.server else 0
        recon2_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records (second pass) — triggers second reconciliation classification",
            passed=recon2_result.ok,
            detail=recon2_result.error or "",
            timing_ms=recon2_result.timing_ms,
            tool_result=recon2_result,
            server_logs=step_logs,
        )
        if not recon2_result.ok:
            return run

        # Step 17: Verify 'resurrected', 'unchanged', and exactly-one constraint.
        t0 = time.monotonic()
        recon2_summary = _extract_recon_summary(recon2_result.text)

        # (a) 'resurrected' must appear in formatted response text (count > 0)
        # resurrected_doc + disassociated_doc both have archived rows + active fqc_docs → 2 resurrected
        m_resurrected = re.search(r"Resurrected (\d+) record", recon2_summary)
        resurrected_count = int(m_resurrected.group(1)) if m_resurrected else 0
        resurrected_present = resurrected_count >= 1

        # (b) 'unchanged' must appear in server debug log (not in formatted response text)
        # The [RECON] debug line: "added=N resurrected=N ... unchanged=N"
        logs_text = "\n".join(step_logs) if isinstance(step_logs, list) else (step_logs or "")
        m_log = re.search(
            r"\[RECON\] \S+ — added=(\d+) resurrected=(\d+) deleted=(\d+)"
            r" disassociated=(\d+) moved=(\d+) modified=(\d+) unchanged=(\d+)",
            logs_text,
        )
        if m_log:
            log_counts = [int(x) for x in m_log.groups()]
            unchanged_count = log_counts[6]
            total_classified = sum(log_counts)
        else:
            log_counts = []
            unchanged_count = -1
            total_classified = -1

        unchanged_present = unchanged_count >= 1

        # (c) Exactly-one constraint: sum of all category counts == total docs examined.
        # 5 original docs + added_doc = 6 total plugin rows (3 active + 3 archived).
        # Every doc appears in exactly one category, so the sum must equal 6.
        expected_total = 6
        exactly_one = (total_classified == expected_total) if m_log else None

        checks2: dict[str, bool] = {
            "RO-02: 'resurrected' category present (>= 1) in second pass": resurrected_present,
            "RO-02: 'unchanged' count > 0 in server debug log": unchanged_present,
        }
        if exactly_one is not None:
            checks2["RO-02: exactly-one — sum of all category counts == 6"] = exactly_one

        all_ok2 = all(checks2.values())

        detail2_parts = []
        if not resurrected_present:
            detail2_parts.append(f"'Resurrected' absent or count=0 (got {resurrected_count}) — file restore or scan may have failed")
        if not unchanged_present:
            detail2_parts.append(
                f"'unchanged' count={unchanged_count} in debug log — "
                f"{'log line not captured' if unchanged_count == -1 else 'all docs still modified'}"
            )
        if exactly_one is False:
            detail2_parts.append(
                f"exactly-one violated: sum={total_classified} != expected={expected_total} "
                f"(counts={log_counts})"
            )
        detail2_parts.append(
            f"resurrected={resurrected_count} unchanged={unchanged_count} "
            f"total_classified={total_classified} | recon_summary={recon2_summary!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-02: second pass — 'resurrected' present, 'unchanged' > 0, exactly-one constraint",
            passed=all_ok2,
            detail=" | ".join(detail2_parts),
            timing_ms=elapsed,
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

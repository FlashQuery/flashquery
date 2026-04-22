#!/usr/bin/env python3
"""
Test: Pending review rows — query/clear mechanics, cascade-delete, and unregister cleanup.

Scenario:
    1. Register a plugin with on_added: auto-track, template declared, field_map (register_plugin)
    2. Create 2 vault files in the watched folder (ctx.create_file + ctx.scan_vault)
    3. Trigger reconciliation — auto-tracks both files, creates 2 pending review rows (search_records)
    4. RO-38a: clear_pending_reviews (empty fqc_ids) — query mode; returns both pending rows, deletes none
    5. RO-38b: clear_pending_reviews (one fqc_id) — clears that item, returns remainder (the other item)
    6. RO-39: clear_pending_reviews (same fqc_id again) — idempotent no-op; returns same remainder
    7. RO-40: archive the second doc's underlying document row (archive_document + scan_vault),
             then clear_pending_reviews (query mode) — verify that row is no longer in the list
    8. RO-41: Register a second plugin instance, create a third doc, trigger auto-track,
             then unregister_plugin(confirm_destroy=True) — verify no pending reviews remain for that plugin
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-38, RO-39, RO-40, RO-41

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_pending_review.py                            # existing server
    python test_reconciliation_pending_review.py --managed                  # managed server
    python test_reconciliation_pending_review.py --managed --json           # structured JSON with server logs
    python test_reconciliation_pending_review.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-38", "RO-39", "RO-40", "RO-41"]

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

TEST_NAME = "test_reconciliation_pending_review"
PLUGIN_ID = "recon_pr"
DOC_TYPE_ID = "pr_note"

# Second plugin used for RO-41
PLUGIN_ID_2 = "recon_pr2"
DOC_TYPE_ID_2 = "pr_note2"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(plugin_id: str, plugin_name: str, doc_type_id: str, folder: str) -> str:
    """Plugin schema with auto-track, template declared, and field_map."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        f"  name: {plugin_name}\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for pending review coverage\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked pending review test notes\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {doc_type_id}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      template: \"review-template\"\n"
        "      field_map:\n"
        "        title: title\n"
    )


def _extract_pending_fqc_ids(text: str) -> list[str]:
    """
    Extract fqc_ids from a clear_pending_reviews response.
    The response embeds a JSON array of objects with "fqc_id" keys, e.g.:
        Pending reviews for plugin_id: N item(s)
        [{"fqc_id": "<uuid>", ...}, ...]
    Falls back to a regex for any non-JSON format.
    """
    # Try to parse the embedded JSON array
    start = text.find("[")
    if start != -1:
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
            items = _json.loads(text[start:end + 1])
            if isinstance(items, list):
                return [item["fqc_id"] for item in items if isinstance(item, dict) and "fqc_id" in item]
        except (_json.JSONDecodeError, KeyError):
            pass
    # Fallback: match quoted UUID values after "fqc_id"
    return re.findall(r'"fqc_id"\s*:\s*"([a-f0-9-]{36})"', text)


def _extract_pending_count(text: str) -> int:
    """Extract the item count from a clear_pending_reviews response."""
    m = re.search(r"(\d+)\s+item\(s\)", text)
    return int(m.group(1)) if m else 0


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
    folder = f"_test_recon_pr/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(
        PLUGIN_ID, "Pending Review Test Plugin", DOC_TYPE_ID, folder
    )

    # Paths for the two primary test docs
    file1_path = f"{folder}/pr-note-1-{run.run_id[:8]}.md"
    file2_path = f"{folder}/pr-note-2-{run.run_id[:8]}.md"

    # Second plugin (RO-41) — separate folder to avoid cross-contamination
    instance_name_2 = f"test2_{run.run_id[:8]}"
    folder_2 = f"_test_recon_pr2/{run.run_id[:8]}"
    schema_yaml_2 = _build_schema_yaml(
        PLUGIN_ID_2, "Pending Review Test Plugin 2", DOC_TYPE_ID_2, folder_2
    )
    file3_path = f"{folder_2}/pr-note-3-{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False
    plugin2_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — reconciliation tests require clean DB state.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin (auto-track with template + field_map) ────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)
        register_result.expect_contains("notes")

        run.step(
            label="register_plugin (auto-track, template declared, field_map)",
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

        # ── Step 2: Create 2 vault files and scan ─────────────────────────────
        ctx.create_file(
            file1_path,
            title=f"PR Note 1 {run.run_id[:8]}",
            body="## Pending Review Note 1\n\nThis doc will have its pending row cleared.",
            tags=["fqc-test", "recon-pr"],
        )
        ctx.create_file(
            file2_path,
            title=f"PR Note 2 {run.run_id[:8]}",
            body="## Pending Review Note 2\n\nThis doc will be cascade-deleted.",
            tags=["fqc-test", "recon-pr"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_pr")

        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="create 2 docs in watched folder and scan vault",
            passed=scan1.ok,
            detail=scan1.error or f"Created: {file1_path}, {file2_path}",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 3: search_records — reconciliation fires, auto-tracks both files
        # Because template is declared, two pending review rows are created.
        log_mark = ctx.server.log_position if ctx.server else 0
        search1 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search1.expect_contains("Auto-tracked")

        run.step(
            label="search_records — reconciliation auto-tracks both files with template",
            passed=(search1.ok and search1.status == "pass"),
            detail=expectation_detail(search1) or search1.error or "",
            timing_ms=search1.timing_ms,
            tool_result=search1,
            server_logs=step_logs,
        )
        if not search1.ok:
            return run

        # ── Step 4: RO-38a — query mode (empty fqc_ids) returns pending list ──
        # Empty fqc_ids = query mode: lists without deleting.
        # Expect 2 items — one for each auto-tracked doc.
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_query = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        pending_query.expect_contains("2 item(s)")

        run.step(
            label="RO-38a: clear_pending_reviews (query mode, empty fqc_ids) — returns 2 pending rows",
            passed=(pending_query.ok and pending_query.status == "pass"),
            detail=expectation_detail(pending_query) or pending_query.error or "",
            timing_ms=pending_query.timing_ms,
            tool_result=pending_query,
            server_logs=step_logs,
        )
        if not pending_query.ok:
            return run

        # Extract fqc_ids from the pending list — we need them for subsequent steps
        pending_ids = _extract_pending_fqc_ids(pending_query.text)

        t0 = time.monotonic()
        checks = {
            "2 pending fqc_ids returned": len(pending_ids) == 2,
        }
        all_ok = all(checks.values())
        detail = (
            f"pending_ids={pending_ids!r}"
            if all_ok
            else f"Failed: expected 2 fqc_ids, got {len(pending_ids)}. text_preview={pending_query.text[:300]!r}"
        )
        run.step(
            label="parse 2 fqc_ids from pending review list",
            passed=all_ok,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        fqc_id_1 = pending_ids[0]
        fqc_id_2 = pending_ids[1]

        # ── Step 5: RO-38b — clear one fqc_id; remainder returned ────────────
        # Non-empty fqc_ids list: clear those items and return what's left.
        # Clear fqc_id_1; expect response shows 1 item(s) remaining (fqc_id_2).
        log_mark = ctx.server.log_position if ctx.server else 0
        clear_one = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[fqc_id_1],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # After clearing fqc_id_1, the response should show 1 remaining item (fqc_id_2)
        clear_one.expect_contains("1 item(s)")

        run.step(
            label="RO-38b: clear_pending_reviews (fqc_id_1) — clears that item, 1 remains",
            passed=(clear_one.ok and clear_one.status == "pass"),
            detail=expectation_detail(clear_one) or clear_one.error or "",
            timing_ms=clear_one.timing_ms,
            tool_result=clear_one,
            server_logs=step_logs,
        )
        if not clear_one.ok:
            return run

        # Verify fqc_id_2 is in the remainder, fqc_id_1 is gone
        t0 = time.monotonic()
        remaining_ids = _extract_pending_fqc_ids(clear_one.text)
        checks = {
            "fqc_id_1 no longer in list": fqc_id_1 not in remaining_ids,
            "fqc_id_2 still in list": fqc_id_2 in remaining_ids,
        }
        all_ok = all(checks.values())
        detail = (
            f"remaining_ids={remaining_ids!r}, fqc_id_1={fqc_id_1!r}, fqc_id_2={fqc_id_2!r}"
            if all_ok
            else (
                f"Failed: {[k for k, v in checks.items() if not v]}. "
                f"remaining_ids={remaining_ids!r}"
            )
        )
        run.step(
            label="RO-38b verify: fqc_id_1 cleared from list; fqc_id_2 remains",
            passed=all_ok,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        # ── Step 6: RO-39 — idempotent: clearing already-cleared fqc_id is no-op
        # Call clear_pending_reviews again with the same fqc_id_1 (already cleared).
        # The list should still show 1 item (fqc_id_2), unchanged from before.
        log_mark = ctx.server.log_position if ctx.server else 0
        clear_again = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[fqc_id_1],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Still 1 item (fqc_id_2); clearing an already-cleared id is a no-op
        clear_again.expect_contains("1 item(s)")

        run.step(
            label="RO-39: clear_pending_reviews (same fqc_id_1 again) — idempotent, still 1 item remains",
            passed=(clear_again.ok and clear_again.status == "pass"),
            detail=expectation_detail(clear_again) or clear_again.error or "",
            timing_ms=clear_again.timing_ms,
            tool_result=clear_again,
            server_logs=step_logs,
        )
        if not clear_again.ok:
            return run

        t0 = time.monotonic()
        idempotent_ids = _extract_pending_fqc_ids(clear_again.text)
        checks = {
            "RO-39 idempotent: fqc_id_2 still present": fqc_id_2 in idempotent_ids,
            "RO-39 idempotent: fqc_id_1 still absent": fqc_id_1 not in idempotent_ids,
            "RO-39 idempotent: still exactly 1 item": len(idempotent_ids) == 1,
        }
        all_ok = all(checks.values())
        detail = (
            f"idempotent_ids={idempotent_ids!r}"
            if all_ok
            else (
                f"Failed: {[k for k, v in checks.items() if not v]}. "
                f"idempotent_ids={idempotent_ids!r}"
            )
        )
        run.step(
            label="RO-39 verify: list unchanged after re-clearing already-cleared fqc_id",
            passed=all_ok,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        # ── Step 7: RO-40 — pending review row deleted when reconciliation sees doc as 'deleted' ──
        # Mechanism: archive_document sets fqc_documents.status='archived'. When reconciliation
        # next runs a full diff (after the staleness window), it classifies the doc as 'deleted'
        # (active plugin row + archived/missing document) and explicitly deletes the pending
        # review rows for that document. We must wait past the 30s staleness window and then
        # trigger a fresh reconciliation pass.
        #
        # Step 7a: Archive the underlying document for file2 (fqc_id_2's backing document).
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=file2_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        archive_result.expect_contains("archived")

        run.step(
            label="RO-40 setup: archive_document for file2 (the doc behind fqc_id_2 pending row)",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if not archive_result.ok:
            return run

        # Step 7b: Wait 32s past the staleness window so the next reconciliation does a full diff.
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-40 setup: wait 32s past 30s staleness window (reconciliation must do full diff)",
            passed=True,
            detail=f"Slept {elapsed}ms to expire the staleness cache",
            timing_ms=elapsed,
        )

        # Step 7c: Scan vault so the scanner updates fqc_documents.status for file2.
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="RO-40 setup: force_file_scan — updates fqc_documents state for archived file2",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # Step 7d: Trigger reconciliation — it classifies file2's doc as 'deleted' (active plugin
        # row + archived/missing document) and deletes fqc_id_2's pending review row.
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="RO-40 setup: search_records — full reconciliation runs, classifies file2 as deleted",
            passed=recon_result.ok,
            detail=expectation_detail(recon_result) or recon_result.error or "",
            timing_ms=recon_result.timing_ms,
            tool_result=recon_result,
            server_logs=step_logs,
        )
        if not recon_result.ok:
            return run

        # Step 7e: Query pending reviews — fqc_id_2's row must be gone (deleted by reconciliation).
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_after_archive = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="RO-40: clear_pending_reviews (query mode) after reconciliation processes archived doc",
            passed=pending_after_archive.ok,
            detail=expectation_detail(pending_after_archive) or pending_after_archive.error or "",
            timing_ms=pending_after_archive.timing_ms,
            tool_result=pending_after_archive,
            server_logs=step_logs,
        )
        if not pending_after_archive.ok:
            return run

        # Verify fqc_id_2 is gone from the pending list (deleted by reconciliation engine)
        t0 = time.monotonic()
        post_archive_ids = _extract_pending_fqc_ids(pending_after_archive.text)
        fqc_id_2_absent = fqc_id_2 not in post_archive_ids
        checks = {
            "RO-40: fqc_id_2 absent after reconciliation deleted its pending row": fqc_id_2_absent,
        }
        all_ok = all(checks.values())
        detail = (
            f"post_archive_ids={post_archive_ids!r}, fqc_id_2={fqc_id_2!r}, "
            f"response_preview={pending_after_archive.text[:300]!r}"
        )
        run.step(
            label="RO-40 verify: fqc_id_2 pending row deleted when reconciliation sees doc as deleted",
            passed=all_ok,
            detail=detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        # ── Step 8: RO-41 — unregister_plugin clears all pending review rows ──
        # Register a second plugin instance, create a doc, trigger auto-track+template
        # (creates a pending review row), then unregister and verify no rows remain.
        log_mark = ctx.server.log_position if ctx.server else 0
        register2_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_2,
            plugin_instance=instance_name_2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register2_result.expect_contains("registered successfully")
        register2_result.expect_contains(instance_name_2)

        run.step(
            label="RO-41 setup: register second plugin (auto-track + template)",
            passed=(register2_result.ok and register2_result.status == "pass"),
            detail=expectation_detail(register2_result) or register2_result.error or "",
            timing_ms=register2_result.timing_ms,
            tool_result=register2_result,
            server_logs=step_logs,
        )
        if not register2_result.ok:
            return run
        plugin2_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID_2, instance_name_2)

        # Create a vault file in the second plugin's folder
        ctx.create_file(
            file3_path,
            title=f"PR Note 3 {run.run_id[:8]}",
            body="## Pending Review Note 3\n\nThis doc's pending row will be cleared by unregister.",
            tags=["fqc-test", "recon-pr2"],
        )
        ctx.cleanup.track_dir(folder_2)
        ctx.cleanup.track_dir("_test_recon_pr2")

        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="RO-41 setup: create doc for second plugin and scan vault",
            passed=scan3.ok,
            detail=scan3.error or f"Created: {file3_path}",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # Trigger reconciliation to auto-track file3 → creates pending review row
        log_mark = ctx.server.log_position if ctx.server else 0
        search2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID_2,
            plugin_instance=instance_name_2,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search2.expect_contains("Auto-tracked")

        run.step(
            label="RO-41 setup: search_records (plugin 2) — auto-tracks file3 with template",
            passed=(search2.ok and search2.status == "pass"),
            detail=expectation_detail(search2) or search2.error or "",
            timing_ms=search2.timing_ms,
            tool_result=search2,
            server_logs=step_logs,
        )
        if not search2.ok:
            return run

        # Verify pending row exists for plugin 2 before unregister
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_before_unregister = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID_2,
            plugin_instance=instance_name_2,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        pending_before_unregister.expect_contains("1 item(s)")

        run.step(
            label="RO-41 setup: verify 1 pending review row for plugin 2 before unregister",
            passed=(pending_before_unregister.ok and pending_before_unregister.status == "pass"),
            detail=expectation_detail(pending_before_unregister) or pending_before_unregister.error or "",
            timing_ms=pending_before_unregister.timing_ms,
            tool_result=pending_before_unregister,
            server_logs=step_logs,
        )
        if not pending_before_unregister.ok:
            return run

        # Unregister plugin 2 — this should cascade-delete all its pending review rows
        log_mark = ctx.server.log_position if ctx.server else 0
        unregister2 = ctx.client.call_tool(
            "unregister_plugin",
            plugin_id=PLUGIN_ID_2,
            plugin_instance=instance_name_2,
            confirm_destroy=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        unregister2.expect_contains("unregistered")

        run.step(
            label="RO-41: unregister_plugin (plugin 2, confirm_destroy=True)",
            passed=(unregister2.ok and unregister2.status == "pass"),
            detail=expectation_detail(unregister2) or unregister2.error or "",
            timing_ms=unregister2.timing_ms,
            tool_result=unregister2,
            server_logs=step_logs,
        )
        if not unregister2.ok:
            return run
        plugin2_registered = False  # already unregistered; skip cleanup teardown

        # After unregister, verify no pending reviews remain for plugin 2.
        # Re-registering is not needed — we call clear_pending_reviews to check
        # via a fresh registration query, or check indirectly via register again.
        # Instead, we re-register plugin 2 briefly just to query its pending state,
        # then immediately unregister again.
        log_mark = ctx.server.log_position if ctx.server else 0
        rereg2 = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_2,
            plugin_instance=instance_name_2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="RO-41 verify: re-register plugin 2 to query pending rows after unregister",
            passed=rereg2.ok,
            detail=expectation_detail(rereg2) or rereg2.error or "",
            timing_ms=rereg2.timing_ms,
            tool_result=rereg2,
            server_logs=step_logs,
        )
        if not rereg2.ok:
            return run
        plugin2_registered = True
        # Note: cleanup tracker already has this registration from the first time;
        # re-registering with same plugin_id/instance_name is safe to track again.

        log_mark = ctx.server.log_position if ctx.server else 0
        pending_after_unregister = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID_2,
            plugin_instance=instance_name_2,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # After unregister cleared the rows, no pending reviews should remain for plugin 2
        pending_after_unregister.expect_contains("No pending reviews")

        run.step(
            label="RO-41 verify: no pending reviews for plugin 2 after unregister_plugin",
            passed=(pending_after_unregister.ok and pending_after_unregister.status == "pass"),
            detail=expectation_detail(pending_after_unregister) or pending_after_unregister.error or "",
            timing_ms=pending_after_unregister.timing_ms,
            tool_result=pending_after_unregister,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister both plugins ──────────────────────────────────
        for pid, iname, registered_flag in [
            (PLUGIN_ID, instance_name, plugin_registered),
            (PLUGIN_ID_2, instance_name_2, plugin2_registered),
        ]:
            if registered_flag:
                try:
                    teardown = ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=pid,
                        plugin_instance=iname,
                        confirm_destroy=True,
                    )
                    if not teardown.ok:
                        ctx.cleanup_errors.append(
                            f"unregister_plugin({pid}/{iname}) failed: {teardown.error or teardown.text}"
                        )
                except Exception as e:
                    ctx.cleanup_errors.append(f"unregister_plugin({pid}/{iname}) exception: {e}")

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Plugin instances retained: {PLUGIN_ID}/{instance_name}, {PLUGIN_ID_2}/{instance_name_2}",
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
        description="Test: pending review rows — query/clear mechanics, cascade-delete, and unregister cleanup.",
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

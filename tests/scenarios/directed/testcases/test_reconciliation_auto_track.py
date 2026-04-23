#!/usr/bin/env python3
"""
Test: Auto-track action mechanics — plugin row, frontmatter write, body preservation, no pending review.

Scenario:
    1. Register a plugin with on_added: auto-track, field_map, and no template (register_plugin)
    2. Drop a test file into the watched folder with author/priority frontmatter (ctx.create_file)
    3. Index the file into fqc_documents (force_file_scan)
    4. Trigger reconciliation — auto-track fires (search_records)
    5. Verify plugin row has field_map columns populated from frontmatter (RO-06)
    6. Verify fq_owner and fq_type written to document frontmatter on disk (RO-07)
    7. Verify document body content is unchanged — only frontmatter was modified (RO-09)
    8. Verify no pending review row — no template declared (clear_pending_reviews) (RO-10)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-06, RO-07, RO-09, RO-10

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_auto_track.py                            # existing server
    python test_reconciliation_auto_track.py --managed                  # managed server
    python test_reconciliation_auto_track.py --managed --json           # structured JSON with server logs
    python test_reconciliation_auto_track.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-06", "RO-07", "RO-09", "RO-10"]

import argparse
import json as _json
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_auto_track"
PLUGIN_ID = "recon_at"
DOC_TYPE_ID = "at_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """Plugin schema with auto-track policy and field_map; no template (so no pending review)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Auto-Track Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for auto-track mechanics\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked notes with field_map\n"
        "    columns:\n"
        "      - name: author\n"
        "        type: text\n"
        "      - name: priority\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      field_map:\n"
        "        author: author\n"
        "        priority: priority\n"
    )


def _extract_first_record(text: str) -> dict:
    """Parse the first record from a search_records response (JSON array)."""
    # Response format: "Found N record(s):\n[...json array...]..."
    # Bracket-count to handle nested objects without splitting on nested brackets.
    start = text.find("[")
    if start == -1:
        return {}
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
        return records[0] if isinstance(records, list) and records else {}
    except _json.JSONDecodeError:
        return {}


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_at/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    expected_author = f"Author {run.run_id[:8]}"
    expected_priority = "high"
    expected_body = (
        f"## Auto-Track Test\n\n"
        f"Body content for {TEST_NAME} (run {run.run_id[:8]}).\n\n"
        f"Only the frontmatter should be modified by auto-track."
    )
    watched_file_path = f"{folder}/at-note-{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a managed server — auto-track mechanics require a clean DB state.
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
        register_result.expect_contains("notes")

        run.step(
            label="register_plugin (auto-track schema with field_map, no template)",
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
        # ctx.create_file writes directly to disk (no MCP ownership yet) and registers
        # cleanup. extra_frontmatter provides the field_map source values.
        ctx.create_file(
            watched_file_path,
            title=f"Auto-Track Note {run.run_id[:8]}",
            body=expected_body,
            tags=["fqc-test", "recon-at"],
            extra_frontmatter={
                "author": expected_author,
                "priority": expected_priority,
            },
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_at")

        run.step(
            label="drop test file into watched folder (with author/priority frontmatter)",
            passed=True,
            detail=f"Created: {watched_file_path}",
        )

        # ── Step 3: force_file_scan — index into fqc_documents ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (sync) — index test file into fqc_documents",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Step 4: search_records — reconciliation fires, auto-tracks file ──
        # The response includes the newly inserted plugin row in the JSON array.
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        search_result.expect_contains("Auto-tracked")

        run.step(
            label="search_records — reconciliation fires and auto-tracks the new file",
            passed=(search_result.ok and search_result.status == "pass"),
            detail=expectation_detail(search_result) or search_result.error or "",
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )
        if not search_result.ok:
            return run

        # ── Step 5: RO-06 — verify field_map columns in the returned plugin row ──
        # The search_records response embeds the inserted row as a JSON array.
        t0 = time.monotonic()
        record = _extract_first_record(search_result.text)

        checks = {
            "record present in response": bool(record),
            f"author={expected_author!r}": record.get("author") == expected_author,
            f"priority={expected_priority!r}": record.get("priority") == expected_priority,
        }
        all_ok = all(checks.values())
        detail_parts = []
        if not all_ok:
            failed = [k for k, v in checks.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(f"record_excerpt={{author={record.get('author')!r}, priority={record.get('priority')!r}}}")

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-06: verify plugin row has field_map columns populated from frontmatter",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=elapsed,
        )
        if not all_ok:
            return run

        # ── Step 6: RO-07 + RO-09 — read vault file from disk ─────────────────
        # fq_owner and fq_type should be in frontmatter (RO-07).
        # Body content must be identical to what we wrote (RO-09).
        t0 = time.monotonic()
        try:
            disk_doc = ctx.vault.read_file(watched_file_path)
            fm = disk_doc.frontmatter

            checks = {
                "fq_owner written to frontmatter (RO-07)": fm.get(FM.OWNER) == PLUGIN_ID,
                "fq_type written to frontmatter (RO-07)": fm.get(FM.TYPE) == DOC_TYPE_ID,
                "body content unchanged (RO-09)": disk_doc.body.strip() == expected_body.strip(),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fq_owner={fm.get(FM.OWNER)!r}, "
                    f"fq_type={fm.get(FM.TYPE)!r}, "
                    f"body_preview={disk_doc.body[:80]!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-07 + RO-09: fq_owner/fq_type in frontmatter; body content unchanged",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="RO-07 + RO-09: fq_owner/fq_type in frontmatter; body content unchanged",
                passed=False,
                detail=f"Exception reading vault file: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7: RO-10 — no pending review (no template declared) ─────────
        # clear_pending_reviews with empty fqc_ids runs in query mode (no deletions).
        log_mark = ctx.server.log_position if ctx.server else 0
        pending_result = ctx.client.call_tool(
            "clear_pending_reviews",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            fqc_ids=[],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        pending_result.expect_contains(f"No pending reviews for {PLUGIN_ID}")

        run.step(
            label="RO-10: clear_pending_reviews (query mode) — no pending review row when no template",
            passed=(pending_result.ok and pending_result.status == "pass"),
            detail=expectation_detail(pending_result) or pending_result.error or "",
            timing_ms=pending_result.timing_ms,
            tool_result=pending_result,
            server_logs=step_logs,
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
        description="Test: auto-track action mechanics — plugin row, frontmatter write, body preservation, no pending review.",
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

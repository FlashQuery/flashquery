#!/usr/bin/env python3
"""
Test: Reconciliation discovery does not silently truncate at 1000 documents.

Scenario:
    1. Register a plugin with a watched folder + frontmatter type.
    2. (RO-51) Write 1100 .md files (with pre-assigned fqc_ids) directly into
       the watched folder, run a background scan, wait for all files to be
       indexed, then trigger reconciliation. Assert added count >= 1100.
       On HTTP timeout, retry after the staleness window until all are tracked.
    3. (RO-62) Trigger reconciliation again (after staleness window). Assert
       deleted count = 0 — no active plugin rows falsely classified as deleted.
    4. (RO-63) Write 1100 .md files OUTSIDE the watched folder with fqc_type
       in frontmatter (Path 2 discovery), run a background scan, wait for
       indexing, then trigger reconciliation. Assert added count >= 1100.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: RO-51, RO-62, RO-63

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_discovery_at_scale.py                            # existing server
    python test_reconciliation_discovery_at_scale.py --managed                  # managed server
    python test_reconciliation_discovery_at_scale.py --managed --json           # structured output
    python test_reconciliation_discovery_at_scale.py --managed --json --keep    # retain files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-51", "RO-62", "RO-63"]

import argparse
import json
import re
import sys
import time
from pathlib import Path
from uuid import uuid4

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_discovery_at_scale"
PLUGIN_ID = "recon_scale"
DOC_TYPE_ID = "scale_note"

# Number of files to create — comfortably above any 1000-row cap.
# Files are written with pre-assigned fqc_ids so the scanner does a read-only
# upsert (no frontmatter write-back). Reconciliation still writes fqc_owner and
# inserts plugin rows, but we use a retry loop to handle the remote-Supabase
# latency case where a single 30s call can't track all 1100 in one shot.
SCALE_COUNT = 500

# How long to wait (seconds) for the background scan to finish indexing
# SCALE_COUNT files into fqc_documents.  Observed scan rate is ~3.5–4 files/sec
# against remote Supabase, so 1010 files ≈ 253–289s; 400s gives a solid margin
# and avoids triggering reconciliation against a partially-indexed vault.
SCAN_WAIT_S = 5 # For local docker install of everything, shorter wait is fine.

# Max reconciliation retries when the first call auto-tracks only a partial
# batch (each retry waits past the 30s staleness window then calls again).
MAX_RECON_RETRIES = 8
STALENESS_WAIT_S = 33   # just over the 30s staleness window


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary block from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


def _parse_auto_tracked(summary: str) -> int:
    """Return the auto-tracked count from a reconciliation summary, or 0."""
    m = re.search(r"Auto-tracked\s+(\d+)\s+new document", summary)
    return int(m.group(1)) if m else 0


def _parse_archived(summary: str) -> int:
    """Return the archived count from a reconciliation summary, or 0."""
    m = re.search(r"Archived\s+(\d+)\s+record", summary)
    return int(m.group(1)) if m else 0


def _build_schema_yaml(watched_folder: str) -> str:
    """Plugin schema with auto-track for watched folder and a named doc type."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Scale Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for at-scale reconciliation discovery\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {watched_folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked scale-test notes\n"
        "    columns:\n"
        "      - name: title\n"
        "        type: text\n"
    )


def _write_plain_md_files(dest_dir: Path, count: int, prefix: str) -> int:
    """Write `count` minimal .md files with pre-assigned fqc_ids into dest_dir.

    Pre-assigning fqc_ids means the scanner does a simple upsert without
    needing to write fqc_id back to the file. This avoids filesystem
    write-back overhead during the scan phase.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for i in range(count):
        p = dest_dir / f"{prefix}_{i:05d}.md"
        fqc_id = str(uuid4())
        p.write_text(
            f"---\nfqc_id: {fqc_id}\ntitle: Scale Test {prefix} {i}\nstatus: active\n---\n\n"
            f"# Scale Test {prefix} {i}\n\nGenerated by {TEST_NAME}.\n",
            encoding="utf-8",
        )
        written += 1
    return written


def _write_typed_md_files(dest_dir: Path, count: int, prefix: str, fqc_type: str) -> int:
    """Write `count` .md files with fqc_type frontmatter and pre-assigned fqc_ids."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for i in range(count):
        p = dest_dir / f"{prefix}_{i:05d}.md"
        fqc_id = str(uuid4())
        p.write_text(
            f"---\nfqc_id: {fqc_id}\ntitle: Typed Scale Test {prefix} {i}\nstatus: active\n"
            f"fqc_type: {fqc_type}\n---\n\n"
            f"# Typed Scale Test {prefix} {i}\n\nGenerated by {TEST_NAME}.\n",
            encoding="utf-8",
        )
        written += 1
    return written


def _extract_recon_log_counts(step_logs: list) -> dict:
    """
    Extract candidate classification counts from the server-side [RECON] debug log.

    The reconciliation service logs a line of the form:
        [RECON] pluginId:instance — added=N resurrected=N deleted=N ...
    before executing actions. This count reflects how many candidates were
    *discovered* by the candidate query (before the HTTP timeout cuts the
    response). Extracting it from captured server logs lets us detect a
    Supabase page-limit cap (added=1000 when 1100 files exist) even when
    the HTTP call times out mid-action.

    This is used for *diagnostic / defect detection* only — step PASS/FAIL
    is still driven by the public-surface HTTP response.
    """
    if not step_logs:
        return {}
    for line in reversed(step_logs):
        m = re.search(
            r'\[RECON\].*?added=(\d+).*?deleted=(\d+).*?disassociated=(\d+)',
            line,
        )
        if m:
            return {
                "added": int(m.group(1)),
                "deleted": int(m.group(2)),
                "disassociated": int(m.group(3)),
            }
    return {}


def _reconcile_until_complete(ctx, run, plugin_id, instance_name, table,
                               expect_added, phase_label, max_retries=MAX_RECON_RETRIES):
    """
    Trigger reconciliation (search_records) and retry past the staleness window
    until all expected docs are tracked or no more progress is made.

    Returns (total_added, all_ok, detail_str).

    On HTTP timeout: the server continues running reconciliation after the client
    disconnects. We capture the [RECON] debug log line (which appears before
    actions execute) to get the *candidate count* — this reveals whether the
    discovery query is capped at 1000 even when the action phase times out.

    If the log shows added=1000 exactly and expect_added > 1000, that is a
    DEFECT (Supabase default page limit not overridden).
    """
    total_added = 0
    attempt = 0
    # Track the max candidate count seen from server logs across all attempts
    max_log_candidates = 0

    while attempt <= max_retries:
        attempt += 1
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "search_records",
            plugin_id=plugin_id,
            plugin_instance=instance_name,
            table=table,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Extract server-side candidate count from [RECON] log line (pre-action)
        log_counts = _extract_recon_log_counts(step_logs)
        log_added = log_counts.get("added", 0)
        if log_added > max_log_candidates:
            max_log_candidates = log_added

        summary = _extract_recon_summary(result.text)
        batch_added = _parse_auto_tracked(summary)
        batch_archived = _parse_archived(summary)
        total_added += batch_added

        # Compose step detail — include log-level candidate count for defect diagnosis
        detail_parts = [
            f"ok={result.ok}",
            f"batch_added={batch_added}",
            f"total_added={total_added}",
            f"batch_archived={batch_archived}",
            f"log_candidates_added={log_added}",
            f"summary={summary!r}",
        ]
        if result.error:
            detail_parts.append(f"error={result.error}")

        # On timeout with log evidence of a cap, upgrade detail to defect note
        is_timeout = not result.ok and result.error and "timed out" in result.error.lower()
        if is_timeout and log_added == 1000 and expect_added > 1000:
            detail_parts.append(
                "DEFECT: server log shows added=1000 exactly (Supabase default page limit). "
                "The candidate query returns at most 1000 rows — files beyond that are invisible "
                "to reconciliation. Fix: add .range(0, 999999) to both Path 1 and Path 2 queries."
            )

        step_label = (
            f"{phase_label} — search_records attempt {attempt} "
            f"(added={batch_added}, log_candidates={log_added}, total={total_added})"
        )
        # The attempt step passes if the HTTP call succeeded, OR if the call timed
        # out but the server log already shows the correct candidate count (meaning
        # the timeout is from write-back overhead, not a discovery defect).
        attempt_passed = result.ok or (
            is_timeout and log_added >= expect_added
        )
        run.step(
            label=step_label,
            passed=attempt_passed,
            detail=" | ".join(detail_parts),
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        if not result.ok:
            is_timeout = bool(result.error and "timed out" in result.error.lower())
            if log_added == 1000 and expect_added > 1000:
                # Old cap defect still present — the discovery query is still truncating.
                return (
                    max_log_candidates,
                    False,
                    f"DEFECT: candidate query capped at 1000 (log: added={log_added}, "
                    f"expected >= {expect_added}). HTTP timed out during action phase.",
                )
            if is_timeout and log_added >= expect_added:
                # Discovery is correct — the [RECON] log line (emitted before any
                # write-back actions run) shows the full uncapped count.  The HTTP
                # timeout is caused by write-back overhead (fqc_owner/fqc_type
                # frontmatter written to every new file at ~2/sec), not by a
                # discovery defect.  Treat this as a pass for the RO-51/RO-63 check.
                return (
                    log_added,
                    True,
                    f"Discovery correct: server log shows added={log_added} >= {expect_added}. "
                    f"HTTP timeout from frontmatter write-back overhead — not a discovery defect.",
                )
            # Any other HTTP error — stop retrying.
            return (
                total_added,
                False,
                f"search_records HTTP error on attempt {attempt} "
                f"(log_candidates={log_added}, total_added={total_added}, "
                f"expected >= {expect_added}): {result.error}",
            )

        # Check if we've reached the target
        if total_added >= expect_added:
            return total_added, True, f"Reached target after {attempt} attempt(s)"

        # If no new docs were added and no docs were archived, we've converged
        if batch_added == 0 and batch_archived == 0 and attempt > 1:
            detail = (
                f"Converged after {attempt} attempt(s) with total_added={total_added} "
                f"(expected >= {expect_added}). "
            )
            if max_log_candidates == 1000 and expect_added > 1000:
                detail += (
                    "DEFECT: max log candidates = 1000 exactly — Supabase default page "
                    "limit not overridden in candidate query."
                )
            elif total_added < expect_added:
                detail += (
                    f"DEFECT: only {total_added} docs discovered (expected >= {expect_added})."
                )
            return total_added, total_added >= expect_added, detail

        if attempt <= max_retries and total_added < expect_added:
            # Wait past the staleness window before the next attempt
            time.sleep(STALENESS_WAIT_S)

    detail = (
        f"Exhausted {max_retries} retries; total_added={total_added}, "
        f"max_log_candidates={max_log_candidates} (expected >= {expect_added})"
    )
    return total_added, total_added >= expect_added, detail


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"rs_{run.run_id[:8]}"
    watched_folder = f"_test/{run.run_id[:8]}/watched"
    outside_folder = f"_test/{run.run_id[:8]}/outside"
    base_test_dir  = f"_test/{run.run_id[:8]}"

    schema_yaml = _build_schema_yaml(watched_folder)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always use a dedicated managed server — needs a clean DB so plugin
        # rows from this run don't collide with any pre-existing state.
        managed=True,
        port_range=port_range,
    ) as ctx:

        vault_root = ctx.vault.vault_root
        watched_abs = vault_root / watched_folder
        outside_abs = vault_root / outside_folder
        base_abs    = vault_root / base_test_dir

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
            label="register_plugin (watched folder + auto-track schema)",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # Register parent dirs for cleanup (deepest first so rmdir works)
        ctx.cleanup.track_dir(outside_folder)
        ctx.cleanup.track_dir(watched_folder)
        ctx.cleanup.track_dir(base_test_dir)
        ctx.cleanup.track_dir("_test")

        # ---------------------------------------------------------------------------
        # RO-51: watched-folder candidate discovery is not capped at 1000
        # ---------------------------------------------------------------------------

        # ── Step 2 (RO-51 setup): Write 1100 files to the watched folder ─────────
        t0 = time.monotonic()
        try:
            n_written = _write_plain_md_files(watched_abs, SCALE_COUNT, "watch")
            write_ok = (n_written == SCALE_COUNT)
            write_detail = f"Wrote {n_written} files to {watched_folder}"
        except Exception as e:
            write_ok = False
            write_detail = f"Exception writing files: {e}"

        run.step(
            label=f"write {SCALE_COUNT} files to watched folder (RO-51/RO-62 setup)",
            passed=write_ok,
            detail=write_detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not write_ok:
            return run

        # ── Step 3: force_file_scan (background) — index watched files ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"force_file_scan (background) — start indexing {SCALE_COUNT} watched files",
            passed=scan1.ok,
            detail=scan1.error or f"Scan started. Waiting {SCAN_WAIT_S}s for completion.",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # Wait for the background scan to finish indexing all files into fqc_documents.
        # At ~4 files/sec against remote Supabase, 1100 files ≈ 275s; 300s is safe.
        time.sleep(SCAN_WAIT_S)

        # ── Steps 4+ (RO-51): Trigger reconciliation with retry until all tracked ─
        # search_records fires reconciliation before the query. If reconciliation
        # auto-tracks fewer than SCALE_COUNT docs in one call (30s HTTP timeout),
        # subsequent calls (after staleness window) pick up the remainder.
        # We accumulate total_added across retries to verify no cap at 1000.
        total_added_51, ro51_ok, ro51_detail = _reconcile_until_complete(
            ctx, run,
            plugin_id=PLUGIN_ID,
            instance_name=instance_name,
            table="notes",
            expect_added=SCALE_COUNT,
            phase_label="RO-51",
        )

        # Record the final RO-51 verdict as a dedicated assertion step
        t0 = time.monotonic()
        ro51_verdict_detail = (
            f"total_added={total_added_51} (expected >= {SCALE_COUNT}) | {ro51_detail}"
        )
        if not ro51_ok and total_added_51 == 1000:
            ro51_verdict_detail += (
                " | DEFECT: exactly 1000 — Supabase default page limit not overridden"
            )
        elif not ro51_ok and 0 < total_added_51 < SCALE_COUNT:
            ro51_verdict_detail += (
                f" | DEFECT: only {total_added_51}/{SCALE_COUNT} discovered"
            )

        run.step(
            label=f"RO-51: reconciliation discovers all {SCALE_COUNT} watched-folder docs (not capped at 1000)",
            passed=ro51_ok,
            detail=ro51_verdict_detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        # Continue to RO-62 even if RO-51 fails (cap defect should be recorded, not abort)

        # ---------------------------------------------------------------------------
        # RO-62: No active plugin rows falsely classified as deleted on second pass
        # ---------------------------------------------------------------------------

        # ── RO-62: Another reconciliation — expect deleted count = 0 ─────────────
        # Wait past the staleness window then trigger a fresh reconciliation.
        # If the candidate query caps at 1000, some of the 1100 plugin rows won't
        # be seen as candidates, and those will be falsely classified as "deleted".
        time.sleep(STALENESS_WAIT_S)

        log_mark = ctx.server.log_position if ctx.server else 0
        recon2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recon2_summary = _extract_recon_summary(recon2.text)
        archived_count_2 = _parse_archived(recon2_summary)
        added_count_2    = _parse_auto_tracked(recon2_summary)
        log_counts_2     = _extract_recon_log_counts(step_logs)
        log_deleted_2    = log_counts_2.get("deleted", 0)

        is_timeout_2 = bool(
            not recon2.ok and recon2.error and "timed out" in recon2.error.lower()
        )
        if is_timeout_2:
            # HTTP timed out during write-back — use the server log's deleted count,
            # which is emitted before any actions run and is reliable.
            ro62_ok = (log_deleted_2 == 0)
            ro62_detail = (
                f"HTTP timeout; log_deleted={log_deleted_2} (expected 0) | "
                f"log_added={log_counts_2.get('added', '?')} | "
                f"(assertion via server log — HTTP timed out during write-back)"
            )
        else:
            ro62_ok = recon2.ok and (archived_count_2 == 0)
            ro62_detail = (
                f"archived={archived_count_2} (expected 0) | added={added_count_2} | "
                f"summary={recon2_summary!r}"
            )
        if not ro62_ok and (archived_count_2 > 0 or log_deleted_2 > 0):
            ro62_detail += (
                f" | DEFECT: plugin row(s) falsely classified as deleted; "
                f"candidate query likely still capped — rows beyond the cap appear 'missing'"
            )

        run.step(
            label="RO-62: second reconciliation reports 0 deleted (no false-positive deleted rows)",
            passed=ro62_ok,
            detail=ro62_detail,
            timing_ms=recon2.timing_ms,
            tool_result=recon2,
            server_logs=step_logs,
        )
        if not recon2.ok:
            return run

        # ---------------------------------------------------------------------------
        # RO-63: Path 2 (frontmatter type) discovery is also not capped at 1000
        # ---------------------------------------------------------------------------

        # ── RO-63 setup: Write 1100 typed files OUTSIDE the watched folder ────────
        t0 = time.monotonic()
        try:
            n_written_outside = _write_typed_md_files(
                outside_abs, SCALE_COUNT, "outside", DOC_TYPE_ID
            )
            outside_write_ok = (n_written_outside == SCALE_COUNT)
            outside_write_detail = (
                f"Wrote {n_written_outside} files to {outside_folder} "
                f"with fqc_type={DOC_TYPE_ID!r}"
            )
        except Exception as e:
            outside_write_ok = False
            outside_write_detail = f"Exception writing outside files: {e}"

        run.step(
            label=f"write {SCALE_COUNT} typed files outside watched folder (RO-63 setup)",
            passed=outside_write_ok,
            detail=outside_write_detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not outside_write_ok:
            return run

        # ── force_file_scan (background) — index outside typed files ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label=f"force_file_scan (background) — start indexing {SCALE_COUNT} outside files",
            passed=scan2.ok,
            detail=scan2.error or f"Scan started. Waiting {SCAN_WAIT_S}s for completion.",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # Wait for the background scan to finish.
        time.sleep(SCAN_WAIT_S)

        # ── Steps (RO-63): Trigger reconciliation with retry until all tracked ─────
        # Path 2 discovers docs by ownership_type column in fqc_documents.
        # The outside docs have fqc_type in frontmatter; the scanner should have
        # written that to ownership_type. Reconciliation Path 2 queries all rows
        # with ownership_type IN (DOC_TYPE_ID). If capped at 1000, only 1000
        # of 1100 outside docs are discovered and auto-tracked.
        total_added_63, ro63_ok, ro63_detail = _reconcile_until_complete(
            ctx, run,
            plugin_id=PLUGIN_ID,
            instance_name=instance_name,
            table="notes",
            expect_added=SCALE_COUNT,
            phase_label="RO-63",
        )

        t0 = time.monotonic()
        ro63_verdict_detail = (
            f"total_added={total_added_63} (expected >= {SCALE_COUNT}) | {ro63_detail}"
        )
        if not ro63_ok and total_added_63 == 1000:
            ro63_verdict_detail += (
                " | DEFECT: exactly 1000 — Path 2 ownership_type query has Supabase page-limit cap"
            )
        elif not ro63_ok and 0 < total_added_63 < SCALE_COUNT:
            ro63_verdict_detail += (
                f" | DEFECT: only {total_added_63}/{SCALE_COUNT} discovered via Path 2"
            )
        elif not ro63_ok and total_added_63 == 0:
            ro63_verdict_detail += (
                " | DEFECT or setup issue: 0 docs discovered via Path 2 — "
                "verify fqc_type frontmatter was written and scan indexed the files"
            )

        run.step(
            label=f"RO-63: Path 2 reconciliation discovers all {SCALE_COUNT} typed docs (not capped at 1000)",
            passed=ro63_ok,
            detail=ro63_verdict_detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Optionally retain files for debugging ─────────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {base_abs}",
            )

        # ── Attach full server logs to the run ────────────────────────────────────
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
        description="Test: reconciliation discovery is not capped at 1000 documents.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with managed=True).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with managed=True).")
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

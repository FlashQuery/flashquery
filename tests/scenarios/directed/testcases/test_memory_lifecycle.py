#!/usr/bin/env python3
"""
Test: save_memory → get → list → update → get new version → archive → list (miss).

Scenario:
    1. Save a memory via MCP (save_memory) with unique content and tags
    2. Get it by ID via MCP (get_memory) — verify full content
    3. List by unique tag via MCP (list_memories) — verify memory appears
    4. Update it via MCP (update_memory) with new content, omitting tags — creates new version
    5. Get the NEW version by its new ID — verify updated content and preserved tags
    6. Archive the new version via MCP (archive_memory) — verify status tag management
    7. List by unique tag again — verify archived memory is excluded
    Cleanup: any surviving memory version is archived in a best-effort pass at the end.

Coverage points: M-01, M-02, M-06, M-07, M-08, M-10, M-12, M-13, M-14

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_memory_lifecycle.py                            # existing server
    python test_memory_lifecycle.py --managed                  # managed server
    python test_memory_lifecycle.py --managed --json           # structured JSON with server logs
    python test_memory_lifecycle.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["M-01", "M-02", "M-06", "M-07", "M-08", "M-10", "M-12", "M-13", "M-14"]
REQUIRES_EMBEDDING = True

import argparse
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_memory_lifecycle"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _extract_id_after(text: str, label: str) -> str:
    """Extract a UUID that appears after a given label, e.g. 'New version id: <uuid>'."""
    m = re.search(rf"{re.escape(label)}\s*([0-9a-fA-F-]{{36}})", text)
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_phrase = f"flashquery lifecycle beacon {run.run_id}"
    # Content prefix must reliably exceed 200 chars so the sentinel placed after it
    # is cut off by list_memories (M-10 truncates previews to 200 chars + "...").
    content_prefix = (
        f"This memory was created by {TEST_NAME} (run {run.run_id}). "
        f"Marker phrase: {unique_phrase}. "
        f"It verifies the save -> get -> list -> update -> archive cycle. "
        f"Additional padding to push the prefix reliably past 200 characters."
    )
    list_truncation_sentinel = f"TRUNCATED_TAIL_{run.run_id}"
    original_content = content_prefix + " " + list_truncation_sentinel
    updated_content = (
        f"This memory was UPDATED by {TEST_NAME} (run {run.run_id}). "
        f"Marker phrase: {unique_phrase}. "
        f"The body content has been replaced and is the newest version."
    )
    unique_tag = f"memlife-{run.run_id}"
    tags = ["fqc-test", "memory-lifecycle", unique_tag]

    port_range = tuple(args.port_range) if args.port_range else None

    original_id: str = ""
    new_version_id: str = ""
    archive_done = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=args.managed,
        url=args.url,
        secret=args.secret,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:

        # ── Step 1: Save memory via MCP (M-01) ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        save_result = ctx.client.call_tool(
            "save_memory",
            content=original_content,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # save_memory response: "Memory saved (id: <uuid>). Tags: ... Scope: ..."
        m = re.search(r"\(id:\s*([0-9a-fA-F-]{36})\)", save_result.text)
        original_id = m.group(1) if m else ""
        if original_id:
            ctx.cleanup.track_mcp_memory(original_id)
        save_result.expect_contains("Memory saved")
        save_result.expect_contains(unique_tag)

        run.step(
            label="save_memory via MCP",
            passed=(save_result.ok and save_result.status == "pass" and bool(original_id)),
            detail=expectation_detail(save_result) or save_result.error or "",
            timing_ms=save_result.timing_ms,
            tool_result=save_result,
            server_logs=step_logs,
        )
        if not save_result.ok or not original_id:
            return run

        # ── Step 2: Get memory by single ID (M-08) ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_result = ctx.client.call_tool(
            "get_memory",
            memory_ids=original_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Full (un-truncated) content should be returned by get_memory;
        # sentinel appears beyond char 200 so its presence confirms no truncation.
        get_result.expect_contains(unique_phrase)
        get_result.expect_contains(original_id)
        get_result.expect_contains(unique_tag)
        get_result.expect_contains(list_truncation_sentinel)

        run.step(
            label="get_memory (single id) — original version",
            passed=(get_result.ok and get_result.status == "pass"),
            detail=expectation_detail(get_result) or get_result.error or "",
            timing_ms=get_result.timing_ms,
            tool_result=get_result,
            server_logs=step_logs,
        )

        # ── Step 3: List memories by unique tag (M-10) ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_memories",
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        list_result.expect_contains(original_id)
        list_result.expect_contains(unique_tag)
        # M-10: preview is truncated to 200 chars — sentinel beyond char 200 must be absent
        list_result.expect_not_contains(list_truncation_sentinel)

        run.step(
            label=f"list_memories(tags=['{unique_tag}'])",
            passed=(list_result.ok and list_result.status == "pass"),
            detail=expectation_detail(list_result) or list_result.error or "",
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        # ── Step 3b: Semantic search_memory by query (M-02) ──────────
        # save_memory is fire-and-forget for embeddings (X-11) — wait for the
        # background embedding job to land before issuing a semantic query.
        # Use a low threshold so noisy similarity scores still match reliably;
        # the tag filter scopes the results to this run.
        time.sleep(2.0)
        log_mark = ctx.server.log_position if ctx.server else 0
        sem_result = ctx.client.call_tool(
            "search_memory",
            query=unique_phrase,
            tags=[unique_tag],
            threshold=0.1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        sem_result.expect_contains(original_id)

        run.step(
            label=f"search_memory(query='{unique_phrase}')",
            passed=(sem_result.ok and sem_result.status == "pass"),
            detail=expectation_detail(sem_result) or sem_result.error or "",
            timing_ms=sem_result.timing_ms,
            tool_result=sem_result,
            server_logs=step_logs,
        )

        # ── Step 4: Update memory content (M-06, M-07) ───────────────
        # Omit tags so we can verify existing tags are preserved (M-07).
        log_mark = ctx.server.log_position if ctx.server else 0
        update_result = ctx.client.call_tool(
            "update_memory",
            memory_id=original_id,
            content=updated_content,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # update_memory response: "Memory updated. New version id: <uuid>. Previous version id: <uuid>. Version: N."
        new_version_id = _extract_id_after(update_result.text, "New version id:")
        if new_version_id:
            ctx.cleanup.track_mcp_memory(new_version_id)
        update_result.expect_contains("New version id")
        update_result.expect_contains(original_id)  # previous version id is echoed back

        run.step(
            label="update_memory (new version)",
            passed=(update_result.ok and update_result.status == "pass" and bool(new_version_id)),
            detail=expectation_detail(update_result) or update_result.error or "",
            timing_ms=update_result.timing_ms,
            tool_result=update_result,
            server_logs=step_logs,
        )
        if not update_result.ok or not new_version_id:
            return run

        # ── Step 5: Get NEW version — verify updated content + preserved tags ─
        log_mark = ctx.server.log_position if ctx.server else 0
        get2_result = ctx.client.call_tool(
            "get_memory",
            memory_ids=new_version_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Updated body, same unique tag (proves M-07 — tags preserved when update omits them)
        get2_result.expect_contains("UPDATED")
        get2_result.expect_contains(new_version_id)
        get2_result.expect_contains(unique_tag)

        run.step(
            label="get_memory (new version) — updated body + preserved tags",
            passed=(get2_result.ok and get2_result.status == "pass"),
            detail=expectation_detail(get2_result) or get2_result.error or "",
            timing_ms=get2_result.timing_ms,
            tool_result=get2_result,
            server_logs=step_logs,
        )

        # ── Step 6: Archive memory (M-12, M-14) ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_memory",
            memory_id=new_version_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Response confirms archival AND reports the auto-managed status tag.
        archive_result.expect_contains("archived")
        archive_result.expect_contains("#status/archived")

        run.step(
            label="archive_memory — status + status tag management",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if archive_result.ok:
            archive_done = True

        # ── Step 7: List by unique tag again — archived should be excluded ─
        log_mark = ctx.server.log_position if ctx.server else 0
        post_list_result = ctx.client.call_tool(
            "list_memories",
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The archived (new) version must not appear. The original version is a
        # separate record and remains active — update_memory is a versioning
        # operation, not an in-place replacement.
        post_list_result.expect_not_contains(new_version_id)
        post_list_result.expect_contains(original_id)

        run.step(
            label="list_memories after archive — exclusion",
            passed=(post_list_result.ok and post_list_result.status == "pass"),
            detail=expectation_detail(post_list_result) or post_list_result.error or "",
            timing_ms=post_list_result.timing_ms,
            tool_result=post_list_result,
            server_logs=step_logs,
        )

        # ── Step 7b: search_memory after archive — excluded (M-13) ───
        log_mark = ctx.server.log_position if ctx.server else 0
        post_sem_result = ctx.client.call_tool(
            "search_memory",
            query=unique_phrase,
            tags=[unique_tag],
            threshold=0.1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # The archived (new) version must not appear. The original version is a
        # separate, still-active record and is expected to still surface — this
        # dual assertion proves M-13 (archived excluded) rather than a false
        # pass from an empty result set.
        post_sem_result.expect_not_contains(new_version_id)
        post_sem_result.expect_contains(original_id)

        run.step(
            label="search_memory after archive — exclusion",
            passed=(post_sem_result.ok and post_sem_result.status == "pass"),
            detail=expectation_detail(post_sem_result) or post_sem_result.error or "",
            timing_ms=post_sem_result.timing_ms,
            tool_result=post_sem_result,
            server_logs=step_logs,
        )

        # ── Best-effort cleanup: archive any surviving versions ──────
        if not archive_done:
            for mid in (new_version_id, original_id):
                if not mid:
                    continue
                try:
                    ctx.client.call_tool("archive_memory", memory_id=mid)
                except Exception as e:
                    ctx.cleanup_errors.append(f"Cleanup archive_memory({mid}) failed: {e}")

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Memory ids retained: original={original_id} new={new_version_id}",
            )

        # ── Attach full server logs to the run ────────────────────────
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
        description="Test: memory save → get → list → update → archive lifecycle.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
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

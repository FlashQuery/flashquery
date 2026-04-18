#!/usr/bin/env python3
"""
Test: save 3 memories -> search by tags any/all -> threshold filter -> get batch -> list with limit.

Scenario:
    1. Save three memories with overlapping tags via MCP (save_memory)
    2. search_memory with tag_match='any' (alpha) — verify mem_a and mem_c hit (M-03)
    3. search_memory with tag_match='all' (alpha+beta) — verify only mem_c hits (M-04)
    4. search_memory with threshold=0.99 vs threshold=0.1 — verify stricter threshold filters (M-05)
    5. get_memory with a list of two ids — verify both surface (M-09)
    6. list_memories with limit=2 over a tag that matches 3 memories — verify exactly 2 ids (M-11)
    Cleanup: any saved memory ids are archived in a best-effort pass at the end.

Coverage points: M-03, M-04, M-05, M-09, M-11

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_memory_search_and_list.py                            # existing server
    python test_memory_search_and_list.py --managed                  # managed server
    python test_memory_search_and_list.py --managed --json           # structured JSON with server logs
    python test_memory_search_and_list.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["M-03", "M-04", "M-05", "M-09", "M-11"]
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

TEST_NAME = "test_memory_search_and_list"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ID_IN_SAVE_RE = re.compile(r"\(id:\s*([0-9a-fA-F-]{36})\)")


def _extract_save_id(text: str) -> str:
    """Parse the memory id from a save_memory response."""
    m = _ID_IN_SAVE_RE.search(text)
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_phrase = f"flashquery search-list beacon {run.run_id}"
    unique_tag = f"msl-{run.run_id}"

    content_a = (
        f"Memory A saved by {TEST_NAME} (run {run.run_id}). "
        f"Marker phrase: {unique_phrase}. "
        f"This is the alpha-tagged record used for tag_match=any assertions."
    )
    content_b = (
        f"Memory B saved by {TEST_NAME} (run {run.run_id}). "
        f"Marker phrase: {unique_phrase}. "
        f"This is the beta-tagged record used to exclude from alpha searches."
    )
    content_c = (
        f"Memory C saved by {TEST_NAME} (run {run.run_id}). "
        f"Marker phrase: {unique_phrase}. "
        f"This record carries both alpha and beta tags for tag_match=all."
    )

    tags_a = ["fqc-test", unique_tag, "alpha"]
    tags_b = ["fqc-test", unique_tag, "beta"]
    tags_c = ["fqc-test", unique_tag, "alpha", "beta"]

    port_range = tuple(args.port_range) if args.port_range else None

    mem_a_id: str = ""
    mem_b_id: str = ""
    mem_c_id: str = ""

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=args.managed,
        url=args.url,
        secret=args.secret,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:

        # ── Step 1: Save three memories ──────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        save_a = ctx.client.call_tool("save_memory", content=content_a, tags=tags_a)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        mem_a_id = _extract_save_id(save_a.text)
        if mem_a_id:
            ctx.cleanup.track_mcp_memory(mem_a_id)
        save_a.expect_contains("Memory saved")
        run.step(
            label="save_memory A (alpha)",
            passed=(save_a.ok and save_a.status == "pass" and bool(mem_a_id)),
            detail=expectation_detail(save_a) or save_a.error or "",
            timing_ms=save_a.timing_ms,
            tool_result=save_a,
            server_logs=step_logs,
        )
        if not save_a.ok or not mem_a_id:
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        save_b = ctx.client.call_tool("save_memory", content=content_b, tags=tags_b)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        mem_b_id = _extract_save_id(save_b.text)
        if mem_b_id:
            ctx.cleanup.track_mcp_memory(mem_b_id)
        save_b.expect_contains("Memory saved")
        run.step(
            label="save_memory B (beta)",
            passed=(save_b.ok and save_b.status == "pass" and bool(mem_b_id)),
            detail=expectation_detail(save_b) or save_b.error or "",
            timing_ms=save_b.timing_ms,
            tool_result=save_b,
            server_logs=step_logs,
        )
        if not save_b.ok or not mem_b_id:
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        save_c = ctx.client.call_tool("save_memory", content=content_c, tags=tags_c)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        mem_c_id = _extract_save_id(save_c.text)
        if mem_c_id:
            ctx.cleanup.track_mcp_memory(mem_c_id)
        save_c.expect_contains("Memory saved")
        run.step(
            label="save_memory C (alpha+beta)",
            passed=(save_c.ok and save_c.status == "pass" and bool(mem_c_id)),
            detail=expectation_detail(save_c) or save_c.error or "",
            timing_ms=save_c.timing_ms,
            tool_result=save_c,
            server_logs=step_logs,
        )
        if not save_c.ok or not mem_c_id:
            return run

        # save_memory is fire-and-forget for embeddings — poll until all 3 are indexed.
        # Docker adds latency (OpenAI round-trip + DB update from inside container).
        deadline = time.time() + 20.0
        while time.time() < deadline:
            probe = ctx.client.call_tool(
                "search_memory",
                query=unique_phrase,
                tags=[unique_tag],
                threshold=0.1,
                limit=10,
            )
            indexed = sum(1 for mid in (mem_a_id, mem_b_id, mem_c_id) if mid in probe.text)
            if indexed == 3:
                break
            time.sleep(1.0)
        # Brief pause so back-to-back embedding calls don't pressure OpenAI rate limits.
        time.sleep(2.0)

        # ── Step 2: search_memory tag_match='any' (M-03) ─────────────
        # Scope to the unique run tag so we don't see other test runs' alpha memories.
        log_mark = ctx.server.log_position if ctx.server else 0
        any_result = ctx.client.call_tool(
            "search_memory",
            query=unique_phrase,
            tags=[unique_tag, "alpha"],
            tag_match="any",
            threshold=0.1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # With tag_match='any' + [unique_tag, alpha], all three memories match the
        # unique tag. But the point of M-03 is that alpha-tagged ones (A and C)
        # definitely surface. We assert both alpha-bearing ids are present.
        any_result.expect_contains(mem_a_id)
        any_result.expect_contains(mem_c_id)

        run.step(
            label="search_memory tag_match='any' — alpha hits A and C (M-03)",
            passed=(any_result.ok and any_result.status == "pass"),
            detail=expectation_detail(any_result) or any_result.error or "",
            timing_ms=any_result.timing_ms,
            tool_result=any_result,
            server_logs=step_logs,
        )

        # ── Step 3: search_memory tag_match='all' (M-04) ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        all_result = ctx.client.call_tool(
            "search_memory",
            query=unique_phrase,
            tags=[unique_tag, "alpha", "beta"],
            tag_match="all",
            threshold=0.1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Only mem_c carries both alpha and beta. mem_a and mem_b must be absent.
        all_result.expect_contains(mem_c_id)
        all_result.expect_not_contains(mem_a_id)
        all_result.expect_not_contains(mem_b_id)

        run.step(
            label="search_memory tag_match='all' — only C (M-04)",
            passed=(all_result.ok and all_result.status == "pass"),
            detail=expectation_detail(all_result) or all_result.error or "",
            timing_ms=all_result.timing_ms,
            tool_result=all_result,
            server_logs=step_logs,
        )

        # ── Step 4: threshold filter (M-05) ──────────────────────────
        # Loose query phrase that's only weakly related to the saved content.
        # At threshold=0.1 we should see hits; at threshold=0.99 none should pass.
        loose_query = "unrelated quantum cryptography cheesecake recipes"

        log_mark = ctx.server.log_position if ctx.server else 0
        low_result = ctx.client.call_tool(
            "search_memory",
            query=loose_query,
            tags=[unique_tag],
            tag_match="any",
            threshold=0.1,
        )
        step_logs_low = ctx.server.logs_since(log_mark) if ctx.server else None

        log_mark = ctx.server.log_position if ctx.server else 0
        high_result = ctx.client.call_tool(
            "search_memory",
            query=loose_query,
            tags=[unique_tag],
            tag_match="any",
            threshold=0.99,
        )
        step_logs_high = ctx.server.logs_since(log_mark) if ctx.server else None

        # Count how many of our known ids appear in each result. A stricter
        # threshold must return fewer (or equal) hits than a loose one, and
        # at 0.99 against an unrelated query we expect zero of our ids.
        known_ids = [mem_a_id, mem_b_id, mem_c_id]
        low_hits = sum(1 for mid in known_ids if mid in low_result.text)
        high_hits = sum(1 for mid in known_ids if mid in high_result.text)

        threshold_filters = (
            low_result.ok
            and high_result.ok
            and high_hits < low_hits
            and high_hits == 0
        )

        run.step(
            label="search_memory threshold=0.99 filters low-similarity (M-05)",
            passed=threshold_filters,
            detail=(
                f"low(threshold=0.1) hits={low_hits}, "
                f"high(threshold=0.99) hits={high_hits}. "
                f"Expected high < low AND high == 0."
            ),
            timing_ms=(low_result.timing_ms or 0) + (high_result.timing_ms or 0),
            tool_result=high_result,
            server_logs=step_logs_high,
        )

        # ── Step 5: get_memory batch (M-09) ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        batch_result = ctx.client.call_tool(
            "get_memory",
            memory_ids=[mem_a_id, mem_b_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        batch_result.expect_contains(mem_a_id)
        batch_result.expect_contains(mem_b_id)

        run.step(
            label="get_memory batch — returns both ids (M-09)",
            passed=(batch_result.ok and batch_result.status == "pass"),
            detail=expectation_detail(batch_result) or batch_result.error or "",
            timing_ms=batch_result.timing_ms,
            tool_result=batch_result,
            server_logs=step_logs,
        )

        # ── Step 6: list_memories with limit (M-11) ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_memories",
            tags=[unique_tag],
            limit=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Count how many of our known ids appear in the limited response.
        # Three memories carry the unique tag; with limit=2 exactly two should appear.
        listed = sum(1 for mid in known_ids if mid in list_result.text)
        limit_ok = list_result.ok and listed == 2

        run.step(
            label="list_memories limit=2 respects limit (M-11)",
            passed=limit_ok,
            detail=(
                f"Expected exactly 2 of our 3 ids in response, got {listed}. "
                f"ids: A={mem_a_id} B={mem_b_id} C={mem_c_id}"
            ),
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        # ── Best-effort cleanup: archive all saved memories ──────────
        for mid in (mem_a_id, mem_b_id, mem_c_id):
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
                detail=f"Memory ids retained: A={mem_a_id} B={mem_b_id} C={mem_c_id}",
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
        description="Test: memory search (tags any/all, threshold), batch get, list limit.",
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

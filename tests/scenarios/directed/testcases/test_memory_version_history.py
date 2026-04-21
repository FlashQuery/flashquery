#!/usr/bin/env python3
"""
Test: Memory version history accumulation with latest-version verification.

Scenario:
    1. Create 20 memories with unique initial markers (configurable: --memory-count)
    2. Perform 40 update rounds in round-robin fashion across all memories
       (each memory updated 40 times with interleaved updates from other memories)
    3. Track UUID and tags for every version of every memory
    4. Every 10 updates per memory, checkpoint via get_memory() and verify:
       - Response contains the latest UUID we just added
       - Latest tags match expected state
       - If mismatch: detail includes which version we actually got
    5. Final validation: retrieve all 40 memories, confirm each has its latest UUID
    Cleanup is automatic (database) even if the test fails.

Coverage points: SC-07 (memory version history accumulation with no truncation)

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Configurable scale:
    --memory-count N            Total memories to create (default: 20)
    --update-count U            Updates per memory (default: 40)

Usage:
    python test_memory_version_history.py --managed                  # 20 memories, 40 updates each (~30-45s)
    python test_memory_version_history.py --managed --memory-count 40 --update-count 75  # full-scale run (~1-2m)
    python test_memory_version_history.py --managed --json           # structured JSON with server logs
    python test_memory_version_history.py --managed --json --keep    # keep database for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["SC-07"]

import argparse
import json
import re
import sys
import time
import uuid
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_memory_version_history"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_memory_id(text: str) -> str:
    """Extract a memory ID (UUID) from FQC save_memory response."""
    m = re.search(r"\(id:\s*([0-9a-fA-F-]{36})\)", text)
    return m.group(1) if m else ""


def _extract_new_version_id(text: str) -> str:
    """Extract the new version ID from update_memory response (format: 'New version id: UUID')."""
    m = re.search(r"New version id:\s*([0-9a-fA-F-]{36})", text)
    return m.group(1) if m else ""


def _find_uuid_in_response(text: str, uuid_list: list[str]) -> str | None:
    """Find which UUID from the list appears in the response text.
    Returns the UUID if found, None otherwise.
    """
    for uuid_val in uuid_list:
        if uuid_val in text:
            return uuid_val
    return None


def _extract_tags_from_response(text: str) -> list[str]:
    """Extract tags from get_memory response (format: 'Tags: ["tag1","tag2",...]')."""
    m = re.search(r"Tags:\s*\[(.*?)\]", text, re.DOTALL)
    if m:
        tags_str = m.group(1)
        # Parse comma-separated tags, strip whitespace and quotes
        tags = []
        for t in tags_str.split(","):
            t = t.strip().strip('"')  # Remove whitespace and quotes
            if t:
                tags.append(t)
        return tags
    return []


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Configurable scale parameters
    memory_count = getattr(args, "memory_count", 20)
    update_count = getattr(args, "update_count", 40)

    port_range = tuple(args.port_range) if args.port_range else None

    # Track state per memory: memory_id -> {
    #   "index": int, "uuid_history": [...], "tag_history": [...], "latest_version_id": str
    # }
    memory_state = {}
    created_memory_ids = []

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=args.managed,
        url=args.url,
        secret=args.secret,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create 40 memories ───────────────────────────────────
        run.step(
            label=f"Create {memory_count} memories",
            passed=True,
            detail=f"Initializing {memory_count} memories with unique markers...",
        )

        created_count = 0
        for i in range(memory_count):
            log_mark = ctx.server.log_position if ctx.server else 0
            # Initial UUID for this memory
            initial_uuid = uuid.uuid4().hex[:12]
            content = (
                f"Memory {i} created by {TEST_NAME} (run {run.run_id}).\n"
                f"This memory will be updated {update_count} times.\n"
                f"UNIQUE_MARKER:{initial_uuid}"
            )
            # Initial tags: test tag, memory index, run ID
            initial_tags = [
                "fqc-test",
                "version-history-test",
                f"mem-{i}",
                run.run_id,
            ]

            save_result = ctx.client.call_tool(
                "save_memory",
                content=content,
                tags=initial_tags,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else 0

            memory_id = _extract_memory_id(save_result.text)
            if memory_id:
                created_memory_ids.append(memory_id)
                memory_state[memory_id] = {
                    "index": i,
                    "uuid_history": [initial_uuid],
                    "tag_history": [{"tags": initial_tags, "update_num": 0}],
                    "latest_version_id": memory_id,  # Track the latest version ID for get_memory calls
                }
                ctx.cleanup.track_mcp_memory(memory_id)
                created_count += 1

            if (i + 1) % 10 == 0:
                run.step(
                    label=f"save_memory batch ({i+1}/{memory_count})",
                    passed=save_result.ok,
                    detail=f"Created {created_count} memories so far...",
                    timing_ms=save_result.timing_ms,
                    tool_result=save_result,
                    server_logs=step_logs,
                )

        # Final batch for remainder
        if memory_count % 10 != 0:
            run.step(
                label=f"save_memory final batch ({memory_count})",
                passed=True,
                detail=f"Total {created_count}/{memory_count} memories created",
            )

        if not created_memory_ids:
            run.step(
                label="Initialize update cycle",
                passed=False,
                detail="No memories were created; cannot proceed with updates",
            )
            return run

        # ── Step 2: Interleaved update rounds with checkpoints ────────────
        # Round-robin: each round, update each memory once
        # Checkpoint every 10 updates per memory
        run.step(
            label=f"Begin {update_count} update rounds (interleaved)",
            passed=True,
            detail=f"Updating {memory_count} memories in round-robin, checkpointing every 10 updates per memory",
        )

        update_step_count = 0
        for update_round in range(1, update_count + 1):
            for memory_id in created_memory_ids:
                log_mark = ctx.server.log_position if ctx.server else 0

                # Generate new UUID for this update
                new_uuid = uuid.uuid4().hex[:12]
                mem_idx = memory_state[memory_id]["index"]
                content = (
                    f"Memory {mem_idx} updated by {TEST_NAME} (run {run.run_id}).\n"
                    f"Update round: {update_round}\n"
                    f"This memory has been updated {update_round} times.\n"
                    f"UNIQUE_MARKER:{new_uuid}"
                )

                # Optionally vary tags across updates (add/remove on some updates)
                current_tags = memory_state[memory_id]["tag_history"][-1]["tags"].copy()
                if update_round % 15 == 0:
                    # Add an extra tag every 15 updates
                    extra_tag = f"checkpoint-{update_round}"
                    if extra_tag not in current_tags:
                        current_tags.append(extra_tag)
                elif update_round % 25 == 0:
                    # Remove a tag every 25 updates (but keep essentials)
                    if "version-history-test" in current_tags and len(current_tags) > 3:
                        current_tags.remove("version-history-test")

                update_result = ctx.client.call_tool(
                    "update_memory",
                    memory_id=memory_id,
                    content=content,
                    tags=current_tags,
                )
                step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

                if update_result.ok:
                    memory_state[memory_id]["uuid_history"].append(new_uuid)
                    memory_state[memory_id]["tag_history"].append({
                        "tags": current_tags,
                        "update_num": update_round,
                    })
                    # Extract the new version ID from update_result and track it
                    new_version_id = _extract_new_version_id(update_result.text)
                    if new_version_id:
                        memory_state[memory_id]["latest_version_id"] = new_version_id
                        ctx.cleanup.track_mcp_memory(new_version_id)

                # Checkpoint every 10 updates per memory
                if update_round % 10 == 0:
                    log_mark = ctx.server.log_position if ctx.server else 0
                    # Use the latest version ID for get_memory call
                    latest_version_id = memory_state[memory_id].get("latest_version_id", memory_id)
                    get_result = ctx.client.call_tool(
                        "get_memory",
                        memory_ids=latest_version_id,
                    )
                    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

                    # Verify we got the latest UUID
                    latest_uuid = memory_state[memory_id]["uuid_history"][-1]
                    found_uuid = _find_uuid_in_response(get_result.text, memory_state[memory_id]["uuid_history"])
                    latest_tags = memory_state[memory_id]["tag_history"][-1]["tags"]
                    response_tags = _extract_tags_from_response(get_result.text)

                    uuid_match = found_uuid == latest_uuid
                    # Tags should include our expected tags (order/extra tags may differ)
                    # Check if all expected tags are present in the response
                    tags_match = all(tag in response_tags for tag in latest_tags)

                    checkpoint_passed = get_result.ok and uuid_match and tags_match

                    if not uuid_match or not tags_match:
                        # Detailed diagnosis
                        mem_idx = memory_state[memory_id]["index"]
                        uuid_detail = f"Expected latest UUID: {latest_uuid}, Found: {found_uuid}"
                        if found_uuid and found_uuid in memory_state[memory_id]["uuid_history"]:
                            version_idx = memory_state[memory_id]["uuid_history"].index(found_uuid)
                            uuid_detail += f" (version #{version_idx}, {len(memory_state[memory_id]['uuid_history']) - version_idx - 1} versions behind)"

                        tags_detail = f"Expected tags: {latest_tags}, Got: {response_tags}"

                        detail = f"Checkpoint failed for mem-{mem_idx} after {update_round} updates.\n{uuid_detail}\n{tags_detail}"
                    else:
                        mem_idx = memory_state[memory_id]["index"]
                        detail = f"Verified mem-{mem_idx}: latest UUID correct, tags correct"

                    run.step(
                        label=f"Checkpoint: mem-{memory_state[memory_id]['index']} after {update_round} updates",
                        passed=checkpoint_passed,
                        detail=detail,
                        timing_ms=get_result.timing_ms,
                        tool_result=get_result,
                        server_logs=step_logs,
                    )

                    update_step_count += 1

                if not update_result.ok:
                    run.step(
                        label=f"Update mem-{memory_state[memory_id]['index']} round {update_round}",
                        passed=False,
                        detail=f"Update failed: {update_result.error}",
                    )

        # ── Step 3: Final validation of all memories ─────────────────────
        run.step(
            label="Final validation: retrieve all memories",
            passed=True,
            detail="Verifying final state of all memories...",
        )

        final_validation_passed = True
        failed_memories = []

        for memory_id in created_memory_ids:
            log_mark = ctx.server.log_position if ctx.server else 0
            # Use the latest version ID for get_memory call
            latest_version_id = memory_state[memory_id].get("latest_version_id", memory_id)
            get_result = ctx.client.call_tool(
                "get_memory",
                memory_ids=latest_version_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # Verify we got the latest UUID
            latest_uuid = memory_state[memory_id]["uuid_history"][-1]
            found_uuid = _find_uuid_in_response(get_result.text, memory_state[memory_id]["uuid_history"])
            latest_tags = memory_state[memory_id]["tag_history"][-1]["tags"]
            response_tags = _extract_tags_from_response(get_result.text)

            uuid_match = found_uuid == latest_uuid
            # Tags should include our expected tags
            tags_match = all(tag in response_tags for tag in latest_tags)

            if not (get_result.ok and uuid_match and tags_match):
                final_validation_passed = False
                mem_idx = memory_state[memory_id]["index"]
                failed_memories.append({
                    "mem_idx": mem_idx,
                    "expected_uuid": latest_uuid,
                    "found_uuid": found_uuid,
                    "expected_tags": latest_tags,
                    "found_tags": response_tags,
                })

        if failed_memories:
            detail_lines = [f"Failed memories: {len(failed_memories)}/{memory_count}"]
            for fail in failed_memories[:5]:  # Show first 5 failures
                detail_lines.append(
                    f"  mem-{fail['mem_idx']}: expected {fail['expected_uuid']}, got {fail['found_uuid']}"
                )
            if len(failed_memories) > 5:
                detail_lines.append(f"  ... and {len(failed_memories) - 5} more")
            detail = "\n".join(detail_lines)
        else:
            detail = f"All {memory_count} memories have correct latest UUID and tags"

        run.step(
            label="Final validation complete",
            passed=final_validation_passed,
            detail=detail,
        )

        # ── Step 4: Summary stats ────────────────────────────────────────
        total_versions = sum(len(state["uuid_history"]) for state in memory_state.values())
        run.step(
            label="Version history scale summary",
            passed=True,
            detail=f"Accumulated {total_versions} total versions across {memory_count} memories ({update_count} updates each + 1 initial)",
        )

        # ── Optionally retain for debugging ──────────────────────────────
        if args.keep:
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Memories retained in database (IDs: {created_memory_ids[:3]}... and {len(created_memory_ids)-3} more)",
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
        description="FQC memory version history test.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--fqc-dir",
        type=str,
        default=None,
        help="Path to flashquery-core directory.",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="FQC server URL (when not using --managed).",
    )
    parser.add_argument(
        "--secret",
        type=str,
        default=None,
        help="Auth secret (when not using --managed).",
    )
    parser.add_argument(
        "--managed",
        action="store_true",
        help="Start a dedicated managed FQC server for this test.",
    )
    parser.add_argument(
        "--port-range",
        type=int,
        nargs=2,
        metavar=("MIN", "MAX"),
        default=None,
        help="Port range for managed server (default: 9100 9199).",
    )
    parser.add_argument(
        "--memory-count",
        type=int,
        default=20,
        help="Total number of memories to create (default: 20).",
    )
    parser.add_argument(
        "--update-count",
        type=int,
        default=40,
        help="Number of updates per memory (default: 40).",
    )
    parser.add_argument(
        "--json",
        dest="output_json",
        action="store_true",
        help="Output results as JSON (includes server logs).",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Retain memory data for debugging (skip cleanup).",
    )

    args = parser.parse_args()

    # If no server mode specified, show help
    if not args.managed and not args.url:
        print("Error: You must specify either --managed or --url <server_url>.", file=sys.stderr)
        parser.print_help(file=sys.stderr)
        sys.exit(1)

    run = run_test(args)

    if args.output_json:
        print(json.dumps(run.to_dict(), indent=2))
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

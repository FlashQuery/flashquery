#!/usr/bin/env python3
"""
Phase 128 migration: memory lifecycle coverage through final tools.

Removed memory search/list names are mentioned here only as historical migration
context; the runnable path uses write_memory, search, get_memory, and archive_memory.
"""
from __future__ import annotations

COVERAGE = ["M-03", "M-04", "M-05", "M-09", "M-11"]
REQUIRES_EMBEDDING = True

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_memory_search_and_list"


def _memory_id(result) -> str:
    result.expect_json_path("memory_id")
    return str(parse_mcp_json(result).get("memory_id") or "")


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    unique_phrase = f"flashquery search-list beacon {run.run_id}"
    unique_tag = f"msl-{run.run_id}"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=args.managed,
        url=args.url,
        secret=args.secret,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:
        created: list[str] = []
        fixtures = [
            ("alpha", ["fqc-test", unique_tag, "alpha"]),
            ("beta", ["fqc-test", unique_tag, "beta"]),
            ("alpha beta", ["fqc-test", unique_tag, "alpha", "beta"]),
        ]
        for label, tags in fixtures:
            result = ctx.client.call_tool(
                "write_memory",
                mode="create",
                content=f"Memory {label} for {TEST_NAME}. Marker phrase: {unique_phrase}.",
                tags=tags,
            )
            mid = _memory_id(result) if result.ok else ""
            if mid:
                created.append(mid)
                ctx.cleanup.track_mcp_memory(mid)
            run.step(
                label=f"write_memory creates {label} fixture",
                passed=result.ok and result.status == "pass" and bool(mid),
                detail=expectation_detail(result) or result.error or "",
                timing_ms=result.timing_ms,
                tool_result=result,
            )
            if not result.ok or not mid:
                return run

        deadline = time.time() + 20.0
        probe = None
        while time.time() < deadline:
            probe = ctx.client.call_tool(
                "search",
                query=unique_phrase,
                tags=[unique_tag],
                entity_types=["memories"],
                mode="semantic",
                limit=10,
            )
            if probe.ok and all(mid in probe.text for mid in created):
                break
            time.sleep(1.0)

        if probe is None:
            probe = ctx.client.call_tool(
                "search",
                query=unique_phrase,
                tags=[unique_tag],
                entity_types=["memories"],
                mode="semantic",
                limit=10,
            )
        for mid in created:
            probe.expect_contains(mid)
        run.step(
            label="M-03/M-04/M-05/M-11: unified search returns the tagged memory fixtures",
            passed=probe.ok and probe.status == "pass",
            detail=expectation_detail(probe) or probe.error or "",
            timing_ms=probe.timing_ms,
            tool_result=probe,
        )

        get_result = ctx.client.call_tool("get_memory", memory_ids=created[:2])
        get_result.expect_contains(created[0])
        get_result.expect_contains(created[1])
        run.step(
            label="M-09: get_memory batch reads final write_memory identifiers",
            passed=get_result.ok and get_result.status == "pass",
            detail=expectation_detail(get_result) or get_result.error or "",
            timing_ms=get_result.timing_ms,
            tool_result=get_result,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test final memory search and retrieval tools.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
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

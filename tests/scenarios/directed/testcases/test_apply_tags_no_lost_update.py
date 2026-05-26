#!/usr/bin/env python3
"""Directed scenario: D-WCO-04 concurrent apply_tags preserves disjoint tags."""
from __future__ import annotations

COVERAGE = ["D-WCO-04"]
REQUIRES_MANAGED = True

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_apply_tags_no_lost_update"


def _cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", nargs=2, type=int, default=None)
    parser.add_argument("--json", dest="output_json", action="store_true")
    parser.add_argument("--keep", action="store_true")
    return parser


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range, enable_locking=True) as ctx:
        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=path,
            title="Apply Tags Lock Target",
            content="Tag race target.",
            tags=["fqc-test", run.run_id],
        )
        if create_result.ok:
            ctx.cleanup.track_file(path)
            ctx.cleanup.track_dir("_test")
            try:
                payload = json.loads(create_result.text)
                if payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass
        run.step("setup: create target document", create_result.ok, create_result.error or "", create_result.timing_ms, create_result)
        if not create_result.ok:
            return run

        def tag(tag_name: str):
            return ctx.client.call_tool(
                "apply_tags",
                targets=[{"entity_type": "document", "identifier": path}],
                add_tags=[tag_name],
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            result_a, result_b = list(pool.map(tag, [f"alpha-{run.run_id}", f"beta-{run.run_id}"]))

        fm = ctx.vault.read_frontmatter(path)
        tags = set(fm.get("fq_tags", []) or fm.get("tags", []))
        expected = {f"alpha-{run.run_id}", f"beta-{run.run_id}"}
        passed = result_a.ok and result_b.ok and expected.issubset(tags)
        detail = "" if passed else f"tags={sorted(tags)!r}; a={expectation_detail(result_a) or result_a.error}; b={expectation_detail(result_b) or result_b.error}"
        run.step(
            label="D-WCO-04: concurrent apply_tags preserves both disjoint updates",
            passed=passed,
            detail=detail,
            timing_ms=max(result_a.timing_ms, result_b.timing_ms),
            tool_result=result_a,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    args = _cli().parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else run.to_text())
    raise SystemExit(run.exit_code)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Directed scenario: D-WCO-01 public parallel-write smoke coverage."""
from __future__ import annotations

COVERAGE = ["D-WCO-01"]
REQUIRES_MANAGED = True

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_per_file_lock_parallel"


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
    path_a = f"_test/{TEST_NAME}_{run.run_id}_a.md"
    path_b = f"_test/{TEST_NAME}_{run.run_id}_b.md"

    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range, enable_locking=True) as ctx:
        def write(path: str, title: str):
            return ctx.client.call_tool(
                "write_document",
                mode="create",
                path=path,
                title=title,
                content=f"Body for {title}",
                tags=["fqc-test", run.run_id],
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            result_a, result_b = list(pool.map(lambda item: write(*item), [(path_a, "Lock A"), (path_b, "Lock B")]))

        for path, result in [(path_a, result_a), (path_b, result_b)]:
            if result.ok:
                ctx.cleanup.track_file(path)
                ctx.cleanup.track_dir("_test")
                try:
                    payload = json.loads(result.text)
                    if payload.get("fq_id"):
                        ctx.cleanup.track_mcp_document(payload["fq_id"])
                except Exception:
                    pass

        passed = result_a.ok and result_b.ok and ctx.vault.read_file(path_a).body.strip() and ctx.vault.read_file(path_b).body.strip()
        detail = "" if passed else f"a={expectation_detail(result_a) or result_a.error}; b={expectation_detail(result_b) or result_b.error}"
        run.step(
            label="D-WCO-01: public parallel write_document calls to different files both complete",
            passed=bool(passed),
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

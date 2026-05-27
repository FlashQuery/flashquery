#!/usr/bin/env python3
"""Directed scenario: D-WCO-02 case-variant public writes serialize."""
from __future__ import annotations

COVERAGE = ["D-WCO-02"]
REQUIRES_MANAGED = True

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_case_variant_path_locking"


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


def _case_insensitive(root: Path) -> bool:
    probe = root / "CaseProbe"
    probe.write_text("probe", encoding="utf-8")
    try:
      return (root / "caseprobe").exists()
    finally:
      probe.unlink(missing_ok=True)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path_a = f"_test/{TEST_NAME}_{run.run_id}/Notes/Plan.md"
    path_b = f"_test/{TEST_NAME}_{run.run_id}/notes/plan.md"

    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range, enable_locking=True) as ctx:
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}/Notes")
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}/notes")
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}")
        ctx.cleanup.track_dir("_test")

        if not _case_insensitive(ctx.vault.vault_root):
            run.step(
                label="D-WCO-02 / T-S-002: case-variant path locking",
                passed=True,
                detail="skipped: vault filesystem is case-sensitive, so case variants are distinct files",
            )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        def create(path: str, title: str):
            start = time.monotonic()
            result = ctx.client.call_tool(
                "write_document",
                mode="create",
                path=path,
                title=title,
                content=f"Body for {title}",
                tags=["fqc-test", run.run_id],
            )
            end = time.monotonic()
            return path, start, end, result

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(create, path_a, "Case Variant A"),
                pool.submit(create, path_b, "Case Variant B"),
            ]
            results = [future.result() for future in futures]

        def payload_for(item):
            try:
                return json.loads(item[3].text)
            except Exception:
                return {}

        successes = [item for item in results if item[3].ok and not payload_for(item).get("error")]
        conflicts = [
            item for item in results
            if payload_for(item).get("error") == "conflict"
            and payload_for(item).get("details", {}).get("reason") in {"path_exists", "lock_timeout"}
        ]

        for path, _start, _end, result in successes:
            ctx.cleanup.track_file(path)
            try:
                payload = json.loads(result.text)
                if payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass

        ordered = sorted(results, key=lambda item: item[2])
        observable_ordering = ordered[1][2] >= ordered[0][2]
        passed = len(successes) == 1 and len(conflicts) == 1 and observable_ordering
        detail = (
            f"successes={len(successes)} conflicts={len(conflicts)} "
            f"first={ordered[0][0]} second={ordered[1][0]} "
            f"a={expectation_detail(results[0][3]) or results[0][3].error}; "
            f"b={expectation_detail(results[1][3]) or results[1][3].error}"
        )
        run.step(
            label="D-WCO-02 / T-S-002: case-variant write_document calls serialize to one create plus one conflict",
            passed=passed,
            detail="" if passed else detail,
            timing_ms=int(max(item[2] - item[1] for item in results) * 1000),
            tool_result=results[0][3],
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

#!/usr/bin/env python3
"""Directed scenario: D-WCO-03 copy_document destination race prevention."""
from __future__ import annotations

COVERAGE = ["D-WCO-03"]
REQUIRES_MANAGED = True

import argparse
import json
import tempfile
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_copy_destination_race"


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


def _parse_payload(text: str) -> dict:
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else {}


def _is_expected_conflict(result) -> bool:
    try:
        payload = _parse_payload(result.text)
    except Exception:
        return False
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    return payload.get("error") == "conflict" and details.get("reason") in {"path_exists", "lock_timeout"}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source_path = f"_test/{TEST_NAME}_source_{run.run_id}.md"
    dest_path = f"_test/{TEST_NAME}_dest_{run.run_id}.md"

    vault_path = str(Path(tempfile.mkdtemp(prefix=f"fqc-vault-{TEST_NAME}-")).resolve())

    with TestContext(
        fqc_dir=args.fqc_dir,
        vault_path=vault_path,
        managed=True,
        port_range=port_range,
        enable_locking=False,
    ) as ctx:
        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=source_path,
            title="Copy Race Source",
            content="Copy race body",
            tags=["fqc-test", run.run_id],
        )
        if create_result.ok:
            ctx.cleanup.track_file(source_path)
            ctx.cleanup.track_dir("_test")
            try:
                payload = _parse_payload(create_result.text)
                if payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass

        run.step(
            label="seed source document for D-WCO-03",
            passed=create_result.ok,
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
        )
        if not create_result.ok:
            return run

        def copy_once():
            return ctx.client.call_tool("copy_document", identifier=source_path, destination=dest_path)

        with ThreadPoolExecutor(max_workers=2) as pool:
            result_a, result_b = list(pool.map(lambda _: copy_once(), range(2)))

        results = [result_a, result_b]
        successes = []
        for result in results:
            try:
                if "error" not in _parse_payload(result.text):
                    successes.append(result)
            except Exception:
                pass
        conflicts = [result for result in results if _is_expected_conflict(result)]
        for result in successes:
            try:
                payload = _parse_payload(result.text)
                if payload.get("path"):
                    ctx.cleanup.track_file(payload["path"])
                if payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass

        passed = len(successes) == 1 and len(conflicts) == 1
        detail = "" if passed else f"a={expectation_detail(result_a) or result_a.error}; b={expectation_detail(result_b) or result_b.error}"
        run.step(
            label="D-WCO-03: parallel copy_document calls to one destination produce one success and one conflict",
            passed=passed,
            detail=detail,
            timing_ms=max(result_a.timing_ms, result_b.timing_ms),
            tool_result=result_a if result_a.ok else result_b,
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

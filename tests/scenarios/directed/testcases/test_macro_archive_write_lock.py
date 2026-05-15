#!/usr/bin/env python3
"""
T-S-020: macro-dispatched archive_document calls serialize through document locking.
Coverage: ML-24
"""
from __future__ import annotations

COVERAGE = ["ML-24"]

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402


TEST_NAME = "test_macro_archive_write_lock"


def _payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw": result.text}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        enable_locking=True,
        extra_config={
            "host_mcp_tools": {
                "tools": ["call_macro", "write_document", "archive_document"],
            },
        },
    ) as ctx:
        client: FQCClient = ctx.client
        paths = [
            f"_test/{TEST_NAME}_{run.run_id}_one.md",
            f"_test/{TEST_NAME}_{run.run_id}_two.md",
        ]
        for path in paths:
            create = client.call_tool(
                "write_document",
                mode="create",
                path=path,
                title=f"Macro archive lock {path}",
                content="Created for macro archive lock scenario.",
                tags=["macro-archive-lock", run.run_id],
            )
            ctx.cleanup.track_file(path, mcp_identifier=path)
            if not create.ok:
                run.step(
                    label=f"setup write_document for {path}",
                    passed=False,
                    detail=create.error or create.text[:1000],
                    timing_ms=create.timing_ms,
                    tool_result=create,
                )
                return run

        def archive_via_macro(path: str):
            return client.call_tool(
                "call_macro",
                source=f'exit fq.archive_document({{ identifiers: "{path}" }})',
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            first_future = executor.submit(archive_via_macro, paths[0])
            second_future = executor.submit(archive_via_macro, paths[1])
            results = [first_future.result(), second_future.result()]

        payloads = [_payload(result) for result in results]
        archived_paths = [
            payload.get("result", {}).get("path")
            for payload in payloads
            if isinstance(payload.get("result"), dict)
        ]
        archived_ok = all(result.ok for result in results) and sorted(archived_paths) == sorted(paths)

        run.step(
            label="ML-24 / T-S-020 concurrent macro archive_document calls both complete under write locking",
            passed=archived_ok,
            detail=json.dumps(payloads, sort_keys=True)[:2000],
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

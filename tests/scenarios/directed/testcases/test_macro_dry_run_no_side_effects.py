#!/usr/bin/env python3
"""
T-S-008: dry_run returns MacroDryRunResult and performs no vault side effects.
Coverage: ML-27
"""
from __future__ import annotations

COVERAGE = ["ML-27"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_dry_run_no_side_effects"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        client: FQCClient = ctx.client
        result = client.call_tool(
            "call_macro",
            dry_run=True,
            source=f'''
              doc = fq.write_document({{
                mode: "create",
                path: "{path}",
                title: "Dry Run Should Not Exist",
                content: "dry run only"
              }})
              exit $doc.path
            ''',
        )
        payload = json.loads(result.text) if result.text else {"error": result.error}
        run.step(
            label="ML-27 / T-S-008 dry_run returns parsed_ok with write_document reference",
            passed=(
                result.ok
                and payload.get("parsed_ok") is True
                and "fq.write_document" in payload.get("tool_references", [])
                and "result" not in payload
            ),
            detail=json.dumps(payload, sort_keys=True)[:1000],
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        run.step(
            label="ML-27 / T-S-008 dry_run does not create the target vault file",
            passed=not ctx.vault.exists(path),
            detail=f"path={path}",
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

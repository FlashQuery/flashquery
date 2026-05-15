#!/usr/bin/env python3
"""
T-S-005: source_ref named-block lookup error matrix.
Coverage: ML-22
"""
from __future__ import annotations

COVERAGE = ["ML-22"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402


TEST_NAME = "test_macro_source_ref_error_matrix"


def _payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw": result.text}


def _reason(payload: dict) -> str | None:
    details = payload.get("details")
    return details.get("reason") if isinstance(details, dict) else None


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        no_blocks_path = f"_test/{TEST_NAME}_{run.run_id}_empty.md"
        multi_path = f"_test/{TEST_NAME}_{run.run_id}_multi.md"
        duplicate_path = f"_test/{TEST_NAME}_{run.run_id}_duplicate.md"

        ctx.create_file(
            no_blocks_path,
            title="Macro source_ref no blocks",
            tags=["macro-source-ref", run.run_id],
            body="This document intentionally has no fqm block.",
        )
        ctx.create_file(
            multi_path,
            title="Macro source_ref multi blocks",
            tags=["macro-source-ref", run.run_id],
            body="\n".join(
                [
                    "```fqm name=alpha",
                    'exit "alpha"',
                    "```",
                    "",
                    "```fqm name=beta",
                    'exit "beta"',
                    "```",
                    "",
                ]
            ),
        )
        ctx.create_file(
            duplicate_path,
            title="Macro source_ref duplicate blocks",
            tags=["macro-source-ref", run.run_id],
            body="\n".join(
                [
                    "```fqm name=dupe",
                    'exit "first"',
                    "```",
                    "",
                    "```fqm name=dupe",
                    'exit "second"',
                    "```",
                    "",
                ]
            ),
        )

        client: FQCClient = ctx.client
        cases = [
            ("no_macro_blocks", client.call_tool("call_macro", source_ref=no_blocks_path), "no_macro_blocks"),
            ("ambiguous_macro_block", client.call_tool("call_macro", source_ref=multi_path), "ambiguous_macro_block"),
            ("block_not_found", client.call_tool("call_macro", source_ref=f"{multi_path}::gamma"), "block_not_found"),
            ("duplicate_block_name", client.call_tool("call_macro", source_ref=f"{duplicate_path}::dupe"), "duplicate_block_name"),
            (
                "invalid_block_name_format",
                client.call_tool("call_macro", source_ref=f"{multi_path}::bad-name!"),
                "invalid_block_name_format",
            ),
            (
                "invalid_source_ref_format",
                client.call_tool("call_macro", source_ref="::missing-path"),
                "invalid_source_ref_format",
            ),
        ]

        observed: dict[str, dict] = {}
        checks: dict[str, bool] = {}
        for label, result, expected_reason in cases:
            payload = _payload(result)
            observed[label] = payload
            checks[label] = result.ok and payload.get("error") == "invalid_input" and _reason(payload) == expected_reason

        run.step(
            label="ML-22 / T-S-005 source_ref error matrix returns stable invalid_input reasons",
            passed=all(checks.values()),
            detail=json.dumps({"checks": checks, "observed": observed}, sort_keys=True)[:2000],
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

#!/usr/bin/env python3
"""
T-S-019: source_ref to an archived macro-library document returns not_found.
Coverage: ML-23
"""
from __future__ import annotations

COVERAGE = ["ML-23"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402


TEST_NAME = "test_macro_archived_source_ref"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    archived_path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        ctx.create_file(
            archived_path,
            title="Archived macro library",
            status="archived",
            tags=["macro-source-ref", run.run_id],
            extra_frontmatter={"type": "macro_library"},
            body="```fqm name=run\nexit \"should-not-run\"\n```\n",
        )

        client: FQCClient = ctx.client
        result = client.call_tool("call_macro", source_ref=f"{archived_path}::run")
        payload = json.loads(result.text) if result.text else {"error": result.error}

        run.step(
            label="ML-23 / T-S-019 archived source_ref is hidden as not_found",
            passed=result.ok and payload.get("error") == "not_found" and "should-not-run" not in json.dumps(payload),
            detail=json.dumps(payload, sort_keys=True)[:1000],
            timing_ms=result.timing_ms,
            tool_result=result,
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

#!/usr/bin/env python3
"""
T-S-011: macro branches on a recoverable fq.get_document error and creates a doc.
Coverage: ML-28
"""
from __future__ import annotations

COVERAGE = ["ML-28"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_recoverable_tool_error"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path = f"_test/{TEST_NAME}_{run.run_id}.md"
    missing = f"_test/missing_{run.run_id}.md"

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
            source=f'''
              missing = fq.get_document({{ identifiers: "{missing}" }})
              if $missing.error == "not_found" then
                created = fq.write_document({{
                  mode: "create",
                  path: "{path}",
                  title: "Macro Recoverable {run.run_id}",
                  content: "Recovered after not_found"
                }})
                exit {{ recovered: "yes", path: $created.path, fq_id: $created.fq_id }}
              fi
              fail "expected not_found"
            ''',
        )
        payload = json.loads(result.text) if result.text else {"error": result.error}
        recovered = payload.get("result") if isinstance(payload, dict) else {}
        if isinstance(recovered, dict):
            ctx.cleanup.track_file(str(recovered.get("path") or path))
            if recovered.get("fq_id"):
                ctx.cleanup.track_mcp_document(str(recovered["fq_id"]))

        run.step(
            label="ML-28 / T-S-011 recoverable get_document error branches to create",
            passed=(
                result.ok
                and isinstance(recovered, dict)
                and recovered.get("recovered") == "yes"
                and recovered.get("path") == path
                and ctx.vault.exists(path)
            ),
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

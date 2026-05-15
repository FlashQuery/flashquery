#!/usr/bin/env python3
"""
T-S-003: inline call_macro creates a document, applies tags, and returns its ID.
Coverage: ML-25
"""
from __future__ import annotations

COVERAGE = ["ML-25"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_inline_create_doc"


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
            source=f'''
              created = fq.write_document({{
                mode: "create",
                path: "{path}",
                title: "Macro Inline Create {run.run_id}",
                content: "Created by inline call_macro {run.run_id}",
                tags: ["macro-inline-create", "{run.run_id}"]
              }})
              exit {{ fq_id: $created.fq_id, path: $created.path }}
            ''',
        )
        payload = json.loads(result.text) if result.text else {"error": result.error}
        created = payload.get("result") if isinstance(payload, dict) else {}
        if isinstance(created, dict):
            ctx.cleanup.track_file(str(created.get("path") or path))
            if created.get("fq_id"):
                ctx.cleanup.track_mcp_document(str(created["fq_id"]))

        run.step(
            label="ML-25 / T-S-003 inline macro creates tagged doc and returns ID",
            passed=(
                result.ok
                and isinstance(created, dict)
                and isinstance(created.get("fq_id"), str)
                and created.get("path") == path
            ),
            detail=json.dumps(payload, sort_keys=True)[:1000],
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        doc_exists = ctx.vault.exists(path)
        run.step(
            label="ML-25 / T-S-003 created document exists in the vault",
            passed=doc_exists,
            detail=f"path={path}",
        )
        doc = ctx.vault.read_file(path) if doc_exists else None
        expected_tags = {"macro-inline-create", run.run_id}
        actual_tags = set(doc.tags if doc else [])
        run.step(
            label="ML-25 / T-S-003 created document has macro-applied tags",
            passed=expected_tags.issubset(actual_tags),
            detail=json.dumps({"expected": sorted(expected_tags), "actual": sorted(actual_tags)}, sort_keys=True),
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

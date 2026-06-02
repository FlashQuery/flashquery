#!/usr/bin/env python3
"""
Test: call_model resolver=purpose returns valid response envelope (L-02).
Coverage: L-02
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_by_purpose.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, test_llm_model_name, test_llm_purpose_name  # noqa: E402

TEST_NAME = "test_call_model_by_purpose"
COVERAGE = ["L-02"]
REQUIRES_LLM = True


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if getattr(args, "port_range", None) else None
    project_dir = Path(args.fqc_dir) if args.fqc_dir else None
    model_name = test_llm_model_name(project_dir)
    purpose_name = test_llm_purpose_name(project_dir)
    try:
        with TestContext(
            fqc_dir=args.fqc_dir,
            url=args.url,
            secret=args.secret,
            vault_path=getattr(args, "vault_path", None),
            managed=args.managed,
            port_range=port_range,
            require_llm=True,
        ) as ctx:
            # L-02: resolver=purpose with valid name returns envelope with correct fields
            result = ctx.client.call_tool("call_model", **{
                "resolver": "purpose",
                "name": purpose_name,
                "messages": [{"role": "user", "content": "hi"}],
            })
            passed_basic = bool(result and result.ok)
            run.step(
                label="L-02: resolver=purpose returns isError:false",
                passed=passed_basic,
                detail=str(result)[:500],
            )

            if passed_basic and result:
                try:
                    envelope = json.loads(result.text)
                    meta = envelope.get("metadata", {})
                    envelope_ok = (
                        meta.get("resolver") == "purpose"
                        and meta.get("fallback_position") == 1
                        and meta.get("resolved_model_name") == model_name
                    )
                    run.step(
                        label=f"L-02: metadata.fallback_position==1 (primary model handled); resolver==purpose, resolved_model_name=={model_name}",
                        passed=envelope_ok,
                        detail=str(meta)[:500],
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    run.step(
                        label="L-02: envelope shape verification",
                        passed=False,
                        detail=f"parse error: {exc}",
                    )
            else:
                run.step(
                    label="L-02: envelope shape (skipped — basic call failed)",
                    passed=False,
                    detail="call did not return content to parse",
                )

    except Exception as e:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(e).__name__}: {e}")
    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
T-S-006: public call_macro returns the full four-array missing input_var envelope.
Coverage: ML-26
"""
from __future__ import annotations

COVERAGE = ["ML-26"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_macro_input_var_contract"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source = '''
      required = input_var "required"
      optional = input_var "optional" --default "fallback"
      exit { required: $required, optional: $optional }
    '''

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        client: FQCClient = ctx.client
        missing = client.call_tool("call_macro", source=source, input_vars={})
        missing_payload = json.loads(missing.text) if missing.text else {"error": missing.error}
        details = missing_payload.get("details", {}) if isinstance(missing_payload, dict) else {}
        run.step(
            label="ML-26 / T-S-006 missing input_var returns full four-array envelope",
            passed=(
                missing_payload.get("error") == "invalid_input"
                and details.get("required_inputs") == ["required"]
                and details.get("optional_inputs") == ["optional"]
                and details.get("provided_inputs") == []
                and details.get("missing_inputs") == ["required"]
            ),
            detail=json.dumps(missing_payload, sort_keys=True)[:1000],
            timing_ms=missing.timing_ms,
            tool_result=missing,
        )

        provided = client.call_tool("call_macro", source=source, input_vars={"required": "Ada"})
        provided_payload = json.loads(provided.text) if provided.text else {"error": provided.error}
        run.step(
            label="ML-26 / T-S-006 optional default is applied when required input is present",
            passed=provided_payload.get("result") == {"required": "Ada", "optional": "fallback"},
            detail=json.dumps(provided_payload, sort_keys=True)[:1000],
            timing_ms=provided.timing_ms,
            tool_result=provided,
        )

        override = client.call_tool(
            "call_macro",
            source=source,
            input_vars={"required": "Ada", "optional": "provided"},
        )
        override_payload = json.loads(override.text) if override.text else {"error": override.error}
        run.step(
            label="ML-26 / T-S-006 provided optional input overrides default",
            passed=override_payload.get("result") == {"required": "Ada", "optional": "provided"},
            detail=json.dumps(override_payload, sort_keys=True)[:1000],
            timing_ms=override.timing_ms,
            tool_result=override,
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

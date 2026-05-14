#!/usr/bin/env python3
"""
Test: Delegated macro hard exclusions are enforced by runMacroSource.

Scenario:
    1. Drive runMacroSource directly with delegated caller identity and assert
       fq.call_model is rejected with forbidden_tools and the recursive model
       hard-exclusion reason.
    2. Drive the same source with host caller identity and assert call_model is
       allowed by host exposure and reaches the fake native handler.

Coverage points: ML-15, ML-16
Requirements: REQ-027, REQ-032
"""
from __future__ import annotations

COVERAGE = ["ML-15", "ML-16"]

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestRun


TEST_NAME = "test_macro_delegated_hard_exclusions"
HELPER = Path(__file__).resolve().parent.parent / "helpers" / "run_delegated_macro.mjs"


def _run_helper(mode: str, fqc_dir: str | None) -> tuple[dict, str]:
    cwd = Path(fqc_dir).resolve() if fqc_dir else Path(__file__).resolve().parents[4]
    completed = subprocess.run(
        ["npx", "tsx", str(HELPER), mode],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    output = completed.stdout.strip()
    if completed.returncode != 0:
        return {
            "error": "helper_failed",
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }, completed.stderr
    try:
        return json.loads(output or "{}"), completed.stderr
    except json.JSONDecodeError as exc:
        return {
            "error": "invalid_helper_json",
            "message": str(exc),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }, completed.stderr


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    delegated, delegated_stderr = _run_helper("delegated", args.fqc_dir)
    delegated_payload = delegated.get("payload") or {}
    delegated_details = delegated_payload.get("details") or {}
    delegated_passed = (
        delegated_payload.get("error") == "forbidden_tools"
        and "fq.call_model" in (delegated_details.get("forbidden") or [])
        and delegated_details.get("reason") == "recursive_model_excluded_from_delegated_macros"
        and delegated.get("registryBuild", {}).get("allowlistSource") == "assembleNativeToolRegistry"
    )
    run.step(
        label="ML-15 delegated caller hard-excludes fq.call_model with reason",
        passed=delegated_passed,
        detail=json.dumps(delegated, sort_keys=True),
        timing_ms=0,
        server_logs=delegated_stderr.splitlines() if delegated_stderr else None,
    )

    host, host_stderr = _run_helper("host", args.fqc_dir)
    host_payload = host.get("payload") or {}
    host_passed = (
        host_payload.get("result", {}).get("ok") is True
        and host_payload.get("result", {}).get("tool") == "call_model"
        and "fq.call_model" in host.get("registryBuild", {}).get("allowedToolNames", [])
        and host.get("registryBuild", {}).get("allowlistSource") == "resolveHostToolExposure"
    )
    run.step(
        label="ML-16 host caller can invoke host-exposed fq.call_model through runMacroSource",
        passed=host_passed,
        detail=json.dumps(host, sort_keys=True),
        timing_ms=0,
        server_logs=host_stderr.splitlines() if host_stderr else None,
    )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify delegated macro hard exclusions.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()

    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

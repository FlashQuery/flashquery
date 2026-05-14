#!/usr/bin/env python3
"""
Test: Macro cancellation prevents post-safe-point document mutations.

Scenario:
    1. Start a managed server to generate a real FlashQuery config.
    2. Drive the in-process cancellation helper during a loop sleep safe point.
    3. Assert the post-cancel write_document probe was not dispatched.

Coverage points: MLC-02
"""
from __future__ import annotations

# Macro Test Plan T-S-002 originally proposed M-02, which collides with the
# existing directed memory lifecycle row. Phase 136 uses MLC-02 instead.
COVERAGE = ["MLC-02"]

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


TEST_NAME = "test_macro_no_partial_side_effects_after_cancel"
HELPER = Path(__file__).resolve().parent.parent / "helpers" / "macro_cancellation_harness.ts"


def _run_helper(mode: str, config_path: str, vault_path: str, fqc_dir: str | None) -> tuple[dict, str, int]:
    cwd = Path(fqc_dir).resolve() if fqc_dir else Path(__file__).resolve().parents[4]
    completed = subprocess.run(
        ["npx", "tsx", str(HELPER), mode, config_path, vault_path],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        return {
            "error": "helper_failed",
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }, completed.stderr, completed.returncode
    try:
        return json.loads(completed.stdout or "{}"), completed.stderr, completed.returncode
    except json.JSONDecodeError as exc:
        return {
            "error": "invalid_helper_json",
            "message": str(exc),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }, completed.stderr, 1


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:
        started = time.monotonic()
        helper, stderr, returncode = _run_helper(
            "no-partial-side-effects",
            ctx.server.config_path if ctx.server else "",
            str(ctx.vault.vault_root),
            args.fqc_dir,
        )
        envelope = helper.get("envelope") or {}
        details = envelope.get("details") or {}
        passed = (
            returncode == 0
            and helper.get("cancelAccepted") is True
            and envelope.get("error") == "cancelled"
            and isinstance(details.get("at_safe_point"), str)
            and helper.get("writeAttempted") is False
            and helper.get("fileExists") is False
            and helper.get("fileContent") is None
        )
        run.step(
            label="MLC-02 / T-S-002 cancellation prevents post-safe-point document mutation",
            passed=passed,
            detail=json.dumps(helper, sort_keys=True),
            timing_ms=int((time.monotonic() - started) * 1000),
            server_logs=stderr.splitlines() if stderr else None,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify macro cancellation side-effect boundary.")
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

#!/usr/bin/env python3
"""
Test: LLM three-layer config invalid startup fails fast (L-02).

Scenario:
    1. Attempt to start FQC with a provider name containing spaces ('my provider')
    2. Expect startup to fail with non-zero exit code
    3. Expect the captured logs to contain the migration/naming error message
       referencing the offending entry name and the regex rule

Coverage: L-02 (CONF-01)

Modes:
    --managed   Required

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402

TEST_NAME = "test_llm_config_invalid"
COVERAGE = ["L-02"]


INVALID_LLM_CONFIG = {
    "llm": {
        "providers": [
            {
                "name": "my provider",  # CONF-01 violation: contains a space
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
            },
        ],
        "models": [],
        "purposes": [],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    server_started = False
    captured_error = ""

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=INVALID_LLM_CONFIG) as server:
            # If we reach here, the server started — that's a failure for L-02.
            server_started = True
            captured_error = "\n".join(server.captured_logs)
    except RuntimeError as e:
        # FQCServer._wait_for_ready raises RuntimeError("FQC server exited during startup ...")
        # That is the EXPECTED outcome.
        captured_error = str(e)

    run.step(
        label="server failed to start (did not become ready)",
        passed=not server_started,
        detail="server unexpectedly started — L-02 expects a fatal config error" if server_started else "ok",
    )

    run.step(
        label="error message names the offending provider 'my provider'",
        passed="my provider" in captured_error,
        detail=captured_error[-800:] if captured_error else "no error captured",
    )

    run.step(
        label="error message cites the [a-z0-9][a-z0-9_-]* naming rule",
        passed="[a-z0-9][a-z0-9_-]" in captured_error or "[a-z0-9]" in captured_error,
        detail=captured_error[-800:] if captured_error else "no error captured",
    )

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

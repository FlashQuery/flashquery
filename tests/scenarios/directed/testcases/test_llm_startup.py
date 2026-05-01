#!/usr/bin/env python3
"""
Test: LLM startup banner format verification (L-03).

Scenario:
    Step A — configured banner:
        1. Start FQC with a one-provider, one-purpose llm: config injected via
           extra_config
        2. Wait for server ready
        3. Verify the ready banner contains "1 provider(s), 1 purpose(s)"
        4. Verify the banner contains the "LLM:" key

    Step B — unconfigured banner:
        1. Start a second FQC with no llm: section (extra_config={})
        2. Wait for server ready
        3. Verify the ready banner contains "LLM:" and "not configured"

Coverage: L-03

Modes:
    --managed   Required (starts dedicated FQC subprocess)

Usage:
    python test_llm_startup.py --managed

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, FQCServer  # noqa: E402
from fqc_client import _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_llm_startup"
COVERAGE = ["L-03"]


CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            }
        ],
        "models": [
            {
                "name": "gpt-4o",
                "provider_name": "openai",
                "model": "gpt-4o",
                "type": "language",
                "cost_per_million": {"input": 2.5, "output": 10.0},
            }
        ],
        "purposes": [
            {
                "name": "default",
                "description": "General",
                "models": ["gpt-4o"],
            }
        ],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}

    # OPENAI_API_KEY must be in the subprocess environment so the server can
    # resolve ${OPENAI_API_KEY} at runtime. Set a placeholder if absent so the
    # test is self-contained (mirrors test_llm_config_valid.py lines 109-115).
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        # ── Step A: configured banner ─────────────────────────────────────────
        with FQCServer(
            fqc_dir=args.fqc_dir,
            extra_config=CONFIGURED_LLM,
        ) as server:
            logs = "\n".join(server.captured_logs)
            run.step(
                label="banner reports '1 provider(s), 1 purpose(s)'",
                passed="1 provider(s), 1 purpose(s)" in logs and "LLM:" in logs,
                detail=logs[-500:] if logs else "no logs captured",
            )

        # ── Step B: unconfigured banner ───────────────────────────────────────
        with FQCServer(
            fqc_dir=args.fqc_dir,
            extra_config={},
        ) as server:
            logs = "\n".join(server.captured_logs)
            run.step(
                label="banner reports 'not configured' when no llm: section",
                passed="LLM:" in logs and "not configured" in logs,
                detail=logs[-500:] if logs else "no logs captured",
            )

    except Exception as e:  # noqa: BLE001
        run.step(
            label="server lifecycle",
            passed=False,
            detail=f"exception: {type(e).__name__}: {e}",
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

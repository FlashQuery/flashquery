#!/usr/bin/env python3
"""
Test: call_model with provider-unsupported parameter — provider error returned as-is (L-09).
Coverage: L-09
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_bad_provider_param.py --managed
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
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_bad_provider_param"
COVERAGE = ["L-09"]
REQUIRES_MANAGED = True

CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            },
        ],
        "models": [
            {
                "name": "fast",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
        ],
        "purposes": [
            {
                "name": "general",
                "description": "General",
                "models": ["fast"],
                "defaults": {"temperature": 0.7},
            },
        ],
    }
}

# FQC-generated error patterns that would indicate FQC itself rejected the call
# before forwarding it to the provider. If any of these appear, the test should
# fail — the assertion requires the error to originate from the provider.
_FQC_ERROR_PATTERNS = [
    "Model '",
    "Purpose '",
    "LLM is not configured",
    "call_model failed: purpose",
]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # L-09: call_model with a bad provider parameter — provider error returned as-is
            result_l09 = client.call_tool("call_model", **{
                "resolver": "model",
                "name": "fast",
                "messages": [{"role": "user", "content": "hi"}],
                "parameters": {"bad_param_xyz": True},
            })
            text_l09 = result_l09.text if result_l09 else ""

            # Check whether OpenAI silently ignored the bad param (returns ok=True).
            # If so, this is a defect: L-09 cannot be verified against OpenAI with this
            # parameter name because OpenAI does not reject unknown top-level parameters.
            if result_l09 and result_l09.ok:
                run.step(
                    label="L-09: provider-unsupported parameter causes provider error — DEFECT: OpenAI silently ignored bad_param_xyz",
                    passed=False,
                    detail=(
                        "OpenAI ignored 'bad_param_xyz' and returned a successful response. "
                        "L-09 cannot be verified against the OpenAI provider under this parameter name. "
                        "The behavior requires a provider that rejects unknown parameters. "
                        f"Response text: {text_l09[:300]}"
                    ),
                )
                return run

            # Verify the error originates from the provider, not from FQC itself.
            fqc_generated = any(pat in text_l09 for pat in _FQC_ERROR_PATTERNS)
            is_error = result_l09 is not None and not result_l09.ok

            run.step(
                label=(
                    "L-09: resolver=model with bad_param_xyz returns isError:true "
                    "with provider-originated error (not an FQC wrapper message)"
                ),
                passed=bool(is_error and not fqc_generated),
                detail=(
                    f"is_error={is_error}, fqc_generated={fqc_generated}, "
                    f"text={text_l09[:400]}"
                ),
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

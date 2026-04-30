#!/usr/bin/env python3
"""
Test: embedding search works end-to-end when routed through 'embedding' purpose (L-23).
Coverage: L-23
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_embedding_migration.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_embedding_migration"
COVERAGE = ["L-23"]

CONFIGURED_LLM_WITH_EMBEDDING_PURPOSE = {
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
                "name": "embed-model",
                "provider_name": "openai",
                "model": "text-embedding-3-small",
                "type": "embedding",
                "cost_per_million": {"input": 0.02, "output": 0.0},
            },
        ],
        "purposes": [
            {
                "name": "embedding",
                "description": "Embedding via purpose system",
                "models": ["embed-model"],
            },
        ],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    # Wave 0 stub: test scaffolding only. Full assertion logic added in Plan 104-01.
    # L-23 expected behavior (Wave 1):
    #   1. Start FQCServer with extra_config=CONFIGURED_LLM_WITH_EMBEDDING_PURPOSE
    #   2. call_tool('save_memory', ...) to write a memory entry
    #   3. call_tool('search_memory', ...) with semantic query
    #   4. Assert: results returned (embedding routing through purpose succeeded)
    #   5. Assert: server log contains "routing through purpose 'embedding'"
    raise NotImplementedError("L-23 stub — implement in Wave 1 (Plan 104-01)")


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", help="Start dedicated FQC subprocess")
    parser.add_argument("--fqc-dir", default=None, help="Path to FQC project root")
    args = parser.parse_args()
    if not args.managed:
        print("ERROR: --managed mode required", file=sys.stderr)
        return 3
    try:
        run = run_test(args)
        return run.exit_code()
    except NotImplementedError as e:
        # Wave 0 stub — explicit RED state for the directed scenario runner
        print(f"DIRTY: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())

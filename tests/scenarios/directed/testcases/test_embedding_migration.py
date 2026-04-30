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
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env.get("OPENAI_API_KEY") or "sk-test-placeholder"
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM_WITH_EMBEDDING_PURPOSE) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            # L-23 step 1: save_memory writes a memory entry — embedding routed through 'embedding' purpose
            seed_text = "FlashQuery embedding migration test — phase 104 L-23 unique marker abc123xyz"
            save_result = client.call_tool("save_memory", **{
                "content": seed_text,
                "category": "test",
                "scope": "global",
            })
            run.step(
                "save_memory_via_embedding_purpose",
                bool(save_result and save_result.ok),
                detail=f"save_result.ok={save_result.ok if save_result else None}",
            )

            # L-23 step 2: search_memory finds the seed entry by semantic query
            search_result = client.call_tool("search_memory", **{
                "query": "phase 104 L-23 unique marker",
                "limit": 5,
            })
            search_ok = bool(search_result and search_result.ok)
            search_text = ""
            if search_result and search_result.ok:
                # FQCClient response: combined text content from MCP envelope
                search_text = json.dumps(search_result.data) if hasattr(search_result, "data") else str(search_result)
            found_seed = "abc123xyz" in search_text
            run.step(
                "search_memory_returns_seed",
                search_ok and found_seed,
                detail=f"search_ok={search_ok} found_seed={found_seed}",
            )

            # L-23 step 3: server log contains the routing-through-purpose marker
            log_lines = server.captured_logs
            log_text = "\n".join(log_lines)
            routing_logged = "routing through purpose 'embedding'" in log_text
            run.step(
                "embedding_routing_log_present",
                routing_logged,
                detail=f"routing_logged={routing_logged}",
            )

    except Exception as exc:  # noqa: BLE001
        run.fail("exception", str(exc))
    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", help="Start dedicated FQC subprocess")
    parser.add_argument("--fqc-dir", default=None, help="Path to FQC project root")
    args = parser.parse_args()
    if not args.managed:
        print("ERROR: --managed mode required", file=sys.stderr)
        return 3
    run = run_test(args)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

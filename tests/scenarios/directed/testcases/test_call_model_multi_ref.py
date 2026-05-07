#!/usr/bin/env python3
"""
Test: call_model with multiple {{ref:...}} references across messages.
Coverage: L-28
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_multi_ref.py --managed
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
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_multi_ref"
COVERAGE = ["L-28"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [{
            "name": "openai",
            "type": "openai-compatible",
            "endpoint": "https://api.openai.com",
            "api_key": "${OPENAI_API_KEY}",
        }],
        "models": [{
            "name": "fast",
            "provider_name": "openai",
            "model": "gpt-4o-mini",
            "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
        }],
        "purposes": [],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env_vars = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env_vars.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            run_id = _uuid.uuid4().hex[:8]

            path_a = f"_test/{TEST_NAME}_{run_id}_doc_a.md"
            body_a = "Document A content."
            create_a = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} doc_a {run_id}",
                path=path_a,
                content=body_a,
            )
            if not create_a.ok:
                run.step(label="Setup doc_a", passed=False,
                         detail=create_a.error or create_a.text[:200])
                return run

            path_b = f"_test/{TEST_NAME}_{run_id}_doc_b.md"
            body_b = "Document B content."
            create_b = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} doc_b {run_id}",
                path=path_b,
                content=body_b,
            )
            if not create_b.ok:
                run.step(label="Setup doc_b", passed=False,
                         detail=create_b.error or create_b.text[:200])
                return run

            # FQC strips frontmatter when resolving references and returns the body
            # with a normalized trailing newline. Expected chars = len(body) + 1.
            chars_a = len(body_a) + 1
            chars_b = len(body_b) + 1

            # L-28: two references — one per message
            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[
                    {"role": "user", "content": f"First: {{{{ref:{path_a}}}}}"},
                    {"role": "user", "content": f"Second: {{{{ref:{path_b}}}}}. Reply OK."},
                ],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            checks = {
                "ok": r.ok,
                "injected has 2 entries":
                    isinstance(injected, list) and len(injected) == 2,
                "first entry refs path_a":
                    injected and injected[0].get("ref") == f"{{{{ref:{path_a}}}}}",
                "second entry refs path_b":
                    len(injected) > 1 and injected[1].get("ref") == f"{{{{ref:{path_b}}}}}",
                "first chars matches on-disk body_a":
                    injected and injected[0].get("chars") == chars_a,
                "second chars matches on-disk body_b":
                    len(injected) > 1 and injected[1].get("chars") == chars_b,
            }
            run.step(
                label="L-28: multiple references across messages all resolved",
                passed=all(checks.values()),
                detail=f"checks={checks}",
                timing_ms=r.timing_ms,
                tool_result=r,
            )

    except Exception as e:  # noqa: BLE001
        run.step(label="Test crashed", passed=False, detail=f"exception: {type(e).__name__}: {e}")

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--vault-path", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

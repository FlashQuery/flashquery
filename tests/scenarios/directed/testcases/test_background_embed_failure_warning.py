#!/usr/bin/env python3
"""
Test: public MCP write response surfaces embedding_deferred when background embedding fails.

Scenario:
    1. Start a dedicated managed FlashQuery server with embedding routed to an
       unreachable local OpenAI-compatible endpoint.
    2. Call write_document through the public MCP surface.
    3. Assert the successful JSON response includes warnings containing
       embedding_deferred.
    Cleanup is automatic.

Coverage points: D-69

Modes:
    --managed   Required; this test owns a failure-injection config.

Usage:
    python test_background_embed_failure_warning.py --managed
    python test_background_embed_failure_warning.py --managed --json

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

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


TEST_NAME = "test_background_embed_failure_warning"
COVERAGE = ["D-69"]

BROKEN_EMBEDDING_CONFIG = {
    "llm": {
        "providers": [
            {
                "name": "broken-embeddings",
                "type": "openai-compatible",
                "endpoint": "http://127.0.0.1:9",
                "api_key": "sk-test-unreachable",
            },
        ],
        "models": [
            {
                "name": "broken-embed-model",
                "provider_name": "broken-embeddings",
                "model": "text-embedding-3-small",
                "type": "embedding",
                "cost_per_million": {"input": 0.02, "output": 0.0},
                "capabilities": {
                    "tool_calling": True,
                    "usage_on_tool_calls": True,
                },
            },
        ],
        "purposes": [
            {
                "name": "embedding",
                "description": "Intentional failure injection for D-69",
                "models": ["broken-embed-model"],
            },
        ],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    title = f"D-69 deferred embedding warning {run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=BROKEN_EMBEDDING_CONFIG,
    ) as ctx:
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=test_path,
            title=title,
            content="This document intentionally uses a broken embedding endpoint.",
            tags=["fqc-test", "embedding-deferred", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        payload = {}
        warnings = []
        json_parse_error = ""
        try:
            payload = json.loads(result.text)
            warnings = payload.get("warnings", [])
        except Exception as exc:  # noqa: BLE001
            json_parse_error = f"{type(exc).__name__}: {exc}"

        if isinstance(payload, dict):
            fq_id = payload.get("fq_id")
            created_path = payload.get("path")
            if isinstance(fq_id, str) and fq_id:
                ctx.cleanup.track_mcp_document(fq_id)
            if isinstance(created_path, str) and created_path:
                ctx.cleanup.track_file(created_path)
                parts = Path(created_path).parts
                for i in range(1, len(parts)):
                    ctx.cleanup.track_dir(str(Path(*parts[:i])))

        result.expect_json_equals(
            "warnings[0]",
            "embedding_deferred",
            "public JSON response includes embedding_deferred warning",
        )

        run.step(
            label="write_document surfaces embedding_deferred warning (D-69)",
            passed=(result.ok and result.status == "pass"),
            detail=(
                expectation_detail(result)
                or json_parse_error
                or f"warnings={warnings!r}"
                or result.error
                or ""
            ),
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test public deferred embedding warning behavior.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    if not args.managed:
        run = TestRun(TEST_NAME)
        run.fail("managed_required", "--managed is required because this scenario injects a broken embedding provider")
    else:
        run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""D-109: rebuild_embeddings confirm mismatch is refused."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import cli_main, lifecycle_context, parse_payload  # noqa: E402

TEST_NAME = "test_rebuild_embeddings_confirm_mismatch"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        result = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            embedding_name="primary",
            confirm="wrong",
            max_rows=1,
            scope={"entity_types": ["documents"]},
        )
        payload = parse_payload(result)
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        run.step(
            "confirm mismatch returns invalid_input with details",
            passed=(
                result.ok
                and payload.get("error") == "invalid_input"
                and details.get("expected_confirm") == "primary"
                and details.get("received_confirm") == "wrong"
            ),
            detail=expectation_detail(result) or result.error or json.dumps(payload, sort_keys=True),
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

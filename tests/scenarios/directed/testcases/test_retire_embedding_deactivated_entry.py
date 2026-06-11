#!/usr/bin/env python3
"""D-113: retire_embedding works against a deactivated catalog entry."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    first_action,
    parse_payload,
    retire_metadata,
    retire_test_context,
    seed_deactivated_column_set,
)

TEST_NAME = "test_retire_embedding_deactivated_entry"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    name = "retired_entry"
    with retire_test_context(args, [{"name": "primary"}]) as ctx:
        seed_deactivated_column_set(ctx, name)
        before = retire_metadata(ctx, name)
        result = ctx.client.call_tool(
            "maintain_vault",
            action="retire_embedding",
            embedding_name=name,
            confirm=name,
        )
        payload = parse_payload(result)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        after = retire_metadata(ctx, name)
        run.step(
            "retire succeeds for deactivated entry",
            passed=(
                result.ok
                and before["catalog_rows"] == 1
                and len(before["columns"]) == 10
                and counts.get("catalog_rows_deleted") == 1
                and counts.get("tables_affected") == 2
                and counts.get("columns_dropped") == 10
                and counts.get("indexes_dropped") == 2
                and after == {"catalog_rows": 0, "columns": [], "indexes": [], "functions": []}
            ),
            detail=expectation_detail(result) or result.error or json.dumps({"payload": payload, "before": before, "after": after}, sort_keys=True),
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

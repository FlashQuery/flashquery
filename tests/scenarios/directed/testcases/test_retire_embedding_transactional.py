#!/usr/bin/env python3
"""D-111: retire_embedding drops core and stale plugin artifacts transactionally."""
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
    plugin_yaml,
    register_plugin,
    retire_metadata,
    retire_test_context,
)

TEST_NAME = "test_retire_embedding_transactional"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    plugin_id = f"retire_tx_{run.run_id.replace('-', '_')}"
    plugin_table = f"fqcp_{plugin_id}_default_notes"
    schema = plugin_yaml(plugin_id, "*")
    suffix = run.run_id.replace("-", "_")
    old_entry = f"primary_{suffix}"
    new_entry = f"analysis_{suffix}"

    with retire_test_context(args, [{"name": old_entry}, {"name": new_entry}]) as ctx:
        first = register_plugin(ctx, plugin_id, schema, old_entry)
        run.step(
            "register plugin against old entry",
            passed=first.ok,
            detail=expectation_detail(first) or first.error or first.text,
            timing_ms=first.timing_ms,
            tool_result=first,
        )
        if not first.ok:
            return run

        second = register_plugin(ctx, plugin_id, schema, new_entry)
        run.step(
            "re-register plugin against new entry, leaving stale old-entry artifacts",
            passed=second.ok,
            detail=expectation_detail(second) or second.error or second.text,
            timing_ms=second.timing_ms,
            tool_result=second,
        )
        if not second.ok:
            return run

        before = retire_metadata(ctx, old_entry, plugin_table)
        result = ctx.client.call_tool(
            "maintain_vault",
            action="retire_embedding",
            embedding_name=old_entry,
            confirm=old_entry,
        )
        payload = parse_payload(result)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        after = retire_metadata(ctx, old_entry, plugin_table)
        run.step(
            "retire old entry removes catalog, core artifacts, and stale plugin artifacts",
            passed=(
                result.ok
                and counts.get("catalog_rows_deleted") == 1
                and counts.get("tables_affected", 0) >= 3
                and counts.get("columns_dropped", 0) >= 15
                and counts.get("indexes_dropped", 0) >= 3
                and before["catalog_rows"] == 1
                and len(before["columns"]) >= 15
                and len(before["functions"]) >= 3
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

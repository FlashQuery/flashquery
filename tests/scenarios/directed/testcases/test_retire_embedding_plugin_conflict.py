#!/usr/bin/env python3
"""D-112: retire_embedding refuses while a plugin is registered against the entry."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    parse_payload,
    plugin_yaml,
    register_plugin,
    retire_metadata,
    retire_test_context,
)

TEST_NAME = "test_retire_embedding_plugin_conflict"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    plugin_id = f"retire_conflict_{run.run_id.replace('-', '_')}"
    schema = plugin_yaml(plugin_id, "*")

    with retire_test_context(args, [{"name": "primary"}]) as ctx:
        registered = register_plugin(ctx, plugin_id, schema, "primary")
        run.step(
            "register plugin against primary",
            passed=registered.ok,
            detail=expectation_detail(registered) or registered.error or registered.text,
            timing_ms=registered.timing_ms,
            tool_result=registered,
        )
        if not registered.ok:
            return run

        before = retire_metadata(ctx, "primary", f"fqcp_{plugin_id}_default_notes")
        result = ctx.client.call_tool(
            "maintain_vault",
            action="retire_embedding",
            embedding_name="primary",
            confirm="primary",
        )
        payload = parse_payload(result)
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        after = retire_metadata(ctx, "primary", f"fqcp_{plugin_id}_default_notes")
        run.step(
            "retire returns conflict with affected_plugins before destructive DDL",
            passed=(
                result.ok
                and payload.get("error") == "conflict"
                and plugin_id in (details.get("affected_plugins") or [])
                and before == after
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

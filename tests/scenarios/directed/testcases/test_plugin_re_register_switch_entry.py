#!/usr/bin/env python3
"""
Test: plugin re-registration switches the frozen embedding entry.

Coverage points: D-103
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from plugin_embedding_scenario_helpers import catalog_config, cli_main, plugin_yaml, register_plugin_step  # noqa: E402

TEST_NAME = "test_plugin_re_register_switch_entry"
COVERAGE = ["D-103"]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    plugin_id = f"plug_switch_{run.run_id.replace('-', '_')}"
    schema = plugin_yaml(plugin_id, "*")

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=catalog_config([
            {"name": "primary"},
            {"name": "analysis"},
        ]),
    ) as ctx:
        first = register_plugin_step(
            run,
            ctx,
            "register_plugin freezes primary",
            plugin_id,
            schema,
            embedding_name="primary",
        )
        first.expect_json_equals("embedding_name", "primary", "first registration uses primary")
        run.step(
            "first registration response includes primary",
            passed=(first.ok and first.status == "pass"),
            detail=expectation_detail(first) or first.error or "",
            timing_ms=first.timing_ms,
            tool_result=first,
        )
        if not first.ok:
            return run

        second = register_plugin_step(
            run,
            ctx,
            "register_plugin re-registers against analysis",
            plugin_id,
            schema,
            embedding_name="analysis",
        )
        second.expect_json_equals("embedding_name", "analysis", "re-registration switches to analysis")
        run.step(
            "re-registration response includes analysis",
            passed=(second.ok and second.status == "pass"),
            detail=expectation_detail(second) or second.error or "",
            timing_ms=second.timing_ms,
            tool_result=second,
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

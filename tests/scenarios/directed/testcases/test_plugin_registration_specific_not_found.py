#!/usr/bin/env python3
"""
Test: plugin manifest specific embedding name not in catalog returns not_found.

Coverage points: D-101
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun  # noqa: E402
from plugin_embedding_scenario_helpers import catalog_config, cli_main, parse_payload, plugin_yaml, register_plugin_step  # noqa: E402

TEST_NAME = "test_plugin_registration_specific_not_found"
COVERAGE = ["D-101"]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    plugin_id = f"plug_nf_{run.run_id.replace('-', '_')}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=catalog_config([{"name": "primary"}]),
    ) as ctx:
        result = register_plugin_step(
            run,
            ctx,
            "register_plugin specific missing embedding returns not_found",
            plugin_id,
            plugin_yaml(plugin_id, "missing_entry"),
            expect_error=True,
        )
        payload = parse_payload(result)
        checks = {
            "error is not_found": payload.get("error") == "not_found",
            "available names included": payload.get("details", {}).get("available_embedding_names") == ["primary"],
        }
        run.step("not_found envelope includes available names", passed=all(checks.values()), detail=str(checks), timing_ms=0)
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

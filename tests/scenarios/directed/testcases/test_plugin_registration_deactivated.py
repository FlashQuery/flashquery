#!/usr/bin/env python3
"""
Test: plugin registration against a deactivated embedding entry returns unsupported.

Coverage points: D-102
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun  # noqa: E402
from plugin_embedding_scenario_helpers import catalog_config, cli_main, parse_payload, plugin_yaml, register_plugin_step, seed_deactivated_embedding  # noqa: E402

TEST_NAME = "test_plugin_registration_deactivated"
COVERAGE = ["D-102"]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    plugin_id = f"plug_deact_{run.run_id.replace('-', '_')}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=catalog_config([{"name": "primary"}]),
    ) as ctx:
        seed_deactivated_embedding(ctx.server.config_path, ctx.server.instance_id, "retired_entry")
        result = register_plugin_step(
            run,
            ctx,
            "register_plugin deactivated embedding returns unsupported",
            plugin_id,
            plugin_yaml(plugin_id, "retired_entry"),
            expect_error=True,
        )
        payload = parse_payload(result)
        checks = {
            "error is unsupported": payload.get("error") == "unsupported",
            "remediation included": "remediation" in payload.get("details", {}),
        }
        run.step("unsupported envelope includes reactivation hint", passed=all(checks.values()), detail=str(checks), timing_ms=0)
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

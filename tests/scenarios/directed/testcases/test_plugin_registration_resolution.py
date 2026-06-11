#!/usr/bin/env python3
"""
Test: plugin manifest wildcard registration refuses ambiguity and succeeds with explicit override.

Coverage points: D-100
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from plugin_embedding_scenario_helpers import catalog_config, cli_main, parse_payload, plugin_yaml, register_plugin_step  # noqa: E402

TEST_NAME = "test_plugin_registration_resolution"
COVERAGE = ["D-100"]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    plugin_id = f"plug_res_{run.run_id.replace('-', '_')}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=catalog_config([
            {"name": "primary"},
            {"name": "analysis"},
        ]),
    ) as ctx:
        wildcard_yaml = plugin_yaml(plugin_id, "*")
        ambiguous = register_plugin_step(
            run,
            ctx,
            "register_plugin manifest wildcard refuses multi-active catalog",
            plugin_id,
            wildcard_yaml,
            expect_error=True,
        )
        payload = parse_payload(ambiguous)
        checks = {
            "error is ambiguous_identifier": payload.get("error") == "ambiguous_identifier",
            "details include active names": payload.get("details", {}).get("available_embedding_names") == ["analysis", "primary"],
        }
        run.step(
            "ambiguous_identifier envelope includes available names",
            passed=all(checks.values()),
            detail=str(checks),
            timing_ms=0,
        )
        if not all(checks.values()):
            return run

        explicit = register_plugin_step(
            run,
            ctx,
            "register_plugin succeeds after explicit embedding_name override",
            plugin_id,
            wildcard_yaml,
            embedding_name="primary",
        )
        explicit.expect_json_equals("embedding_name", "primary", "resolved embedding choice is frozen in response")
        run.step(
            "explicit override response includes primary",
            passed=(explicit.ok and explicit.status == "pass"),
            detail=expectation_detail(explicit) or explicit.error or "",
            timing_ms=explicit.timing_ms,
            tool_result=explicit,
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

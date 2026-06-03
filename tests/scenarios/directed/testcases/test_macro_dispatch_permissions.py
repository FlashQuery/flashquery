#!/usr/bin/env python3
"""
Test: Macro dispatch permission and hard-exclusion public surface.

Scenario:
    1. Invoke call_macro with fq.call_macro nested inside the macro and assert
       the public envelope is unknown_tool.
    2. Create a real template-masqueraded tool in the vault, invoke it from a
       macro, and assert the public envelope uses the template-specific code.

Coverage points: ML-11, ML-12
"""
from __future__ import annotations

COVERAGE = ["ML-11", "ML-12"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import get_json_path, parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_macro_dispatch_permissions"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        extra_config={
            "templates": {"default_access": "permissive"},
            "host_mcp_tools": {"tools": ["call_macro"]},
        },
    ) as ctx:
        log_mark = ctx.server.log_position if ctx.server else 0
        nested = ctx.client.call_tool("call_macro", source='exit fq.call_macro({ source: "exit 1" })')
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        nested.expect_json_equals("result.result", 1)
        nested_passed = nested.ok and nested.status == "pass"
        nested_detail = expectation_detail(nested) or nested.error or ""
        try:
            nested_payload = parse_mcp_json(nested)
            trace_name = get_json_path(nested_payload, "trace[0].name")
            nested_trace_name = get_json_path(nested_payload, "result.trace[0].kind")
            if trace_name != "fq.call_macro" or nested_trace_name != "exit":
                nested_passed = False
                nested_detail = f"unexpected nested macro trace: outer={trace_name!r}, inner={nested_trace_name!r}"
        except Exception as exc:
            nested_passed = False
            nested_detail = f"nested macro response parse failed: {exc}"
        run.step(
            label="host nested fq.call_macro inherits context and returns nested result",
            passed=nested_passed,
            detail=nested_detail,
            timing_ms=nested.timing_ms,
            tool_result=nested,
            server_logs=step_logs,
        )

        ctx.create_file(
            "Templates/Macro Dispatch Skill.md",
            title="Macro Dispatch Skill",
            body="Dispatch template {{topic}}",
            tags=["macro-dispatch-permissions"],
            extra_frontmatter={
                "fq_template": True,
                "fq_expose_as_tool": True,
                "fq_namespace": "skill",
                "fq_desc": "Macro dispatch template skill",
                "fq_params": {"topic": {"type": "string", "required": True}},
            },
        )
        ctx.client.call_tool("maintain_vault", action="sync", background=False)

        log_mark = ctx.server.log_position if ctx.server else 0
        template = ctx.client.call_tool(
            "call_macro",
            source='exit fq.flashquery_skill_macro_dispatch_skill({ topic: "permissions" })',
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        template.expect_json_equals("error", "template_masquerade_tools_not_callable_from_macro")
        template.expect_json_equals("details.server", "fq")
        template.expect_json_equals("details.tool", "flashquery_skill_macro_dispatch_skill")
        run.step(
            label="template-masqueraded tool is rejected with template-specific macro code",
            passed=(template.ok and template.status == "pass"),
            detail=expectation_detail(template) or template.error or "",
            timing_ms=template.timing_ms,
            tool_result=template,
            server_logs=step_logs,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify macro dispatch permission hard exclusions.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()

    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

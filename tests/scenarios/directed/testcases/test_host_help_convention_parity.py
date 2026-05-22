#!/usr/bin/env python3
"""
Test: host help convention parity for native and brokered MCP tools.

Scenario:
    1. Call every FlashQuery-native MCP tool with a non-boolean help value and
       verify the resulting native error includes that tool's single help footer.
    2. Call a brokered host tool with help:true and verify the upstream fixture
       receives it unchanged.
    3. Trigger a brokered host tool error and verify FlashQuery does not append
       the native help footer.
    Cleanup is automatic.

Coverage points: MCB-23 through MCB-54

Modes:
    Default     Ignored; this test always starts a dedicated managed server
    --managed   Starts a dedicated FQC subprocess for this test

Usage:
    python test_host_help_convention_parity.py --managed
    python test_host_help_convention_parity.py --managed --json
    python test_host_help_convention_parity.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = [
    "MCB-23", "MCB-24", "MCB-25", "MCB-26", "MCB-27", "MCB-28", "MCB-29",
    "MCB-30", "MCB-31", "MCB-32", "MCB-33", "MCB-34", "MCB-35", "MCB-36",
    "MCB-37", "MCB-38", "MCB-39", "MCB-40", "MCB-41", "MCB-42", "MCB-43",
    "MCB-44", "MCB-45", "MCB-46", "MCB-47", "MCB-48", "MCB-49", "MCB-50",
    "MCB-51", "MCB-52", "MCB-53", "MCB-54",
]

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import ToolResult  # noqa: E402
from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_host_help_convention_parity"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NATIVE_HELP_FOOTER_PREFIX = "For full documentation, examples, and parameter details"

NATIVE_TOOLS: list[tuple[str, str]] = [
    ("MCB-23", "apply_tags"),
    ("MCB-24", "archive_document"),
    ("MCB-25", "archive_memory"),
    ("MCB-26", "archive_record"),
    ("MCB-27", "call_macro"),
    ("MCB-28", "call_model"),
    ("MCB-29", "clear_pending_reviews"),
    ("MCB-30", "copy_document"),
    ("MCB-31", "get_briefing"),
    ("MCB-32", "get_document"),
    ("MCB-33", "get_llm_usage"),
    ("MCB-34", "get_memory"),
    ("MCB-35", "get_plugin_info"),
    ("MCB-36", "get_record"),
    ("MCB-37", "insert_doc_link"),
    ("MCB-38", "insert_in_doc"),
    ("MCB-39", "list_vault"),
    ("MCB-40", "maintain_vault"),
    ("MCB-41", "manage_directory"),
    ("MCB-42", "move_document"),
    ("MCB-43", "register_plugin"),
    ("MCB-44", "remove_document"),
    ("MCB-45", "replace_doc_section"),
    ("MCB-46", "search"),
    ("MCB-47", "search_records"),
    ("MCB-48", "search_tools"),
    ("MCB-49", "unregister_plugin"),
    ("MCB-50", "write_document"),
    ("MCB-51", "write_memory"),
    ("MCB-52", "write_record"),
]


def _project_root(args: argparse.Namespace) -> Path:
    if args.fqc_dir:
        return Path(args.fqc_dir).resolve()
    return Path(__file__).resolve().parents[4]


def _host_help_config(args: argparse.Namespace) -> dict[str, Any]:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    return {
        "mcp_servers": {
            "basic": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "per_call_timeout_ms": 30000,
            },
        },
        "host": {
            "mcp_servers": ["basic"],
            "tool_search": "disabled",
        },
    }


def _native_footer(tool_name: str) -> str:
    return f"For full documentation, examples, and parameter details, call `{tool_name}` with `help: true`."


def _serialized_result(result: ToolResult) -> str:
    return json.dumps(
        {
            "ok": result.ok,
            "text": result.text,
            "error": result.error,
            "raw_response": result.raw_response,
        },
        sort_keys=True,
        default=str,
    )


def _parse_text_json(result: ToolResult) -> Any:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw_text": result.text}


def _step_detail(result: ToolResult, extra: dict[str, Any] | None = None) -> str:
    detail = {
        "expectation": expectation_detail(result) or result.error or "",
        "text": result.text[:1200],
    }
    if extra:
        detail.update(extra)
    return json.dumps(detail, sort_keys=True, default=str)[:1800]


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    try:
        with TestContext(
            fqc_dir=args.fqc_dir,
            managed=True,
            port_range=port_range,
            extra_config=_host_help_config(args),
        ) as ctx:
            # ── Step 1-N: every native tool error includes its own footer ──
            for coverage_id, tool_name in NATIVE_TOOLS:
                log_mark = ctx.server.log_position if ctx.server else 0
                result = ctx.client.call_tool(tool_name, help="true")
                step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

                footer = _native_footer(tool_name)
                passed = (
                    not result.ok
                    and footer in result.text
                    and result.text.count(footer) == 1
                )
                run.step(
                    label=f"{coverage_id}: {tool_name} native error includes one help footer",
                    passed=passed,
                    detail=_step_detail(
                        result,
                        {
                            "expected_footer": footer,
                            "footer_count": result.text.count(footer),
                        },
                    ),
                    timing_ms=result.timing_ms,
                    tool_result=result,
                    server_logs=step_logs,
                )
                if not passed:
                    return run

            # ── Step 31: brokered help:true passes upstream unchanged ──────
            log_mark = ctx.server.log_position if ctx.server else 0
            help_result = ctx.client.call_tool("basic__help_probe", help=True)
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            help_payload = _parse_text_json(help_result)
            passed = help_result.ok and help_payload == {"help": True}
            run.step(
                label="MCB-53: brokered help:true is forwarded upstream unchanged",
                passed=passed,
                detail=_step_detail(help_result, {"parsed": help_payload}),
                timing_ms=help_result.timing_ms,
                tool_result=help_result,
                server_logs=step_logs,
            )
            if not passed:
                return run

            # ── Step 32: brokered errors do not get native help footer ─────
            log_mark = ctx.server.log_position if ctx.server else 0
            broker_error = ctx.client.call_tool("basic__slow", ms="not-a-number")
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            serialized = _serialized_result(broker_error)
            passed = (
                not broker_error.ok
                and NATIVE_HELP_FOOTER_PREFIX not in serialized
                and "help: true" not in serialized
            )
            run.step(
                label="MCB-54: brokered errors omit the native help footer",
                passed=passed,
                detail=_step_detail(
                    broker_error,
                    {
                        "contains_native_footer_prefix": NATIVE_HELP_FOOTER_PREFIX in serialized,
                        "contains_help_true": "help: true" in serialized,
                    },
                ),
                timing_ms=broker_error.timing_ms,
                tool_result=broker_error,
                server_logs=step_logs,
            )
    except Exception as exc:  # noqa: BLE001
        run.step(
            label="Host help convention parity lifecycle",
            passed=False,
            detail=f"{type(exc).__name__}: {exc}",
        )

    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

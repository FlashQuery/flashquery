#!/usr/bin/env python3
"""
Test: foundation JSON response helpers for directed scenarios.

Scenario:
    Creates a document, reads it through the helper-backed get_document path,
    parses the MCP response JSON through shared scenario helpers, and verifies
    an expected not_found error remains a JSON payload without transport/runtime
    failure.

Coverage points: D-foundation-json-1, D-foundation-json-2, D-foundation-tools-1,
D-foundation-frontmatter-1, D-foundation-description-1

Modes:
    Default     Connects to an already-running FQC instance.
    --managed   Starts a dedicated FQC subprocess for this test.

Usage:
    python test_foundation_json_response.py
    python test_foundation_json_response.py --managed
    python test_foundation_json_response.py --managed --json
    python test_foundation_json_response.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = [
    "D-foundation-json-1",
    "D-foundation-json-2",
    "D-foundation-tools-1",
    "D-foundation-frontmatter-1",
    "D-foundation-description-1",
]

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import get_json_path, parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_foundation_json_response"


def _extract_field(text: str, field: str) -> str:
    json_key = {"FQC ID": "fq_id", "Path": "path", "Memory ID": "memory_id"}.get(field)
    if json_key:
        try:
            payload = json.loads(text)
            value = payload.get(json_key) if isinstance(payload, dict) else None
            if value is not None:
                return str(value)
        except Exception:
            pass
    match = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _track_created(ctx: TestContext, result_text: str, fallback_path: str) -> tuple[str, str]:
    created_fqc_id = _extract_field(result_text, "FQC ID")
    created_path = _extract_field(result_text, "Path") or fallback_path
    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)
    return created_fqc_id, created_path


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path = f"_test/{TEST_NAME}_{run.run_id}.md"
    missing_path = f"_test/{TEST_NAME}_{run.run_id}_missing.md"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            title="Foundation JSON Response",
            content="JSON response helper scenario body.",
            path=path,
            tags=["foundation-json-response"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        _track_created(ctx, create_result.text, path)
        create_result.expect_contains("Foundation JSON Response")

        run.step(
            label="Setup: create_document fixture",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan (sync)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        log_mark = ctx.server.log_position if ctx.server else 0
        read_result = ctx.client.call_tool("get_document", identifiers=path)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        read_result.expect_json_path("identifier")
        read_result.expect_json_equals("path", path)
        read_result.expect_json_no_path("error")

        read_passed = read_result.ok and read_result.status == "pass"
        read_detail = expectation_detail(read_result) or read_result.error or ""
        try:
            payload = parse_mcp_json(read_result)
            if get_json_path(payload, "identifier") is None:
                read_passed = False
                read_detail = "Missing identifier in parsed JSON payload"
        except Exception as exc:
            read_passed = False
            read_detail = f"JSON parse error: {exc}"

        run.step(
            label="D-foundation-json-1: helper-backed get_document success parses as JSON",
            passed=read_passed,
            detail=read_detail,
            timing_ms=read_result.timing_ms,
            tool_result=read_result,
            server_logs=step_logs,
        )

        log_mark = ctx.server.log_position if ctx.server else 0
        missing_result = ctx.client.call_tool("get_document", identifiers=missing_path)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        missing_result.expect_json_equals("error", "not_found")
        missing_result.expect_json_equals("identifier", missing_path)
        transport_is_error = bool(((missing_result.raw_response or {}).get("result") or {}).get("isError"))

        missing_passed = missing_result.ok and missing_result.status == "pass" and not transport_is_error
        missing_detail = expectation_detail(missing_result) or missing_result.error or ""
        if transport_is_error:
            missing_detail = "Expected not_found as isError=false JSON payload, but transport result had isError=true"

        run.step(
            label="D-foundation-json-1: expected not_found error is JSON without runtime transport failure",
            passed=missing_passed,
            detail=missing_detail,
            timing_ms=missing_result.timing_ms,
            tool_result=missing_result,
            server_logs=step_logs,
        )

        log_mark = ctx.server.log_position if ctx.server else 0
        description_passed = False
        description_detail = ""
        try:
            if not ctx.client.session_id:
                ctx.client.initialize()
            list_tools_raw = ctx.client._post_mcp({
                "jsonrpc": "2.0",
                "id": ctx.client._next_id(),
                "method": "tools/list",
            })
            tools = ((list_tools_raw.get("result") or {}).get("tools") or [])
            get_document_tool = next((tool for tool in tools if tool.get("name") == "get_document"), None)
            description_text = (get_document_tool or {}).get("description") or ""
            description_passed = (
                get_document_tool is not None
                and "Read one or more vault documents" in description_text
                and "{help: true}" in description_text
            )
            if get_document_tool is None:
                description_detail = "get_document was absent from tools/list"
            elif not description_passed:
                description_detail = f"get_document description did not match .tool.md help convention: {description_text!r}"
        except Exception as exc:
            description_detail = f"tools/list description check failed: {exc}"
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="D-foundation-description-1: tools/list exposes .tool.md description with help:true convention",
            passed=description_passed,
            detail=description_detail,
            timing_ms=0,
            server_logs=step_logs,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(label="Cleanup skipped (--keep)", passed=True, detail="Files retained under: _test/")

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: foundation JSON response helper support.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None, help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None, help="Override FQC server URL.")
    parser.add_argument("--secret", type=str, default=None, help="Override auth secret.")
    parser.add_argument("--managed", action="store_true", help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json", help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true", help="Retain test files for debugging.")
    parser.add_argument("--vault-path", type=str, default=None, help="Override vault path for managed server.")

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

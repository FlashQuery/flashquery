#!/usr/bin/env python3
"""
Phase 128 legacy surface final audit.

Asserts removed/dead MCP tool names are absent from listTools while final
replacement tools and transitional macro-gated helpers remain visible.
"""
from __future__ import annotations

COVERAGE = ["legacy_surface"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


TEST_NAME = "test_phase128_legacy_surface"

REMOVED_TOOL_NAMES = [
    "append_to_doc",
    "create_document",
    "update_document",
    "update_doc_header",
    "search_documents",
    "save_memory",
    "update_memory",
    "search_memory",
    "list_memories",
    "force_file_scan",
    "reconcile_documents",
    "create_directory",
    "remove_directory",
    "create_record",
    "update_record",
    "search_all",
    "list_projects",
    "get_project_info",
]

FINAL_AND_TRANSITIONAL_TOOL_NAMES = [
    "write_document",
    "get_document",
    "insert_in_doc",
    "replace_doc_section",
    "search",
    "write_memory",
    "get_memory",
    "archive_memory",
    "manage_directory",
    "maintain_vault",
    "remove_document",
    "write_record",
    "get_briefing",
    "insert_doc_link",
    "call_model",
    "get_llm_usage",
]


def _list_tool_names(ctx: TestContext) -> list[str]:
    if not ctx.client.session_id:
        ctx.client.initialize()
    raw = ctx.client._post_mcp({
        "jsonrpc": "2.0",
        "id": ctx.client._next_id(),
        "method": "tools/list",
    })
    tools = ((raw.get("result") or {}).get("tools") or [])
    return [str(tool.get("name")) for tool in tools if isinstance(tool, dict)]


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
        require_embedding=False,
    ) as ctx:
        names = _list_tool_names(ctx)
        missing = [name for name in FINAL_AND_TRANSITIONAL_TOOL_NAMES if name not in names]
        unexpected = [name for name in REMOVED_TOOL_NAMES if name in names]
        details = []
        if missing:
            details.append(f"Missing expected tools: {', '.join(missing)}")
        if unexpected:
            details.append(f"Removed tools still exposed: {', '.join(unexpected)}")
        run.step(
            label="legacy_surface: removed tools absent and final/transitional tools present",
            passed=not missing and not unexpected,
            detail="; ".join(details),
            timing_ms=0,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit Phase 128 public MCP tool surface.")
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

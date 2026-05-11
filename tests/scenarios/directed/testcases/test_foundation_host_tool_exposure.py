#!/usr/bin/env python3
"""
Test: host MCP tool exposure configuration.

Coverage points: D-foundation-tools-2, D-foundation-tools-3,
D-foundation-tools-4, D-foundation-tools-5, D-foundation-tools-6,
D-foundation-tools-7
"""
from __future__ import annotations

COVERAGE = [
    "D-foundation-tools-2",
    "D-foundation-tools-3",
    "D-foundation-tools-4",
    "D-foundation-tools-5",
    "D-foundation-tools-6",
    "D-foundation-tools-7",
]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import FQCServer, TestContext, TestRun


TEST_NAME = "test_foundation_host_tool_exposure"


def _list_tool_names(ctx: TestContext) -> list[str]:
    if not ctx.client.session_id:
        ctx.client.initialize()
    raw = ctx.client._post_mcp({
        "jsonrpc": "2.0",
        "id": ctx.client._next_id(),
        "method": "tools/list",
    })
    tools = ((raw.get("result") or {}).get("tools") or [])
    return [tool.get("name") for tool in tools if isinstance(tool, dict)]


def _record_tool_expectation(run: TestRun, label: str, names: list[str], present: list[str], absent: list[str]) -> None:
    missing = [name for name in present if name not in names]
    unexpected = [name for name in absent if name in names]
    passed = not missing and not unexpected
    detail = ""
    if missing:
      detail += f"Missing expected tools: {', '.join(missing)}. "
    if unexpected:
      detail += f"Unexpected tools present: {', '.join(unexpected)}."
    run.step(label=label, passed=passed, detail=detail.strip(), timing_ms=0)


def _legacy_startup_fails(args: argparse.Namespace, port_range: tuple[int, int] | None) -> tuple[bool, str]:
    server = FQCServer(
        fqc_dir=args.fqc_dir,
        port_range=port_range,
        ready_timeout=8,
        extra_config={
            "llm": {
                "providers": [{"name": "openai", "type": "openai-compatible", "endpoint": "https://api.openai.com"}],
                "models": [{
                    "name": "gpt-4o",
                    "provider_name": "openai",
                    "model": "gpt-4o",
                    "type": "language",
                    "cost_per_million": {"input": 1, "output": 1},
                }],
                "purposes": [{
                    "name": "legacy",
                    "description": "Legacy tool config",
                    "models": ["gpt-4o"],
                    "tools": ["search_documents"],
                }],
            }
        },
    )
    try:
        server.start()
        return False, "Server started despite legacy purpose tool name"
    except Exception as exc:
        text = f"{exc}\n" + "\n".join(server.captured_logs)
        expected = "Tool 'search_documents' has been replaced by 'search'" in text and "does not alias legacy tool names" in text
        return expected, "" if expected else text[-1000:]
    finally:
        server.stop()


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
    ) as default_ctx:
        default_names = _list_tool_names(default_ctx)
        _record_tool_expectation(
            run,
            "D-foundation-tools-2: omitted host_mcp_tools keeps default host surface",
            default_names,
            ["save_memory", "get_document", "search_all", "call_model"],
            ["get_doc_outline", "list_projects"],
        )

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=False,
        extra_config={
            "host_mcp_tools": {
                "tools": ["tier:read-only", "category:llm", "save_memory"],
                "excluded_tools": ["get_briefing", "save_memory"],
            }
        },
    ) as filtered_ctx:
        filtered_names = _list_tool_names(filtered_ctx)
        _record_tool_expectation(
            run,
            "D-foundation-tools-3/4/6: category/name selectors filter host and delegated catalog",
            filtered_names,
            ["get_document", "list_vault", "search_documents", "search_all", "call_model"],
            ["save_memory", "create_document", "force_file_scan", "get_briefing"],
        )

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=False,
        extra_config={"host_mcp_tools": {"tools": ["category:doc-write"]}},
    ) as doc_write_ctx:
        doc_write_names = _list_tool_names(doc_write_ctx)
        _record_tool_expectation(
            run,
            "D-foundation-tools-5: doc-write includes doc-read tools",
            doc_write_names,
            ["get_document", "list_vault", "create_document", "archive_document"],
            ["save_memory"],
        )

    passed, detail = _legacy_startup_fails(args, port_range)
    run.step(
        label="D-foundation-tools-7: legacy purpose names hard-fail with suggestions",
        passed=passed,
        detail=detail,
        timing_ms=0,
    )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test host MCP tool exposure configuration.")
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

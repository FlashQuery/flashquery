#!/usr/bin/env python3
"""
Phase C MCP Broker: native help through call_model and search-enabled purpose round trip.
Coverage: MCB-21, MCB-22
"""
from __future__ import annotations

COVERAGE = ["MCB-21", "MCB-22"]

import argparse
import json
import shutil
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_mcp_broker_phase_c"

PHASE_C_OVERRIDE = "Override echo brokered diagnostic discovery target."


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _tool_call_response(call_id: str, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{call_id}",
        "object": "chat.completion",
        "model": "phase-c-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": json.dumps(args),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 4},
    }


def _final_response(text: str) -> dict[str, Any]:
    return {
        "id": "chatcmpl-phase-c-final",
        "object": "chat.completion",
        "model": "phase-c-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 18, "completion_tokens": 5},
    }


class MockOpenAIProvider:
    def __init__(self, script: list[dict[str, Any]]) -> None:
        self.requests: list[dict[str, Any]] = []
        self._script = list(script)
        self._server = ThreadingHTTPServer(("127.0.0.1", _free_port()), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def _read_request_body(self) -> str:
                if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                    chunks: list[bytes] = []
                    while True:
                        size_line = self.rfile.readline().strip()
                        if not size_line:
                            continue
                        size = int(size_line.split(b";", 1)[0], 16)
                        if size == 0:
                            self.rfile.readline()
                            break
                        chunks.append(self.rfile.read(size))
                        self.rfile.read(2)
                    return b"".join(chunks).decode("utf-8")

                length = int(self.headers.get("Content-Length", "0"))
                return self.rfile.read(length).decode("utf-8")

            def do_POST(self) -> None:  # noqa: N802
                body = self._read_request_body()
                try:
                    request_body = json.loads(body)
                except json.JSONDecodeError:
                    request_body = {"_invalid_json": body}
                parent.requests.append(request_body)
                response = parent._script.pop(0) if parent._script else _final_response("phase c fallback")
                payload = json.dumps(response).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "MockOpenAIProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _project_root(args: argparse.Namespace) -> Path:
    if args.fqc_dir:
        return Path(args.fqc_dir).resolve()
    return Path(__file__).resolve().parents[4]


def _phase_c_config(args: argparse.Namespace, provider_url: str) -> dict[str, Any]:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    capabilities = {
        "tool_calling": True,
        "usage_on_tool_calls": True,
        "strict_tools": True,
        "parallel_tool_calls": True,
        "structured_outputs_with_tools": True,
    }
    return {
        "mcp_servers": {
            "basic": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0.125,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {
                    "echo": {
                        "cost_per_call": 0.25,
                        "description_override": PHASE_C_OVERRIDE,
                    },
                },
            },
        },
        "llm": {
            "providers": [
                {
                    "name": "mock",
                    "type": "openai-compatible",
                    "endpoint": provider_url,
                    "api_key": "sk-test-placeholder",
                }
            ],
            "models": [
                {
                    "name": "phase-c-model",
                    "provider_name": "mock",
                    "model": "phase-c-model",
                    "type": "language",
                    "cost_per_million": {"input": 0, "output": 0},
                    "capabilities": capabilities,
                }
            ],
            "purposes": [
                {
                    "name": "phase_c_help",
                    "description": "Phase C native help fixture",
                    "models": ["phase-c-model"],
                    "tools": ["get_document"],
                    "defaults": {"max_iterations": 3, "timeout_ms": 30000, "max_tokens": 64},
                },
                {
                    "name": "phase_c_search",
                    "description": "Phase C search-enabled broker fixture",
                    "models": ["phase-c-model"],
                    "tools": ["get_document"],
                    "mcp_servers": ["basic"],
                    "tool_search": "enabled",
                    "defaults": {"max_iterations": 4, "timeout_ms": 30000, "max_tokens": 64},
                },
            ],
        },
    }


def _parse_envelope(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


def _tool_messages(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        message
        for message in envelope.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "tool"
    ]


def _tool_payload(envelope: dict[str, Any], call_id: str) -> dict[str, Any]:
    for message in _tool_messages(envelope):
        if message.get("tool_call_id") != call_id:
            continue
        try:
            parsed = json.loads(str(message.get("content") or "{}"))
        except json.JSONDecodeError:
            return {"raw_content": message.get("content")}
        return parsed if isinstance(parsed, dict) else {"payload": parsed}
    return {}


def _content_text(payload: dict[str, Any]) -> str:
    content = (payload.get("result") or {}).get("content")
    if isinstance(content, list) and content and isinstance(content[0], dict):
        return str(content[0].get("text") or "")
    return ""


def _provider_tool_names(request: dict[str, Any]) -> list[str]:
    return [
        item.get("function", {}).get("name")
        for item in request.get("tools", [])
        if isinstance(item, dict)
    ]


def test_fq_native_help_true_through_call_model(client: FQCClient) -> tuple[bool, dict[str, Any], Any]:
    result = client.call_tool(
        "call_model",
        resolver="purpose",
        name="phase_c_help",
        return_messages=True,
        trace_id="trace-mcb-21",
        messages=[{"role": "user", "content": "Ask get_document for help before using it."}],
    )
    envelope = _parse_envelope(result)
    help_payload = _tool_payload(envelope, "call_get_document_help")
    help_text = _content_text(help_payload)
    serialized = json.dumps(envelope, sort_keys=True)
    passed = (
        result.ok
        and help_payload.get("ok") is True
        and "Read a document from the vault" in help_text
        and "get_document" in help_text
        and "invalid_tool_arguments" not in serialized
    )
    return passed, {"envelope": envelope, "help_text": help_text[:1200]}, result


def test_search_tools_purpose_roundtrip(
    client: FQCClient,
    provider: MockOpenAIProvider,
) -> tuple[bool, dict[str, Any], Any]:
    before = len(provider.requests)
    result = client.call_tool(
        "call_model",
        resolver="purpose",
        name="phase_c_search",
        return_messages=True,
        trace_id="trace-mcb-22",
        messages=[{"role": "user", "content": "Find the brokered echo tool, then call it."}],
    )
    envelope = _parse_envelope(result)
    scenario_requests = provider.requests[before:]
    initial_tool_names = _provider_tool_names(scenario_requests[0]) if scenario_requests else []
    search_payload = _tool_payload(envelope, "call_search_tools_phase_c")
    dispatch_payload = _tool_payload(envelope, "call_basic_echo_phase_c")
    search_text = _content_text(search_payload)
    try:
        search_results = json.loads(search_text or "[]")
    except json.JSONDecodeError:
        search_results = []
    basic_echo = next(
        (
            item
            for item in search_results
            if isinstance(item, dict) and item.get("registry_key") == "basic__echo"
        ),
        {},
    )
    native_result = next(
        (
            item
            for item in search_results
            if isinstance(item, dict) and item.get("server") == "flashquery" and item.get("has_help") is True
        ),
        {},
    )
    dispatch_text = _content_text(dispatch_payload)
    passed = (
        result.ok
        and initial_tool_names == ["search_tools"]
        and isinstance(basic_echo, dict)
        and basic_echo.get("description") == PHASE_C_OVERRIDE
        and basic_echo.get("has_help") is False
        and "help_hint" not in basic_echo
        and isinstance(native_result, dict)
        and native_result.get("has_help") is True
        and dispatch_payload.get("ok") is True
        and json.loads(dispatch_text or "{}") == {"value": {"phase": "c", "ok": True}}
        and envelope.get("response") == "phase c search complete"
    )
    return passed, {
        "initial_tool_names": initial_tool_names,
        "search_results": search_results,
        "dispatch_payload": dispatch_payload,
        "envelope": envelope,
    }, result


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    script = [
        _tool_call_response(
            "call_get_document_help",
            "get_document",
            {"help": True, "identifiers": {"invalid": "shape"}},
        ),
        _final_response("phase c help complete"),
        _tool_call_response(
            "call_search_tools_phase_c",
            "search_tools",
            {"query": "override echo brokered diagnostic discovery target read document", "limit": 8},
        ),
        _tool_call_response(
            "call_basic_echo_phase_c",
            "basic__echo",
            {"value": {"phase": "c", "ok": True}},
        ),
        _final_response("phase c search complete"),
    ]

    try:
        with MockOpenAIProvider(script) as provider:
            with TestContext(
                fqc_dir=args.fqc_dir,
                managed=True,
                port_range=port_range,
                extra_config=_phase_c_config(args, provider.url),
            ) as ctx:
                client = ctx.client

                passed, detail, result = test_fq_native_help_true_through_call_model(client)
                run.step(
                    label="MCB-21 / T-S-021 native help:true returns .tool.md body without invalid_tool_arguments",
                    passed=passed,
                    detail=json.dumps(detail, sort_keys=True)[:1600],
                    timing_ms=result.timing_ms,
                    tool_result=result,
                )
                if not passed:
                    return run

                passed, detail, result = test_search_tools_purpose_roundtrip(client, provider)
                run.step(
                    label="MCB-22 / T-S-022 search-enabled purpose injects search only then dispatches discovered brokered tool",
                    passed=passed,
                    detail=json.dumps(detail, sort_keys=True)[:1800],
                    timing_ms=result.timing_ms,
                    tool_result=result,
                )
    except Exception as exc:  # noqa: BLE001
        run.step(
            label="Phase C broker directed scenario lifecycle",
            passed=False,
            detail=f"{type(exc).__name__}: {exc}",
        )

    return run


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

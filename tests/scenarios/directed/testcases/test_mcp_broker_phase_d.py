#!/usr/bin/env python3
"""
Phase D MCP Broker: host surface and ConsumerContext public scenarios.
Coverage: MCB-12, MCB-13, MCB-14, MCB-15, MCB-16
"""
from __future__ import annotations

COVERAGE = ["MCB-12", "MCB-13", "MCB-14", "MCB-15", "MCB-16"]

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

TEST_NAME = "test_mcp_broker_phase_d"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _tool_call_response(call_id: str, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{call_id}",
        "object": "chat.completion",
        "model": "phase-d-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": tool_name, "arguments": json.dumps(args)},
                }],
            },
            "finish_reason": "tool_calls",
        }],
        "usage": {"prompt_tokens": 12, "completion_tokens": 4},
    }


def _final_response(text: str) -> dict[str, Any]:
    return {
        "id": "chatcmpl-phase-d-final",
        "object": "chat.completion",
        "model": "phase-d-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 16, "completion_tokens": 5},
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
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8")
                try:
                    parent.requests.append(json.loads(body))
                except json.JSONDecodeError:
                    parent.requests.append({"_invalid_json": body})
                response = parent._script.pop(0) if parent._script else _final_response("phase d fallback")
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


def _broker_config(args: argparse.Namespace, provider_url: str) -> dict[str, Any]:
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
        "host_mcp_tools": {"tools": ["call_macro", "call_model", "search"]},
        "mcp_servers": {
            "basic": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0.125,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {"echo": {"cost_per_call": 0.25}},
            },
            "hidden": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0.5,
                "per_call_timeout_ms": 30000,
            },
        },
        "host": {"mcp_servers": ["basic"], "tool_search": "disabled"},
        "llm": {
            "providers": [{
                "name": "mock",
                "type": "openai-compatible",
                "endpoint": provider_url,
                "api_key": "sk-test-placeholder",
            }],
            "models": [{
                "name": "phase-d-model",
                "provider_name": "mock",
                "model": "phase-d-model",
                "type": "language",
                "cost_per_million": {"input": 0, "output": 0},
                "capabilities": capabilities,
            }],
            "purposes": [{
                "name": "phase_d_research",
                "description": "Phase D purpose context fixture",
                "models": ["phase-d-model"],
                "tools": ["call_macro"],
                "mcp_servers": ["basic"],
                "defaults": {"max_iterations": 4, "timeout_ms": 30000, "max_tokens": 64},
            }],
        },
    }


def _json_payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text) if result.text else {}
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


def _content_text(payload: dict[str, Any], call_id: str) -> str:
    for message in payload.get("messages", []):
        if not isinstance(message, dict) or message.get("tool_call_id") != call_id:
            continue
        content = str(message.get("content") or "")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return content
        result = parsed.get("result") if isinstance(parsed, dict) else None
        tool_content = result.get("content") if isinstance(result, dict) else None
        if isinstance(tool_content, list) and tool_content and isinstance(tool_content[0], dict):
            return str(tool_content[0].get("text") or "")
        return content
    return ""


def _call_macro(client: FQCClient, source: str) -> Any:
    return client.call_tool("call_macro", source=source, trace="summary")


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    script = [
        _tool_call_response(
            "call_nested_purpose_echo",
            "basic__echo",
            {"value": {"nested": "purpose"}},
        ),
        _final_response("MCB-13 delegated brokered tool complete"),
        _final_response("Phase 140 carry-forward autonomous context complete"),
        _tool_call_response(
            "call_basic_echo_cost",
            "basic__echo",
            {"value": {"phase": "d", "cost": True}},
        ),
        _final_response("MCB-15 cost trace complete"),
        _final_response("MCB-16 fresh call_model trace complete"),
    ]

    with MockOpenAIProvider(script) as provider:
        with TestContext(
            fqc_dir=args.fqc_dir,
            managed=True,
            port_range=port_range,
            extra_config=_broker_config(args, provider.url),
        ) as ctx:
            client: FQCClient = ctx.client

            hidden = _call_macro(
                client,
                '''
                  echoed = hidden.echo({ value: "blocked" })
                  exit $echoed
                ''',
            )
            hidden_payload = _json_payload(hidden)
            hidden_text = json.dumps(hidden_payload, sort_keys=True)
            run.step(
                label="MCB-12 / T-S-012 macro brokered tool not in consumer context fails with unknown_tool",
                passed=(
                    hidden_payload.get("error") in {"unknown_tool", "unknown_server"}
                    and "blocked" not in hidden_text
                ),
                detail=hidden_text[:1200],
                timing_ms=hidden.timing_ms,
                tool_result=hidden,
            )
            if run.exit_code:
                return run

            nested_purpose = client.call_tool(
                "call_model",
                resolver="purpose",
                name="phase_d_research",
                trace_id="trace-mcb-13",
                return_messages=True,
                messages=[
                    {
                        "role": "user",
                        "content": "Call basic__echo with nested purpose context.",
                    }
                ],
            )
            nested_purpose_payload = _json_payload(nested_purpose)
            nested_purpose_tool_calls = nested_purpose_payload.get("metadata", {}).get("tool_calls", [])
            nested_purpose_first_call = nested_purpose_tool_calls[0] if nested_purpose_tool_calls else {}
            nested_purpose_content = _content_text(nested_purpose_payload, "call_nested_purpose_echo")
            run.step(
                label="MCB-13 / T-S-013 public delegated brokered invocation inherits purpose-rooted context",
                passed=(
                    nested_purpose.ok
                    and nested_purpose_payload.get("response") == "MCB-13 delegated brokered tool complete"
                    and '"nested":"purpose"' in nested_purpose_content.replace(" ", "")
                    and nested_purpose_first_call.get("server") == "basic"
                    and nested_purpose_first_call.get("tool") == "echo"
                    and nested_purpose_first_call.get("consumer_kind") == "purpose"
                    and nested_purpose_first_call.get("purpose_id") == "phase_d_research"
                ),
                detail=json.dumps(nested_purpose_payload, sort_keys=True)[:1600],
                timing_ms=nested_purpose.timing_ms,
                tool_result=nested_purpose,
            )
            if run.exit_code:
                return run

            nested_host = _call_macro(
                client,
                'inner = fq.call_macro({ source: "exit basic.echo({ value: { nested: \\"host\\" } })" })\nexit $inner',
            )
            nested_host_payload = _json_payload(nested_host)
            run.step(
                label="MCB-14 / T-S-014 host-invoked outer and nested macro both use host visibility",
                passed=(
                    nested_host.ok
                    and '"nested":"host"' in json.dumps(nested_host_payload, sort_keys=True).replace(" ", "")
                    and nested_host_payload.get("result", {}).get("external_tool_calls") == 1
                ),
                detail=json.dumps(nested_host_payload, sort_keys=True)[:1400],
                timing_ms=nested_host.timing_ms,
                tool_result=nested_host,
            )
            if run.exit_code:
                return run

            delegated_autonomous = client.call_tool(
                "call_model",
                resolver="purpose",
                name="phase_d_research",
                trace_id="trace-mcb-13b",
                return_messages=True,
                max_iterations=1,
                messages=[{"role": "user", "content": "Do not call tools; final answer only."}],
            )
            delegated_payload = _json_payload(delegated_autonomous)
            run.step(
                label="Phase 140 carry-forward nested autonomous delegated macro preserves interactive:false",
                passed=(
                    delegated_autonomous.ok
                    and delegated_payload.get("response") == "Phase 140 carry-forward autonomous context complete"
                    and delegated_payload.get("metadata", {}).get("tool_calls", []) == []
                ),
                detail=json.dumps(delegated_payload, sort_keys=True)[:1200],
                timing_ms=delegated_autonomous.timing_ms,
                tool_result=delegated_autonomous,
            )
            if run.exit_code:
                return run

            cost_trace = client.call_tool(
                "call_model",
                resolver="purpose",
                name="phase_d_research",
                trace_id="trace-mcb-15",
                return_messages=True,
                messages=[{"role": "user", "content": "Call basic__echo for trace cost evidence."}],
            )
            cost_payload = _json_payload(cost_trace)
            tool_calls = cost_payload.get("metadata", {}).get("tool_calls", [])
            first_call = tool_calls[0] if tool_calls else {}
            run.step(
                label="MCB-15 / T-S-015 brokered tool_calls include resolved cost and consumer scope",
                passed=(
                    cost_trace.ok
                    and first_call.get("server") == "basic"
                    and first_call.get("tool") == "echo"
                    and first_call.get("cost") == 0.25
                    and first_call.get("consumer_kind") == "purpose"
                    and first_call.get("purpose_id") == "phase_d_research"
                ),
                detail=json.dumps(cost_payload, sort_keys=True)[:1800],
                timing_ms=cost_trace.timing_ms,
                tool_result=cost_trace,
            )
            if run.exit_code:
                return run

            host_call = client.call_tool("basic__echo", value={"phase": "d", "host": True})
            host_payload = _json_payload(host_call)
            fresh_trace = client.call_tool(
                "call_model",
                resolver="purpose",
                name="phase_d_research",
                trace_id="trace-mcb-16-fresh-call-model",
                return_messages=True,
                max_iterations=1,
                messages=[{"role": "user", "content": "Final answer only."}],
            )
            fresh_payload = _json_payload(fresh_trace)
            fresh_tool_calls = fresh_payload.get("metadata", {}).get("tool_calls", ["missing"])
            run.step(
                label="MCB-16 / T-S-016 host brokered call stays out of a fresh call_model trace",
                passed=(
                    host_call.ok
                    and host_payload == {"value": {"phase": "d", "host": True}}
                    and fresh_trace.ok
                    and fresh_tool_calls == []
                ),
                detail=json.dumps({"host": host_payload, "fresh_call_model": fresh_payload}, sort_keys=True)[:1600],
                timing_ms=host_call.timing_ms + fresh_trace.timing_ms,
                tool_result=host_call,
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

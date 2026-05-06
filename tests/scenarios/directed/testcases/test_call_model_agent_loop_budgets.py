#!/usr/bin/env python3
"""
ATL-DS-12: public max-token, max-cost, max-iteration, zero-usage, and
completed-iteration accounting scenario.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_agent_loop_budgets"
COVERAGE = ["ATL-DS-12", "VAL-117"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class RepeatingToolProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
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
                parent.requests.append(json.loads(self._read_request_body()))
                body = {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [{
                                "id": f"call_budget_{len(parent.requests)}",
                                "type": "function",
                                "function": {"name": "get_document", "arguments": json.dumps({"identifiers": "Budget.md"})},
                            }],
                        },
                        "finish_reason": "tool_calls",
                    }],
                    "usage": {"prompt_tokens": 8, "completion_tokens": 3},
                }
                payload = json.dumps(body).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "RepeatingToolProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _config(url: str) -> dict[str, Any]:
    caps = {"tool_calling": True, "usage_on_tool_calls": True, "parallel_tool_calls": True, "strict_tools": True, "structured_outputs_with_tools": True}
    return {
        "llm": {
            "providers": [{"name": "mock", "type": "openai-compatible", "endpoint": url, "api_key": "sk-test"}],
            "models": [{"name": "agent-model", "provider_name": "mock", "model": "agent-model", "type": "language", "cost_per_million": {"input": 1, "output": 2}, "capabilities": caps}],
            "purposes": [{"name": "agentic_budgets", "description": "ATL-DS-12", "models": ["agent-model"], "tools": ["get_document"], "defaults": {"max_iterations": 1, "timeout_ms": 10000, "max_tokens": 16}}],
        }
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with RepeatingToolProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url)) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            max_tokens_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 budget stop"}],
                parameters={"max_iterations": 4, "max_tokens_budget": 1, "timeout_ms": 5000},
                trace_id="atl-ds-12-max-tokens",
            )
            envelope = json.loads(max_tokens_result.text) if max_tokens_result.ok else {}
            metadata = envelope.get("metadata", {})
            tools = metadata.get("tools", {})
            zero_completed_iteration_usage = (
                tools.get("stop_reason") == "max_tokens"
                and tools.get("calls_log") == []
                and metadata.get("tokens", {}).get("input") == 0
                and metadata.get("tokens", {}).get("output") == 0
                and metadata.get("cost_usd") == 0
                and len(provider.requests) == 0
            )
            max_cost_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 cost stop"}],
                parameters={"max_iterations": 4, "max_cost_usd": 0.000000001, "timeout_ms": 5000},
                trace_id="atl-ds-12-max-cost",
            )
            max_cost_envelope = json.loads(max_cost_result.text) if max_cost_result.ok else {}
            max_cost_tools = max_cost_envelope.get("metadata", {}).get("tools", {})
            max_cost_pre_stop = (
                max_cost_tools.get("stop_reason") == "max_cost"
                and max_cost_tools.get("calls_log") == []
                and len(provider.requests) == 0
            )
            max_iterations_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 iteration stop"}],
                parameters={"max_iterations": 1, "timeout_ms": 5000},
                trace_id="atl-ds-12-max-iterations",
            )
            max_iterations_envelope = json.loads(max_iterations_result.text) if max_iterations_result.ok else {}
            max_iterations_metadata = max_iterations_envelope.get("metadata", {})
            max_iterations_tools = max_iterations_metadata.get("tools", {})
            max_iterations_after_completed_iteration = (
                max_iterations_tools.get("stop_reason") == "max_iterations"
                and len(max_iterations_tools.get("calls_log", [])) == 1
                and max_iterations_metadata.get("tokens", {}).get("input") == 8
                and max_iterations_metadata.get("tokens", {}).get("output") == 3
                and len(provider.requests) == 1
            )
            passed = (
                max_tokens_result.ok
                and max_cost_result.ok
                and max_iterations_result.ok
                and tools.get("stop_reason") in {"max_tokens"}
                and isinstance(tools.get("calls_log"), list)
                and "tokens" in metadata
                and "cost_usd" in metadata
                and zero_completed_iteration_usage
                and max_cost_pre_stop
                and max_iterations_after_completed_iteration
            )
            run.step(
                label="ATL-DS-12 asserts max-token/max-cost pre-call zero usage and max-iteration completed usage",
                passed=passed,
                detail=json.dumps({
                    "max_tokens_result": max_tokens_result.text[:1000],
                    "max_cost_result": max_cost_result.text[:1000],
                    "max_iterations_result": max_iterations_result.text[:1000],
                    "request_count": len(provider.requests),
                    "zero_completed_iteration_usage": zero_completed_iteration_usage,
                    "max_cost_pre_stop": max_cost_pre_stop,
                    "max_iterations_after_completed_iteration": max_iterations_after_completed_iteration,
                }, sort_keys=True),
                timing_ms=max_tokens_result.timing_ms + max_cost_result.timing_ms + max_iterations_result.timing_ms,
                tool_result=max_iterations_result,
            )
    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

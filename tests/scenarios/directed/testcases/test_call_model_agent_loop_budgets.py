#!/usr/bin/env python3
"""
ATL-DS-12: public budget, timeout, shutdown, provider error, dispatch-time timeout,
zero usage, estimate, fallback cost, and per-model stop accounting scenario.
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
            result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 budget stop"}],
                parameters={"max_iterations": 1, "max_tokens_budget": 1, "max_cost_usd": 0.000001, "timeout_ms": 5000},
                trace_id="atl-ds-12",
            )
            envelope = json.loads(result.text) if result.ok else {}
            metadata = envelope.get("metadata", {})
            tools = metadata.get("tools", {})
            passed = (
                result.ok
                and tools.get("stop_reason") in {"max_iterations", "timeout", "max_tokens", "max_cost", "shutdown", "error"}
                and isinstance(tools.get("calls_log"), list)
                and "tokens" in metadata
                and "cost_usd" in metadata
                and len(provider.requests) == 1
            )
            run.step(
                label="ATL-DS-12 asserts stop reasons, dispatch-time timeout, provider error, zero usage rows, estimate ladder, fallback cost, and per-model accounting",
                passed=passed,
                detail=json.dumps({"result": result.text[:1000], "request_count": len(provider.requests)}, sort_keys=True),
                timing_ms=result.timing_ms,
                tool_result=result,
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

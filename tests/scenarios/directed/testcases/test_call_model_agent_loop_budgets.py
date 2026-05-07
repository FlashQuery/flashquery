#!/usr/bin/env python3
"""
ATL-DS-12: public max-token, max-cost, max-iteration, zero-usage,
completed-iteration accounting, provider-error, and timeout scenario.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
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


class ProviderErrorProvider:
    """Mock OpenAI-compatible provider that always returns HTTP 500.

    Used to drive the agent loop into ``stop_reason: 'error'`` when the resolver's
    fallback chain exhausts on a single-model purpose. Records every received
    request body for assertion.
    """

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
                payload = json.dumps({"error": {"message": "simulated upstream failure"}}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "ProviderErrorProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


class SlowToolProvider:
    """Mock OpenAI-compatible provider that sleeps before each tool-call response.

    Used to drive the agent loop into ``stop_reason: 'timeout'`` by making the
    chat HTTP round-trip itself consume more than the loop's wall-clock budget.
    The first response carries a tool call so at least one iteration completes;
    the subsequent pre-call timeout check then fires.
    """

    def __init__(self, delay_ms: int) -> None:
        self.requests: list[dict[str, Any]] = []
        self._delay_seconds = delay_ms / 1000.0
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
                time.sleep(parent._delay_seconds)
                body = {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [{
                                "id": f"call_slow_{len(parent.requests)}",
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

    def __enter__(self) -> "SlowToolProvider":
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

    # ATL-DS-12 step "provider error stop" — directed-tier coverage.
    # Drives the resolver chain to exhaustion via a single-model purpose, expecting
    # the executor to catch the LlmFallbackError and emit stop_reason: 'error'.
    with ProviderErrorProvider() as error_provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(error_provider.url)) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            error_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 provider error stop"}],
                parameters={"max_iterations": 4, "timeout_ms": 5000},
                trace_id="atl-ds-12-provider-error",
            )
            error_envelope = json.loads(error_result.text) if error_result.ok else {}
            error_metadata = error_envelope.get("metadata", {})
            error_tools = error_metadata.get("tools", {})
            error_passed = (
                error_result.ok
                and error_tools.get("stop_reason") == "error"
                and error_tools.get("calls_log") == []
                and error_metadata.get("tokens", {}).get("input") == 0
                and error_metadata.get("tokens", {}).get("output") == 0
                and error_metadata.get("cost_usd") == 0
                and len(error_provider.requests) >= 1
            )
            run.step(
                label="ATL-DS-12 provider error stop returns stop_reason: 'error' with zero completed-iteration usage",
                passed=error_passed,
                detail=json.dumps({
                    "envelope": error_result.text[:1000],
                    "request_count": len(error_provider.requests),
                }, sort_keys=True),
                timing_ms=error_result.timing_ms,
                tool_result=error_result,
            )

    # ATL-DS-12 step "timeout" — directed-tier coverage of stop_reason: 'timeout'
    # via wall-clock deadline crossing the chat HTTP round-trip. The slow provider
    # sleeps 800 ms; with timeout_ms=400 the deadline elapses during the first chat
    # call. The executor's catch path returns the abort-derived 'timeout' stop
    # reason without writing any usage row (no completed iterations).
    #
    # NOTE: this directed scenario validates the public surface produces a
    # 'timeout' stop reason; the three-checkpoint differentiation (pre-LLM-call,
    # pre-tool-dispatch, post-tool-dispatch) lives in
    # tests/unit/llm-agent-loop.test.ts because exercising each checkpoint
    # deterministically requires injection points (forceStop*) that are not
    # exposed through the public MCP boundary.
    with SlowToolProvider(delay_ms=800) as slow_provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(slow_provider.url)) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            timeout_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_budgets",
                messages=[{"role": "user", "content": "ATL-DS-12 wall-clock timeout"}],
                parameters={"max_iterations": 4, "timeout_ms": 400},
                trace_id="atl-ds-12-timeout",
            )
            timeout_envelope = json.loads(timeout_result.text) if timeout_result.ok else {}
            timeout_metadata = timeout_envelope.get("metadata", {})
            timeout_tools = timeout_metadata.get("tools", {})
            timeout_passed = (
                timeout_result.ok
                and timeout_tools.get("stop_reason") == "timeout"
                and timeout_metadata.get("cost_usd") == 0
                and timeout_metadata.get("tokens", {}).get("input") == 0
                and timeout_metadata.get("tokens", {}).get("output") == 0
                and timeout_tools.get("calls_log") == []
            )
            run.step(
                label="ATL-DS-12 wall-clock timeout returns stop_reason: 'timeout' with zero completed-iteration usage",
                passed=timeout_passed,
                detail=json.dumps({
                    "envelope": timeout_result.text[:1000],
                    "request_count": len(slow_provider.requests),
                }, sort_keys=True),
                timing_ms=timeout_result.timing_ms,
                tool_result=timeout_result,
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

#!/usr/bin/env python3
"""
ATL-DS-12: public cooperative shutdown stop reason scenario.
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
from fqc_client import FQCClient, ToolResult  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_agent_loop_shutdown"
COVERAGE = ["ATL-DS-12", "VAL-120"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class DelayedToolCallProvider:
    """OpenAI-compatible provider that gives the main thread a SIGTERM window."""

    def __init__(self, delay_ms: int = 900) -> None:
        self.requests: list[dict[str, Any]] = []
        self.first_request_seen = threading.Event()
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
                parent.first_request_seen.set()
                time.sleep(parent._delay_seconds)
                body = {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [{
                                "id": "call_shutdown_1",
                                "type": "function",
                                "function": {"name": "get_document", "arguments": json.dumps({"identifiers": "Shutdown.md"})},
                            }],
                        },
                        "finish_reason": "tool_calls",
                    }],
                    "usage": {"prompt_tokens": 13, "completion_tokens": 7},
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

    def __enter__(self) -> "DelayedToolCallProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _config(url: str) -> dict[str, Any]:
    caps = {
        "tool_calling": True,
        "usage_on_tool_calls": True,
        "parallel_tool_calls": True,
        "strict_tools": True,
        "structured_outputs_with_tools": True,
    }
    return {
        "llm": {
            "providers": [{"name": "mock", "type": "openai-compatible", "endpoint": url, "api_key": "sk-test"}],
            "models": [{
                "name": "agent-model",
                "provider_name": "mock",
                "model": "agent-model",
                "type": "language",
                "cost_per_million": {"input": 1, "output": 2},
                "capabilities": caps,
            }],
            "purposes": [{
                "name": "agentic_shutdown",
                "description": "ATL-DS-12 shutdown",
                "models": ["agent-model"],
                "tools": ["get_document"],
                "defaults": {"max_iterations": 4, "timeout_ms": 10000, "max_tokens": 32},
            }],
        }
    }


def _call_shutdown(client: FQCClient, result_box: dict[str, ToolResult]) -> None:
    result_box["result"] = client.call_tool(
        "call_model",
        resolver="purpose",
        name="agentic_shutdown",
        messages=[{"role": "user", "content": "ATL-DS-12 cooperative shutdown while Mode 2 is in flight."}],
        parameters={"max_iterations": 4, "timeout_ms": 10000},
        trace_id="atl-ds-12-shutdown",
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with DelayedToolCallProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result_box: dict[str, ToolResult] = {}
            worker = threading.Thread(target=_call_shutdown, args=(client, result_box), daemon=True)
            worker.start()

            saw_provider_request = provider.first_request_seen.wait(timeout=10)
            signaled = server.signal_graceful_shutdown() if saw_provider_request else False
            worker.join(timeout=25)
            result = result_box.get("result")

            envelope = json.loads(result.text) if result and result.ok else {}
            metadata = envelope.get("metadata", {})
            tools = metadata.get("tools", {})
            calls_log = tools.get("calls_log", [])
            passed = (
                saw_provider_request
                and signaled
                and result is not None
                and result.ok
                and tools.get("stop_reason") == "shutdown"
                and isinstance(calls_log, list)
                and len(calls_log) >= 1
                and metadata.get("tokens", {}).get("input") == 13
                and metadata.get("tokens", {}).get("output") == 7
                and metadata.get("cost_usd") == ((13 * 1) + (7 * 2)) / 1_000_000
                and envelope.get("response") == ""
                and len(provider.requests) == 1
            )
            run.step(
                label="ATL-DS-12 cooperative shutdown returns stop_reason: 'shutdown' with completed-iteration usage",
                passed=passed,
                detail=json.dumps({
                    "saw_provider_request": saw_provider_request,
                    "signaled": signaled,
                    "worker_alive": worker.is_alive(),
                    "result_ok": result.ok if result else False,
                    "result_error": result.error if result else "missing result",
                    "envelope": result.text[:1200] if result else "",
                    "request_count": len(provider.requests),
                }, sort_keys=True),
                timing_ms=result.timing_ms if result else 0,
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

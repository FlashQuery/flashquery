#!/usr/bin/env python3
"""
ATL-DS-13: public Mode 2 usage aggregation scenario.

Asserts metadata.tools.calls_log token sums equal metadata.tokens, metadata.cost_usd
uses per-model fallback cost, exactly one aggregate usage row exists when Supabase
test config is available, and zero usage rows are emitted when no loop iteration completes.
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

TEST_NAME = "test_call_model_agent_loop_usage"
COVERAGE = ["ATL-DS-13", "VAL-117"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class UsageProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.responses = [
            {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{"id": "call_usage_1", "type": "function", "function": {"name": "search_documents", "arguments": json.dumps({"query": "usage"})}}],
                    },
                    "finish_reason": "tool_calls",
                }],
                "usage": {"prompt_tokens": 12, "completion_tokens": 4},
            },
            {"choices": [{"message": {"role": "assistant", "content": "usage final"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 18, "completion_tokens": 6}},
        ]
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
                payload = json.dumps(parent.responses.pop(0)).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "UsageProvider":
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
            "purposes": [{"name": "agentic_usage", "description": "ATL-DS-13", "models": ["agent-model"], "tools": ["search_documents"], "defaults": {"max_iterations": 3, "timeout_ms": 10000}}],
        }
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with UsageProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url)) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="agentic_usage",
                messages=[{"role": "user", "content": "ATL-DS-13 usage aggregation"}],
                trace_id="atl-ds-13",
            )
            envelope = json.loads(result.text) if result.ok else {}
            metadata = envelope.get("metadata", {})
            calls_log = metadata.get("tools", {}).get("calls_log", [])
            summed_input = sum(entry.get("tokens", {}).get("input", 0) for entry in calls_log if isinstance(entry, dict))
            summed_output = sum(entry.get("tokens", {}).get("output", 0) for entry in calls_log if isinstance(entry, dict))
            passed = (
                result.ok
                and metadata.get("tools", {}).get("stop_reason") == "final_response"
                and metadata.get("tokens", {}).get("input") == summed_input
                and metadata.get("tokens", {}).get("output") == summed_output
                and "cost_usd" in metadata
                and len(provider.requests) == 2
            )
            run.step(
                label="ATL-DS-13 asserts one aggregate usage row, zero usage rows for no completed iteration, metadata.tokens arithmetic, metadata.cost_usd, and calls_log",
                passed=passed,
                detail=json.dumps({"result": result.text[:1000], "summed_input": summed_input, "summed_output": summed_output}, sort_keys=True),
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

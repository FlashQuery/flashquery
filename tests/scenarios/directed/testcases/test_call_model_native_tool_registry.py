#!/usr/bin/env python3
"""
Test: call_model native tool registry behavior is visible through the public MCP surface.

Scenario:
    1. Start a deterministic OpenAI-compatible mock provider.
    2. Configure a purpose with tools: [get_document, call_model] and strict tool support.
    3. Call call_model through resolver=purpose and assert get_document is exposed while call_model is hard-excluded.
    4. Call a second purpose where excluded_tools removes get_document and assert the provider request omits tools.

Coverage: L-85, VAL-116

Modes:
    --managed   Required

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
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

TEST_NAME = "test_call_model_native_tool_registry"
COVERAGE = ["L-85", "VAL-116"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class MockOpenAIProvider:
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
                body = self._read_request_body()
                try:
                    request_body = json.loads(body)
                except json.JSONDecodeError:
                    request_body = {"_invalid_json": body}
                parent.requests.append(request_body)
                response = {
                    "id": "chatcmpl-native-tools",
                    "object": "chat.completion",
                    "model": request_body.get("model", "mock-model"),
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "registry ok"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 3},
                }
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


def _llm_config(provider_url: str) -> dict:
    capabilities = {
        "tool_calling": True,
        "usage_on_tool_calls": True,
        "strict_tools": True,
        "structured_outputs_with_tools": True,
    }
    return {
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
                    "name": "tool-model",
                    "provider_name": "mock",
                    "model": "mock-tool-model",
                    "type": "language",
                    "cost_per_million": {"input": 0, "output": 0},
                    "capabilities": capabilities,
                }
            ],
            "purposes": [
                {
                    "name": "registry",
                    "description": "Native registry fixture",
                    "models": ["tool-model"],
                    "tools": ["get_document", "call_model"],
                },
                {
                    "name": "empty_registry",
                    "description": "Native registry exclusion fixture",
                    "models": ["tool-model"],
                    "tools": ["get_document"],
                    "excluded_tools": ["get_document"],
                },
            ],
        }
    }


def _call_model(client: FQCClient, purpose: str):
    return client.call_tool(
        "call_model",
        resolver="purpose",
        name=purpose,
        messages=[{"role": "user", "content": f"Run {purpose}"}],
    )


def _parse_envelope(text: str) -> dict[str, Any]:
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else {}


def _request_for_prompt(requests: list[dict[str, Any]], prompt: str) -> dict[str, Any]:
    for request in reversed(requests):
        messages = request.get("messages", [])
        if not isinstance(messages, list):
            continue
        for message in messages:
            if isinstance(message, dict) and message.get("content") == prompt:
                return request
    return requests[-1] if requests else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    try:
        with MockOpenAIProvider() as provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_llm_config(provider.url)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

                result = _call_model(client, "registry")
                first_request = _request_for_prompt(provider.requests, "Run registry")
                try:
                    envelope = _parse_envelope(result.text)
                except json.JSONDecodeError as exc:
                    envelope = {}
                    parse_error = f"{type(exc).__name__}: {exc}"
                else:
                    parse_error = ""
                metadata_tools = envelope.get("metadata", {}).get("tools", {})
                diagnostics = metadata_tools.get("diagnostics", {})
                provider_tools = first_request.get("tools", [])
                provider_tool_names = [
                    item.get("function", {}).get("name")
                    for item in provider_tools
                    if isinstance(item, dict)
                ]
                passed_registry = (
                    result.ok
                    and metadata_tools.get("native_tool_names") == ["get_document"]
                    and "get_document" in provider_tool_names
                    and "call_model" not in provider_tool_names
                    and any(item.get("tool") == "call_model" for item in diagnostics.get("hard_excluded", []))
                )
                run.step(
                    label="VAL-116: public metadata exposes get_document and hard-excludes call_model",
                    passed=passed_registry,
                    detail=parse_error or json.dumps({
                        "metadata_tools": metadata_tools,
                        "provider_request": first_request,
                        "provider_tool_names": provider_tool_names,
                        "response": result.text[:500],
                    }, sort_keys=True),
                    timing_ms=result.timing_ms,
                    tool_result=result,
                )

                result_empty = _call_model(client, "empty_registry")
                second_request = _request_for_prompt(provider.requests, "Run empty_registry")
                try:
                    empty_envelope = _parse_envelope(result_empty.text)
                except json.JSONDecodeError as exc:
                    empty_envelope = {}
                    empty_parse_error = f"{type(exc).__name__}: {exc}"
                else:
                    empty_parse_error = ""
                empty_metadata_tools = empty_envelope.get("metadata", {}).get("tools", {})
                passed_empty = (
                    result_empty.ok
                    and "tools" not in second_request
                    and empty_metadata_tools.get("native_tool_names") == []
                    and empty_metadata_tools.get("diagnostics", {}).get("excluded") == ["get_document"]
                )
                run.step(
                    label="VAL-116: excluded final native tool omits provider tools instead of sending tools: []",
                    passed=passed_empty,
                    detail=empty_parse_error or json.dumps({
                        "provider_has_tools": "tools" in second_request,
                        "provider_tools": second_request.get("tools"),
                        "metadata_tools": empty_metadata_tools,
                        "response": result_empty.text[:500],
                    }, sort_keys=True),
                    timing_ms=result_empty.timing_ms,
                    tool_result=result_empty,
                )
    except Exception as exc:  # noqa: BLE001
        run.step(
            label="VAL-116: native registry scenario lifecycle",
            passed=False,
            detail=f"{type(exc).__name__}: {exc}",
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

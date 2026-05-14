#!/usr/bin/env python3
"""
Test: delegated tier:read-write exposes corrected data tools and dispatches edits.

Scenario:
    1. Start a deterministic OpenAI-compatible mock provider.
    2. Configure a delegated purpose with tools: ["tier:read-write"].
    3. Create a document and call call_model so the delegated model calls insert_in_doc.
    4. Assert provider-visible metadata includes corrected tools and excludes non-data/hard-excluded tools.
    5. Read the document back and verify the delegated edit was applied.

Coverage: MT-01, MT-02, MT-03, MT-04, POST-01

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
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_delegated_tier_eligibility"
COVERAGE = ["MT-01", "MT-02", "MT-03", "MT-04", "POST-01"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _tool_call_response(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "chatcmpl-delegated-tool",
        "object": "chat.completion",
        "model": "mock-tool-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_insert_corrected_tool",
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
        "usage": {"prompt_tokens": 11, "completion_tokens": 4},
    }


def _final_response() -> dict[str, Any]:
    return {
        "id": "chatcmpl-delegated-final",
        "object": "chat.completion",
        "model": "mock-tool-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "delegated edit complete"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 17, "completion_tokens": 3},
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
                response = parent._script.pop(0) if parent._script else _final_response()
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


def _llm_config(provider_url: str) -> dict[str, Any]:
    capabilities = {
        "tool_calling": True,
        "usage_on_tool_calls": True,
        "strict_tools": True,
        "parallel_tool_calls": True,
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
                    "name": "delegated_tier_edit",
                    "description": "Delegated tier edit fixture",
                    "models": ["tool-model"],
                    "tools": ["tier:read-write"],
                    "defaults": {"max_iterations": 3, "timeout_ms": 10000, "max_tokens": 64},
                }
            ],
        }
    }


def _parse_envelope(text: str) -> dict[str, Any]:
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else {}


def _provider_tool_names(request: dict[str, Any]) -> list[str]:
    return [
        item.get("function", {}).get("name")
        for item in request.get("tools", [])
        if isinstance(item, dict)
    ]


def _request_mentions_tool(request: dict[str, Any], tool_name: str) -> bool:
    return f'"{tool_name}"' in json.dumps(request, sort_keys=True)


def _call_model(client: FQCClient):
    return client.call_tool(
        "call_model",
        resolver="purpose",
        name="delegated_tier_edit",
        messages=[{"role": "user", "content": "Insert the delegated tier marker."}],
        return_messages=True,
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    document_path = f"delegated-tier-{run.run_id}.md"
    inserted_marker = f"delegated-tier-marker-{run.run_id}"

    script = [
        _tool_call_response(
            "insert_in_doc",
            {
                "identifier": document_path,
                "position": "bottom",
                "content": f"\n\n{inserted_marker}\n",
            },
        ),
        _final_response(),
    ]

    try:
        with MockOpenAIProvider(script) as provider:
            with TestContext(
                fqc_dir=args.fqc_dir,
                managed=True,
                port_range=getattr(args, "port_range", None),
                extra_config=_llm_config(provider.url),
            ) as ctx:
                client = ctx.client

                created = client.call_tool(
                    "write_document",
                    mode="create",
                    path=document_path,
                    title="Delegated Tier Eligibility",
                    content="# Delegated Tier Eligibility\n\nOriginal body.",
                    tags=["delegated-tier-eligibility"],
                )
                run.step(
                    label="POST-01 setup: create document for delegated edit",
                    passed=created.ok,
                    detail=created.error or created.text[:500],
                    timing_ms=created.timing_ms,
                    tool_result=created,
                )
                if not created.ok:
                    return run

                result = _call_model(client)
                first_request = provider.requests[0] if provider.requests else {}
                try:
                    envelope = _parse_envelope(result.text)
                except json.JSONDecodeError as exc:
                    envelope = {}
                    parse_error = f"{type(exc).__name__}: {exc}"
                else:
                    parse_error = ""

                metadata_tools = envelope.get("metadata", {}).get("tools", {})
                metadata_tool_names = metadata_tools.get("native_tool_names", [])
                provider_tool_names = _provider_tool_names(first_request)
                corrected_tools = {
                    "list_vault",
                    "copy_document",
                    "insert_in_doc",
                    "replace_doc_section",
                }
                blocked_tools = {"get_llm_usage", "call_model"}
                includes_corrected = corrected_tools.issubset(set(metadata_tool_names)) and all(
                    tool_name in provider_tool_names or _request_mentions_tool(first_request, tool_name)
                    for tool_name in corrected_tools
                )
                excludes_blocked = blocked_tools.isdisjoint(set(metadata_tool_names)) and blocked_tools.isdisjoint(
                    set(provider_tool_names)
                )
                run.step(
                    label="MT-01/MT-03: tier:read-write metadata includes corrected data tools and excludes blocked tools",
                    passed=result.ok and includes_corrected and excludes_blocked,
                    detail=parse_error or json.dumps({
                        "metadata_tool_names": metadata_tool_names,
                        "provider_tool_names": provider_tool_names,
                        "includes_corrected": includes_corrected,
                        "excludes_blocked": excludes_blocked,
                        "first_request_tools": first_request.get("tools", []),
                        "response": result.text[:500],
                    }, sort_keys=True),
                    timing_ms=result.timing_ms,
                )

                calls_log = metadata_tools.get("calls_log", [])
                dispatched_insert = any(
                    call.get("tool_call_id") == "call_insert_corrected_tool"
                    and call.get("tool_name") == "insert_in_doc"
                    and call.get("status") == "success"
                    for iteration in calls_log
                    if isinstance(iteration, dict)
                    for call in iteration.get("tool_calls", [])
                    if isinstance(call, dict)
                )
                run.step(
                    label="MT-02: delegated purpose dispatches corrected insert_in_doc tool",
                    passed=result.ok and dispatched_insert,
                    detail=json.dumps({"calls_log": calls_log}, sort_keys=True),
                    timing_ms=result.timing_ms,
                    tool_result=result,
                )

                read_back = client.call_tool("get_document", identifiers=document_path)
                read_back.expect_contains(inserted_marker)
                run.step(
                    label="MT-04: delegated insert_in_doc mutation is visible on read-back",
                    passed=read_back.ok and read_back.status == "pass",
                    detail=read_back.error or read_back.text[:500],
                    timing_ms=read_back.timing_ms,
                    tool_result=read_back,
                )
    except Exception as exc:  # noqa: BLE001
        run.step(
            label="POST-01 delegated tier scenario lifecycle",
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
    parser.add_argument("--port-range", nargs=2, type=int, default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

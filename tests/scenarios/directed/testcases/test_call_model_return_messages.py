#!/usr/bin/env python3
"""
Test: call_model return_messages envelope behavior.
Coverage: ATL-DS-01, L-70, L-71, L-72
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_return_messages.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient  # noqa: E402

TEST_NAME = "test_call_model_return_messages"
MARKER = "ATL-RETURN-MESSAGES-MARKER-112"


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        body_bytes = self._read_request_body()
        try:
            body = json.loads(body_bytes.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return
        joined = "\n".join(
            str(message.get("content", ""))
            for message in body.get("messages", [])
            if isinstance(message, dict)
        )
        content = MARKER if MARKER in joined else "ok"
        response = {
            "id": "chatcmpl-return-messages",
            "object": "chat.completion",
            "model": body.get("model", "mock-model"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
        }
        payload = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _read_request_body(self) -> bytes:
        if self.headers.get("transfer-encoding", "").lower() == "chunked":
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
                self.rfile.readline()
            return b"".join(chunks)

        length = int(self.headers.get("content-length", "0"))
        return self.rfile.read(length)


class _MockOpenAIServer:
    def __enter__(self) -> "_MockOpenAIServer":
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _MockOpenAIHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    @property
    def endpoint(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}"


def _configured_llm(endpoint: str) -> dict:
    return {
        "llm": {
            "providers": [
                {
                    "name": "mock-openai",
                    "type": "openai-compatible",
                    "endpoint": endpoint,
                    "api_key": "sk-test",
                }
            ],
            "models": [
                {
                    "name": "fast",
                    "provider_name": "mock-openai",
                    "model": "mock-model",
                    "type": "language",
                    "capabilities": {
                        "tool_calling": True,
                        "usage_on_tool_calls": True,
                        "parallel_tool_calls": True,
                        "strict_tools": True,
                        "structured_outputs_with_tools": True,
                    },
                    "cost_per_million": {"input": 0.15, "output": 0.6},
                }
            ],
            "purposes": [
                {
                    "name": "general",
                    "description": "General",
                    "models": ["fast"],
                }
            ],
        }
    }


def _load_json_tool_result(result) -> dict:
    if not result.ok:
        return {}
    try:
        return json.loads(result.text)
    except json.JSONDecodeError:
        return {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    run_id = uuid.uuid4().hex[:8]
    doc_path = f"_test/{TEST_NAME}_{run_id}.md"

    try:
        with _MockOpenAIServer() as mock_provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_configured_llm(mock_provider.endpoint)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

                create = client.call_tool(
                    "create_document",
                    title=f"{TEST_NAME} marker {run_id}",
                    path=doc_path,
                    content=f"{MARKER}\n",
                )
                run.step(
                    label="setup marker document",
                    passed=create.ok,
                    detail=create.error or create.text[:300],
                    tool_result=create,
                )
                if not create.ok:
                    return run

                default_call = client.call_tool(
                    "call_model",
                    resolver="model",
                    name="fast",
                    messages=[{"role": "user", "content": f"Read {{{{ref:{doc_path}}}}} and reply with the marker."}],
                    return_messages=False,
                )
                default_envelope = _load_json_tool_result(default_call)
                default_ok = (
                    default_call.ok
                    and "response" in default_envelope
                    and default_envelope.get("messages") == []
                )
                run.step(
                    label="return_messages false yields root messages: []",
                    passed=default_ok,
                    detail=f"envelope={default_envelope}",
                    tool_result=default_call,
                )
                if not default_ok:
                    return run

                rich_call = client.call_tool(
                    "call_model",
                    resolver="model",
                    name="fast",
                    messages=[{"role": "user", "content": f"Read {{{{ref:{doc_path}}}}} and reply with the marker."}],
                    return_messages=True,
                )
                rich_envelope = _load_json_tool_result(rich_call)
                returned_messages = rich_envelope.get("messages", [])
                rich_checks = {
                    "ok": rich_call.ok,
                    "response present": isinstance(rich_envelope.get("response"), str),
                    "messages length >= 2": isinstance(returned_messages, list) and len(returned_messages) >= 2,
                    "hydrated marker present": any(
                        MARKER in str(message.get("content", ""))
                        for message in returned_messages
                        if isinstance(message, dict)
                    ),
                    "no ref placeholder": all(
                        "{{ref:" not in str(message.get("content", ""))
                        for message in returned_messages
                        if isinstance(message, dict)
                    ),
                    "final assistant": bool(returned_messages)
                    and returned_messages[-1].get("role") == "assistant"
                    and isinstance(returned_messages[-1].get("name"), str),
                }
                run.step(
                    label="return_messages true yields hydrated inputs plus final assistant",
                    passed=all(rich_checks.values()),
                    detail=f"checks={rich_checks}, messages={returned_messages}",
                    tool_result=rich_call,
                )
                if not all(rich_checks.values()):
                    return run

                discovery = client.call_tool("call_model", resolver="list_models", return_messages=True)
                discovery_body = _load_json_tool_result(discovery)
                discovery_ok = (
                    discovery.ok
                    and isinstance(discovery_body.get("models"), list)
                    and "messages" not in discovery_body
                )
                run.step(
                    label="discovery resolver ignores return_messages",
                    passed=discovery_ok,
                    detail=f"body={discovery_body}",
                    tool_result=discovery,
                )

    except Exception as exc:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(exc).__name__}: {exc}")

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

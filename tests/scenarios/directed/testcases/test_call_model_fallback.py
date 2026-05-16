#!/usr/bin/env python3
"""
Test: call_model purpose fallback chains — ordered fallback success and exhaustion.
Coverage: L-101, L-102, L-103
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_fallback.py --managed
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient  # noqa: E402

TEST_NAME = "test_call_model_fallback"
COVERAGE = ["L-101", "L-102", "L-103"]


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = json.loads(self._read_request_body().decode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        _MockOpenAIHandler.calls.append(body)
        payload = json.dumps({
            "id": "chatcmpl-fallback-chain",
            "object": "chat.completion",
            "model": body.get("model", "mock-model"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "fallback-ok"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14},
        }).encode("utf-8")
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
        return self.rfile.read(int(self.headers.get("content-length", "0")))


class _MockOpenAIServer:
    def __enter__(self) -> "_MockOpenAIServer":
        _MockOpenAIHandler.calls = []
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

    @property
    def calls(self) -> list[dict]:
        return list(_MockOpenAIHandler.calls)


def _model(name: str, provider_name: str, provider_model: str, cost: float = 0) -> dict:
    return {
        "name": name,
        "provider_name": provider_name,
        "model": provider_model,
        "type": "language",
        "cost_per_million": {"input": cost, "output": cost},
        "capabilities": {"tool_calling": True, "usage_on_tool_calls": True},
    }


def _configured_llm(endpoint: str) -> dict:
    return {
        "llm": {
            "providers": [
                {"name": "mock-openai", "type": "openai-compatible", "endpoint": endpoint, "api_key": "sk-test"},
                {
                    "name": "broken",
                    "type": "openai-compatible",
                    "endpoint": "http://127.0.0.1:1",
                    "api_key": "sk-broken-placeholder",
                },
            ],
            "models": [
                _model("broken-1", "broken", "broken-one"),
                _model("broken-2", "broken", "broken-two"),
                _model("broken-3", "broken", "broken-three"),
                _model("success-4", "mock-openai", "mock-success-four", cost=1),
                _model("success-5", "mock-openai", "mock-success-five", cost=1),
                _model("broken-4", "broken", "broken-four"),
                _model("broken-5", "broken", "broken-five"),
            ],
            "purposes": [
                {
                    "name": "ordered_fallback",
                    "description": "First three fail, fourth succeeds, fifth must not be tried",
                    "models": ["broken-1", "broken-2", "broken-3", "success-4", "success-5"],
                },
                {
                    "name": "all_broken_long",
                    "description": "Five-model chain where every model is unreachable",
                    "models": ["broken-1", "broken-2", "broken-3", "broken-4", "broken-5"],
                },
            ],
        }
    }


def _json_payload(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    try:
        with _MockOpenAIServer() as mock_provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_configured_llm(mock_provider.endpoint)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

                result_l101 = client.call_tool("call_model", **{
                    "resolver": "purpose",
                    "name": "ordered_fallback",
                    "messages": [{"role": "user", "content": "Say hello through fallback"}],
                })
                envelope_l101 = _json_payload(result_l101) if result_l101 and result_l101.ok else {}
                metadata_l101 = envelope_l101.get("metadata", {})
                provider_models = [call.get("model") for call in mock_provider.calls]
                run.step(
                    label="L-101/L-102: ordered five-model fallback uses first successful model at position 4",
                    passed=bool(
                        result_l101
                        and result_l101.ok
                        and metadata_l101.get("fallback_position") == 4
                        and metadata_l101.get("resolved_model_name") == "success-4"
                        and provider_models == ["mock-success-four"]
                    ),
                    detail=(
                        f"fallback_position={metadata_l101.get('fallback_position')}, "
                        f"resolved_model_name={metadata_l101.get('resolved_model_name')}, "
                        f"provider_models={provider_models}"
                    ),
                )

                result_l103 = client.call_tool("call_model", **{
                    "resolver": "purpose",
                    "name": "all_broken_long",
                    "messages": [{"role": "user", "content": "Say hello through broken chain"}],
                })
                text_l103 = result_l103.text if result_l103 else ""
                expected_attempts = [f"[{idx}] broken-{idx}" for idx in range(1, 6)]
                run.step(
                    label="L-103: five-model all-fail chain returns ordered exhausted-attempt error",
                    passed=bool(
                        result_l103
                        and not result_l103.ok
                        and "call_model failed: purpose 'all_broken_long'" in text_l103
                        and "all 5 models exhausted" in text_l103
                        and all(attempt in text_l103 for attempt in expected_attempts)
                    ),
                    detail=text_l103[:1000],
                )

    except Exception as e:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(e).__name__}: {e}")
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

#!/usr/bin/env python3
"""
Test: get_llm_usage by_purpose mode separates _direct rows from named purposes (L-19).
Coverage: L-19
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_by_purpose.py --managed
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
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient  # noqa: E402

TEST_NAME = "test_get_llm_usage_by_purpose"
COVERAGE = ["L-19", "D-71"]


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self._read_request_body().decode("utf-8") or "{}")
        _MockOpenAIHandler.calls.append(body)
        payload = json.dumps({
            "id": "chatcmpl-usage-purpose",
            "object": "chat.completion",
            "model": body.get("model", "mock-model"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "1"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 7, "completion_tokens": 1, "total_tokens": 8},
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _read_request_body(self) -> bytes:
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
                    "model": "mock-usage-purpose",
                    "type": "language",
                    "cost_per_million": {"input": 0.15, "output": 0.6},
                    "capabilities": {"tool_calling": True, "usage_on_tool_calls": True},
                }
            ],
            "purposes": [
                {
                    "name": "general",
                    "description": "General",
                    "models": ["fast"],
                    "defaults": {"temperature": 0.7},
                }
            ],
        }
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    try:
        with _MockOpenAIServer() as mock_provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_configured_llm(mock_provider.endpoint)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

                # Seed: one purpose-resolved call (purpose_name='general') + one direct call (purpose_name='_direct')
                purpose_call = client.call_tool("call_model", **{
                    "resolver": "purpose",
                    "name": "general",
                    "messages": [{"role": "user", "content": "Reply with just the digit 1."}],
                })
                direct_call = client.call_tool("call_model", **{
                    "resolver": "model",
                    "name": "fast",
                    "messages": [{"role": "user", "content": "Reply with just the digit 2."}],
                })
                seed_ok = bool(purpose_call and purpose_call.ok and direct_call and direct_call.ok)
                run.step(
                    label="D-71 setup: local mock-provider call_model seeds succeed",
                    passed=seed_ok,
                    detail=f"purpose={str(purpose_call)[:250]}, direct={str(direct_call)[:250]}",
                )

                # fqc_llm_usage writes are fire-and-forget; give them time to commit before querying
                time.sleep(3)

                # L-19/D-71: by_purpose separates _direct into direct_model_calls; purposes array contains 'general' but NOT '_direct'
                result = client.call_tool("get_llm_usage", **{
                    "mode": "by_purpose",
                    "period": "24h",
                })
                ok = bool(result and result.ok)
                run.step(label="L-19/D-71: by_purpose mode returns isError:false", passed=ok, detail=str(result)[:500])

                if ok and result:
                    try:
                        parsed = json.loads(result.text)
                        purpose_names = [p.get("purpose_name") for p in parsed.get("purposes", [])]
                        shape_ok = (
                            parsed.get("mode") == "by_purpose"
                            and isinstance(parsed.get("purposes"), list)
                            and "_direct" not in purpose_names
                            and "general" in purpose_names
                            and isinstance(parsed.get("direct_model_calls"), dict)
                            and parsed.get("direct_model_calls", {}).get("calls", 0) >= 1
                        )
                        run.step(
                            label="L-19/D-71: by_purpose excludes _direct from purposes array; direct_model_calls.calls>=1",
                            passed=shape_ok,
                            detail=str(parsed)[:500],
                        )
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        run.step(label="L-19/D-71: parse error", passed=False, detail=str(exc))
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

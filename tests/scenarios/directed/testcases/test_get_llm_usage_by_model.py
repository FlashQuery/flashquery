#!/usr/bin/env python3
"""
Test: get_llm_usage by_model mode returns per-model stats with pct_of_total_calls (L-20).
Coverage: L-20
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_get_llm_usage_by_model.py --managed
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

TEST_NAME = "test_get_llm_usage_by_model"
COVERAGE = ["L-20", "D-72"]


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self._read_request_body().decode("utf-8") or "{}")
        _MockOpenAIHandler.calls.append(body)
        payload = json.dumps({
            "id": "chatcmpl-usage-model",
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
                    "model": "mock-usage-model",
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

                seed_results = []
                for i in range(2):
                    seed_results.append(client.call_tool("call_model", **{
                        "resolver": "model",
                        "name": "fast",
                        "messages": [{"role": "user", "content": f"Reply with just the digit {i + 1}."}],
                    }))
                seed_ok = all(result and result.ok for result in seed_results)
                run.step(
                    label="D-72 setup: local mock-provider call_model seeds succeed",
                    passed=seed_ok,
                    detail=", ".join(str(result)[:250] for result in seed_results),
                )

                # fqc_llm_usage writes are fire-and-forget; give them time to commit before querying
                time.sleep(3)

                # L-20/D-72: by_model returns per-model stats including pct_of_total_calls and avg_fallback_position
                result = client.call_tool("get_llm_usage", **{
                    "mode": "by_model",
                    "period": "24h",
                })
                ok = bool(result and result.ok)
                run.step(label="L-20/D-72: by_model mode returns isError:false", passed=ok, detail=str(result)[:500])

                if ok and result:
                    try:
                        parsed = json.loads(result.text)
                        models = parsed.get("models", [])
                        fast_entry = next((m for m in models if m.get("model_name") == "fast"), None)
                        shape_ok = (
                            parsed.get("mode") == "by_model"
                            and isinstance(models, list)
                            and fast_entry is not None
                            and "pct_of_total_calls" in fast_entry
                            and "avg_fallback_position" in fast_entry  # may be null for all-direct calls
                            and "spend_usd" in fast_entry
                            and "avg_cost_per_call_usd" in fast_entry
                            and "avg_latency_ms" in fast_entry
                            and fast_entry.get("provider_name") == "mock-openai"
                            and fast_entry.get("calls", 0) >= 2
                            and 0 < fast_entry.get("pct_of_total_calls", 0) <= 1
                        )
                        run.step(
                            label="L-20/D-72: by_model entry has model_name, provider_name, calls, pct_of_total_calls, avg_fallback_position, spend_usd, avg_cost_per_call_usd, avg_latency_ms",
                            passed=shape_ok,
                            detail=str(fast_entry)[:500],
                        )
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        run.step(label="L-20/D-72: parse error", passed=False, detail=str(exc))
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

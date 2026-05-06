#!/usr/bin/env python3
"""
ATL-DS-11: public mixed native/template Mode 2 loop.

Modes:
    --managed   Required
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_agent_loop_mixed_tools"
COVERAGE = ["ATL-DS-11", "VAL-118"]


class MockProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.responses = [
            {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {"id": "call_native_doc", "type": "function", "function": {"name": "get_document", "arguments": json.dumps({"identifiers": "Docs/native.md"})}},
                            {"id": "call_template_skill", "type": "function", "function": {"name": "flashquery_skill_research_skill", "arguments": json.dumps({"topic": "ATL-DS-11"})}},
                        ],
                    },
                    "finish_reason": "tool_calls",
                }],
                "usage": {"prompt_tokens": 11, "completion_tokens": 4},
            },
            {
                "choices": [{"message": {"role": "assistant", "content": "ATL-DS-11 final"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 19, "completion_tokens": 5},
            },
        ]
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("content-length", "0"))).decode("utf-8")
                parent.requests.append(json.loads(body or "{}"))
                payload = json.dumps(parent.responses.pop(0)).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "MockProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _write_doc(vault: Path, rel_path: str, body: str, **frontmatter: object) -> None:
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    fm_lines = [f"fq_id: {uuid.uuid4()}", "fq_status: active", *[f"{k}: {json.dumps(v)}" for k, v in frontmatter.items()]]
    path.write_text("---\n" + "\n".join(fm_lines) + "\n---\n\n" + body)


def _config(provider_url: str) -> dict[str, Any]:
    return {
        "templates": {"default_access": "restrictive"},
        "llm": {
            "providers": [{"name": "mock", "type": "openai-compatible", "endpoint": provider_url, "api_key": "sk-test"}],
            "models": [{
                "name": "agent-model",
                "provider_name": "mock",
                "model": "agent-model",
                "type": "language",
                "cost_per_million": {"input": 1, "output": 2},
                "capabilities": {"tool_calling": True, "usage_on_tool_calls": True, "strict_tools": True, "parallel_tool_calls": True},
            }],
            "purposes": [{"name": "mixed_agent", "description": "ATL-DS-11", "models": ["agent-model"], "tools": ["get_document"], "templates": ["Templates/Research-Skill.md"], "defaults": {"max_iterations": 3, "timeout_ms": 10000}}],
        },
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with MockProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            _write_doc(server.vault_path, "Docs/native.md", "NATIVE DOC ATL-DS-11")
            _write_doc(
                server.vault_path,
                "Templates/Research-Skill.md",
                "Skill {{topic}}",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_namespace="skill",
                fq_desc="Research skill",
                fq_params={"topic": {"type": "string", "required": True}},
            )
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result = client.call_tool("call_model", resolver="purpose", name="mixed_agent", messages=[{"role": "user", "content": "ATL-DS-11 mixed loop"}], return_messages=True)
            envelope = json.loads(result.text or "{}") if result.ok else {}
            calls_log = envelope.get("metadata", {}).get("tools", {}).get("calls_log", [])
            kinds = [call.get("kind") for entry in calls_log for call in entry.get("tool_calls", [])]
            native_names = envelope.get("metadata", {}).get("tools", {}).get("native_tool_names", [])
            template_names = envelope.get("metadata", {}).get("tools", {}).get("template_tool_names", [])
            model_visible_payload = json.dumps({
                "second_request": provider.requests[1] if len(provider.requests) > 1 else {},
                "messages": envelope.get("messages", []),
            }, sort_keys=True)
            passed = (
                result.ok
                and envelope.get("response") == "ATL-DS-11 final"
                and "native" in kinds
                and "template" in kinds
                and "get_document" in native_names
                and "flashquery_skill_research_skill" in template_names
                and "NATIVE DOC ATL-DS-11" in model_visible_payload
                and "Skill ATL-DS-11" in model_visible_payload
            )
            run.step("ATL-DS-11 final provider-visible registry and calls_log include native and template kinds", passed, json.dumps({"kinds": kinds, "native_names": native_names, "template_names": template_names, "model_visible_payload": model_visible_payload[:1500], "result": result.text[:1500]}, sort_keys=True), tool_result=result)
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

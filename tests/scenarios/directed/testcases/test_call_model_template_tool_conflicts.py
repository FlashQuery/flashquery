#!/usr/bin/env python3
"""
ATL-DS-08: template tool collisions are public diagnostics and block provider invocation.

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

TEST_NAME = "test_call_model_template_tool_conflicts"
COVERAGE = ["ATL-DS-08", "VAL-118"]


class MockProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length", "0"))
                parent.requests.append(json.loads(self.rfile.read(length).decode("utf-8") or "{}"))
                payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": "should not run"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}).encode("utf-8")
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


def _write_doc(vault: Path, rel_path: str, body: str) -> None:
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        f"fq_id: {uuid.uuid4()}\n"
        "fq_status: active\n"
        "fq_template: true\n"
        "fq_expose_as_tool: true\n"
        "fq_namespace: skill\n"
        "fq_desc: \"Collision fixture\"\n"
        "---\n\n"
        + body
    )


def _config(provider_url: str) -> dict[str, Any]:
    return {
        "templates": {"default_access": "permissive"},
        "llm": {
            "providers": [{"name": "mock", "type": "openai-compatible", "endpoint": provider_url, "api_key": "sk-test"}],
            "models": [{
                "name": "tool-model",
                "provider_name": "mock",
                "model": "tool-model",
                "type": "language",
                "cost_per_million": {"input": 0, "output": 0},
                "capabilities": {"tool_calling": True, "usage_on_tool_calls": True, "strict_tools": True},
            }],
            "purposes": [{"name": "conflict_agent", "description": "ATL-DS-08", "models": ["tool-model"], "templates": ["Templates/Research Skill.md", "Other/Research-Skill.md"]}],
        },
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with MockProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            _write_doc(server.vault_path, "Templates/Research Skill.md", "First")
            _write_doc(server.vault_path, "Other/Research-Skill.md", "Second")
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

            discovery = client.call_tool("call_model", resolver="list_purposes")
            payload = json.loads(discovery.text or "{}") if discovery.ok else {}
            purpose = next((p for p in payload.get("purposes", []) if p.get("name") == "conflict_agent"), {})
            conflicts = purpose.get("template_tool_conflicts", [])
            passed_discovery = (
                discovery.ok
                and any(c.get("name") == "flashquery.skill.research_skill" and set(c.get("template_paths", [])) == {"Templates/Research Skill.md", "Other/Research-Skill.md"} for c in conflicts)
            )
            run.step("ATL-DS-08 list_purposes exposes template_tool_conflicts", passed_discovery, json.dumps({"purpose": purpose}, sort_keys=True), tool_result=discovery)

            result = client.call_tool("call_model", resolver="purpose", name="conflict_agent", messages=[{"role": "user", "content": "ATL-DS-08"}])
            response_text = result.text or ""
            passed_call = (
                (not result.ok)
                and len(provider.requests) == 0
                and "tool_registry_collision" in response_text
                and "template_tool_conflicts" in response_text
            )
            run.step(
                "ATL-DS-08 call_model fails before provider invocation on template collision",
                passed_call,
                json.dumps({"provider_requests": provider.requests, "requests_count": 0, "response": response_text[:1000]}, sort_keys=True),
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

#!/usr/bin/env python3
"""
ATL-DS-10: public template-tool Mode 2 loop with string and document params.

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

TEST_NAME = "test_call_model_agent_loop_template_tool"
COVERAGE = ["ATL-DS-10", "VAL-118"]


class MockProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.responses = [
            {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "call_research_skill",
                            "type": "function",
                            "function": {"name": "flashquery_skill_research_skill", "arguments": json.dumps({"topic": "ATL-DS-10", "source": "Docs/source.md"})},
                        }],
                    },
                    "finish_reason": "tool_calls",
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4},
            },
            {
                "choices": [{"message": {"role": "assistant", "content": "ATL-DS-10 final"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 5},
            },
            {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "call_research_skill_missing_param",
                            "type": "function",
                            "function": {"name": "flashquery_skill_research_skill", "arguments": json.dumps({"source": "Docs/source.md"})},
                        }],
                    },
                    "finish_reason": "tool_calls",
                }],
                "usage": {"prompt_tokens": 9, "completion_tokens": 3},
            },
            {
                "choices": [{"message": {"role": "assistant", "content": "ATL-DS-10 recovery final"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 18, "completion_tokens": 4},
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
            "purposes": [{"name": "template_agent", "description": "ATL-DS-10", "models": ["agent-model"], "templates": ["Templates/Research-Skill.md"], "defaults": {"max_iterations": 3, "timeout_ms": 10000}}],
        },
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with MockProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            _write_doc(server.vault_path, "Docs/source.md", "SOURCE BODY ATL-DS-10")
            _write_doc(
                server.vault_path,
                "Templates/Research-Skill.md",
                "Skill {{topic}}\n{{source}}",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_namespace="skill",
                fq_desc="Research skill",
                fq_params={"topic": {"type": "string", "required": True}, "source": {"type": "document", "required": True}},
            )
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result = client.call_tool("call_model", resolver="purpose", name="template_agent", messages=[{"role": "user", "content": "ATL-DS-10 template loop"}], return_messages=True)
            envelope = json.loads(result.text or "{}") if result.ok else {}
            calls_log = envelope.get("metadata", {}).get("tools", {}).get("calls_log", [])
            passed = (
                result.ok
                and envelope.get("response") == "ATL-DS-10 final"
                and any(call.get("kind") == "template" and call.get("tool_name") == "flashquery_skill_research_skill" for entry in calls_log for call in entry.get("tool_calls", []))
                and len(provider.requests) == 2
                and "SOURCE BODY ATL-DS-10" in result.text
            )
            run.step("ATL-DS-10 validates string and document params through public call_model template tool loop", passed, json.dumps({"result": result.text[:1500], "requests": provider.requests}, sort_keys=True)[:4000], tool_result=result)
            missing_result = client.call_tool("call_model", resolver="purpose", name="template_agent", messages=[{"role": "user", "content": "ATL-DS-10 missing required param recovery"}], return_messages=True)
            missing_envelope = json.loads(missing_result.text or "{}") if missing_result.ok else {}
            missing_calls_log = missing_envelope.get("metadata", {}).get("tools", {}).get("calls_log", [])
            missing_passed = (
                missing_result.ok
                and missing_envelope.get("response") == "ATL-DS-10 recovery final"
                and any(
                    call.get("kind") == "template"
                    and call.get("error_code") == "template_missing_required_param"
                    for entry in missing_calls_log
                    for call in entry.get("tool_calls", [])
                )
            )
            run.step("ATL-DS-10 returns recoverable template_missing_required_param tool errors", missing_passed, json.dumps({"result": missing_result.text[:1500]}, sort_keys=True), tool_result=missing_result)
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

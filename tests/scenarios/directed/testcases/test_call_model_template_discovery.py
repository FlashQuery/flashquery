#!/usr/bin/env python3
"""
ATL-DS-07: template discovery appears in public list_purposes metadata.

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

TEST_NAME = "test_call_model_template_discovery"
COVERAGE = ["ATL-DS-07", "VAL-118"]


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
                payload = json.dumps({
                    "choices": [{"message": {"role": "assistant", "content": "unused"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                }).encode("utf-8")
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
            "purposes": [{
                "name": "researcher",
                "description": "ATL-DS-07",
                "models": ["tool-model"],
                "templates": ["Templates/Research-Skill.md", "Templates/Weekly Checklist.md"],
            }],
        },
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with MockProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            _write_doc(
                server.vault_path,
                "Templates/Research-Skill.md",
                "Research {{topic}}",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_namespace="skill",
                fq_desc="Research skill",
                fq_params={"topic": {"type": "string", "required": True}},
            )
            _write_doc(
                server.vault_path,
                "Templates/Weekly Checklist.md",
                "Checklist",
                fq_template=True,
                fq_expose_as_tool=True,
                fq_desc="Weekly checklist",
            )
            _write_doc(
                server.vault_path,
                "Templates/Hidden Skill.md",
                "Hidden body",
                fq_template=True,
                fq_expose_as_tool=False,
                fq_namespace="skill",
                fq_desc="Hidden skill not for masquerade",
            )
            _write_doc(
                server.vault_path,
                "Docs/Plain.md",
                "Plain document body",
            )
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result = client.call_tool("call_model", resolver="list_purposes")
            payload = json.loads(result.text or "{}") if result.ok else {}
            purpose = next((p for p in payload.get("purposes", []) if p.get("name") == "researcher"), {})
            tools = purpose.get("template_tools", [])
            passed = (
                result.ok
                and any(t.get("name") == "flashquery_skill_research_skill" and t.get("template_path") == "Templates/Research-Skill.md" and "parameters" in t for t in tools)
                and any(t.get("name") == "flashquery_template_weekly_checklist" and t.get("description") == "Weekly checklist" for t in tools)
                and not any(t.get("template_path") == "Templates/Hidden Skill.md" for t in tools)
                and not any(t.get("template_path") == "Docs/Plain.md" for t in tools)
                and isinstance(purpose.get("template_tool_conflicts"), list)
            )
            run.step(
                "ATL-DS-07 list_purposes exposes template_tools name/template_path/description/parameters",
                passed,
                json.dumps({"purpose": purpose, "provider_requests": provider.requests}, sort_keys=True)[:3000],
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

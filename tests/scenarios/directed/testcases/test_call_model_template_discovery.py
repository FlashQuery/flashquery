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
COVERAGE = ["ATL-DS-07", "VAL-118", "L-104", "L-105", "L-106", "L-107"]


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
            for index in range(30):
                _write_doc(
                    server.vault_path,
                    f"Archive/Plain-{index}.md",
                    f"Archive plain document {index}",
                )
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            sync_result = client.call_tool("maintain_vault", action="sync")
            result = client.call_tool("call_model", resolver="list_purposes")
            payload = json.loads(result.text or "{}") if result.ok else {}
            purpose = next((p for p in payload.get("purposes", []) if p.get("name") == "researcher"), {})
            tools = payload.get("template_tools", [])
            serialized_payload = json.dumps(payload, sort_keys=True)
            warning_text = json.dumps(purpose.get("template_tool_warnings", []), sort_keys=True)
            passed = (
                result.ok
                and sync_result.ok
                and any(t.get("name") == "flashquery_skill_research_skill" and t.get("template_path") == "Templates/Research-Skill.md" and "parameters" in t for t in tools)
                and any(t.get("name") == "flashquery_template_weekly_checklist" and t.get("description") == "Weekly checklist" for t in tools)
                and not any(t.get("template_path") == "Templates/Hidden Skill.md" for t in tools)
                and not any(t.get("template_path") == "Docs/Plain.md" for t in tools)
                and "template_tools" not in purpose
                and isinstance(purpose.get("template_tool_conflicts"), list)
            )
            run.step(
                "ATL-DS-07 list_purposes exposes template_tools name/template_path/description/parameters",
                passed,
                json.dumps({"purpose": purpose, "template_tools": tools, "sync_ok": sync_result.ok, "provider_requests": provider.requests}, sort_keys=True)[:3000],
                tool_result=result,
            )
            run.step(
                "L-104 list_purposes stays bounded and omits non-template warning flood",
                (
                    result.ok
                    and "not_template" not in serialized_payload
                    and "Archive/Plain-" not in serialized_payload
                    and "Docs/Plain.md" not in warning_text
                    and len(serialized_payload) < 60000
                ),
                json.dumps({
                    "payload_bytes": len(serialized_payload),
                    "warning_text": warning_text,
                    "contains_archive_plain": "Archive/Plain-" in serialized_payload,
                }, sort_keys=True),
                tool_result=result,
            )

            search_result = client.call_tool("call_model", resolver="search", parameters={"query": "researcher"})
            search_payload = json.loads(search_result.text or "{}") if search_result.ok else {}
            search_text = json.dumps(search_payload, sort_keys=True)
            run.step(
                "L-105 search results carry no non-template warning flood",
                (
                    search_result.ok
                    and any(p.get("name") == "researcher" for p in search_payload.get("results", {}).get("purposes", []))
                    and "not_template" not in search_text
                    and "Archive/Plain-" not in search_text
                    and "Docs/Plain.md" not in search_text
                ),
                search_text[:3000],
                tool_result=search_result,
            )

            purpose_result = client.call_tool(
                "call_model",
                resolver="purpose",
                name="researcher",
                messages=[{"role": "user", "content": "Phase 144 template diagnostics"}],
            )
            purpose_payload = json.loads(purpose_result.text or "{}") if purpose_result.ok else {}
            diagnostics = purpose_payload.get("metadata", {}).get("tools", {}).get("diagnostics", {})
            diagnostics_text = json.dumps(diagnostics, sort_keys=True)
            run.step(
                "L-106 purpose call metadata diagnostics omit non-template warnings",
                (
                    purpose_result.ok
                    and "not_template" not in diagnostics_text
                    and "Archive/Plain-" not in diagnostics_text
                    and "Docs/Plain.md" not in diagnostics_text
                    and "not_exposed" in diagnostics_text
                ),
                json.dumps({
                    "diagnostics": diagnostics,
                    "metadata": purpose_payload.get("metadata", {}),
                    "provider_request_count": len(provider.requests),
                }, sort_keys=True)[:3000],
                tool_result=purpose_result,
            )

            archive_search = client.call_tool("call_model", resolver="search", parameters={"query": "Archive/"})
            not_template_search = client.call_tool("call_model", resolver="search", parameters={"query": "not_template"})
            hidden_warning_search = client.call_tool("call_model", resolver="search", parameters={"query": "Hidden Skill"})
            archive_payload = json.loads(archive_search.text or "{}") if archive_search.ok else {}
            not_template_payload = json.loads(not_template_search.text or "{}") if not_template_search.ok else {}
            hidden_payload = json.loads(hidden_warning_search.text or "{}") if hidden_warning_search.ok else {}
            run.step(
                "L-107 skipped document text does not pollute discovery search relevance",
                (
                    archive_search.ok
                    and not_template_search.ok
                    and hidden_warning_search.ok
                    and archive_payload.get("results", {}).get("purposes", []) == []
                    and not_template_payload.get("results", {}).get("purposes", []) == []
                    and any(p.get("name") == "researcher" for p in hidden_payload.get("results", {}).get("purposes", []))
                ),
                json.dumps({
                    "archive": archive_payload,
                    "not_template": not_template_payload,
                    "hidden": hidden_payload,
                }, sort_keys=True)[:3000],
                tool_result=hidden_warning_search,
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

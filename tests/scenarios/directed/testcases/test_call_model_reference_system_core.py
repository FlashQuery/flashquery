#!/usr/bin/env python3
"""
Test: call_model Document Reference System core behavior.
Coverage: ATL-DS-02, ATL-DS-03, REF-01..REF-08, VAL-113
Modes:
    --managed   Required (starts dedicated FQC subprocess)
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

TEST_NAME = "test_call_model_reference_system_core"
COVERAGE = ["ATL-DS-02", "ATL-DS-03"]


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self._read_request_body().decode("utf-8"))
        _MockOpenAIHandler.calls.append(body)
        joined = "\n".join(str(message.get("content", "")) for message in body.get("messages", []))
        payload = json.dumps({
            "id": "chatcmpl-reference-system-core",
            "object": "chat.completion",
            "model": body.get("model", "mock-model"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": joined}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
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
    def call_count(self) -> int:
        return len(_MockOpenAIHandler.calls)


def _configured_llm(endpoint: str) -> dict:
    return {
        "llm": {
            "providers": [{"name": "mock-openai", "type": "openai-compatible", "endpoint": endpoint, "api_key": "sk-test"}],
            "models": [{"name": "fast", "provider_name": "mock-openai", "model": "mock-model", "type": "language", "capabilities": {"tool_calling": True, "usage_on_tool_calls": True, "parallel_tool_calls": True, "strict_tools": True, "structured_outputs_with_tools": True}, "cost_per_million": {"input": 0.15, "output": 0.6}}],
            "purposes": [{"name": "general", "description": "General", "models": ["fast"]}],
        }
    }


def _json(result) -> dict:
    try:
        return json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {}


def _write_doc(vault: Path, rel_path: str, body: str, **frontmatter: object) -> str:
    fqc_id = str(uuid.uuid4())
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    fm_lines = [f"fq_id: {fqc_id}", "fq_status: active", *[f"{k}: {json.dumps(v)}" for k, v in frontmatter.items()]]
    path.write_text("---\n" + "\n".join(fm_lines) + "\n---\n\n" + body)
    return fqc_id


def _call(client: FQCClient, content: str, **extra):
    return client.call_tool(
        "call_model",
        resolver="model",
        name="fast",
        messages=[{"role": "user", "content": content}],
        return_messages=True,
        **extra,
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    run_id = uuid.uuid4().hex[:8]

    try:
        with _MockOpenAIServer() as mock_provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_configured_llm(mock_provider.endpoint)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
                target = f"_test/{TEST_NAME}_{run_id}/target.md"
                source = f"_test/{TEST_NAME}_{run_id}/source.md"
                alias_doc = f"_test/{TEST_NAME}_{run_id}/alias.md"
                email_doc = f"_test/{TEST_NAME}_{run_id}/alice@example.com.md"
                dup_a = f"_test/{TEST_NAME}_{run_id}/a/shared.md"
                dup_b = f"_test/{TEST_NAME}_{run_id}/b/shared.md"
                nested = f"_test/{TEST_NAME}_{run_id}/nested.md"

                target_id = _write_doc(server.vault_path, target, "TARGET BODY\n\n## Section\n\nSECTION BODY\n\n## Other\n\nOTHER BODY\n", fq_title="Target")
                _write_doc(server.vault_path, source, "SOURCE BODY\n", pointer=target, fq_title="Source")
                _write_doc(server.vault_path, alias_doc, "ALIAS SHOULD NOT LOAD\n", fq_title="Alias")
                _write_doc(server.vault_path, email_doc, "EMAIL BODY\n", fq_title="Email")
                _write_doc(server.vault_path, dup_a, "DUP A\n", fq_title="Shared A")
                _write_doc(server.vault_path, dup_b, "DUP B\n", fq_title="Shared B")
                _write_doc(server.vault_path, nested, "literal {{ref:missing-nested.md}} remains\n", fq_title="Nested")
                client.call_tool("force_file_scan", background=False)

                success_content = f"{{{{ref:{target}}}}} | {{{{ref:{target_id}}}}} | {{{{ref:target}}}} | {{{{ref:{email_doc}}}}} | {{{{ref:{target}#Section}}}} | {{{{ref:{source}->pointer}}}} | {{{{ref:{nested}}}}}"
                success = _call(client, success_content)
                env = _json(success)
                meta = env.get("metadata", {})
                text = env.get("response", "")
                injected = meta.get("injected_references", [])
                checks = {
                    "call ok": success.ok,
                    "path body hydrated": "TARGET BODY" in text,
                    "fq_id hydrated": text.count("TARGET BODY") >= 3,
                    "email-like filename hydrated": "EMAIL BODY" in text,
                    "section hydrated": "SECTION BODY" in text,
                    "pointer hydrated": any(entry.get("resolved_to") == target for entry in injected),
                    "fq_id resolved_to": any(entry.get("ref") == f"{{{{ref:{target_id}}}}}" and entry.get("resolved_to") == target for entry in injected),
                    "filename resolved_to": any(entry.get("ref") == "{{ref:target}}" and entry.get("resolved_to") == target for entry in injected),
                    "refs are literal substrings": all(str(entry.get("ref", "")) in success_content for entry in injected),
                    "no identifier leak": all("identifier" not in entry for entry in injected),
                    "non-recursive nested literal": "{{ref:missing-nested.md}}" in text,
                }
                run.step("ATL-DS-02 refs hydrate path, filename/fq_id, section, pointer, metadata", all(checks.values()), f"checks={checks}", tool_result=success)

                sections_content = f"{{{{ref:{target}#Section}}}} || {{{{ref:{target}#Other}}}}"
                sections = _call(client, sections_content)
                env = _json(sections)
                text = env.get("response", "")
                injected = env.get("metadata", {}).get("injected_references", [])
                refs = [entry.get("ref") for entry in injected]
                checks = {
                    "call ok": sections.ok,
                    "two metadata entries": refs == [f"{{{{ref:{target}#Section}}}}", f"{{{{ref:{target}#Other}}}}"],
                    "section order": text.find("SECTION BODY") != -1 and text.find("OTHER BODY") != -1 and text.find("SECTION BODY") < text.find("OTHER BODY"),
                    "refs are literal substrings": all(str(ref) in sections_content for ref in refs),
                }
                run.step("same document different sections preserve ordered metadata", all(checks.values()), f"checks={checks}, refs={refs}", tool_result=sections)

                escaped = _call(client, f"literal \\{{{{ref:{target}}}}} active \\\\{{{{ref:{target}}}}} triple \\\\\\{{{{ref:{target}}}}} id {{{{id:{target_id}}}}} malformed {{{{ref:{target}}}")
                env = _json(escaped)
                text = env.get("response", "")
                injected = env.get("metadata", {}).get("injected_references", [])
                checks = {
                    "escaped literal remains": f"{{{{ref:{target}}}}}" in text,
                    "even parity active": "\\\nTARGET BODY" in text or "\\TARGET BODY" in text,
                    "triple escaped literal": f"\\{{{{ref:{target}}}}}" in text,
                    "id literal": f"{{{{id:{target_id}}}}}" in text,
                    "malformed literal": f"{{{{ref:{target}" in text,
                    "only active ref metadata": len(injected) == 1,
                }
                run.step("ATL-DS-03 escape parity and legacy id literal behavior", all(checks.values()), f"checks={checks}", tool_result=escaped)

                before_fail_calls = mock_provider.call_count
                invalid = _call(client, "{{ref:@alias#Section}}")
                invalid_pointer = _call(client, "{{ref:@alias->pointer}}")
                whitespace_hash = _call(client, f"{{{{ref:{target} #Section}}}}")
                whitespace_arrow = _call(client, f"{{{{ref:{source} ->pointer}}}}")
                ambiguous = _call(client, "{{ref:shared}}")
                pointer = _call(client, f"{{{{ref:{source}->missing}}}}")
                failed_payloads = [_json(invalid), _json(invalid_pointer), _json(whitespace_hash), _json(whitespace_arrow), _json(ambiguous), _json(pointer)]
                failed_refs = [
                    entry
                    for payload in failed_payloads
                    for entry in payload.get("failed_references", [])
                    if isinstance(entry, dict)
                ]
                reasons = {entry.get("reason") for entry in failed_refs}
                detail_text = " ".join(str(entry.get("detail", "")) for entry in failed_refs)
                checks = {
                    "is error": all(not result.ok for result in [invalid, invalid_pointer, whitespace_hash, whitespace_arrow, ambiguous, pointer]),
                    "reference error": all(payload.get("error") == "reference_resolution_failed" for payload in failed_payloads),
                    "invalid syntax": "invalid_reference_syntax" in reasons,
                    "ambiguous_document_identifier": "ambiguous_document_identifier" in reasons,
                    "reference_path_not_found": "reference_path_not_found" in reasons,
                    "alias hash detail": any("#" in str(entry.get("detail", "")) for entry in failed_payloads[0].get("failed_references", [])),
                    "alias pointer detail": any("->" in str(entry.get("detail", "")) for entry in failed_payloads[1].get("failed_references", [])),
                    "whitespace hash detail": any("whitespace" in str(entry.get("detail", "")) and "#" in str(entry.get("detail", "")) for entry in failed_payloads[2].get("failed_references", [])),
                    "whitespace pointer detail": any("whitespace" in str(entry.get("detail", "")) and "->" in str(entry.get("detail", "")) for entry in failed_payloads[3].get("failed_references", [])),
                    "detail guidance": "Use a vault-relative path or fq_id" in detail_text,
                    "no LLM dispatch": mock_provider.call_count == before_fail_calls,
                }
                run.step("typed failures abort before LLM dispatch", all(checks.values()), f"checks={checks}, failed={failed_refs}", tool_result=invalid)

                host_only = client.call_tool(
                    "call_model",
                    resolver="model",
                    name="fast",
                    messages=[
                        {"role": "assistant", "content": f"assistant {{{{ref:{target}}}}}"},
                        {"role": "tool", "content": f"tool {{{{ref:{target}}}}}", "tool_call_id": "call_1"},
                        {"role": "user", "content": "host text"},
                    ],
                    return_messages=True,
                )
                env = _json(host_only)
                returned = env.get("messages", [])
                checks = {
                    "ok": host_only.ok,
                    "assistant ref preserved": any("assistant {{ref:" in str(m.get("content", "")) for m in returned if isinstance(m, dict)),
                    "tool ref preserved": any("tool {{ref:" in str(m.get("content", "")) for m in returned if isinstance(m, dict)),
                    "no injected metadata": "injected_references" not in env.get("metadata", {}),
                }
                run.step("assistant/tool references remain ordinary data", all(checks.values()), f"checks={checks}", tool_result=host_only)

    except Exception as exc:  # noqa: BLE001
        run.step(label="server lifecycle", passed=False, detail=f"exception: {type(exc).__name__}: {exc}")

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--fqc-dir")
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    raise SystemExit(main())

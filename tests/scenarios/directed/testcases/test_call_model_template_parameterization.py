#!/usr/bin/env python3
"""
Test: call_model template parameterization public behavior.
Coverage: ATL-DS-04, ATL-DS-05, ATL-DS-06, ATL-DS-07, TMPL-01..TMPL-05, VAL-114
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

TEST_NAME = "test_call_model_template_parameterization"
COVERAGE = ["ATL-DS-04", "ATL-DS-05", "ATL-DS-06", "ATL-DS-07"]


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self._read_request_body().decode("utf-8"))
        _MockOpenAIHandler.calls.append(body)
        joined = "\n".join(str(message.get("content", "")) for message in body.get("messages", []))
        payload = json.dumps({
            "id": "chatcmpl-template-parameterization",
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
        text = result.text or "{}"
        if "\n\nFor full documentation" in text:
            text = text.split("\n\nFor full documentation", 1)[0]
        return json.loads(text)
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


def _ref(identifier: str) -> str:
    return "{{ref:" + identifier + "}}"


def _failure_reasons(*payloads: dict) -> set[str]:
    return {
        str(entry.get("reason"))
        for payload in payloads
        for entry in payload.get("failed_references", [])
        if isinstance(entry, dict)
    }


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    run_id = uuid.uuid4().hex[:8]

    try:
        with _MockOpenAIServer() as mock_provider:
            with FQCServer(fqc_dir=args.fqc_dir, extra_config=_configured_llm(mock_provider.endpoint)) as server:
                client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
                root = f"_test/{TEST_NAME}_{run_id}"
                template = f"{root}/templates/review.md"
                item_template = f"{root}/templates/item.md"
                target = f"{root}/docs/target.md"
                plain = f"{root}/docs/plain.md"
                nested_literal = f"{root}/docs/nested-literal.md"
                item_a = f"{root}/docs/item-a.md"
                item_b = f"{root}/docs/item-b.md"
                section_combo = f"{root}/docs/section-combo.md"
                pointer_source = f"{root}/docs/pointer-source.md"
                pointer_target = f"{root}/docs/pointer-target.md"

                target_id = _write_doc(server.vault_path, target, "TARGET BODY\n", fq_title="Target")
                _write_doc(server.vault_path, plain, "Plain {{name}} remains.\n", fq_title="Plain")
                _write_doc(server.vault_path, nested_literal, "literal {{ref:missing.md}} remains\n", fq_title="Nested Literal")
                _write_doc(server.vault_path, item_a, "ALPHA\n", fq_title="Item A")
                _write_doc(server.vault_path, item_b, "BRAVO\n", fq_title="Item B")
                _write_doc(
                    server.vault_path,
                    section_combo,
                    "# Top\nTOP-SECTION\n\n# List\nLIST-SECTION\n",
                    fq_title="Section Combo",
                )
                _write_doc(server.vault_path, pointer_target, "POINTER BODY\n", fq_title="Pointer Target")
                _write_doc(
                    server.vault_path,
                    pointer_source,
                    "Pointer source\n",
                    fq_title="Pointer Source",
                    projections={"summary": pointer_target},
                )
                _write_doc(
                    server.vault_path,
                    template,
                    "Review {{name}}\nDoc:\n{{source}}\nLiteral:\n{{literal}}\n",
                    fq_title="Review Template",
                    fq_template=True,
                    fq_params={
                        "name": {"type": "string", "required": True},
                        "source": {"type": "document", "required": True},
                        "literal": {"type": "string", "required": True},
                    },
                )
                _write_doc(
                    server.vault_path,
                    item_template,
                    "Item {{label}}\n",
                    fq_title="Item Template",
                    fq_template=True,
                    fq_params={"label": {"type": "string", "required": True}},
                )
                client.call_tool("maintain_vault", action="sync", background=False)

                # ── Step ATL-DS-04: path-keyed template params ───────────────
                success = _call(
                    client,
                    f"Use {_ref(template)}",
                    template_params={
                        template: {
                            "name": "Ada",
                            "source": target,
                            "literal": "kept {{ref:missing.md}} literal",
                        }
                    },
                )
                env = _json(success)
                text = env.get("response", "")
                returned = env.get("messages", [])
                injected = env.get("metadata", {}).get("injected_references", [])
                first = injected[0] if injected else {}
                params_used = first.get("template_params_used", {}) if isinstance(first, dict) else {}
                checks = {
                    "call ok": success.ok,
                    "template rendered": "Review Ada" in text,
                    "document param hydrated": "TARGET BODY" in text,
                    "non-recursive param literal": "kept {{ref:missing.md}} literal" in text,
                    "returned messages hydrated": any(isinstance(m, dict) and "Review Ada" in str(m.get("content", "")) for m in returned),
                    "metadata template true": first.get("template") is True,
                    "metadata template path": first.get("template_path") == template,
                    "metadata string param": params_used.get("name", {}).get("type") == "string",
                    "metadata document input": params_used.get("source", {}).get("input") == target,
                    "metadata document param": params_used.get("source", {}).get("resolved_to") == target,
                    "metadata literal param": params_used.get("literal", {}).get("chars") == len("kept {{ref:missing.md}} literal"),
                }
                run.step("ATL-DS-04 path-keyed template_params render with metadata", all(checks.values()), f"checks={checks}, injected={injected}", tool_result=success)

                by_id = _call(
                    client,
                    f"Use {_ref(template)}",
                    template_params={
                        template: {
                            "name": "IdSource",
                            "source": target_id,
                            "literal": "id",
                        }
                    },
                )
                env = _json(by_id)
                injected = env.get("metadata", {}).get("injected_references", [])
                params_used = injected[0].get("template_params_used", {}) if injected and isinstance(injected[0], dict) else {}
                checks = {
                    "call ok": by_id.ok,
                    "fq_id rendered": "Review IdSource" in env.get("response", ""),
                    "document input fq_id": params_used.get("source", {}).get("input") == target_id,
                    "document resolved path": params_used.get("source", {}).get("resolved_to") == target,
                }
                run.step("ATL-DS-04 document param metadata preserves fq_id input", all(checks.values()), f"checks={checks}, injected={injected}", tool_result=by_id)

                # ── Step ATL-DS-05: alias _template and _items ───────────────
                alias = _call(
                    client,
                    "A {{ref:@first}}\nB {{ref:@second}}\nList {{ref:@bundle}}\nPlain {{ref:@plain_obj}}",
                    template_params={
                        "first": {"_template": template, "name": "First", "source": target, "literal": "one"},
                        "second": {"_template": template, "name": "Second", "source": target, "literal": "two"},
                        "bundle": {
                            "_items": [
                                item_a,
                                {"_template": item_template, "label": "Beta"},
                                item_b,
                            ],
                            "_separator": "\n--\n",
                        },
                        "plain_obj": {"_items": [{"_template": plain, "name": "Ignored"}]},
                    },
                )
                env = _json(alias)
                text = env.get("response", "")
                injected = env.get("metadata", {}).get("injected_references", [])
                bundle = next((entry for entry in injected if isinstance(entry, dict) and entry.get("ref") == "{{ref:@bundle}}"), {})
                plain_obj = next((entry for entry in injected if isinstance(entry, dict) and entry.get("ref") == "{{ref:@plain_obj}}"), {})
                bundle_items = bundle.get("items", [])
                plain_items = plain_obj.get("items", [])
                checks = {
                    "call ok": alias.ok,
                    "first alias rendered": "Review First" in text,
                    "second alias rendered": "Review Second" in text,
                    "same template twice with different values": text.find("Review First") != -1 and text.find("Review Second") > text.find("Review First"),
                    "items ordered": text.find("ALPHA") != -1 and text.find("Item Beta") > text.find("ALPHA") and text.find("BRAVO") > text.find("Item Beta"),
                    "separator injected": "\n--\n" in text,
                    "bundle resolved count": bundle.get("resolved_to_count") == 3,
                    "bundle metadata items": len(bundle_items) == 3,
                    "item input metadata": bundle_items and bundle_items[0].get("input") == item_a,
                    "item template metadata": any(
                        item.get("template") is True
                        and item.get("template_path") == item_template
                        and item.get("template_params_used", {}).get("label", {}).get("chars") == 4
                        for item in bundle_items
                    ),
                    "plain object item injects raw body": "Plain {{name}} remains." in text,
                    "plain object item input metadata": plain_items and plain_items[0].get("input") == plain and plain_items[0].get("template") is not True,
                }
                run.step("ATL-DS-05 alias templates and _items render in order", all(checks.values()), f"checks={checks}, injected={injected}", tool_result=alias)

                # ── Step ATL-INT-05: parsed mixed-mode metadata shape ───────
                mixed_content = (
                    f"Plain {_ref(plain)}\n"
                    f"Section {_ref(section_combo + '#Top')}\n"
                    f"Pointer {_ref(pointer_source + '->projections.summary')}\n"
                    "Alias {{ref:@review}}\n"
                    "List {{ref:@bundle_default}}\n"
                )
                mixed = _call(
                    client,
                    mixed_content,
                    template_params={
                        "review": {"_template": item_template, "label": "Standalone"},
                        "bundle_default": {
                            "_items": [
                                f"{section_combo}#List",
                                item_a,
                            ],
                        },
                    },
                )
                env = _json(mixed)
                text = env.get("response", "")
                injected = env.get("metadata", {}).get("injected_references", [])
                refs = [entry.get("ref") for entry in injected if isinstance(entry, dict)]
                expected_refs = [
                    _ref(plain),
                    _ref(section_combo + "#Top"),
                    _ref(pointer_source + "->projections.summary"),
                    "{{ref:@review}}",
                    "{{ref:@bundle_default}}",
                ]
                bundle_default = injected[4] if len(injected) > 4 and isinstance(injected[4], dict) else {}
                bundle_items = bundle_default.get("items", [])
                bundle_item_chars = [
                    item.get("chars") for item in bundle_items if isinstance(item, dict) and isinstance(item.get("chars"), int)
                ]
                expected_default_chars = sum(bundle_item_chars) + max(len(bundle_item_chars) - 1, 0) * len("\n\n")
                checks = {
                    "call ok": mixed.ok,
                    "five placeholders in original order": refs == expected_refs,
                    "alias template separate from list alias": injected[3].get("template") is True if len(injected) > 3 and isinstance(injected[3], dict) else False,
                    "list alias parent at placeholder position": bundle_default.get("ref") == "{{ref:@bundle_default}}",
                    "list alias is one parent entry": len(injected) == 5 and isinstance(bundle_items, list) and len(bundle_items) == 2,
                    "list items ordered": bundle_items and bundle_items[0].get("input") == f"{section_combo}#List" and bundle_items[1].get("input") == item_a,
                    "same document sections distinct": (
                        len(injected) > 1
                        and isinstance(injected[1], dict)
                        and bundle_items
                        and injected[1].get("ref") == _ref(section_combo + "#Top")
                        and bundle_items[0].get("input") == f"{section_combo}#List"
                        and injected[1].get("chars") != bundle_items[0].get("chars")
                    ),
                    "default separator rendered": "LIST-SECTION\n\n\nALPHA" in text,
                    "default separator chars": bundle_default.get("chars") == expected_default_chars,
                }
                run.step("ATL-INT-05 parsed metadata preserves placeholder order, parent list entry, same-doc sections, and default separator", all(checks.values()), f"checks={checks}, injected={injected}", tool_result=mixed)

                # ── Step ATL-DS-06: fail-fast template failures ──────────────
                before_fail_calls = mock_provider.call_count
                missing_required = _call(client, _ref(template), template_params={template: {"source": target, "literal": "x"}})
                invalid_doc = _call(client, _ref(template), template_params={template: {"name": "Ada", "source": f"{root}/docs/missing.md", "literal": "x"}})
                invalid_items = _call(client, "{{ref:@bundle}}", template_params={"bundle": {"_items": "not-an-array"}})
                invalid_separator = _call(client, "{{ref:@bundle}}", template_params={"bundle": {"_items": [item_a], "_separator": 42}})
                payloads = [_json(missing_required), _json(invalid_doc), _json(invalid_items), _json(invalid_separator)]
                reasons = _failure_reasons(*payloads)
                checks = {
                    "all errored": all(not result.ok for result in [missing_required, invalid_doc, invalid_items, invalid_separator]),
                    "reference errors": all(payload.get("error") == "reference_resolution_failed" for payload in payloads),
                    "missing required": "template_missing_required_param" in reasons,
                    "invalid document param": "template_param_doc_not_found" in reasons,
                    "invalid items": "multi_ref_invalid_value" in reasons,
                    "invalid separator detail": any(
                        "_separator" in str(entry.get("detail", ""))
                        for payload in payloads
                        for entry in payload.get("failed_references", [])
                        if isinstance(entry, dict)
                    ),
                    "no provider dispatch": mock_provider.call_count == before_fail_calls,
                }
                run.step("ATL-DS-06 template failures abort before provider dispatch", all(checks.values()), f"checks={checks}, reasons={reasons}, payloads={payloads}", tool_result=missing_required)

                # ── Step ATL-DS-07: plain documents and non-recursion ────────
                plain_call = _call(
                    client,
                    f"Plain {_ref(plain)} Nested {_ref(template)}",
                    template_params={
                        plain: {"name": "Ignored"},
                        template: {
                            "name": "Literal",
                            "source": nested_literal,
                            "literal": "{{ref:missing.md}}",
                        },
                    },
                )
                env = _json(plain_call)
                text = env.get("response", "")
                injected = env.get("metadata", {}).get("injected_references", [])
                plain_meta = next((entry for entry in injected if isinstance(entry, dict) and entry.get("ref") == _ref(plain)), {})
                tmpl_meta = next((entry for entry in injected if isinstance(entry, dict) and entry.get("ref") == _ref(template)), {})
                checks = {
                    "call ok": plain_call.ok,
                    "plain ignores params": "Plain {{name}} remains." in text,
                    "plain not template metadata": "template_params_used" not in plain_meta and plain_meta.get("template") is not True,
                    "document param nested ref literal": "literal {{ref:missing.md}} remains" in text,
                    "string param nested ref literal": "Literal:\n{{ref:missing.md}}" in text,
                    "no recursive metadata": len(injected) == 2,
                    "template metadata still present": tmpl_meta.get("template") is True,
                }
                run.step("ATL-DS-07 plain docs ignore params and substituted refs stay literal", all(checks.values()), f"checks={checks}, injected={injected}", tool_result=plain_call)

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

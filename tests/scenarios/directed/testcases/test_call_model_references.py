#!/usr/bin/env python3
"""
Test: call_model resolver=model with {{ref:...}} and {{id:...}} references in messages.
Coverage: L-24, L-25, L-26, L-27, L-27a, L-27b, L-29, L-33, L-33a, L-33b, L-33c, L-33d, L-33e
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_references.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_references"


def _extract_fq_id(text: str) -> str | None:
    """Extract the FQC ID value from create_document's key-value response."""
    m = re.search(r"^FQC ID:\s*([0-9a-f-]+)\s*$", text, re.MULTILINE)
    return m.group(1) if m else None

COVERAGE = [
    "L-24", "L-25", "L-26", "L-27", "L-27a", "L-27b", "L-29",
    "L-33", "L-33a", "L-33b", "L-33c", "L-33d", "L-33e",
]

CONFIGURED_LLM = {
    "llm": {
        "providers": [
            {
                "name": "openai",
                "type": "openai-compatible",
                "endpoint": "https://api.openai.com",
                "api_key": "${OPENAI_API_KEY}",
            },
        ],
        "models": [
            {
                "name": "fast",
                "provider_name": "openai",
                "model": "gpt-4o-mini",
                "type": "language",
                "cost_per_million": {"input": 0.15, "output": 0.6},
            },
        ],
        "purposes": [],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env_vars = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env_vars.get("OPENAI_API_KEY") or "sk-test-placeholder"

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            run_id = _uuid.uuid4().hex[:8]

            # ── Setup: doc with body for L-24, L-27 ──────────────────────
            body_path = f"_test/{TEST_NAME}_{run_id}_body.md"
            body_text = "Reference target body."
            create_body = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} body {run_id}",
                path=body_path,
                content=body_text,
            )
            if not create_body.ok:
                run.step(label="Setup body doc", passed=False,
                         detail=create_body.error or create_body.text[:200])
                return run
            body_fq_id = _extract_fq_id(create_body.text)
            # FQC strips frontmatter when resolving references and returns the body
            # with a normalized trailing newline. Expected chars = len(body) + 1.
            body_chars = len(body_text) + 1
            run.step(label="Setup: body doc created", passed=True,
                     detail=f"body_chars={body_chars}")

            # ── Setup: doc with section for L-25, L-27a ─────────────────
            sec_path = f"_test/{TEST_NAME}_{run_id}_section.md"
            sec_body = "intro\n\n## Target\n\nsection content here\n\n## Other\n\nother\n"
            create_sec = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} section {run_id}",
                path=sec_path,
                content=sec_body,
            )
            if not create_sec.ok:
                run.step(label="Setup section doc", passed=False,
                         detail=create_sec.error or create_sec.text[:200])
                return run
            sec_fq_id = _extract_fq_id(create_sec.text)

            # ── Setup: source + target for L-26, L-27b (pointer) ────────
            target_path = f"_test/{TEST_NAME}_{run_id}_target.md"
            target_body = "pointer target body"
            create_target = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target {run_id}",
                path=target_path,
                content=target_body,
            )
            if not create_target.ok:
                run.step(label="Setup target doc", passed=False,
                         detail=create_target.error or create_target.text[:200])
                return run
            # Same trailing-newline-normalization convention as body_chars above.
            target_chars = len(target_body) + 1

            source_path = f"_test/{TEST_NAME}_{run_id}_source.md"
            # Add frontmatter pointer via raw vault write — frontmatter must include
            # the target reference for follow_ref-style resolution. Capture the UUID
            # so L-27b can resolve {{id:<uuid>->pointer}} after force_file_scan
            # registers the file in fqc_documents under this id.
            source_fq_id = str(_uuid.uuid4())
            p = server.vault_path / source_path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                f"---\n"
                f"fq_id: {source_fq_id}\n"
                f"projections:\n"
                f"  summary: \"{target_path}\"\n"
                f"---\n\n"
                f"source\n"
            )
            # Trigger scan so the new file is indexed (fq_id from frontmatter
            # becomes the fqc_documents row id; required for {{id:uuid->...}}).
            client.call_tool("force_file_scan", background=False)

            # ── L-24: {{ref:path}} resolves full body ───────────────────
            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{body_path}}}}} Reply with one word: OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            checks = {
                "ok": r.ok,
                "injected_references is list of 1": isinstance(injected, list) and len(injected) == 1,
                "entry.ref is full placeholder":
                    injected[0].get("ref") == f"{{{{ref:{body_path}}}}}" if injected else False,
                "entry.chars equals on-disk body length":
                    injected[0].get("chars") == body_chars if injected else False,
                "entry has no 'tokens' field (L-33e)":
                    injected and "tokens" not in injected[0],
            }
            run.step(label="L-24: {{ref:path}} resolves full body",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, metadata_keys={list(metadata.keys())}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-25: {{ref:path#Section}} resolves section only ────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{sec_path}#Target}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            section_text_len = len("## Target\n\nsection content here")
            checks = {
                "ok": r.ok,
                "injected_references has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry chars == section length (approximate match)":
                    injected and abs(injected[0].get("chars", 0) - section_text_len) <= 4,
            }
            run.step(label="L-25: {{ref:path#Section}} resolves section",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, expected_len~{section_text_len}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-26 + L-29: {{ref:path->pointer}} dereferences + resolved_to ───
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source_path}->projections.summary}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry has resolved_to (L-29)":
                    injected and "resolved_to" in injected[0],
                "resolved_to value contains target_path basename":
                    injected and target_path in (injected[0].get("resolved_to") or ""),
                "entry chars == on-disk target body length":
                    injected and injected[0].get("chars") == target_chars,
            }
            run.step(label="L-26 + L-29: pointer deref + resolved_to present",
                     passed=all(checks.values()),
                     detail=f"checks={checks}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-27: {{id:uuid}} full body ────────────────────────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{id:{body_fq_id}}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry.ref is full placeholder":
                    injected and injected[0].get("ref") == f"{{{{id:{body_fq_id}}}}}",
                "chars matches on-disk body": injected and injected[0].get("chars") == body_chars,
            }
            run.step(label="L-27: {{id:uuid}} resolves full body",
                     passed=all(checks.values()),
                     detail=f"checks={checks}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-27a: {{id:uuid#Section}} ─────────────────────────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{id:{sec_fq_id}#Target}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            section_text_len = len("## Target\n\nsection content here")
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                # Parallels L-25's approximate-match assertion — proves the section
                # content was actually extracted, not just that one entry exists.
                "entry chars == section length (approximate match)":
                    injected and abs(injected[0].get("chars", 0) - section_text_len) <= 4,
            }
            run.step(label="L-27a: {{id:uuid#Section}} resolves section",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, expected_len~{section_text_len}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-27b: {{id:uuid->pointer}} dereferences via fq_id + pointer ──
            # source_fq_id was injected into the raw write above and indexed by
            # force_file_scan, so the resolver can look up the source via UUID
            # and follow projections.summary to the target body.
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{id:{source_fq_id}->projections.summary}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry.ref is full placeholder":
                    injected and injected[0].get("ref")
                    == f"{{{{id:{source_fq_id}->projections.summary}}}}",
                "entry has resolved_to":
                    injected and "resolved_to" in injected[0],
                "resolved_to contains target_path":
                    injected and target_path in (injected[0].get("resolved_to") or ""),
                # chars is content.length of the resolved body which may include a
                # trailing newline (same approximate-match pattern as L-25).
                "chars approximately matches target body length":
                    injected and abs(injected[0].get("chars", 0) - len(target_body)) <= 4,
            }
            run.step(label="L-27b: {{id:uuid->pointer}} resolves via fq_id + pointer",
                     passed=all(checks.values()),
                     detail=f"checks={checks}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-33: no references → no metadata fields, body unchanged ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content": "Reply with the word: BAREMSG"}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            tokens = metadata.get("tokens") if isinstance(metadata, dict) else None
            checks = {
                "ok": r.ok,
                "no injected_references key": "injected_references" not in metadata,
                "no prompt_chars key": "prompt_chars" not in metadata,
                "tokens key present (regression guard L-33d)": "tokens" in metadata,
                # L-33d structural shape: tokens.input and tokens.output are integers,
                # not just any value. Locks down the response shape so a regression
                # that drops/renames the inner fields fails loudly.
                "tokens is dict": isinstance(tokens, dict),
                "tokens.input is int":
                    isinstance(tokens, dict) and isinstance(tokens.get("input"), int),
                "tokens.output is int":
                    isinstance(tokens, dict) and isinstance(tokens.get("output"), int),
                "cost_usd present": "cost_usd" in metadata,
                "cost_usd is numeric":
                    isinstance(metadata.get("cost_usd"), (int, float)),
            }
            run.step(label="L-33 + L-33d: no references, baseline shape unchanged",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, metadata_keys={list(metadata.keys())}, tokens={tokens}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-33a + L-33b + L-33c: per-entry chars int + prompt_chars + invariant ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{body_path}}}}} {{{{ref:{sec_path}}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            prompt_chars = metadata.get("prompt_chars")
            sum_chars = sum(e.get("chars", 0) for e in injected) if injected else 0
            checks = {
                "ok": r.ok,
                "injected has 2 entries (L-33a)":
                    isinstance(injected, list) and len(injected) == 2,
                "all entry.chars are int":
                    injected and all(isinstance(e.get("chars"), int) for e in injected),
                "prompt_chars is int (L-33b)": isinstance(prompt_chars, int),
                "sum(chars) <= prompt_chars (L-33c)":
                    isinstance(prompt_chars, int) and sum_chars <= prompt_chars,
                "no entry has 'tokens' key (L-33e)":
                    injected and all("tokens" not in e for e in injected),
            }
            run.step(label="L-33a + L-33b + L-33c + L-33e: char accounting invariants",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, sum={sum_chars}, prompt_chars={prompt_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

    except Exception as e:  # noqa: BLE001
        run.step(label="Test crashed", passed=False, detail=f"exception: {type(e).__name__}: {e}")

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--vault-path", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

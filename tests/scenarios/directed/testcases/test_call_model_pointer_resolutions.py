#!/usr/bin/env python3
"""
Test: call_model {{ref:source->ptr}} pointer-value normalization to resolved_to path.
Coverage: L-49, L-50, L-51, L-52, L-53
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_pointer_resolutions.py --managed
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

TEST_NAME = "test_call_model_pointer_resolutions"


def _extract_fq_id(text: str) -> str | None:
    """Extract the FQC ID value from create_document's key-value response."""
    m = re.search(r"^FQC ID:\s*([0-9a-f-]+)\s*$", text, re.MULTILINE)
    return m.group(1) if m else None


COVERAGE = ["L-49", "L-50", "L-51", "L-52", "L-53"]

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
            base = f"_test/{TEST_NAME}_{run_id}"

            # ── Setup target docs (one per scenario) ─────────────────────
            # Each target body is unique so chars assertions verify the
            # correct target was reached. Use create_document for proper
            # DB indexing (so UUID and filename lookups work). FQC adds
            # a trailing newline to body content, so on-disk body is
            # len(body) + 1 chars.

            # L-49 target: nested .projections path
            target49_path = f"{base}/projections/target49.md"
            target49_body = "target49 body"
            create49 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target49 {run_id}",
                path=target49_path,
                content=target49_body,
            )
            if not create49.ok:
                run.step(label="Setup target49", passed=False,
                         detail=create49.error or create49.text[:200])
                return run
            target49_chars = len(target49_body) + 1

            # L-50 target: target whose UUID we capture via create_document
            target50_path = f"{base}/uuid-target/target50.md"
            target50_body = "target50 body content"
            create50 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target50 {run_id}",
                path=target50_path,
                content=target50_body,
            )
            if not create50.ok:
                run.step(label="Setup target50", passed=False,
                         detail=create50.error or create50.text[:200])
                return run
            target50_fq_id = _extract_fq_id(create50.text)
            if not target50_fq_id:
                run.step(label="Setup target50 fq_id extraction", passed=False,
                         detail=f"could not extract fq_id from: {create50.text[:300]}")
                return run
            target50_chars = len(target50_body) + 1

            # L-51 target: bare-filename (no extension) match. Per §6.6, a value
            # ending in a configured markdown extension is path-only — to actually
            # exercise the filename-search branch, the pointer value must be the
            # bare basename without the extension. The vault file itself is a
            # normal `.md` file in a nested folder; filename search walks the
            # vault and matches by basename + configured extension.
            target51_basename = f"target51_{run_id}"  # unique stem, no extension
            target51_path = f"{base}/bare-name/{target51_basename}.md"
            target51_body = "target51 unique body"
            create51 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target51 {run_id}",
                path=target51_path,
                content=target51_body,
            )
            if not create51.ok:
                run.step(label="Setup target51", passed=False,
                         detail=create51.error or create51.text[:200])
                return run
            target51_chars = len(target51_body) + 1

            # L-52 target (top-level supersedes pointer)
            target52_path = f"{base}/old52.md"
            target52_body = "predecessor52 body text"
            create52 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target52 {run_id}",
                path=target52_path,
                content=target52_body,
            )
            if not create52.ok:
                run.step(label="Setup target52", passed=False,
                         detail=create52.error or create52.text[:200])
                return run
            target52_chars = len(target52_body) + 1

            # L-53 target (deeply nested a.b.c pointer)
            target53_path = f"{base}/nested53.md"
            target53_body = "nested53 deep target body"
            create53 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} target53 {run_id}",
                path=target53_path,
                content=target53_body,
            )
            if not create53.ok:
                run.step(label="Setup target53", passed=False,
                         detail=create53.error or create53.text[:200])
                return run
            target53_chars = len(target53_body) + 1

            # ── Setup source docs (one per scenario) ─────────────────────
            source49_path = f"{base}/source49.md"
            s49_id = str(_uuid.uuid4())
            (server.vault_path / source49_path).write_text(
                f"---\n"
                f"fq_id: {s49_id}\n"
                f"ptr: \"{target49_path}\"\n"
                f"---\n\n"
                f"source49\n"
            )

            source50_path = f"{base}/source50.md"
            s50_id = str(_uuid.uuid4())
            (server.vault_path / source50_path).write_text(
                f"---\n"
                f"fq_id: {s50_id}\n"
                f"ptr: \"{target50_fq_id}\"\n"
                f"---\n\n"
                f"source50\n"
            )

            source51_path = f"{base}/source51.md"
            s51_id = str(_uuid.uuid4())
            (server.vault_path / source51_path).write_text(
                f"---\n"
                f"fq_id: {s51_id}\n"
                f"ptr: \"{target51_basename}\"\n"
                f"---\n\n"
                f"source51\n"
            )

            source52_path = f"{base}/source52.md"
            s52_id = str(_uuid.uuid4())
            (server.vault_path / source52_path).write_text(
                f"---\n"
                f"fq_id: {s52_id}\n"
                f"supersedes: \"{target52_path}\"\n"
                f"---\n\n"
                f"source52\n"
            )

            source53_path = f"{base}/source53.md"
            s53_id = str(_uuid.uuid4())
            (server.vault_path / source53_path).write_text(
                f"---\n"
                f"fq_id: {s53_id}\n"
                f"a:\n"
                f"  b:\n"
                f"    c: \"{target53_path}\"\n"
                f"---\n\n"
                f"source53\n"
            )

            # Trigger scan to register all sources + targets in fqc_documents.
            client.call_tool("force_file_scan", background=False)

            # ── L-49: path-style pointer value ────────────────────────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source49_path}->ptr}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "resolved_to == target49_path exactly":
                    entry.get("resolved_to") == target49_path,
                "chars == target49_chars":
                    entry.get("chars") == target49_chars,
            }
            run.step(label="L-49: path-style ptr (Research/.projections/target.md)",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, resolved_to={entry.get('resolved_to')!r}, chars={entry.get('chars')}, expected_chars={target49_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-50: UUID-style pointer value ────────────────────────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source50_path}->ptr}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "resolved_to is vault path (not UUID)":
                    entry.get("resolved_to") == target50_path,
                "resolved_to does not equal the UUID":
                    entry.get("resolved_to") != target50_fq_id,
                "chars == target50_chars":
                    entry.get("chars") == target50_chars,
            }
            run.step(label="L-50: UUID-style ptr normalizes resolved_to to path",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, resolved_to={entry.get('resolved_to')!r}, expected_path={target50_path!r}, uuid={target50_fq_id}, chars={entry.get('chars')}, expected_chars={target50_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-51: bare-basename (extensionless) pointer value ────────
            # Per §6.6, a pointer value with no `/` and no `.md` extension and
            # no UUID format hits the filename-search branch — the resolver
            # walks the vault and matches `<value>.md` (or any configured
            # markdown extension) by basename. resolved_to should be the full
            # vault-relative path of the unique match, not the bare basename.
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source51_path}->ptr}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "resolved_to == full vault-relative target51 path":
                    entry.get("resolved_to") == target51_path,
                "resolved_to is not the bare basename":
                    entry.get("resolved_to") != target51_basename,
                "chars == target51_chars":
                    entry.get("chars") == target51_chars,
            }
            run.step(label="L-51: extensionless filename ptr resolves via filename-search to full vault path",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, ptr_value={target51_basename!r}, resolved_to={entry.get('resolved_to')!r}, expected={target51_path!r}, chars={entry.get('chars')}, expected_chars={target51_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-52: top-level pointer (single segment, no dot) ─────────
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source52_path}->supersedes}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "resolved_to == target52 path":
                    entry.get("resolved_to") == target52_path,
                "chars == target52_chars":
                    entry.get("chars") == target52_chars,
            }
            run.step(label="L-52: top-level pointer (supersedes) resolves",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, resolved_to={entry.get('resolved_to')!r}, expected={target52_path!r}, chars={entry.get('chars')}, expected_chars={target52_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-53: deep-nested pointer (a.b.c — 2 dots, 3 segments) ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content":
                           f"{{{{ref:{source53_path}->a.b.c}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "resolved_to == target53 path":
                    entry.get("resolved_to") == target53_path,
                "chars == target53_chars":
                    entry.get("chars") == target53_chars,
            }
            run.step(label="L-53: deep-nested pointer (a.b.c) resolves without depth cap",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, resolved_to={entry.get('resolved_to')!r}, expected={target53_path!r}, chars={entry.get('chars')}, expected_chars={target53_chars}",
                     timing_ms=r.timing_ms, tool_result=r)

    except Exception as e:  # noqa: BLE001
        run.step(label="Test crashed", passed=False,
                 detail=f"exception: {type(e).__name__}: {e}")

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

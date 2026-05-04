#!/usr/bin/env python3
"""
Test: call_model reference resolution error taxonomy — pin failure reasons.
Coverage: L-54, L-55, L-56, L-57, L-58, L-61, L-62
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_ref_error_taxonomy.py --managed
Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid as _uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer  # noqa: E402
from fqc_client import FQCClient, _find_project_dir, _load_env_file  # noqa: E402

TEST_NAME = "test_call_model_ref_error_taxonomy"
COVERAGE = ["L-54", "L-55", "L-56", "L-57", "L-58", "L-61", "L-62"]

CONFIGURED_LLM = {
    "llm": {
        "providers": [{
            "name": "openai", "type": "openai-compatible",
            "endpoint": "https://api.openai.com", "api_key": "${OPENAI_API_KEY}",
        }],
        "models": [{
            "name": "fast", "provider_name": "openai",
            "model": "gpt-4o-mini", "type": "language",
            "cost_per_million": {"input": 0.15, "output": 0.6},
        }],
        "purposes": [],
    }
}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    project_dir = Path(args.fqc_dir) if args.fqc_dir else _find_project_dir()
    env_vars = _load_env_file(project_dir) if project_dir else {}
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = env_vars.get("OPENAI_API_KEY") or "sk-test-placeholder"

    raw_files: list[Path] = []
    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            run_id = _uuid.uuid4().hex[:8]

            # ── Setup: raw-write source documents for the various failure modes ──

            # L-54 source: frontmatter has `ptr` but NOT `missing.path`.
            src54_path = f"_test/{TEST_NAME}_{run_id}_src54.md"
            p54 = server.vault_path / src54_path
            p54.parent.mkdir(parents=True, exist_ok=True)
            p54.write_text(
                f"---\nfq_id: {_uuid.uuid4()}\nptr: \"x\"\n---\n\nsource54\n"
            )
            raw_files.append(p54)

            # L-55 source: frontmatter has `ptr: 42` (numeric, not string).
            src55_path = f"_test/{TEST_NAME}_{run_id}_src55.md"
            p55 = server.vault_path / src55_path
            p55.parent.mkdir(parents=True, exist_ok=True)
            p55.write_text(
                f"---\nfq_id: {_uuid.uuid4()}\nptr: 42\n---\n\nsource55\n"
            )
            raw_files.append(p55)

            # L-56 source: frontmatter ptr resolves to a well-formed path that
            # does NOT exist in the vault.
            src56_path = f"_test/{TEST_NAME}_{run_id}_src56.md"
            p56 = server.vault_path / src56_path
            p56.parent.mkdir(parents=True, exist_ok=True)
            p56.write_text(
                f"---\nfq_id: {_uuid.uuid4()}\n"
                f"ptr: \"Nonexistent/missing-target-{run_id}.md\"\n---\n\nsource56\n"
            )
            raw_files.append(p56)

            # L-57 doc: any document that exists; only the parse-error matters.
            doc57_path = f"_test/{TEST_NAME}_{run_id}_doc57.md"
            p57 = server.vault_path / doc57_path
            p57.parent.mkdir(parents=True, exist_ok=True)
            p57.write_text(
                f"---\nfq_id: {_uuid.uuid4()}\n---\n\n## Sec\n\nsection body\n"
            )
            raw_files.append(p57)

            # L-58 doc: a document with a section for the section ref.
            # Use create_document for L-58 since it's the success case mirroring L-25.
            doc58_path = f"_test/{TEST_NAME}_{run_id}_doc58.md"
            sec_body = "intro\n\n## Target\n\nsection content here\n\n## Other\n\nother\n"
            create58 = client.call_tool(
                "create_document",
                title=f"{TEST_NAME} doc58 {run_id}",
                path=doc58_path,
                content=sec_body,
            )
            if not create58.ok:
                run.step(label="Setup doc58", passed=False,
                         detail=create58.error or create58.text[:200])
                return run

            # L-62 source: NO frontmatter at all — body only.
            src62_path = f"_test/{TEST_NAME}_{run_id}_src62.md"
            p62 = server.vault_path / src62_path
            p62.parent.mkdir(parents=True, exist_ok=True)
            p62.write_text("just a body, no frontmatter at all\n")
            raw_files.append(p62)

            # Force a sync scan so all raw-written files are indexed.
            client.call_tool("force_file_scan", background=False)

            # ── L-54: missing pointer path → "not found in frontmatter" reason ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{src54_path}->missing.path}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason54 = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason contains 'not found in frontmatter'":
                    "not found in frontmatter" in reason54.lower(),
            }
            run.step(label="L-54: missing pointer path → 'not found in frontmatter' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason54!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-55: pointer resolves to non-string → "not a string" reason ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{src55_path}->ptr}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason55 = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason contains 'not a string'":
                    "not a string" in reason55.lower(),
            }
            run.step(label="L-55: pointer to non-string scalar → 'not a string' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason55!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-56: pointer resolves to nonexistent target document ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{src56_path}->ptr}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason56 = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                # spec: "target document not found" or normative equivalent.
                # Use "not found" as substring check to be tolerant of wording.
                "reason indicates target not found":
                    "not found" in reason56.lower(),
            }
            run.step(label="L-56: pointer → nonexistent target → 'target document not found' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason56!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-57a: placeholder with both -> and # (ptr#Sec ordering) ──
            EXPECTED_57 = "invalid reference syntax: # and -> are mutually exclusive"
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{doc57_path}->ptr#Sec}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason57a = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason exact match (ptr#Sec ordering)": reason57a == EXPECTED_57,
            }
            run.step(label="L-57a: '->ptr#Sec' ordering → exact 'mutually exclusive' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason57a!r}, expected={EXPECTED_57!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-57b: placeholder with both -> and # (#Sec->ptr ordering) ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{doc57_path}#Sec->ptr}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason57b = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason exact match (#Sec->ptr ordering)": reason57b == EXPECTED_57,
            }
            run.step(label="L-57b: '#Sec->ptr' ordering → exact 'mutually exclusive' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason57b!r}, expected={EXPECTED_57!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-58: section ref (no ->) → no resolved_to in injected entry ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{doc58_path}#Target}}}} Reply OK."}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            entry = injected[0] if injected else {}
            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry has no 'resolved_to' key":
                    bool(entry) and "resolved_to" not in entry,
            }
            run.step(label="L-58: section ref (no ->) omits 'resolved_to' in injected entry",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, entry_keys={list(entry.keys())}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-61: {{id:<unknown-uuid>->ptr}} → source-doc-not-found ──
            unknown_uuid = str(_uuid.uuid4())
            placeholder_61 = f"{{{{id:{unknown_uuid}->ptr}}}}"
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content": f"{placeholder_61} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason61 = (failed[0].get("reason") if failed else "") or ""
            ref61 = (failed[0].get("ref") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "failed[0].ref is full literal placeholder":
                    ref61 == placeholder_61,
                "reason indicates source / not found / id":
                    "not found" in reason61.lower()
                    or "source" in reason61.lower()
                    or "id" in reason61.lower(),
            }
            run.step(label="L-61: '{{id:<unknown-uuid>->ptr}}' → source-document-not-found",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, ref={ref61!r}, reason={reason61!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── L-62: source has no frontmatter at all → "not found in frontmatter" ──
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{src62_path}->ptr}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason62 = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason contains 'not found in frontmatter'":
                    "not found in frontmatter" in reason62.lower(),
            }
            run.step(label="L-62: source with no frontmatter → 'not found in frontmatter' reason",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason62!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # ── Cleanup: remove raw-written files before FQCServer exits ──
            # FQCServer wipes the temp vault on __exit__, but removing now
            # avoids stale Supabase rows accumulating across runs (WR-03).
            for raw in raw_files:
                if raw.exists():
                    raw.unlink(missing_ok=True)
            # Try to remove the _test parent dir if empty.
            test_dir = server.vault_path / "_test"
            try:
                test_dir.rmdir()
            except OSError:
                pass  # not empty — managed-server-created docs may still be there

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

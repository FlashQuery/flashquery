#!/usr/bin/env python3
"""
Test: call_model reference resolution failures — fail-fast, no LLM dispatch.
Coverage: L-30, L-31, L-32
Modes:
    --managed   Required (starts dedicated FQC subprocess)
Usage:
    python test_call_model_ref_errors.py --managed
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

TEST_NAME = "test_call_model_ref_errors"
COVERAGE = ["L-30", "L-31", "L-31a", "L-32"]

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

    try:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            run_id = _uuid.uuid4().hex[:8]

            valid_path = f"_test/{TEST_NAME}_{run_id}_valid.md"
            # NOTE: create_document requires `title`. Prior versions of this
            # test omitted it, which caused the call to fail silently with
            # -32602 input validation; the file was never actually created,
            # and L-31 degenerated into a 2-failure case (valid_path also
            # not found) instead of the intended 1-valid + 1-invalid mix.
            client.call_tool(
                "create_document",
                path=valid_path,
                title="L-31 valid fixture",
                content="valid content",
            )
            # Force a sync scan so valid_path is indexed before L-31 / L-31a
            # reference it.
            client.call_tool("force_file_scan", background=False)

            # L-30: nonexistent reference → reference_resolution_failed
            ghost_ref = "Nonexistent/ghost_no_such_doc.md"
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user", "content": f"{{{{ref:{ghost_ref}}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed_references is list of 1": isinstance(failed, list) and len(failed) == 1,
                "failed[0].ref is full placeholder":
                    failed and failed[0].get("ref") == f"{{{{ref:{ghost_ref}}}}}",
                "failed[0].reason present": failed and "reason" in failed[0],
            }
            run.step(label="L-30: nonexistent reference → reference_resolution_failed",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, resp_keys={list(resp.keys())}",
                     timing_ms=r.timing_ms, tool_result=r)

            # L-31: one valid + one invalid → fail-fast, no LLM call
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[
                    {"role": "user",
                     "content": f"valid: {{{{ref:{valid_path}}}}} bad: {{{{ref:{ghost_ref}}}}}"},
                ],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed_references contains the bad ref":
                    failed and any(ghost_ref in (f.get("ref") or "") for f in failed),
                # Fail-fast: NO injected_references on a failed call
                "no injected_references key": "injected_references" not in resp,
                "no tokens key (no LLM dispatch)": "tokens" not in resp,
                # Phase 3 Gap 6: the valid ref MUST NOT appear in
                # failed_references[]. Only refs that actually failed to
                # resolve belong there. Without this negative assertion the
                # test couldn't tell apart "fail-fast bundled all refs as
                # failures" from the spec-correct "fail-fast surfaces only
                # the actually-failed refs".
                "valid ref NOT in failed_references (Phase 3 Gap 6)":
                    not any(valid_path in (f.get("ref") or "") for f in failed),
            }
            run.step(label="L-31: one valid + one invalid → fail-fast no LLM dispatch",
                     passed=all(checks.values()),
                     detail=f"checks={checks}",
                     timing_ms=r.timing_ms, tool_result=r)

            # L-31a (Phase 3 Gap 1, OQ #7): two-failure aggregation —
            # BOTH bad refs must appear in failed_references[]. The fail-fast
            # behaviour does not collapse the array to a single entry.
            ghost_ref_a = "Nonexistent/ghost_a.md"
            ghost_ref_b = "Nonexistent/ghost_b.md"
            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[
                    {"role": "user",
                     "content": f"a: {{{{ref:{ghost_ref_a}}}}} b: {{{{ref:{ghost_ref_b}}}}}"},
                ],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed_references contains ghost_a":
                    any(ghost_ref_a in (f.get("ref") or "") for f in failed),
                "failed_references contains ghost_b":
                    any(ghost_ref_b in (f.get("ref") or "") for f in failed),
                "failed_references has at least 2 entries (aggregation)":
                    isinstance(failed, list) and len(failed) >= 2,
                "no injected_references key": "injected_references" not in resp,
            }
            run.step(label="L-31a: two-failure aggregation — both bad refs in failed_references[] (Phase 3 Gap 1)",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, failed_count={len(failed) if isinstance(failed, list) else 'N/A'}",
                     timing_ms=r.timing_ms, tool_result=r)

            # L-32: pointer-missing → reference_resolution_failed, reason mentions pointer
            # Create a source doc with frontmatter that does NOT have the requested pointer.
            # Uses a raw vault write (not create_document) to avoid the fq_id round-trip.
            # The file is explicitly removed before the with-block exits so the scanner
            # does not leave a stale vault entry across test runs (WR-03).
            src_path = f"_test/{TEST_NAME}_{run_id}_src.md"
            p = server.vault_path / src_path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                f"---\nfq_id: {_uuid.uuid4()}\n---\n\nsource\n"
            )
            client.call_tool("force_file_scan", background=False)

            r = client.call_tool(
                "call_model", resolver="model", name="fast",
                messages=[{"role": "user",
                           "content": f"{{{{ref:{src_path}->missing.pointer}}}} reply"}],
            )
            resp = json.loads(r.text) if r.text else {}
            failed = resp.get("failed_references", [])
            reason_text = (failed[0].get("reason") if failed else "") or ""
            checks = {
                "isError true": (not r.ok),
                "error == reference_resolution_failed":
                    resp.get("error") == "reference_resolution_failed",
                "failed has 1 entry": isinstance(failed, list) and len(failed) == 1,
                "reason mentions pointer or path":
                    "pointer" in reason_text.lower() or "path" in reason_text.lower(),
            }
            run.step(label="L-32: pointer-missing → reference_resolution_failed",
                     passed=all(checks.values()),
                     detail=f"checks={checks}, reason={reason_text!r}",
                     timing_ms=r.timing_ms, tool_result=r)

            # Cleanup: remove the raw-written file before the FQCServer exits.
            # FQCServer deletes the whole temp vault on __exit__ (filesystem is cleaned),
            # but removing the file now and re-scanning prevents stale DB entries from
            # accumulating in Supabase when the vault is shared or reused (WR-03).
            if p.exists():
                p.unlink(missing_ok=True)
                # Remove the parent dir if empty
                try:
                    p.parent.rmdir()
                except OSError:
                    pass  # Not empty — other test files may be present

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

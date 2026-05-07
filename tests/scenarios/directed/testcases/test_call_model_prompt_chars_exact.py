#!/usr/bin/env python3
"""
Test: call_model metadata.prompt_chars exact-equality accounting.

Tightens the L-33b/L-33c invariants by pinning prompt_chars to exact
sums after {{ref:...}} placeholder substitution:
  - L-44: multi-message prompt — system content length + user content
          length WITH the {{ref:...}} placeholder replaced by the
          referenced body text.
  - L-45: single-message prompt whose content is exactly one
          {{ref:...}} placeholder — collapses the L-33c <= invariant
          to ===, catching regressions where placeholder delimiters
          or whitespace accidentally count toward prompt_chars.

Coverage points: L-44, L-45

Modes:
    --managed   Required (starts dedicated FQC subprocess with LLM config)

Usage:
    python test_call_model_prompt_chars_exact.py --managed

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


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_call_model_prompt_chars_exact"

COVERAGE = ["L-44", "L-45"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_fq_id(text: str) -> str | None:
    """Extract the FQC ID value from create_document's key-value response."""
    m = re.search(r"^FQC ID:\s*([0-9a-f-]+)\s*$", text, re.MULTILINE)
    return m.group(1) if m else None


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


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

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

            # ── Setup: create the reference target document ─────────────
            body_path = f"_test/{TEST_NAME}_{run_id}_body.md"
            body_text = "Reference target body."  # length 22
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
            run.step(label="Setup: body doc created", passed=True,
                     detail=f"path={body_path}, body_len={len(body_text)}")

            placeholder = f"{{{{ref:{body_path}}}}}"

            # ── Step L-44: prompt_chars equals sum across messages ──────
            # Two messages: a system role and a user role. The user content
            # contains exactly one {{ref:...}} placeholder surrounded by
            # fixed prefix and suffix text. After substitution:
            #   prompt_chars = len(system.content)
            #                + len("prefix ") + body_chars + len(" suffix")
            # where body_chars is taken from injected[0].chars (authoritative
            # body length as seen by the resolver, including any normalized
            # trailing newline).
            system_content = "You are concise."
            prefix = "prefix "
            suffix = " suffix"
            user_content = f"{prefix}{placeholder}{suffix}"

            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_content},
                ],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            prompt_chars = metadata.get("prompt_chars")

            body_chars = injected[0].get("chars") if injected else None
            expected = None
            if isinstance(body_chars, int):
                expected = (
                    len(system_content)
                    + len(prefix)
                    + body_chars
                    + len(suffix)
                )

            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry.ref is full placeholder":
                    bool(injected) and injected[0].get("ref") == placeholder,
                "entry.chars is int":
                    isinstance(body_chars, int),
                "prompt_chars is int":
                    isinstance(prompt_chars, int),
                "prompt_chars === sum of substituted message contents (strict)":
                    isinstance(prompt_chars, int)
                    and isinstance(expected, int)
                    and prompt_chars == expected,
            }
            run.step(
                label="L-44: prompt_chars equals sum of substituted message contents",
                passed=all(checks.values()),
                detail=(
                    f"checks={checks}, "
                    f"system_len={len(system_content)}, prefix_len={len(prefix)}, "
                    f"suffix_len={len(suffix)}, body_chars={body_chars}, "
                    f"expected={expected}, actual_prompt_chars={prompt_chars}"
                ),
                timing_ms=r.timing_ms,
                tool_result=r,
            )

            # ── Step L-45: single-placeholder boundary case ─────────────
            # Single user message whose content is *exactly* the placeholder
            # — no system message, no leading/trailing whitespace, no other
            # text. The L-33c "<=" invariant collapses to "===":
            #   prompt_chars === injected[0].chars
            # If placeholder delimiters or whitespace accidentally counted
            # toward prompt_chars, this assertion would fail by exactly the
            # number of stray characters.
            r = client.call_tool(
                "call_model",
                resolver="model",
                name="fast",
                messages=[{"role": "user", "content": placeholder}],
            )
            resp = json.loads(r.text) if r.ok else {}
            metadata = resp.get("metadata", {}) if isinstance(resp, dict) else {}
            injected = metadata.get("injected_references", [])
            prompt_chars = metadata.get("prompt_chars")
            body_chars = injected[0].get("chars") if injected else None

            checks = {
                "ok": r.ok,
                "injected has 1 entry":
                    isinstance(injected, list) and len(injected) == 1,
                "entry.ref is full placeholder":
                    bool(injected) and injected[0].get("ref") == placeholder,
                "entry.chars is int":
                    isinstance(body_chars, int),
                "prompt_chars is int":
                    isinstance(prompt_chars, int),
                "prompt_chars === injected[0].chars (strict, boundary)":
                    isinstance(prompt_chars, int)
                    and isinstance(body_chars, int)
                    and prompt_chars == body_chars,
            }
            run.step(
                label="L-45: single placeholder — prompt_chars === injected[0].chars",
                passed=all(checks.values()),
                detail=(
                    f"checks={checks}, "
                    f"injected[0].chars={body_chars}, "
                    f"prompt_chars={prompt_chars}, "
                    f"placeholder_len={len(placeholder)}"
                ),
                timing_ms=r.timing_ms,
                tool_result=r,
            )

    except Exception as e:  # noqa: BLE001
        run.step(label="Test crashed", passed=False,
                 detail=f"exception: {type(e).__name__}: {e}")

    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

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

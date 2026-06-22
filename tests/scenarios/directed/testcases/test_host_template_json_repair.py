#!/usr/bin/env python3
"""
T-S-002: generated host-template tools expose structured success and error payloads.
Coverage: ML-34
"""
from __future__ import annotations

COVERAGE = ["ML-34"]

import argparse
import json
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_host_template_json_repair"


def _write_doc(vault: Path, rel_path: str, body: str, **frontmatter: object) -> None:
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"fq_id: {uuid.uuid4()}",
        "fq_status: active",
        *[f"{key}: {json.dumps(value)}" for key, value in frontmatter.items()],
    ]
    path.write_text("---\n" + "\n".join(lines) + "\n---\n\n" + body, encoding="utf-8")


def _structured(result) -> dict[str, Any]:
    raw = result.raw_response or {}
    structured = ((raw.get("result") or {}).get("structuredContent") or {})
    return structured if isinstance(structured, dict) else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if getattr(args, "port_range", None) else None

    with FQCServer(
        fqc_dir=args.fqc_dir,
        port_range=port_range,
        extra_config={"templates": {"default_access": "permissive"}},
    ) as server:
        _write_doc(
            server.vault_path,
            "Templates/Json-Repair-Skill.md",
            "Repair template topic={{topic}}\n{{source}}",
            fq_template=True,
            fq_expose_as_tool=True,
            fq_namespace="jsonrepair",
            fq_desc="JSON repair directed template",
            fq_params={
                "topic": {"type": "string", "required": True},
                "source": {"type": "document", "required": True},
            },
        )
        _write_doc(server.vault_path, "Docs/source.md", "HOST TEMPLATE SOURCE BODY")

        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
        client.call_tool("maintain_vault", action="sync", background=False)

        success = client.call_tool(
            "flashquery_jsonrepair_json_repair_skill",
            topic="ML-34",
            source="Docs/source.md",
        )
        success_structured = _structured(success)
        run.step(
            label="ML-34 / T-S-002 generated host-template success includes structuredContent",
            passed=(
                success.ok
                and success_structured.get("ok") is True
                and isinstance(success_structured.get("result"), dict)
                and "HOST TEMPLATE SOURCE BODY" in json.dumps(success_structured)
            ),
            detail=json.dumps(success_structured, sort_keys=True)[:1200],
            timing_ms=success.timing_ms,
            tool_result=success,
        )

        failure = client.call_tool(
            "flashquery_jsonrepair_json_repair_skill",
            topic="ML-34",
            source="Docs/missing.md",
        )
        failure_structured = _structured(failure)
        run.step(
            label="ML-34 / T-S-002 generated host-template errors include structuredContent and isError",
            passed=(
                not failure.ok
                and failure_structured.get("ok") is False
                and isinstance(failure_structured.get("error"), dict)
                and failure_structured["error"].get("code") == "template_param_doc_not_found"
            ),
            detail=json.dumps(failure_structured, sort_keys=True)[:1200],
            timing_ms=failure.timing_ms,
            tool_result=failure,
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

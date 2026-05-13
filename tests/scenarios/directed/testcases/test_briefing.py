#!/usr/bin/env python3
"""
Phase 128 migration: get_briefing transitional coverage.

get_briefing is intentionally retained as a transitional macro-dependent helper.
Runnable setup uses final write tools so this scenario does not depend on removed
document or memory primitives.
"""
from __future__ import annotations

COVERAGE = ["B-01", "B-02", "B-03", "D-briefing-degrade-1", "D-briefing-degrade-2"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_briefing"


def _json_field(result, field: str) -> str:
    result.expect_json_path(field)
    payload = parse_mcp_json(result)
    return str(payload.get(field) or "")


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    unique_tag = f"briefing-test-{run.run_id}"
    other_tag = f"briefing-other-{run.run_id}"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        doc_ids: list[str] = []
        for idx in range(2):
            path = f"_test/{TEST_NAME}_{run.run_id}_doc{idx + 1}.md"
            result = ctx.client.call_tool(
                "write_document",
                mode="create",
                title=f"Briefing Doc {idx + 1} {run.run_id}",
                content=f"Briefing fixture document {idx + 1} for run {run.run_id}.",
                path=path,
                tags=[unique_tag, "briefing-test", "fqc-test"],
            )
            fq_id = _json_field(result, "fq_id") if result.ok else ""
            created_path = _json_field(result, "path") if result.ok else ""
            if created_path:
                ctx.cleanup.track_file(created_path, mcp_identifier=fq_id or created_path)
                parts = Path(created_path).parts
                for j in range(1, len(parts)):
                    ctx.cleanup.track_dir(str(Path(*parts[:j])))
            if fq_id:
                doc_ids.append(fq_id)
            run.step(
                label=f"write_document fixture {idx + 1}",
                passed=result.ok and result.status == "pass" and bool(fq_id),
                detail=expectation_detail(result) or result.error or "",
                timing_ms=result.timing_ms,
                tool_result=result,
            )
            if not result.ok or not fq_id:
                return run

        other = ctx.client.call_tool(
            "write_document",
            mode="create",
            title=f"Briefing Other {run.run_id}",
            content=f"Other briefing fixture for run {run.run_id}.",
            path=f"_test/{TEST_NAME}_{run.run_id}_other.md",
            tags=[other_tag, "fqc-test"],
        )
        other_id = _json_field(other, "fq_id") if other.ok else ""
        other_path = _json_field(other, "path") if other.ok else ""
        if other_path:
            ctx.cleanup.track_file(other_path, mcp_identifier=other_id or other_path)

        memory_result = ctx.client.call_tool(
            "write_memory",
            mode="create",
            content=f"Briefing memory alpha for run {run.run_id}.",
            tags=[unique_tag, "briefing-test", "fqc-test"],
        )
        memory_id = _json_field(memory_result, "memory_id") if memory_result.ok else ""
        if memory_id:
            ctx.cleanup.track_mcp_memory(memory_id)
        run.step(
            label="write_memory fixture",
            passed=memory_result.ok and memory_result.status == "pass" and bool(memory_id),
            detail=expectation_detail(memory_result) or memory_result.error or "",
            timing_ms=memory_result.timing_ms,
            tool_result=memory_result,
        )
        if not memory_result.ok or not memory_id:
            return run

        ctx.maintain_vault(action="sync", background=False)

        briefing = ctx.client.call_tool(
            "get_briefing",
            tags=[unique_tag],
            limit=5,
        )
        briefing.expect_json_path("generated_at")
        briefing.expect_json_path("entity_types")
        briefing.expect_json_path("groups")
        briefing.expect_contains(doc_ids[0])
        briefing.expect_contains(memory_id)
        if other_id:
            briefing.expect_not_contains(other_id)
        run.step(
            label="B-01/B-02: get_briefing returns structured filtered transitional output",
            passed=briefing.ok and briefing.status == "pass",
            detail=expectation_detail(briefing) or briefing.error or "",
            timing_ms=briefing.timing_ms,
            tool_result=briefing,
        )

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=None,
        secret=None,
        vault_path=None,
        managed=True,
        port_range=port_range,
        require_embedding=False,
        extra_config={"host_mcp_tools": {"tools": ["category:doc-write"]}},
    ) as ctx:
        degrade_tag = f"briefing-degrade-{run.run_id}"
        doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            title=f"Briefing Degrade Doc {run.run_id}",
            content=f"Briefing degradation fixture for run {run.run_id}.",
            path=f"_test/{TEST_NAME}_{run.run_id}_degrade.md",
            tags=[degrade_tag, "fqc-test"],
        )
        doc_id = _json_field(doc, "fq_id") if doc.ok else ""
        doc_path = _json_field(doc, "path") if doc.ok else ""
        if doc_path:
            ctx.cleanup.track_file(doc_path, mcp_identifier=doc_id or doc_path)
        run.step(
            label="D-briefing-degrade setup: write document with memory category disabled",
            passed=doc.ok and doc.status == "pass" and bool(doc_id),
            detail=expectation_detail(doc) or doc.error or "",
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )
        if not doc.ok or not doc_id:
            return run

        mixed = ctx.client.call_tool(
            "get_briefing",
            tags=[degrade_tag],
            entity_types=["documents", "memories"],
            limit=5,
        )
        mixed.expect_json_equals("warnings[0]", "memory_category_disabled")
        mixed.expect_json_equals("entity_types[0]", "documents")
        mixed.expect_json_path("groups[0].items[0].fq_id")
        mixed.expect_not_contains("memory_id")
        run.step(
            label="D-briefing-degrade-1: memory-disabled mixed request warns and returns documents only",
            passed=mixed.ok and mixed.status == "pass",
            detail=expectation_detail(mixed) or mixed.error or "",
            timing_ms=mixed.timing_ms,
            tool_result=mixed,
        )

        only_memory = ctx.client.call_tool(
            "get_briefing",
            tags=[degrade_tag],
            entity_types=["memories"],
            limit=5,
        )
        only_memory.expect_json_equals("error", "unsupported")
        only_memory.expect_json_equals("identifier", "memories")
        only_memory.expect_json_equals("details.disabled_entity_types[0]", "memories")
        run.step(
            label="D-briefing-degrade-2: memory-disabled memories-only request returns unsupported envelope",
            passed=only_memory.ok and only_memory.status == "pass",
            detail=expectation_detail(only_memory) or only_memory.error or "",
            timing_ms=only_memory.timing_ms,
            tool_result=only_memory,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test transitional get_briefing structured output.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()

    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Phase 128 migration: unified search cross-type coverage.

The removed legacy search surface is retained here only as historical coverage
context; the runnable scenario now uses write_document, write_memory, and search.
"""
from __future__ import annotations

COVERAGE = ["SA-01", "SA-02", "SA-03", "SA-04", "SA-05"]
REQUIRES_MANAGED = True

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_search_all_cross_type"


def _json_field(result, path: str):
    result.expect_json_path(path)
    payload = parse_mcp_json(result)
    current = payload
    for part in path.split("."):
        current = current[part]
    return current


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    doc_phrase = f"quetzalcoatl thunder {run.run_id}"
    mem_phrase = f"palimpsest murmuration {run.run_id}"
    unique_tag = f"sa-test-{run.run_id}"
    shared_tag = f"sa-shared-{run.run_id}"
    doc_title = f"FQC Unified Search Doc {run.run_id}"
    doc_path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:
        create_doc = ctx.client.call_tool(
            "write_document",
            mode="create",
            title=doc_title,
            content=f"## Cross-type search fixture\n\nDocument marker: {doc_phrase}.\n",
            path=doc_path,
            tags=["fqc-test", unique_tag, shared_tag, run.run_id],
        )
        created_path = _json_field(create_doc, "path") if create_doc.ok else ""
        doc_id = _json_field(create_doc, "fq_id") if create_doc.ok else ""
        if created_path:
            ctx.cleanup.track_file(created_path, mcp_identifier=doc_id or created_path)
            parts = Path(created_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        run.step(
            label="write_document creates document fixture for unified search",
            passed=create_doc.ok and create_doc.status == "pass" and bool(doc_id),
            detail=expectation_detail(create_doc) or create_doc.error or "",
            timing_ms=create_doc.timing_ms,
            tool_result=create_doc,
        )
        if not create_doc.ok or not doc_id:
            return run

        create_mem = ctx.client.call_tool(
            "write_memory",
            mode="create",
            content=f"Cross-type search fixture memory: {mem_phrase}. Run {run.run_id}.",
            tags=["fqc-test", shared_tag, run.run_id],
        )
        mem_id = _json_field(create_mem, "memory_id") if create_mem.ok else ""
        if mem_id:
            ctx.cleanup.track_mcp_memory(mem_id)
        run.step(
            label="write_memory creates memory fixture for unified search",
            passed=create_mem.ok and create_mem.status == "pass" and bool(mem_id),
            detail=expectation_detail(create_mem) or create_mem.error or "",
            timing_ms=create_mem.timing_ms,
            tool_result=create_mem,
        )
        if not create_mem.ok or not mem_id:
            return run

        ctx.maintain_vault(action="sync", background=False)

        deadline = time.time() + 20.0
        mem_probe = None
        while time.time() < deadline:
            mem_probe = ctx.client.call_tool(
                "search",
                query=mem_phrase,
                entity_types=["memories"],
                mode="semantic",
                tags=[shared_tag],
                limit=10,
            )
            if mem_probe.ok and mem_id in mem_probe.text:
                break
            time.sleep(1.0)

        doc_result = ctx.client.call_tool(
            "search",
            query=doc_title,
            entity_types=["documents"],
            mode="filesystem",
            limit=10,
        )
        doc_result.expect_json_equals("entity_types[0]", "documents")
        doc_result.expect_contains(doc_title)
        run.step(
            label="SA-01/03: search finds documents through final unified surface",
            passed=doc_result.ok and doc_result.status == "pass",
            detail=expectation_detail(doc_result) or doc_result.error or "",
            timing_ms=doc_result.timing_ms,
            tool_result=doc_result,
        )

        if mem_probe is None:
            mem_probe = ctx.client.call_tool(
                "search",
                query=mem_phrase,
                entity_types=["memories"],
                mode="semantic",
                tags=[shared_tag],
                limit=10,
            )
        mem_probe.expect_json_equals("entity_types[0]", "memories")
        mem_probe.expect_contains(mem_id)
        run.step(
            label="SA-02: search finds memories through final unified surface",
            passed=mem_probe.ok and mem_probe.status == "pass",
            detail=expectation_detail(mem_probe) or mem_probe.error or "",
            timing_ms=mem_probe.timing_ms,
            tool_result=mem_probe,
        )

        tagged_result = ctx.client.call_tool(
            "search",
            query="",
            tags=[shared_tag],
            tag_match="any",
            entity_types=["documents", "memories"],
            list_all=True,
            limit=10,
        )
        tagged_result.expect_contains(doc_id)
        tagged_result.expect_contains(mem_id)
        run.step(
            label="SA-04/05: search list-mode returns tagged document and memory fixtures",
            passed=tagged_result.ok and tagged_result.status == "pass",
            detail=expectation_detail(tagged_result) or tagged_result.error or "",
            timing_ms=tagged_result.timing_ms,
            tool_result=tagged_result,
        )

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test unified search across documents and memories.")
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

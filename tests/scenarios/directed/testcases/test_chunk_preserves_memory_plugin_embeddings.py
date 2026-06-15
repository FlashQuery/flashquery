#!/usr/bin/env python3
"""D-chunk-5: chunked document search preserves memory and plugin embedding workflows."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from lifecycle_embedding_scenario_helpers import lifecycle_catalog_config, parse_payload, plugin_yaml, register_plugin  # noqa: E402

TEST_NAME = "test_chunk_preserves_memory_plugin_embeddings"
COVERAGE = ["D-chunk-5"]


def _record(run: TestRun, label: str, result, passed: bool, detail: str = "") -> bool:
    run.step(
        label=label,
        passed=passed,
        detail=detail or expectation_detail(result) or result.error or result.text[:1000],
        timing_ms=result.timing_ms,
        tool_result=result,
    )
    return passed


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    suffix = f"{run.run_id.replace('-', '_')}_{uuid4().hex[:8]}"
    plugin_id = f"chunk_preserve_{suffix[:8]}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config("primary"),
    ) as ctx:
        doc = None
        doc_path = ""
        doc_payload = {}
        doc_id = ""
        for attempt in range(3):
            attempt_suffix = f"{suffix}_{attempt}"
            doc_path = f"chunk-preserve/{attempt_suffix}.md"
            doc = ctx.client.call_tool(
                "write_document",
                mode="create",
                path=doc_path,
                title=f"Chunk preserve document {attempt_suffix}",
                content=f"Chunk preserve document body {attempt_suffix}",
                tags=["chunk-preserve"],
            )
            doc_payload = parse_payload(doc)
            doc_id = str(doc_payload.get("fq_id") or "")
            if doc.ok and doc_id:
                suffix = attempt_suffix
                break
            if "fqc_chunks_pkey" not in (doc.text or ""):
                break
        assert doc is not None
        if doc_id:
            ctx.cleanup.track_mcp_document(doc_id)
            ctx.cleanup.track_file(doc_path)
            ctx.cleanup.track_dir("chunk-preserve")
        if not _record(run, "public write_document creates a chunked document fixture", doc, doc.ok and bool(doc_id), json.dumps(doc_payload, sort_keys=True)):
            return run

        memory = ctx.client.call_tool(
            "write_memory",
            mode="create",
            content=f"Chunk preserve memory body {suffix}",
            tags=["chunk-preserve"],
        )
        memory_payload = parse_payload(memory)
        memory_id = str(memory_payload.get("memory_id") or "")
        if memory_id:
            ctx.cleanup.track_mcp_memory(memory_id)
        if not _record(run, "public write_memory still creates row-per-vector memory fixture", memory, memory.ok and bool(memory_id), json.dumps(memory_payload, sort_keys=True)):
            return run

        plugin = register_plugin(ctx, plugin_id, plugin_yaml(plugin_id, "primary"), "primary")
        if not _record(run, "public register_plugin preserves explicit record embedding entry", plugin, plugin.ok):
            return run

        record = ctx.client.call_tool(
            "write_record",
            mode="create",
            plugin_id=plugin_id,
            plugin_instance="default",
            table="notes",
            data={
                "title": f"Chunk preserve plugin title {suffix}",
                "body": f"Chunk preserve plugin body {suffix}",
            },
            include=["data"],
        )
        record_payload = parse_payload(record)
        record_id = str(record_payload.get("id") or record_payload.get("record_id") or "")
        if not _record(run, "public write_record still creates embedding-enabled plugin record", record, record.ok and bool(record_id), json.dumps(record_payload, sort_keys=True)):
            return run

        backfill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory", "records"], "records": {"plugin": plugin_id}},
        )
        if not _record(run, "public maintain_vault backfill accepts documents memory and records together", backfill, backfill.ok):
            return run

        doc_search = ctx.client.call_tool(
            "search",
            query=f"Chunk preserve document body {suffix}",
            entity_types=["documents"],
            mode="semantic",
        )
        doc_search_payload = parse_payload(doc_search)
        doc_results = doc_search_payload.get("results") if isinstance(doc_search_payload.get("results"), list) else []
        first_doc = doc_results[0] if doc_results and isinstance(doc_results[0], dict) else {}
        matched_chunks = first_doc.get("matched_chunks") if isinstance(first_doc, dict) else None
        doc_passed = (
            doc_search.ok
            and first_doc.get("path") == doc_path
            and isinstance(matched_chunks, list)
            and len(matched_chunks) >= 1
        )
        _record(run, "public document semantic search returns matched_chunks", doc_search, doc_passed, json.dumps(doc_search_payload, sort_keys=True))

        memory_search = ctx.client.call_tool(
            "search",
            query=f"Chunk preserve memory body {suffix}",
            entity_types=["memories"],
            mode="semantic",
        )
        memory_search_payload = parse_payload(memory_search)
        memory_results = memory_search_payload.get("results") if isinstance(memory_search_payload.get("results"), list) else []
        first_memory = memory_results[0] if memory_results and isinstance(memory_results[0], dict) else {}
        memory_passed = (
            memory_search.ok
            and first_memory.get("memory_id") == memory_id
            and "matched_chunks" not in first_memory
            and str(first_memory.get("content_preview") or "").find(f"Chunk preserve memory body {suffix}") >= 0
        )
        _record(run, "public memory semantic search keeps memory result shape", memory_search, memory_passed, json.dumps(memory_search_payload, sort_keys=True))

        record_search = ctx.client.call_tool(
            "search_records",
            plugin_id=plugin_id,
            plugin_instance="default",
            table="notes",
            query=f"Chunk preserve plugin title {suffix}",
            include=["data"],
        )
        record_search_payload = parse_payload(record_search)
        records = record_search_payload.get("results") if isinstance(record_search_payload.get("results"), list) else []
        first_record = records[0] if records and isinstance(records[0], dict) else {}
        record_passed = record_search.ok and first_record.get("id") == record_id
        _record(run, "public plugin record search remains available after document chunking", record_search, record_passed, json.dumps(record_search_payload, sort_keys=True))

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    from lifecycle_embedding_scenario_helpers import cli_main

    cli_main(TEST_NAME, run_test)

#!/usr/bin/env python3
"""
Test: final unified search + memory lifecycle tool surface.

Scenario:
    1. Create a document through write_document and a memory through write_memory.
    2. Parse final JSON envelopes from write_memory, search, get_memory, and archive_memory.
    3. Verify search(entity_types=...) covers documents, memories, list mode, mixed limits,
       and archived visibility without legacy search_all/search_memory calls.

Coverage points: D-search-1..D-search-7, D-wmem-1..D-wmem-7
"""
from __future__ import annotations

COVERAGE = [
    "D-search-1",
    "D-search-2",
    "D-search-3",
    "D-search-4",
    "D-search-5",
    "D-search-6",
    "D-search-7",
    "D-wmem-1",
    "D-wmem-2",
    "D-wmem-3",
    "D-wmem-4",
    "D-wmem-5",
    "D-wmem-6",
    "D-wmem-7",
]

import argparse
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import get_json_path, parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail


TEST_NAME = "test_unified_search_memory_final"
MISSING_MEMORY_ID = "00000000-0000-4000-8000-000000000125"


def _json(result, path: str):
    return get_json_path(parse_mcp_json(result), path)


def _record(run: TestRun, label: str, result, passed: bool, detail: str = "", server_logs=None) -> bool:
    run.step(
        label=label,
        passed=passed,
        detail=detail or expectation_detail(result) or result.error or "",
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=server_logs,
    )
    return passed


def _track_doc(ctx: TestContext, payload: dict, fallback_path: str) -> None:
    path = str(payload.get("path") or fallback_path)
    fq_id = str(payload.get("fq_id") or "")
    if path:
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if fq_id:
        ctx.cleanup.track_mcp_document(fq_id)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    marker = f"phase125-final-{run.run_id}"
    doc_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    doc_title = f"Phase 125 Unified Search {run.run_id}"
    doc_phrase = f"{marker} document beacon"
    mem_phrase = f"{marker} memory beacon"
    updated_phrase = f"{marker} updated memory beacon"
    unique_tag = f"phase125-final-{run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        log_mark = ctx.server.log_position if ctx.server else 0
        doc_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            title=doc_title,
            content=f"# {doc_title}\n\nThis document carries {doc_phrase}.",
            path=doc_path,
            tags=["fqc-test", "phase125", unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            doc_payload = parse_mcp_json(doc_result)
            _track_doc(ctx, doc_payload, doc_path)
            doc_passed = doc_result.ok and doc_payload.get("path") == doc_path
            doc_detail = "" if doc_passed else f"Unexpected document payload: {doc_payload}"
        except Exception as exc:
            doc_passed = False
            doc_detail = f"JSON parse error: {exc}"
        if not _record(run, "setup: write_document creates searchable document fixture", doc_result, doc_passed, doc_detail, step_logs):
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        if not _record(run, "setup: force_file_scan indexes document fixture", scan_result, scan_result.ok, scan_result.error or "", step_logs):
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        mem_result = ctx.client.call_tool(
            "write_memory",
            mode="create",
            content=f"Original {mem_phrase}.",
            tags=["fqc-test", "phase125", unique_tag],
            include=["content", "tags_full"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            memory_id = str(_json(mem_result, "memory_id"))
            UUID(memory_id)
            ctx.cleanup.track_mcp_memory(memory_id)
            mem_passed = (
                mem_result.ok
                and _json(mem_result, "content") == f"Original {mem_phrase}."
                and unique_tag in (_json(mem_result, "tags_full") or [])
                and _json(mem_result, "is_latest") is True
            )
            mem_detail = "" if mem_passed else f"Unexpected memory payload: {parse_mcp_json(mem_result)}"
        except Exception as exc:
            memory_id = ""
            mem_passed = False
            mem_detail = f"JSON parse error: {exc}"
        if not _record(run, "D-wmem-1/2: write_memory create returns parseable JSON with includes", mem_result, mem_passed, mem_detail, step_logs):
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        search_doc = ctx.client.call_tool(
            "search",
            query=doc_title,
            mode="filesystem",
            entity_types=["documents"],
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            doc_results = _json(search_doc, "results") or []
            doc_search_passed = (
                search_doc.ok
                and _json(search_doc, "mode") == "filesystem"
                and _json(search_doc, "entity_types") == ["documents"]
                and any(item.get("path") == doc_path and item.get("entity_type") == "document" for item in doc_results)
                and all("filesystem" in item.get("match_source", []) for item in doc_results)
            )
            doc_search_detail = "" if doc_search_passed else f"Unexpected search payload: {parse_mcp_json(search_doc)}"
        except Exception as exc:
            doc_search_passed = False
            doc_search_detail = f"JSON parse error: {exc}"
        _record(run, "D-search-1/3/6: search filesystem document JSON envelope", search_doc, doc_search_passed, doc_search_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        search_mem = ctx.client.call_tool(
            "search",
            query="",
            entity_types=["memories"],
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            mem_results = _json(search_mem, "results") or []
            mem_search_passed = (
                search_mem.ok
                and _json(search_mem, "mode") == "list"
                and _json(search_mem, "entity_types") == ["memories"]
                and any(item.get("memory_id") == memory_id for item in mem_results)
            )
            mem_search_detail = "" if mem_search_passed else f"Unexpected search payload: {parse_mcp_json(search_mem)}"
        except Exception as exc:
            mem_search_passed = False
            mem_search_detail = f"JSON parse error: {exc}"
        _record(run, "D-search-2/4: search memory list mode with entity_types", search_mem, mem_search_passed, mem_search_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        update_result = ctx.client.call_tool(
            "write_memory",
            mode="update",
            memory_id=memory_id,
            content=f"Updated {updated_phrase}.",
            include=["content", "tags_full"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            updated_id = str(_json(update_result, "memory_id"))
            UUID(updated_id)
            ctx.cleanup.track_mcp_memory(updated_id)
            update_passed = (
                update_result.ok
                and updated_id != memory_id
                and _json(update_result, "previous_version_id") == memory_id
                and _json(update_result, "version") == 2
                and unique_tag in (_json(update_result, "tags_full") or [])
            )
            update_detail = "" if update_passed else f"Unexpected update payload: {parse_mcp_json(update_result)}"
        except Exception as exc:
            updated_id = ""
            update_passed = False
            update_detail = f"JSON parse error: {exc}"
        if not _record(run, "D-wmem-3/4: write_memory update versions latest memory and preserves tags", update_result, update_passed, update_detail, step_logs):
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        get_batch = ctx.client.call_tool(
            "get_memory",
            memory_ids=[memory_id, updated_id],
            include=["content", "tags_full"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            batch_payload = parse_mcp_json(get_batch)
            get_passed = (
                get_batch.ok
                and isinstance(batch_payload, list)
                and [item.get("memory_id") for item in batch_payload] == [memory_id, updated_id]
                and batch_payload[1].get("content") == f"Updated {updated_phrase}."
            )
            get_detail = "" if get_passed else f"Unexpected get payload: {batch_payload}"
        except Exception as exc:
            get_passed = False
            get_detail = f"JSON parse error: {exc}"
        _record(run, "D-wmem-5: get_memory batch returns ordered JSON projections", get_batch, get_passed, get_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        search_mixed = ctx.client.call_tool(
            "search",
            query=marker,
            mode="mixed",
            entity_types=["documents", "memories"],
            limit=1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            mixed_passed = search_mixed.ok and _json(search_mixed, "mode") == "mixed" and _json(search_mixed, "total") == 1
            mixed_detail = "" if mixed_passed else f"Unexpected mixed payload: {parse_mcp_json(search_mixed)}"
        except Exception as exc:
            mixed_passed = False
            mixed_detail = f"JSON parse error: {exc}"
        _record(run, "D-search-5: search applies one global mixed-result limit", search_mixed, mixed_passed, mixed_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_memory",
            memory_ids=[updated_id, MISSING_MEMORY_ID],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            archive_payload = parse_mcp_json(archive_result)
            archive_passed = (
                archive_result.ok
                and isinstance(archive_payload, list)
                and archive_payload[0].get("memory_id") == updated_id
                and archive_payload[0].get("archived_at")
                and archive_payload[1].get("error") == "not_found"
                and archive_payload[1].get("identifier") == MISSING_MEMORY_ID
            )
            archive_detail = "" if archive_passed else f"Unexpected archive payload: {archive_payload}"
        except Exception as exc:
            archive_passed = False
            archive_detail = f"JSON parse error: {exc}"
        _record(run, "D-wmem-6/7: archive_memory batch order and expected-error envelopes", archive_result, archive_passed, archive_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        archived_default = ctx.client.call_tool(
            "search",
            query=updated_phrase,
            mode="filesystem",
            entity_types=["memories"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            default_passed = archived_default.ok and _json(archived_default, "total") == 0
            default_detail = "" if default_passed else f"Unexpected default archived payload: {parse_mcp_json(archived_default)}"
        except Exception as exc:
            default_passed = False
            default_detail = f"JSON parse error: {exc}"
        _record(run, "D-search-7a: search excludes archived memories by default", archived_default, default_passed, default_detail, step_logs)

        log_mark = ctx.server.log_position if ctx.server else 0
        archived_included = ctx.client.call_tool(
            "search",
            query=updated_phrase,
            mode="filesystem",
            entity_types=["memories"],
            include_archived=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        try:
            included_results = _json(archived_included, "results") or []
            included_passed = archived_included.ok and any(item.get("memory_id") == updated_id for item in included_results)
            included_detail = "" if included_passed else f"Unexpected include_archived payload: {parse_mcp_json(archived_included)}"
        except Exception as exc:
            included_passed = False
            included_detail = f"JSON parse error: {exc}"
        _record(run, "D-search-7b: search include_archived surfaces archived memories", archived_included, included_passed, included_detail, step_logs)

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
        return run


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()

    result = run_test(args)
    if args.output_json:
        print(result.to_json())
    else:
        print("\n".join(result.summary_lines()))
    raise SystemExit(result.exit_code)

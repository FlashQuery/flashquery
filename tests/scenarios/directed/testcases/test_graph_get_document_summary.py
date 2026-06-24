#!/usr/bin/env python3
"""Directed get_document graph summary and connections coverage (D-GR-04)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_graph_get_document_summary"


def _payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _graph_config() -> dict[str, Any]:
    return {"graph": {"enabled": True, "embedding_name": "primary"}}


def _track(ctx: TestContext, path: str, payload: dict[str, Any]) -> None:
    fqc_id = str(payload.get("fq_id") or "")
    if fqc_id:
        ctx.cleanup.track_mcp_document(fqc_id)
    ctx.cleanup.track_file(path)
    ctx.cleanup.track_dir("_test")


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source_path = f"_test/graph_summary_source_{run.run_id}.md"
    target_path = f"_test/graph_summary_target_{run.run_id}.md"
    source_title = f"Graph Summary Source {run.run_id}"
    target_title = f"Graph Summary Target {run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=_graph_config(),
    ) as ctx:
        target = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=target_path,
            title=target_title,
            content=f"# {target_title}\n\n## Evidence\n\nTarget evidence for graph summary.",
            tags=["fqc-test", run.run_id, "graph"],
        )
        target_payload = _payload(target)
        _track(ctx, target_path, target_payload)
        run.step("create graph summary target", target.ok and bool(target_payload.get("fq_id")), expectation_detail(target) or target.error or target.text, target.timing_ms, target)
        if not target.ok:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        source = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=source_path,
            title=source_title,
            content=f"# {source_title}\n\nSee [[{target_title}#Evidence]] for supporting details.",
            tags=["fqc-test", run.run_id, "graph"],
        )
        source_payload = _payload(source)
        source_id = str(source_payload.get("fq_id") or "")
        _track(ctx, source_path, source_payload)
        run.step("create graph summary source", source.ok and bool(source_id), expectation_detail(source) or source.error or source.text, source.timing_ms, source)
        if not source_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        scan = ctx.client.call_tool("maintain_vault", action="sync", background=False)
        run.step("sync structural graph state", scan.ok, expectation_detail(scan) or scan.error or scan.text, scan.timing_ms, scan)

        doc = ctx.client.call_tool(
            "get_document",
            identifiers=source_id,
            include=["graph_summary", "connections"],
            connections={"graph_limit_per_chunk": 10, "include_inactive_targets": True},
        )
        doc_payload = _payload(doc)
        summary = doc_payload.get("graph_summary", {})
        connections = doc_payload.get("connections", {})
        serialized = json.dumps(doc_payload, sort_keys=True)
        checks = {
            "summary present": isinstance(summary, dict),
            "edge count is numeric": isinstance(summary.get("edge_count"), int),
            "connections present": isinstance(connections.get("source_chunks"), list),
            "drilldown chunk ids present": "chunk_id" in serialized,
        }
        run.step(
            "get_document returns graph_summary, graph-primary connections, and chunk drill-down ids",
            passed=doc.ok and all(checks.values()),
            detail="" if all(checks.values()) else json.dumps({"checks": checks, "payload": doc_payload}, sort_keys=True),
            timing_ms=doc.timing_ms,
            tool_result=doc,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test get_document graph summary.")
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--vault-path", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else "\n".join(run.summary_lines()))
    raise SystemExit(run.exit_code)


if __name__ == "__main__":
    main()

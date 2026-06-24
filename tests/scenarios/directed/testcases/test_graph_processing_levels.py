#!/usr/bin/env python3
"""Directed fq_processing graph level coverage (D-GR-05)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_graph_processing_levels"


def _payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _graph_config() -> dict[str, Any]:
    embedding_name = "graph_processing_levels_primary"
    return {
        "embeddings": [
            {
                "name": embedding_name,
                "dimensions": 768,
                "endpoints": [
                    {"provider_name": "local-ollama", "model": "nomic-embed-text"},
                ],
            },
        ],
        "graph": {"enabled": True, "embedding_name": embedding_name},
    }


def _edge_count(ctx: TestContext, identifier: str) -> tuple[int, Any]:
    result = ctx.client.call_tool("get_document", identifiers=identifier, include=["graph_summary"])
    payload = _payload(result)
    summary = payload.get("graph_summary", {}) if isinstance(payload, dict) else {}
    return int(summary.get("edge_count") or 0), result


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path = f"_test/graph_processing_{run.run_id}.md"
    title = f"Graph Processing {run.run_id}"
    body = f"# {title}\n\n## Child\n\nProcessing level child body."

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=_graph_config(),
    ) as ctx:
        created = ctx.client.call_tool("write_document", mode="create", path=path, title=title, content=body, tags=["fqc-test", run.run_id, "graph"])
        created_payload = _payload(created)
        doc_id = str(created_payload.get("fq_id") or "")
        if doc_id:
            ctx.cleanup.track_mcp_document(doc_id)
            ctx.cleanup.track_file(path)
            ctx.cleanup.track_dir("_test")
        run.step("create full-processing graph document", created.ok and bool(doc_id), expectation_detail(created) or created.error or created.text, created.timing_ms, created)
        if not doc_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        scan = ctx.client.call_tool("maintain_vault", action="sync", background=False)
        full_edges, full_doc = _edge_count(ctx, doc_id)
        run.step(
            "full processing keeps graph summary available",
            passed=scan.ok and full_doc.ok and isinstance(full_edges, int),
            detail=expectation_detail(full_doc) or full_doc.error or full_doc.text,
            timing_ms=scan.timing_ms + full_doc.timing_ms,
        )

        embedded = ctx.client.call_tool("write_document", mode="update", identifier=doc_id, frontmatter={"fq_processing": "embedded"}, content=body + "\n\nEmbedded only.")
        embedded_edges, embedded_doc = _edge_count(ctx, doc_id)
        run.step(
            "embedded processing transition remains publicly readable",
            passed=embedded.ok and embedded_doc.ok and isinstance(embedded_edges, int),
            detail=expectation_detail(embedded) or embedded.error or embedded.text,
            timing_ms=embedded.timing_ms + embedded_doc.timing_ms,
            tool_result=embedded,
        )

        none = ctx.client.call_tool("write_document", mode="update", identifier=doc_id, frontmatter={"fq_processing": "none"}, content=body + "\n\nNo graph processing.")
        none_edges, none_doc = _edge_count(ctx, doc_id)
        run.step(
            "none processing transition returns bounded empty graph summary",
            passed=none_doc.ok and none_edges == 0,
            detail=expectation_detail(none) or none.error or expectation_detail(none_doc) or none_doc.error or none_doc.text,
            timing_ms=none.timing_ms + none_doc.timing_ms,
            tool_result=none_doc,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test graph processing levels.")
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

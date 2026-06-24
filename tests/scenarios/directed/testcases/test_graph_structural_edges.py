#!/usr/bin/env python3
"""
Test: graph structural edges — write_document -> maintain_vault sync -> query_graph.

Scenario:
    1. Create linked markdown documents through public write_document.
    2. Run public maintain_vault sync to ensure the vault index is current.
    3. Resolve created chunk IDs from the test database and call public query_graph.
    4. Assert structural references edges are visible in public MCP responses.
    Cleanup is automatic.

Coverage points: D-GR-01, T-S-001
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


TEST_NAME = "test_graph_structural_edges"


def _graph_config() -> dict[str, Any]:
    return {"graph": {"enabled": True, "embedding_name": "primary"}}


def _payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL")
    if not value:
        env_path = Path(__file__).resolve().parents[4] / ".env.test"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not value:
        raise RuntimeError("DATABASE_URL is required for graph scenario verification")
    return value


def _chunks_for_document(document_id: str) -> list[dict[str, str]]:
    if psycopg is None:
        raise RuntimeError("psycopg is required for graph scenario verification")
    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT heading_path, id::text
                FROM fqc_chunks
                WHERE document_id = %s
                ORDER BY chunk_index
                """,
                (document_id,),
            )
            return [{"heading_path": str(row[0]), "id": str(row[1])} for row in cur.fetchall()]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source_path = f"_test/graph_source_{run.run_id}.md"
    target_path = f"_test/graph_target_{run.run_id}.md"
    source_title = f"Graph Source {run.run_id}"
    target_title = f"Graph Target {run.run_id}"
    source_child_body = " ".join([f"source child detail {run.run_id}"] * 80)
    target_child_body = " ".join([f"target child detail {run.run_id}"] * 80)
    source_body = (
        f"# {source_title}\n\n"
        f"See [[{target_title}#Target Child]].\n\n"
        "## Source Child\n\n"
        f"{source_child_body}"
    )
    target_body = (
        f"# {target_title}\n\n"
        "Target root body.\n\n"
        "## Target Child\n\n"
        f"{target_child_body}"
    )

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
            content=target_body,
            tags=["fqc-test", run.run_id, "graph"],
        )
        target_payload = _payload(target)
        target_id = str(target_payload.get("fq_id") or "")
        if target_id:
            ctx.cleanup.track_mcp_document(target_id)
            ctx.cleanup.track_file(target_path)
            ctx.cleanup.track_dir("_test")
        run.step(
            "create target document through public write_document",
            passed=target.ok and bool(target_id),
            detail=expectation_detail(target) or target.error or json.dumps(target_payload, sort_keys=True),
            timing_ms=target.timing_ms,
            tool_result=target,
        )
        if not target_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        source = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=source_path,
            title=source_title,
            content=source_body,
            tags=["fqc-test", run.run_id, "graph"],
        )
        source_payload = _payload(source)
        source_id = str(source_payload.get("fq_id") or "")
        if source_id:
            ctx.cleanup.track_mcp_document(source_id)
            ctx.cleanup.track_file(source_path)
        run.step(
            "create source document through public write_document",
            passed=source.ok and bool(source_id),
            detail=expectation_detail(source) or source.error or json.dumps(source_payload, sort_keys=True),
            timing_ms=source.timing_ms,
            tool_result=source,
        )
        if not source_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        scan = ctx.client.call_tool("maintain_vault", action="sync", background=False)
        run.step(
            "sync vault through public maintain_vault",
            passed=scan.ok,
            detail=expectation_detail(scan) or scan.error or scan.text[:1000],
            timing_ms=scan.timing_ms,
            tool_result=scan,
        )
        if not scan.ok:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        t0 = time.monotonic()
        try:
            source_chunks = _chunks_for_document(source_id)
            target_chunks = _chunks_for_document(target_id)
            root_chunk = source_chunks[0]["id"]
            target_child_chunk = next(chunk["id"] for chunk in target_chunks if chunk["heading_path"].endswith("Target Child"))
            run.step(
                "resolve graph chunk IDs from indexed documents",
                passed=True,
                detail=json.dumps(
                    {"source": root_chunk, "target_child": target_child_chunk},
                    sort_keys=True,
                ),
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        except Exception as exc:
            run.step(
                "resolve graph chunk IDs from indexed documents",
                passed=False,
                detail=f"Exception: {exc}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            run.record_cleanup(ctx.cleanup_errors)
            return run

        query = ctx.client.call_tool(
            "query_graph",
            action="edges",
            chunk_id=root_chunk,
            relations=["references"],
            limit=20,
        )
        query_payload = _payload(query)
        edges = query_payload.get("data", {}).get("edges", []) if isinstance(query_payload.get("data"), dict) else []
        observed = [
            (
                edge.get("relation"),
                edge.get("source", {}).get("chunk_id"),
                edge.get("target", {}).get("chunk_id"),
            )
            for edge in edges
            if isinstance(edge, dict)
        ]
        checks = {
            "references edge visible": ("references", root_chunk, target_child_chunk) in observed,
        }
        passed = query.ok and all(checks.values())
        detail = "" if passed else json.dumps({"checks": checks, "observed": observed, "payload": query_payload}, sort_keys=True)
        run.step(
            "query_graph exposes structural references edge",
            passed=passed,
            detail=expectation_detail(query) or query.error or detail,
            timing_ms=query.timing_ms,
            tool_result=query,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: graph structural edges public workflow.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
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

#!/usr/bin/env python3
"""Directed get_document graph summary and connections coverage (D-GR-04, D-GR-08)."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

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
    embedding_name = "graph_get_document_summary_primary"
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


def _seed_promoted_connection(source_id: str, target_id: str, run_id: str) -> dict[str, str]:
    if psycopg is None:
        raise RuntimeError("psycopg is required for graph scenario verification")
    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, instance_id
                FROM fqc_chunks
                WHERE document_id = %s::uuid
                ORDER BY chunk_index
                LIMIT 1
                """,
                (source_id,),
            )
            source_row = cur.fetchone()
            cur.execute(
                """
                SELECT id::text, instance_id, content_hash
                FROM fqc_chunks
                WHERE document_id = %s::uuid
                ORDER BY chunk_index
                LIMIT 1
                """,
                (target_id,),
            )
            target_row = cur.fetchone()
            if source_row is None or target_row is None:
                raise RuntimeError("Expected source and target chunks after sync")
            source_chunk, instance_id = str(source_row[0]), str(source_row[1])
            target_chunk, target_instance_id, target_hash = str(target_row[0]), str(target_row[1]), str(target_row[2])
            if instance_id != target_instance_id:
                raise RuntimeError("Source and target chunks belong to different instances")
            cur.execute(
                """
                INSERT INTO fqc_graph_nodes (
                  chunk_id, instance_id, question_status, community_id, community_label,
                  chunk_summary, analyzed_content_hash, analyzed_at
                )
                VALUES
                  (%s, %s, NULL, NULL, NULL, NULL, NULL, NULL),
                  (%s, %s, 'open', %s, 'Directed Cluster', %s, %s, '2026-06-29T00:00:00Z'::timestamptz)
                ON CONFLICT (chunk_id) DO UPDATE
                SET question_status = EXCLUDED.question_status,
                    community_id = EXCLUDED.community_id,
                    community_label = EXCLUDED.community_label,
                    chunk_summary = EXCLUDED.chunk_summary,
                    analyzed_content_hash = EXCLUDED.analyzed_content_hash,
                    analyzed_at = EXCLUDED.analyzed_at
                """,
                (
                    source_chunk,
                    instance_id,
                    target_chunk,
                    instance_id,
                    f"comm-directed-{run_id}",
                    f"Directed target summary {run_id}",
                    target_hash,
                ),
            )
            cur.execute(
                """
                INSERT INTO fqc_graph_edges (
                  instance_id, source_chunk_id, target_chunk_id, relation,
                  confidence, confidence_score, reasoning, model, status
                )
                VALUES (%s, %s, %s, 'supports', 'INFERRED', 0.88, 'directed promoted fields', 'mock', 'active')
                """,
                (instance_id, source_chunk, target_chunk),
            )
            conn.commit()
            return {
                "source_chunk": source_chunk,
                "target_chunk": target_chunk,
                "community_id": f"comm-directed-{run_id}",
            }


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

        seeded: dict[str, str] = {}
        try:
            seeded = _seed_promoted_connection(source_id, str(target_payload.get("fq_id") or ""), run.run_id)
            run.step("seed promoted graph connection target", passed=True, detail=json.dumps(seeded, sort_keys=True))
        except Exception as exc:
            run.step("seed promoted graph connection target", passed=False, detail=f"Exception: {exc}")
            run.record_cleanup(ctx.cleanup_errors)
            return run

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

        promoted_targets = [
            connection.get("target", {})
            for connection in connections.get("overall", [])
            if isinstance(connection, dict)
        ]
        promoted = next((target for target in promoted_targets if target.get("chunk_id") == seeded.get("target_chunk")), {})
        follow_up = ctx.client.call_tool("query_graph", action="community_members", community_id=promoted.get("community_id"))
        follow_up_payload = _payload(follow_up)
        members = follow_up_payload.get("data", {}).get("members", [])
        promoted_checks = {
            "chunk_summary": promoted.get("chunk_summary") == f"Directed target summary {run.run_id}",
            "stale false": promoted.get("stale") is False,
            "analyzed_at present": isinstance(promoted.get("analyzed_at"), str),
            "community_id": promoted.get("community_id") == seeded.get("community_id"),
            "community follow-up": any(member.get("chunk_id") == seeded.get("target_chunk") for member in members if isinstance(member, dict)),
        }
        run.step(
            "D-GR-08 get_document promoted target fields and community follow-up are public through MCP",
            passed=doc.ok and follow_up.ok and all(promoted_checks.values()),
            detail="" if all(promoted_checks.values()) else json.dumps({
                "checks": promoted_checks,
                "promoted": promoted,
                "follow_up": follow_up_payload,
            }, sort_keys=True),
            timing_ms=doc.timing_ms + follow_up.timing_ms,
            tool_result=follow_up,
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

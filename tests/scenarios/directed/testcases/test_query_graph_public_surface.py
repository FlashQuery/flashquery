#!/usr/bin/env python3
"""
Test: query_graph public surface — actions and disabled/error envelopes.

Scenario:
    1. Verify graph-disabled query_graph returns canonical unsupported JSON.
    2. Start a graph-enabled server and seed graph rows in the test database.
    3. Exercise every public query_graph action through MCP.
    4. Verify invalid parameter combinations return expected-error envelopes.
    Cleanup is automatic.

Coverage points: D-GR-02, T-S-002
"""
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


TEST_NAME = "test_query_graph_public_surface"


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


def _seed_graph_rows(run_id: str) -> dict[str, str]:
    if psycopg is None:
        raise RuntimeError("psycopg is required for graph scenario verification")
    with psycopg.connect(_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT instance_id
                FROM fqc_documents
                ORDER BY created_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("No document exists to infer the managed test instance_id")
            instance_id = str(row[0])

            chunks: dict[str, str] = {}
            for name in ("Alpha", "Beta", "Gamma"):
                cur.execute(
                    """
                    INSERT INTO fqc_documents (id, instance_id, path, title, tags, status)
                    VALUES (gen_random_uuid(), %s, %s, %s, ARRAY['graph'], 'active')
                    RETURNING id
                    """,
                    (instance_id, f"_test/{run_id}_{name}.md", name),
                )
                document_id = cur.fetchone()[0]
                cur.execute(
                    """
                    INSERT INTO fqc_chunks (
                      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
                      content, content_hash, chunk_index
                    )
                    VALUES (gen_random_uuid(), %s, %s, %s, 1, %s, %s, md5(%s), 0)
                    RETURNING id::text
                    """,
                    (instance_id, document_id, name, name, f"{name} content {run_id}", name),
                )
                chunks[name] = str(cur.fetchone()[0])

            cur.execute(
                """
                INSERT INTO fqc_graph_nodes (
                  chunk_id, instance_id, provenance_basis, community_id, community_label, community_summary
                )
                VALUES
                  (%s, %s, 'source:alpha', 'comm-surface', 'Surface Cluster', 'Seeded public surface community'),
                  (%s, %s, NULL, 'comm-surface', 'Surface Cluster', 'Seeded public surface community'),
                  (%s, %s, 'source:gamma', NULL, NULL, NULL)
                """,
                (chunks["Alpha"], instance_id, chunks["Beta"], instance_id, chunks["Gamma"], instance_id),
            )
            cur.execute(
                """
                INSERT INTO fqc_graph_edges (
                  instance_id, source_chunk_id, target_chunk_id, relation,
                  confidence, confidence_score, reasoning, model, status
                )
                VALUES
                  (%s, %s, %s, 'references', 'EXTRACTED', 1.0, NULL, NULL, 'active'),
                  (%s, %s, %s, 'supports', 'INFERRED', 0.44, 'weak support', 'mock', 'active'),
                  (%s, %s, %s, 'contradicts', 'INFERRED', 0.81, 'stale contradiction', 'mock', 'stale')
                """,
                (
                    instance_id, chunks["Alpha"], chunks["Beta"],
                    instance_id, chunks["Beta"], chunks["Gamma"],
                    instance_id, chunks["Gamma"], chunks["Alpha"],
                ),
            )
            conn.commit()
            return chunks


def _call_action(ctx: TestContext, action: str, **params: Any) -> tuple[bool, dict[str, Any], Any]:
    result = ctx.client.call_tool("query_graph", action=action, **params)
    payload = _payload(result)
    return result.ok and payload.get("ok") is True and payload.get("action") == action, payload, result


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as disabled_ctx:
        disabled = disabled_ctx.client.call_tool("query_graph", action="schema")
        disabled_payload = _payload(disabled)
        run.step(
            "graph-disabled query_graph returns unsupported expected error",
            passed=disabled.ok and disabled_payload.get("error") == "unsupported" and disabled_payload.get("details", {}).get("code") == "graph_disabled",
            detail=expectation_detail(disabled) or disabled.error or json.dumps(disabled_payload, sort_keys=True),
            timing_ms=disabled.timing_ms,
            tool_result=disabled,
        )
        if disabled_ctx.server:
            run.attach_server_logs(disabled_ctx.server.captured_logs)

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=_graph_config(),
    ) as ctx:
        marker = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=f"_test/query_graph_marker_{run.run_id}.md",
            title=f"Query Graph Marker {run.run_id}",
            content=f"# Query Graph Marker {run.run_id}\n",
            tags=["fqc-test", run.run_id],
        )
        marker_payload = _payload(marker)
        marker_id = str(marker_payload.get("fq_id") or "")
        if marker_id:
            ctx.cleanup.track_mcp_document(marker_id)
            ctx.cleanup.track_file(f"_test/query_graph_marker_{run.run_id}.md")
            ctx.cleanup.track_dir("_test")
        run.step(
            "create marker document for managed graph instance",
            passed=marker.ok and bool(marker_id),
            detail=expectation_detail(marker) or marker.error or json.dumps(marker_payload, sort_keys=True),
            timing_ms=marker.timing_ms,
            tool_result=marker,
        )
        if not marker_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        try:
            chunks = _seed_graph_rows(run.run_id)
            run.step("seed graph rows for public action checks", passed=True, detail=json.dumps(chunks, sort_keys=True))
        except Exception as exc:
            run.step("seed graph rows for public action checks", passed=False, detail=f"Exception: {exc}")
            run.record_cleanup(ctx.cleanup_errors)
            return run

        action_specs = [
            ("node", {"chunk_id": chunks["Alpha"]}),
            ("edges", {"chunk_id": chunks["Alpha"], "include_stale": True}),
            ("neighbors", {"chunk_id": chunks["Alpha"], "max_depth": 1}),
            ("path", {"from": chunks["Alpha"], "to": chunks["Gamma"], "max_hops": 2}),
            ("subgraph", {"chunk_id": chunks["Alpha"], "max_depth": 2}),
            ("stats", {}),
            ("schema", {}),
            ("contradictions", {"include_resolved": True}),
            ("impact", {"chunk_id": chunks["Alpha"], "max_depth": 2}),
            ("provenance_chain", {"chunk_id": chunks["Gamma"], "max_depth": 2}),
            ("weak_paths", {"confidence_threshold": 0.5}),
            ("ungrounded_edges", {}),
            ("community_for", {"chunk_id": chunks["Alpha"]}),
            ("community_members", {"community_id": "comm-surface"}),
            ("list_communities", {"min_members": 2}),
        ]
        action_results: dict[str, Any] = {}
        raw_results: list[Any] = []
        for action, params in action_specs:
            ok, payload, result = _call_action(ctx, action, **params)
            action_results[action] = {"ok": ok, "payload": payload}
            raw_results.append(result)

        all_actions_ok = all(entry["ok"] for entry in action_results.values())
        data_checks = {
            "community_for populated": action_results["community_for"]["payload"].get("data", {}).get("community", {}).get("community_id") == "comm-surface",
            "weak_paths populated": len(action_results["weak_paths"]["payload"].get("data", {}).get("edges", [])) >= 1,
            "schema has relations": len(action_results["schema"]["payload"].get("data", {}).get("relations", [])) >= 1,
        }
        run.step(
            "all public query_graph actions return success envelopes",
            passed=all_actions_ok and all(data_checks.values()),
            detail="" if all_actions_ok and all(data_checks.values()) else json.dumps({"actions": action_results, "checks": data_checks}, sort_keys=True),
            timing_ms=sum(getattr(result, "timing_ms", 0) for result in raw_results),
        )

        invalid = ctx.client.call_tool("query_graph", action="neighbors")
        invalid_payload = _payload(invalid)
        run.step(
            "invalid query_graph parameters return expected-error envelope",
            passed=invalid.ok and invalid_payload.get("error") == "invalid_input" and invalid_payload.get("details", {}).get("code") == "graph_missing_parameter",
            detail=expectation_detail(invalid) or invalid.error or json.dumps(invalid_payload, sort_keys=True),
            timing_ms=invalid.timing_ms,
            tool_result=invalid,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: query_graph public surface actions and disabled/error envelopes.",
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

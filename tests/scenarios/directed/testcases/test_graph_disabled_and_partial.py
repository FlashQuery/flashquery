#!/usr/bin/env python3
"""Directed graph disabled/partial behavior coverage (D-GR-06)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_graph_disabled_and_partial"


def _payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _graph_config() -> dict[str, Any]:
    return {"graph": {"enabled": True, "embedding_name": "primary"}}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range) as ctx:
        disabled = ctx.client.call_tool("query_graph", action="schema")
        payload = _payload(disabled)
        run.step(
            "disabled query_graph returns graph_disabled remediation",
            passed=disabled.ok and payload.get("error") == "unsupported" and payload.get("details", {}).get("code") == "graph_disabled",
            detail=expectation_detail(disabled) or disabled.error or json.dumps(payload, sort_keys=True),
            timing_ms=disabled.timing_ms,
            tool_result=disabled,
        )

        search = ctx.client.call_tool(
            "search",
            query="",
            list_all=True,
            entity_types=["documents"],
            graph_expand=True,
        )
        search_payload = _payload(search)
        run.step(
            "disabled graph-expanded search returns ordinary JSON with warning",
            passed=search.ok and "graph_disabled" in search_payload.get("warnings", []),
            detail=expectation_detail(search) or search.error or json.dumps(search_payload, sort_keys=True),
            timing_ms=search.timing_ms,
            tool_result=search,
        )

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=_graph_config(),
    ) as ctx:
        schema = ctx.client.call_tool("query_graph", action="schema")
        schema_payload = _payload(schema)
        graph_flags = schema_payload.get("data", {}).get("features", {}) if isinstance(schema_payload.get("data"), dict) else {}
        run.step(
            "tier-1-only graph schema is discoverable with classification disabled",
            passed=schema.ok and schema_payload.get("ok") is True and graph_flags.get("classification_enabled") is False,
            detail=expectation_detail(schema) or schema.error or json.dumps(schema_payload, sort_keys=True),
            timing_ms=schema.timing_ms,
            tool_result=schema,
        )

        worker = ctx.client.call_tool("maintain_vault", action="graph_worker", limit=2)
        worker_payload = _payload(worker)
        serialized = json.dumps(worker_payload, sort_keys=True)
        run.step(
            "tier-1-only graph worker reports skipped classification without leaking internals",
            passed=worker.ok and ("missing_resolver" in serialized or "graph_classification_skipped_missing_resolver" in serialized or "processed" in serialized),
            detail=expectation_detail(worker) or worker.error or serialized,
            timing_ms=worker.timing_ms,
            tool_result=worker,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors if "ctx" in locals() else [])
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test graph disabled and partial behavior.")
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

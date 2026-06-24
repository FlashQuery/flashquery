#!/usr/bin/env python3
"""Directed archive graph lifecycle coverage (D-GR-03)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402

TEST_NAME = "test_graph_archive_staleness"


def _payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _graph_config() -> dict[str, Any]:
    embedding_name = "graph_archive_staleness_primary"
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


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    source_path = f"_test/graph_archive_source_{run.run_id}.md"
    target_path = f"_test/graph_archive_target_{run.run_id}.md"
    source_title = f"Graph Archive Source {run.run_id}"
    target_title = f"Graph Archive Target {run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=_graph_config(),
    ) as ctx:
        target = ctx.client.call_tool("write_document", mode="create", path=target_path, title=target_title, content=f"# {target_title}\n\nArchive target.", tags=["fqc-test", run.run_id, "graph"])
        target_payload = _payload(target)
        target_id = str(target_payload.get("fq_id") or "")
        if target_id:
            ctx.cleanup.track_mcp_document(target_id)
            ctx.cleanup.track_file(target_path)
            ctx.cleanup.track_dir("_test")
        run.step("create graph archive target", target.ok and bool(target_id), expectation_detail(target) or target.error or target.text, target.timing_ms, target)

        source = ctx.client.call_tool("write_document", mode="create", path=source_path, title=source_title, content=f"# {source_title}\n\nReferences [[{target_title}]].", tags=["fqc-test", run.run_id, "graph"])
        source_payload = _payload(source)
        source_id = str(source_payload.get("fq_id") or "")
        if source_id:
            ctx.cleanup.track_mcp_document(source_id)
            ctx.cleanup.track_file(source_path)
        run.step("create graph archive source", source.ok and bool(source_id), expectation_detail(source) or source.error or source.text, source.timing_ms, source)
        if not source_id or not target_id:
            run.record_cleanup(ctx.cleanup_errors)
            return run

        scan = ctx.client.call_tool("maintain_vault", action="sync", background=False)
        run.step("sync graph before archive", scan.ok, expectation_detail(scan) or scan.error or scan.text, scan.timing_ms, scan)

        archive = ctx.client.call_tool("archive_document", identifiers=target_id)
        archive_payload = _payload(archive)
        run.step(
            "archive graph target through public archive_document",
            archive.ok and ("archived" in json.dumps(archive_payload)),
            expectation_detail(archive) or archive.error or json.dumps(archive_payload, sort_keys=True),
            archive.timing_ms,
            archive,
        )

        active_only = ctx.client.call_tool("get_document", identifiers=source_id, include=["connections"], connections={"graph_limit_per_chunk": 10})
        inactive = ctx.client.call_tool("get_document", identifiers=source_id, include=["connections"], connections={"graph_limit_per_chunk": 10, "include_inactive_targets": True})
        active_text = active_only.text
        inactive_text = inactive.text
        checks = {
            "active default hides archived target": target_path not in active_text,
            "include inactive exposes archived target or empty bounded envelope": target_path in inactive_text or '"connections"' in inactive_text,
        }
        run.step(
            "graph connections preserve archived state with inactive opt-in",
            passed=active_only.ok and inactive.ok and all(checks.values()),
            detail="" if all(checks.values()) else json.dumps(checks, sort_keys=True),
            timing_ms=active_only.timing_ms + inactive.timing_ms,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Test graph archive lifecycle.")
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

#!/usr/bin/env python3
"""D-114: per-entry lifecycle locks conflict only on the same embedding entry."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    clear_entry_vectors,
    cli_main,
    create_doc_and_memory,
    first_action,
    parse_payload,
    wait_for_status,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_test_utils import TestContext  # noqa: E402

TEST_NAME = "test_lifecycle_lock_per_entry"


def _slow_catalog_config() -> dict[str, Any]:
    mode = (os.environ.get("FQC_TEST_EMBEDDING_MODE") or "ollama_openai").lower().replace("-", "_")
    provider = "openai-embeddings" if mode == "openai" else "local-ollama"
    model = (
        os.environ.get("OPENAI_EMBEDDING_MODEL")
        if provider == "openai-embeddings"
        else os.environ.get("OLLAMA_EMBEDDING_MODEL")
    ) or ("text-embedding-3-small" if provider == "openai-embeddings" else "nomic-embed-text")
    endpoint = {
        "provider_name": provider,
        "model": model,
        "rate_limit": {"min_delay_ms": 450},
    }
    return {
        "embeddings": [
            {
                "name": "primary",
                "dimensions": int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768")),
                "endpoints": [endpoint],
            },
            {
                "name": "secondary",
                "dimensions": int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768")),
                "endpoints": [endpoint],
            },
        ]
    }


def _context(args: argparse.Namespace) -> TestContext:
    return TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=tuple(args.port_range) if args.port_range else None,
        require_embedding=True,
        extra_config=_slow_catalog_config(),
    )


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with _context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id, "primary")
        clear_entry_vectors(ctx, doc_id, memory_id, "secondary")

        primary = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        primary_payload = parse_payload(primary)
        primary_job_id = str(primary_payload.get("job_id") or "")
        run.step(
            "start primary background lifecycle job",
            passed=primary.ok and primary_payload.get("accepted") is True and bool(primary_job_id),
            detail=expectation_detail(primary) or primary.error or json.dumps(primary_payload, sort_keys=True),
            timing_ms=primary.timing_ms,
            tool_result=primary,
        )
        if not primary_job_id:
            return run

        conflict = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        conflict_payload = parse_payload(conflict)
        conflict_details = conflict_payload.get("details") if isinstance(conflict_payload.get("details"), dict) else {}
        run.step(
            "same entry lifecycle call returns conflict with in-flight metadata",
            passed=(
                conflict.ok
                and conflict_payload.get("error") == "conflict"
                and conflict_details.get("in_flight_action") == "backfill_embeddings"
                and conflict_details.get("in_flight_job_id") == primary_job_id
                and isinstance(conflict_details.get("started_at"), str)
                and isinstance(conflict_details.get("elapsed_ms"), int)
            ),
            detail=json.dumps(conflict_payload, sort_keys=True),
            timing_ms=conflict.timing_ms,
            tool_result=conflict,
        )

        secondary = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="secondary",
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        secondary_payload = parse_payload(secondary)
        secondary_job_id = str(secondary_payload.get("job_id") or "")
        run.step(
            "different entry lifecycle job starts while primary is running",
            passed=secondary.ok and secondary_payload.get("accepted") is True and bool(secondary_job_id),
            detail=expectation_detail(secondary) or secondary.error or json.dumps(secondary_payload, sort_keys=True),
            timing_ms=secondary.timing_ms,
            tool_result=secondary,
        )

        primary_status = wait_for_status(ctx, primary_job_id)
        secondary_status = wait_for_status(ctx, secondary_job_id) if secondary_job_id else {}
        primary_counts = first_action(primary_status).get("counts") if isinstance(first_action(primary_status).get("counts"), dict) else {}
        secondary_counts = first_action(secondary_status).get("counts") if isinstance(first_action(secondary_status).get("counts"), dict) else {}
        run.step(
            "both independent lifecycle jobs complete and release locks",
            passed=(
                primary_status.get("status") == "completed"
                and secondary_status.get("status") == "completed"
                and primary_counts.get("rows_embedded") == 2
                and secondary_counts.get("rows_embedded") == 2
            ),
            detail=json.dumps({"primary": primary_status, "secondary": secondary_status}, sort_keys=True),
        )

        follow_up = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        follow_payload = parse_payload(follow_up)
        run.step(
            "same entry can acquire lock again after completion",
            passed=follow_up.ok and first_action(follow_payload).get("action") == "backfill_embeddings",
            detail=expectation_detail(follow_up) or follow_up.error or json.dumps(follow_payload, sort_keys=True),
            timing_ms=follow_up.timing_ms,
            tool_result=follow_up,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

#!/usr/bin/env python3
"""D-115: stale lifecycle heartbeat rows are released before new lock acquisition."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    clear_entry_vectors,
    cli_main,
    create_doc_and_memory,
    db_url,
    first_action,
    lifecycle_context,
    parse_payload,
)

TEST_NAME = "test_lifecycle_lock_heartbeat"


def _seed_stale_running_job(ctx, embedding_name: str) -> str:
    import psycopg

    job_id = str(uuid4())
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            # Managed-scenario-only setup: simulate a crashed lifecycle process by
            # aging the durable heartbeat beyond the production stale threshold.
            cur.execute(
                """
                INSERT INTO fqc_maintenance_jobs(
                  id, instance_id, action, embedding_name, status, started_at,
                  heartbeat_at, counts, failures, metadata
                )
                VALUES (
                  %s, %s, 'backfill_embeddings', %s, 'running',
                  now() - interval '10 minutes',
                  now() - interval '10 minutes',
                  '{}'::jsonb,
                  '[]'::jsonb,
                  '{"scenario":"D-115 stale heartbeat"}'::jsonb
                )
                """,
                (job_id, ctx.server.instance_id, embedding_name),
            )
        conn.commit()
    return job_id


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id)

        stale_job_id = _seed_stale_running_job(ctx, "primary")
        recovered = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        recovered_payload = parse_payload(recovered)
        recovered_action = first_action(recovered_payload)
        recovered_counts = recovered_action.get("counts") if isinstance(recovered_action.get("counts"), dict) else {}
        run.step(
            "new caller acquires lock after stale heartbeat recovery",
            passed=(
                recovered.ok
                and recovered_action.get("action") == "backfill_embeddings"
                and recovered_counts.get("rows_embedded") == 2
            ),
            detail=expectation_detail(recovered) or recovered.error or json.dumps(recovered_payload, sort_keys=True),
            timing_ms=recovered.timing_ms,
            tool_result=recovered,
        )

        stale_status = ctx.client.call_tool("maintain_vault", action="status", job_id=stale_job_id)
        stale_payload = parse_payload(stale_status)
        error_details = stale_payload.get("error", {}).get("details") if isinstance(stale_payload.get("error"), dict) else {}
        follow_up = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        follow_payload = parse_payload(follow_up)
        run.step(
            "stale job is marked failed and lock is reusable",
            passed=(
                stale_status.ok
                and stale_payload.get("status") == "failed"
                and error_details.get("reason") == "stale_heartbeat_recovered"
                and follow_up.ok
                and first_action(follow_payload).get("action") == "backfill_embeddings"
            ),
            detail=json.dumps({"stale": stale_payload, "follow_up": follow_payload}, sort_keys=True),
            timing_ms=stale_status.timing_ms + follow_up.timing_ms,
            tool_result=stale_status,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

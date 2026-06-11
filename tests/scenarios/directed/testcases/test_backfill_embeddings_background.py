#!/usr/bin/env python3
"""D-106: background backfill is accepted and pollable to completion."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    clear_entry_vectors,
    cli_main,
    create_doc_and_memory,
    first_action,
    lifecycle_context,
    parse_payload,
    wait_for_status,
)

TEST_NAME = "test_backfill_embeddings_background"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id)

        accepted = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        accepted_payload = parse_payload(accepted)
        job_id = str(accepted_payload.get("job_id") or "")
        run.step(
            "background backfill returns accepted job",
            passed=accepted.ok and accepted_payload.get("accepted") is True and bool(job_id),
            detail=expectation_detail(accepted) or accepted.error or json.dumps(accepted_payload, sort_keys=True),
            timing_ms=accepted.timing_ms,
            tool_result=accepted,
        )
        if not job_id:
            return run

        status_payload = wait_for_status(ctx, job_id)
        action = first_action(status_payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        run.step(
            "background status completes with embedded counts",
            passed=status_payload.get("status") == "completed" and counts.get("rows_embedded") == 2,
            detail=json.dumps(status_payload, sort_keys=True),
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

#!/usr/bin/env python3
"""D-117: abort returns expected errors for unknown and non-running jobs."""
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
    first_action,
    lifecycle_context,
    parse_payload,
    wait_for_status,
)

TEST_NAME = "test_abort_unknown_job"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        unknown_id = str(uuid4())
        unknown = ctx.client.call_tool("maintain_vault", action="abort", job_id=unknown_id)
        unknown_payload = parse_payload(unknown)
        run.step(
            "abort unknown lifecycle job returns not_found",
            passed=unknown.ok and unknown_payload.get("error") == "not_found" and unknown_payload.get("identifier") == unknown_id,
            detail=json.dumps(unknown_payload, sort_keys=True),
            timing_ms=unknown.timing_ms,
            tool_result=unknown,
        )

        invalid = ctx.client.call_tool("maintain_vault", action="abort", job_id=unknown_id, embedding_name="primary")
        invalid_payload = parse_payload(invalid)
        invalid_details = invalid_payload.get("details") if isinstance(invalid_payload.get("details"), dict) else {}
        run.step(
            "abort rejects embedding-specific parameters before job lookup",
            passed=(
                invalid.ok
                and invalid_payload.get("error") == "invalid_input"
                and invalid_details.get("parameter") == "embedding_name"
            ),
            detail=json.dumps(invalid_payload, sort_keys=True),
            timing_ms=invalid.timing_ms,
            tool_result=invalid,
        )

        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id)
        started = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        started_payload = parse_payload(started)
        job_id = str(started_payload.get("job_id") or "")
        completed_status = wait_for_status(ctx, job_id) if job_id else {}
        completed_abort = ctx.client.call_tool("maintain_vault", action="abort", job_id=job_id)
        completed_payload = parse_payload(completed_abort)
        completed_details = completed_payload.get("details") if isinstance(completed_payload.get("details"), dict) else {}
        run.step(
            "abort completed lifecycle job returns unsupported",
            passed=(
                started.ok
                and completed_status.get("status") == "completed"
                and completed_abort.ok
                and completed_payload.get("error") == "unsupported"
                and completed_details.get("status") == "completed"
            ),
            detail=json.dumps(
                {"started": started_payload, "status": completed_status, "abort": completed_payload},
                sort_keys=True,
            ),
            timing_ms=started.timing_ms + completed_abort.timing_ms,
            tool_result=completed_abort,
        )

        clear_entry_vectors(ctx, doc_id, memory_id)
        second = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        second_payload = parse_payload(second)
        second_job_id = str(second_payload.get("job_id") or "")
        abort_once = ctx.client.call_tool("maintain_vault", action="abort", job_id=second_job_id)
        abort_once_payload = parse_payload(abort_once)
        abort_twice = ctx.client.call_tool("maintain_vault", action="abort", job_id=second_job_id)
        abort_twice_payload = parse_payload(abort_twice)
        abort_twice_details = abort_twice_payload.get("details") if isinstance(abort_twice_payload.get("details"), dict) else {}
        run.step(
            "abort already-aborted lifecycle job returns unsupported",
            passed=(
                second.ok
                and abort_once.ok
                and abort_once_payload.get("status") == "aborted"
                and abort_twice.ok
                and abort_twice_payload.get("error") == "unsupported"
                and abort_twice_details.get("status") == "aborted"
            ),
            detail=json.dumps(
                {"started": second_payload, "first_abort": abort_once_payload, "second_abort": abort_twice_payload},
                sort_keys=True,
            ),
            timing_ms=second.timing_ms + abort_once.timing_ms + abort_twice.timing_ms,
            tool_result=abort_twice,
        )

        final_status = ctx.client.call_tool("maintain_vault", action="status", job_id=second_job_id)
        final_payload = parse_payload(final_status)
        run.step(
            "already-aborted job remains pollable as aborted",
            passed=final_status.ok and final_payload.get("status") == "aborted" and first_action(final_payload).get("action") == "backfill_embeddings",
            detail=expectation_detail(final_status) or final_status.error or json.dumps(final_payload, sort_keys=True),
            timing_ms=final_status.timing_ms,
            tool_result=final_status,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

#!/usr/bin/env python3
"""D-105: backfill_embeddings dry-run reports estimates and leaves stamps unchanged."""
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
    read_stamp_models,
)

TEST_NAME = "test_backfill_embeddings_dry_run"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id)
        before = read_stamp_models(ctx, doc_id, memory_id)

        result = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            dry_run=True,
        )
        payload = parse_payload(result)
        action = first_action(payload)
        estimated = action.get("estimated") if isinstance(action.get("estimated"), dict) else {}
        after = read_stamp_models(ctx, doc_id, memory_id)
        run.step(
            "dry-run has estimates and no vector side effects",
            passed=(
                result.ok
                and action.get("would_process") == 2
                and isinstance(estimated.get("input_tokens"), int)
                and estimated.get("cost_usd") is None
                and isinstance(estimated.get("wall_time_seconds"), int)
                and estimated.get("cost_basis") == "unavailable_provider_pricing_metadata"
                and before == after == [None, None]
            ),
            detail=expectation_detail(result) or result.error or json.dumps(payload, sort_keys=True),
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

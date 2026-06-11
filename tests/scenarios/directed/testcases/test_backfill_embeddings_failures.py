#!/usr/bin/env python3
"""D-107: backfill row/provider failures are reported in failures[]."""
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
)

TEST_NAME = "test_backfill_embeddings_failures"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args, model="definitely-missing-lifecycle-model") as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        clear_entry_vectors(ctx, doc_id, memory_id)

        result = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        payload = parse_payload(result)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        failures = action.get("failures") if isinstance(action.get("failures"), list) else []
        run.step(
            "failed provider calls populate row failures",
            passed=(
                result.ok
                and counts.get("rows_failed") == 2
                and len(failures) == 2
                and all("entity_type" in item and "identifier" in item and "error" in item for item in failures)
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

#!/usr/bin/env python3
"""D-108: rebuild_embeddings stale_only regenerates only stale stamped rows."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    create_doc_and_memory,
    first_action,
    lifecycle_context,
    parse_payload,
    read_stamp_models,
    stamp_stale_vectors,
)

TEST_NAME = "test_rebuild_embeddings_stale_only"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, run.run_id)
        if not doc_id or not memory_id:
            return run
        stamp_stale_vectors(ctx, doc_id, memory_id)

        result = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            embedding_name="primary",
            confirm="primary",
            max_rows=10,
            stale_only=True,
            scope={"entity_types": ["documents", "memory"]},
        )
        payload = parse_payload(result)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        models = read_stamp_models(ctx, doc_id, memory_id)
        run.step(
            "stale_only rebuild restamps stale rows",
            passed=(
                result.ok
                and counts.get("rows_examined") == 2
                and counts.get("rows_embedded") == 2
                and all(model and model != "stale-model" for model in models)
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

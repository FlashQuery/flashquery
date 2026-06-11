#!/usr/bin/env python3
"""D-116: background lifecycle rebuild can be aborted and releases its lock."""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
import sys
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    create_doc_and_memory,
    db_url,
    first_action,
    parse_payload,
    stamp_stale_vectors,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_test_utils import TestContext  # noqa: E402

TEST_NAME = "test_abort_background_job"


def _slow_catalog_config() -> dict[str, Any]:
    mode = (os.environ.get("FQC_TEST_EMBEDDING_MODE") or "ollama_openai").lower().replace("-", "_")
    provider = "openai-embeddings" if mode == "openai" else "local-ollama"
    model = (
        os.environ.get("OPENAI_EMBEDDING_MODEL")
        if provider == "openai-embeddings"
        else os.environ.get("OLLAMA_EMBEDDING_MODEL")
    ) or ("text-embedding-3-small" if provider == "openai-embeddings" else "nomic-embed-text")
    return {
        "embeddings": [
            {
                "name": "primary",
                "dimensions": int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768")),
                "endpoints": [
                    {
                        "provider_name": provider,
                        "model": model,
                        "rate_limit": {"min_delay_ms": 450},
                    }
                ],
            }
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


def _read_models(ctx, doc_ids: list[str], memory_ids: list[str]) -> list[str | None]:
    import psycopg

    models: list[str | None] = []
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            for table, ids in (("fqc_documents", doc_ids), ("fqc_memory", memory_ids)):
                for row_id in ids:
                    cur.execute(f"SELECT embedding_primary_model FROM {table} WHERE id = %s", (row_id,))
                    row = cur.fetchone()
                    models.append(row[0] if row else None)
    return models


def _wait_until_progress(ctx, job_id: str, timeout_s: int = 45) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last_payload: dict[str, Any] = {}
    while time.time() < deadline:
        result = ctx.client.call_tool("maintain_vault", action="status", job_id=job_id)
        payload = parse_payload(result)
        last_payload = payload
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        if payload.get("status") != "running":
            return payload
        if int(counts.get("rows_embedded") or 0) >= 1:
            return payload
        time.sleep(0.5)
    return last_payload


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    with _context(args) as ctx:
        doc_ids: list[str] = []
        memory_ids: list[str] = []
        for index in range(4):
            doc_id, memory_id = create_doc_and_memory(ctx, run, f"{run.run_id}-{index}")
            if not doc_id or not memory_id:
                return run
            doc_ids.append(doc_id)
            memory_ids.append(memory_id)
            stamp_stale_vectors(ctx, doc_id, memory_id)

        before_models = _read_models(ctx, doc_ids, memory_ids)
        started = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            embedding_name="primary",
            confirm="primary",
            max_rows=20,
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        started_payload = parse_payload(started)
        job_id = str(started_payload.get("job_id") or "")
        run.step(
            "start background rebuild job",
            passed=started.ok and started_payload.get("accepted") is True and bool(job_id),
            detail=expectation_detail(started) or started.error or json.dumps(started_payload, sort_keys=True),
            timing_ms=started.timing_ms,
            tool_result=started,
        )
        if not job_id:
            return run

        progress_payload = _wait_until_progress(ctx, job_id)
        progress_action = first_action(progress_payload)
        progress_counts = progress_action.get("counts") if isinstance(progress_action.get("counts"), dict) else {}
        run.step(
            "background rebuild reports partial progress before abort",
            passed=progress_payload.get("status") == "running" and int(progress_counts.get("rows_embedded") or 0) >= 1,
            detail=json.dumps(progress_payload, sort_keys=True),
        )

        aborted = ctx.client.call_tool("maintain_vault", action="abort", job_id=job_id)
        aborted_payload = parse_payload(aborted)
        aborted_action = first_action(aborted_payload)
        aborted_counts = aborted_action.get("counts") if isinstance(aborted_action.get("counts"), dict) else {}
        run.step(
            "abort returns aborted status with readable partial counts",
            passed=(
                aborted.ok
                and aborted_payload.get("status") == "aborted"
                and aborted_counts.get("rows_examined") == 8
                and int(aborted_counts.get("rows_embedded") or 0) >= 1
                and int(aborted_counts.get("rows_embedded") or 0) < 8
                and isinstance(aborted_payload.get("abort_requested_at"), str)
            ),
            detail=expectation_detail(aborted) or aborted.error or json.dumps(aborted_payload, sort_keys=True),
            timing_ms=aborted.timing_ms,
            tool_result=aborted,
        )

        status = ctx.client.call_tool("maintain_vault", action="status", job_id=job_id)
        status_payload = parse_payload(status)
        status_counts = first_action(status_payload).get("counts") if isinstance(first_action(status_payload).get("counts"), dict) else {}
        after_models = _read_models(ctx, doc_ids, memory_ids)
        restamped = sum(1 for model in after_models if model and model != "stale-model")
        still_stale = sum(1 for model in after_models if model == "stale-model")
        run.step(
            "status stays aborted and completed row stamps remain without rollback",
            passed=(
                status.ok
                and status_payload.get("status") == "aborted"
                and status_counts.get("rows_examined") == 8
                and restamped >= int(status_counts.get("rows_embedded") or 0) >= 1
                and still_stale >= 1
                and all(model == "stale-model" for model in before_models)
            ),
            detail=json.dumps(
                {
                    "status": status_payload,
                    "before_models": before_models,
                    "after_models": after_models,
                    "restamped": restamped,
                    "still_stale": still_stale,
                },
                sort_keys=True,
            ),
            timing_ms=status.timing_ms,
            tool_result=status,
        )

        follow_up = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            embedding_name="primary",
            confirm="primary",
            max_rows=20,
            scope={"entity_types": ["documents", "memory"]},
            background=True,
        )
        follow_payload = parse_payload(follow_up)
        follow_job_id = str(follow_payload.get("job_id") or "")
        if follow_job_id:
            ctx.client.call_tool("maintain_vault", action="abort", job_id=follow_job_id)
        run.step(
            "follow-up lifecycle action acquires lock after abort",
            passed=follow_up.ok and follow_payload.get("accepted") is True and bool(follow_job_id),
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

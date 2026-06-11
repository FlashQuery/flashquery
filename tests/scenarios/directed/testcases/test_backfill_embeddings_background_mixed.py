#!/usr/bin/env python3
"""D-106/D-119: background mixed backfill supports core plus records scope."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    clear_entry_vectors,
    cli_main,
    create_doc_and_memory,
    db_url,
    first_action,
    parse_payload,
    plugin_yaml,
    register_plugin,
    retire_test_context,
    wait_for_status,
)

TEST_NAME = "test_backfill_embeddings_background_mixed"


def _write_note(ctx, plugin_id: str, title: str):
    return ctx.client.call_tool(
        "write_record",
        mode="create",
        plugin_id=plugin_id,
        plugin_instance="default",
        table="notes",
        data={"title": title, "body": f"Body for {title}"},
        include=["data"],
    )


def _clear_record_vector(ctx, table: str, record_id: str, embedding_name: str) -> None:
    import psycopg

    base = f"embedding_{embedding_name}"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE "{table}"
                SET "{base}" = NULL,
                    "{base}_model" = NULL,
                    "{base}_dimensions" = NULL,
                    "{base}_provider" = NULL,
                    "{base}_truncated" = NULL
                WHERE id = %s
                """,
                (record_id,),
            )
        conn.commit()


def _record_model(ctx, table: str, record_id: str, embedding_name: str) -> str | None:
    import psycopg

    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT "embedding_{embedding_name}_model" FROM "{table}" WHERE id = %s',
                (record_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


def _core_models(ctx, doc_id: str, memory_id: str, embedding_name: str) -> list[str | None]:
    import psycopg

    column = f"embedding_{embedding_name}_model"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            values: list[str | None] = []
            for table, row_id in (("fqc_documents", doc_id), ("fqc_memory", memory_id)):
                cur.execute(f'SELECT "{column}" FROM "{table}" WHERE id = %s', (row_id,))
                row = cur.fetchone()
                values.append(row[0] if row else None)
            return values


def _running_jobs(ctx) -> int:
    import psycopg

    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT count(*) FROM fqc_maintenance_jobs
                WHERE instance_id = %s AND status = 'running'
                """,
                (ctx.server.instance_id,),
            )
            return int(cur.fetchone()[0])


def _wait_for_record_model(ctx, table: str, record_id: str, embedding_name: str, timeout_s: int = 60) -> str | None:
    deadline = time.time() + timeout_s
    last: str | None = None
    while time.time() < deadline:
        last = _record_model(ctx, table, record_id, embedding_name)
        if last:
            return last
        time.sleep(1)
    return last


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    suffix = run.run_id.replace("-", "_")
    plugin_id = f"background_mixed_{suffix}"
    table = f"fqcp_{plugin_id}_default_notes"

    with retire_test_context(args, [{"name": "primary"}, {"name": "secondary"}]) as ctx:
        registered = register_plugin(ctx, plugin_id, plugin_yaml(plugin_id, "*"), "primary")
        run.step(
            "register primary records plugin",
            passed=registered.ok,
            detail=expectation_detail(registered) or registered.error or registered.text,
            timing_ms=registered.timing_ms,
            tool_result=registered,
        )
        if not registered.ok:
            return run

        doc_id, memory_id = create_doc_and_memory(ctx, run, suffix)
        if not doc_id or not memory_id:
            return run

        note = _write_note(ctx, plugin_id, f"background mixed {suffix}")
        note_payload = parse_payload(note)
        record_id = str(note_payload.get("id") or "")
        run.step(
            "write primary plugin record",
            passed=note.ok and bool(record_id),
            detail=expectation_detail(note) or note.error or json.dumps(note_payload, sort_keys=True),
            timing_ms=note.timing_ms,
            tool_result=note,
        )
        if not record_id:
            return run

        clear_entry_vectors(ctx, doc_id, memory_id, "secondary")
        _clear_record_vector(ctx, table, record_id, "primary")

        refused = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="secondary",
            scope={"entity_types": ["documents", "memory", "records"], "records": {"plugin": plugin_id}},
            background=True,
            max_rows=2,
        )
        refused_payload = parse_payload(refused)
        refused_details = refused_payload.get("details") if isinstance(refused_payload.get("details"), dict) else {}
        run.step(
            "background mixed backfill enforces combined max_rows before creating jobs",
            passed=(
                refused.ok
                and refused_payload.get("error") == "invalid_input"
                and refused_details.get("rows_in_scope") == 3
                and _running_jobs(ctx) == 0
            ),
            detail=json.dumps(
                {"payload": refused_payload, "running_jobs": _running_jobs(ctx)},
                sort_keys=True,
            ),
            timing_ms=refused.timing_ms,
            tool_result=refused,
        )

        accepted = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="secondary",
            scope={"entity_types": ["documents", "memory", "records"], "records": {"plugin": plugin_id}},
            background=True,
            max_rows=0,
        )
        accepted_payload = parse_payload(accepted)
        job_id = str(accepted_payload.get("job_id") or "")
        run.step(
            "background mixed backfill returns accepted core job",
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
        record_model = _wait_for_record_model(ctx, table, record_id, "primary")
        core_models = _core_models(ctx, doc_id, memory_id, "secondary")
        run.step(
            "background mixed status completes and populates core plus records embeddings",
            passed=(
                status_payload.get("status") == "completed"
                and counts.get("rows_embedded") >= 2
                and all(model for model in core_models)
                and bool(record_model)
            ),
            detail=json.dumps(
                {"status": status_payload, "core_models": core_models, "record_model": record_model},
                sort_keys=True,
            ),
        )
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

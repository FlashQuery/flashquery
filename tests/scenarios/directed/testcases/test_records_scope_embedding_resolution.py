#!/usr/bin/env python3
"""D-118: records-scope lifecycle resolution uses frozen plugin choices."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    cli_main,
    db_url,
    first_action,
    lifecycle_context,
    parse_payload,
    plugin_yaml,
    register_plugin,
)

TEST_NAME = "test_records_scope_embedding_resolution"
EXPECTED_MESSAGE = "plugin embedding choice is per-registration, not per-action; use `register_plugin` to change the choice"


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


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail

    run = TestRun(TEST_NAME)
    suffix = run.run_id.replace("-", "_")
    active_plugin = f"records_resolution_{suffix}"
    opted_out_plugin = f"records_optout_{suffix}"
    active_table = f"fqcp_{active_plugin}_default_notes"

    with lifecycle_context(args) as ctx:
        registered = register_plugin(ctx, active_plugin, plugin_yaml(active_plugin, "*"), "primary")
        run.step(
            "register plugin with frozen primary embedding",
            passed=registered.ok,
            detail=expectation_detail(registered) or registered.error or registered.text,
            timing_ms=registered.timing_ms,
            tool_result=registered,
        )
        if not registered.ok:
            return run

        opted = register_plugin(ctx, opted_out_plugin, plugin_yaml(opted_out_plugin, None), None)
        run.step(
            "register opted-out plugin",
            passed=opted.ok,
            detail=expectation_detail(opted) or opted.error or opted.text,
            timing_ms=opted.timing_ms,
            tool_result=opted,
        )
        if not opted.ok:
            return run

        active_note = _write_note(ctx, active_plugin, f"active {suffix}")
        active_payload = parse_payload(active_note)
        active_id = str(active_payload.get("id") or "")
        run.step(
            "write record for frozen embedding plugin",
            passed=active_note.ok and bool(active_id),
            detail=expectation_detail(active_note) or active_note.error or json.dumps(active_payload, sort_keys=True),
            timing_ms=active_note.timing_ms,
            tool_result=active_note,
        )
        if not active_id:
            return run

        opted_note = _write_note(ctx, opted_out_plugin, f"opted {suffix}")
        opted_payload = parse_payload(opted_note)
        run.step(
            "write record for opted-out plugin",
            passed=opted_note.ok and bool(opted_payload.get("id")),
            detail=expectation_detail(opted_note) or opted_note.error or json.dumps(opted_payload, sort_keys=True),
            timing_ms=opted_note.timing_ms,
            tool_result=opted_note,
        )
        if not opted_note.ok:
            return run

        _clear_record_vector(ctx, active_table, active_id, "primary")

        rejected = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["records"]},
        )
        rejected_payload = parse_payload(rejected)
        run.step(
            "pure records scope rejects top-level embedding_name",
            passed=(
                rejected.ok
                and rejected_payload.get("error") == "invalid_input"
                and rejected_payload.get("message") == EXPECTED_MESSAGE
            ),
            detail=expectation_detail(rejected) or rejected.error or json.dumps(rejected_payload, sort_keys=True),
            timing_ms=rejected.timing_ms,
            tool_result=rejected,
        )

        result = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            scope={"entity_types": ["records"]},
            max_rows=0,
        )
        payload = parse_payload(result)
        action = first_action(payload)
        counts = action.get("counts") if isinstance(action.get("counts"), dict) else {}
        model = _record_model(ctx, active_table, active_id, "primary")
        run.step(
            "records backfill uses frozen choices and skips opted-out plugin rows",
            passed=(
                result.ok
                and counts.get("rows_embedded", 0) >= 1
                and counts.get("rows_failed") == 0
                and counts.get("rows_skipped_no_embedding", 0) >= 1
                and bool(model)
            ),
            detail=expectation_detail(result) or result.error or json.dumps({"payload": payload, "model": model}, sort_keys=True),
            timing_ms=result.timing_ms,
            tool_result=result,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

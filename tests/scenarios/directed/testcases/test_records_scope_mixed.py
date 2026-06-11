#!/usr/bin/env python3
"""D-119: mixed lifecycle scope uses top-level entry for core and frozen entries for records."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lifecycle_embedding_scenario_helpers import (  # noqa: E402
    clear_entry_vectors,
    cli_main,
    create_doc_and_memory,
    db_url,
    first_action,
    parse_payload,
    plugin_yaml,
    read_stamp_models,
    register_plugin,
    retire_test_context,
)

TEST_NAME = "test_records_scope_mixed"
MULTI_ENTRY_MESSAGE = "pure records rebuild spans multiple embedding entries; narrow scope.plugin or scope.records.targets so one embedding entry is rebuilt per call"


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


def _stamp_record_vector(ctx, table: str, record_id: str, embedding_name: str, model: str = "stale-model") -> None:
    import psycopg

    dims = int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768"))
    vector = "[" + ",".join(["0.001"] * dims) + "]"
    base = f"embedding_{embedding_name}"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE "{table}"
                SET "{base}" = %s::vector,
                    "{base}_model" = %s,
                    "{base}_dimensions" = %s,
                    "{base}_provider" = 'scenario',
                    "{base}_truncated" = false
                WHERE id = %s
                """,
                (vector, model, dims, record_id),
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
    primary_plugin = f"records_mixed_primary_{suffix}"
    secondary_plugin = f"records_mixed_secondary_{suffix}"
    primary_table = f"fqcp_{primary_plugin}_default_notes"
    secondary_table = f"fqcp_{secondary_plugin}_default_notes"

    with retire_test_context(args, [{"name": "primary"}, {"name": "secondary"}]) as ctx:
        registered_primary = register_plugin(ctx, primary_plugin, plugin_yaml(primary_plugin, "*"), "primary")
        run.step(
            "register primary records plugin",
            passed=registered_primary.ok,
            detail=expectation_detail(registered_primary) or registered_primary.error or registered_primary.text,
            timing_ms=registered_primary.timing_ms,
            tool_result=registered_primary,
        )
        if not registered_primary.ok:
            return run

        doc_id, memory_id = create_doc_and_memory(ctx, run, suffix)
        if not doc_id or not memory_id:
            return run

        note = _write_note(ctx, primary_plugin, f"mixed {suffix}")
        note_payload = parse_payload(note)
        primary_record_id = str(note_payload.get("id") or "")
        run.step(
            "write primary plugin record",
            passed=note.ok and bool(primary_record_id),
            detail=expectation_detail(note) or note.error or json.dumps(note_payload, sort_keys=True),
            timing_ms=note.timing_ms,
            tool_result=note,
        )
        if not primary_record_id:
            return run

        clear_entry_vectors(ctx, doc_id, memory_id, "secondary")
        _clear_record_vector(ctx, primary_table, primary_record_id, "primary")

        mixed = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="secondary",
            scope={"entity_types": ["documents", "memory", "records"]},
            max_rows=0,
        )
        mixed_payload = parse_payload(mixed)
        mixed_action = first_action(mixed_payload)
        counts = mixed_action.get("counts") if isinstance(mixed_action.get("counts"), dict) else {}
        core_models = read_stamp_models(ctx, doc_id, memory_id, "secondary")
        record_model = _record_model(ctx, primary_table, primary_record_id, "primary")
        run.step(
            "mixed backfill applies secondary to core and frozen primary to records",
            passed=(
                mixed.ok
                and counts.get("rows_embedded", 0) >= 3
                and all(model for model in core_models)
                and bool(record_model)
            ),
            detail=expectation_detail(mixed) or mixed.error or json.dumps(
                {"payload": mixed_payload, "core_models": core_models, "record_model": record_model},
                sort_keys=True,
            ),
            timing_ms=mixed.timing_ms,
            tool_result=mixed,
        )

        _stamp_record_vector(ctx, primary_table, primary_record_id, "primary")
        rebuilt = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            scope={"entity_types": ["records"], "records": {"plugin": primary_plugin}},
            max_rows=0,
            confirm="primary",
        )
        rebuilt_payload = parse_payload(rebuilt)
        rebuilt_action = first_action(rebuilt_payload)
        rebuilt_counts = rebuilt_action.get("counts") if isinstance(rebuilt_action.get("counts"), dict) else {}
        rebuilt_model = _record_model(ctx, primary_table, primary_record_id, "primary")
        run.step(
            "pure records rebuild derives single confirm from frozen choice",
            passed=(
                rebuilt.ok
                and rebuilt_counts.get("rows_embedded", 0) >= 1
                and rebuilt_model is not None
                and rebuilt_model != "stale-model"
            ),
            detail=expectation_detail(rebuilt) or rebuilt.error or json.dumps(
                {"payload": rebuilt_payload, "rebuilt_model": rebuilt_model},
                sort_keys=True,
            ),
            timing_ms=rebuilt.timing_ms,
            tool_result=rebuilt,
        )

        registered_secondary = register_plugin(ctx, secondary_plugin, plugin_yaml(secondary_plugin, "*"), "secondary")
        secondary_note = _write_note(ctx, secondary_plugin, f"secondary {suffix}")
        secondary_payload = parse_payload(secondary_note)
        secondary_record_id = str(secondary_payload.get("id") or "")
        _stamp_record_vector(ctx, primary_table, primary_record_id, "primary", "before-multi-primary")
        if secondary_record_id:
            _stamp_record_vector(ctx, secondary_table, secondary_record_id, "secondary", "before-multi-secondary")
        refused = ctx.client.call_tool(
            "maintain_vault",
            action="rebuild_embeddings",
            scope={"entity_types": ["records"]},
            max_rows=0,
            confirm="primary",
        )
        refused_payload = parse_payload(refused)
        details = refused_payload.get("details") if isinstance(refused_payload.get("details"), dict) else {}
        run.step(
            "pure records rebuild spanning multiple entries is refused before mutation",
            passed=(
                registered_secondary.ok
                and secondary_note.ok
                and refused.ok
                and refused_payload.get("error") == "invalid_input"
                and refused_payload.get("message") == MULTI_ENTRY_MESSAGE
                and details.get("resolved_embedding_names") == ["primary", "secondary"]
                and _record_model(ctx, primary_table, primary_record_id, "primary") == "before-multi-primary"
                and (
                    not secondary_record_id
                    or _record_model(ctx, secondary_table, secondary_record_id, "secondary") == "before-multi-secondary"
                )
            ),
            detail=json.dumps(
                {
                    "registered_secondary": parse_payload(registered_secondary),
                    "secondary_note": secondary_payload,
                    "refused": refused_payload,
                },
                sort_keys=True,
            ),
            timing_ms=refused.timing_ms,
            tool_result=refused,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

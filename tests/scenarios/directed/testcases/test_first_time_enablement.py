#!/usr/bin/env python3
"""D-120: first-time embedding enablement recipe validates backfill and semantic search."""
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
    db_url,
    first_action,
    lifecycle_context,
    parse_payload,
    plugin_yaml,
    read_stamp_models,
    register_plugin,
)

TEST_NAME = "test_first_time_enablement"


def run_test(args: argparse.Namespace):
    from fqc_test_utils import TestRun, expectation_detail
    import psycopg

    run = TestRun(TEST_NAME)
    with lifecycle_context(args) as ctx:
        doc_id, memory_id = create_doc_and_memory(ctx, run, f"first-time-{run.run_id}")
        if not doc_id or not memory_id:
            return run

        clear_entry_vectors(ctx, doc_id, memory_id, "primary")

        dry = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
            dry_run=True,
        )
        dry_payload = parse_payload(dry)
        dry_action = first_action(dry_payload)
        run.step(
            "recipe dry-run reports rows before mutation",
            passed=dry.ok and dry_action.get("would_process") == 2,
            detail=expectation_detail(dry) or dry.error or json.dumps(dry_payload, sort_keys=True),
            timing_ms=dry.timing_ms,
            tool_result=dry,
        )

        backfill = ctx.client.call_tool(
            "maintain_vault",
            action="backfill_embeddings",
            embedding_name="primary",
            scope={"entity_types": ["documents", "memory"]},
        )
        backfill_payload = parse_payload(backfill)
        counts = first_action(backfill_payload).get("counts")
        rows_examined = int(counts.get("rows_examined") or 0) if isinstance(counts, dict) else 0
        rows_embedded = int(counts.get("rows_embedded") or 0) if isinstance(counts, dict) else 0
        models = read_stamp_models(ctx, doc_id, memory_id, "primary")
        run.step(
            "recipe backfill populates configured embedding columns",
            passed=(
                backfill.ok
                and isinstance(counts, dict)
                and rows_examined >= 1
                and rows_embedded >= 1
                and all(model for model in models)
            ),
            detail=expectation_detail(backfill) or backfill.error or json.dumps(
                {"payload": backfill_payload, "models": models},
                sort_keys=True,
            ),
            timing_ms=backfill.timing_ms,
            tool_result=backfill,
        )

        search = ctx.client.call_tool(
            "search",
            query=f"Lifecycle document body first-time-{run.run_id}",
            entity_types=["documents", "memories"],
        )
        run.step(
            "recipe semantic search returns enabled document and memory content",
            passed=(
                search.ok
                and "Lifecycle first-time" in search.text
                and "Lifecycle memory body first-time" in search.text
                and "semantic" in search.text
            ),
            detail=expectation_detail(search) or search.error or search.text[:1000],
            timing_ms=search.timing_ms,
            tool_result=search,
        )

        plugin_id = f"first_time_plugin_{run.run_id.replace('-', '_')[:8]}"
        plugin = register_plugin(ctx, plugin_id, plugin_yaml(plugin_id, "primary"), "primary")
        run.step(
            "recipe registers embedding-enabled records plugin",
            passed=plugin.ok,
            detail=expectation_detail(plugin) or plugin.error or plugin.text[:1000],
            timing_ms=plugin.timing_ms,
            tool_result=plugin,
        )
        if plugin.ok:
            record = ctx.client.call_tool(
                "write_record",
                mode="create",
                plugin_id=plugin_id,
                plugin_instance="default",
                table="notes",
                data={
                    "title": f"Lifecycle plugin record first-time-{run.run_id}",
                    "body": "Plugin record body for first-time embedding enablement.",
                },
                include=["data"],
            )
            record_payload = parse_payload(record)
            record_id = str(record_payload.get("id") or record_payload.get("record_id") or "")
            table_name = f"fqcp_{plugin_id}_default_notes"
            if record_id:
                with psycopg.connect(db_url(ctx)) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            f"""
                            UPDATE "{table_name}"
                            SET embedding_primary = NULL,
                                embedding_primary_model = NULL,
                                embedding_primary_dimensions = NULL,
                                embedding_primary_provider = NULL,
                                embedding_primary_truncated = NULL
                            WHERE id = %s
                            """,
                            (record_id,),
                        )
                    conn.commit()
            records_backfill = ctx.client.call_tool(
                "maintain_vault",
                action="backfill_embeddings",
                scope={"entity_types": ["records"], "records": {"plugin": plugin_id}},
            )
            model = None
            if record_id:
                with psycopg.connect(db_url(ctx)) as conn:
                    with conn.cursor() as cur:
                        cur.execute(f'SELECT embedding_primary_model FROM "{table_name}" WHERE id = %s', (record_id,))
                        row = cur.fetchone()
                        model = row[0] if row else None
            run.step(
                "recipe records backfill populates plugin record embedding columns",
                passed=record.ok and records_backfill.ok and bool(model),
                detail=expectation_detail(records_backfill) or records_backfill.error or json.dumps(
                    {"record": record_payload, "model": model, "backfill": parse_payload(records_backfill)},
                    sort_keys=True,
                ),
                timing_ms=records_backfill.timing_ms,
                tool_result=records_backfill,
            )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


if __name__ == "__main__":
    cli_main(TEST_NAME, run_test)

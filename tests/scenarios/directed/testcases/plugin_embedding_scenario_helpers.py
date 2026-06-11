from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover - fallback for older local envs
    psycopg = None  # type: ignore[assignment]

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


def catalog_config(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "llm": {
            "providers": [
                {
                    "name": "catalog-provider",
                    "type": "openai-compatible",
                    "endpoint": "http://127.0.0.1:9",
                    "api_key": "sk-test-unreachable",
                }
            ],
            "models": [],
            "purposes": [],
        },
        "embeddings": [
            {
                "name": entry["name"],
                "dimensions": entry.get("dimensions", 3),
                "endpoints": [
                    {
                        "provider_name": "catalog-provider",
                        "model": entry.get("model", f"{entry['name']}-model"),
                    }
                ],
            }
            for entry in entries
        ],
    }


def plugin_yaml(plugin_id: str, embedding: str | None = "*") -> str:
    if embedding is None:
        embedding_line = "embedding: null"
    else:
        embedding_line = f'embedding: "{embedding}"'
    return f"""
id: {plugin_id}
name: {plugin_id}
version: 1.0.0
{embedding_line}
tables:
  - name: notes
    embed_fields: [title]
    columns:
      - name: title
        type: text
      - name: body
        type: text
"""


def parse_payload(result) -> dict[str, Any]:
    try:
        payload = json.loads(result.text)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def cli_main(test_name: str, run_test) -> None:
    parser = argparse.ArgumentParser(description=test_name)
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(run.exit_code)


def register_plugin_step(
    run: TestRun,
    ctx: TestContext,
    label: str,
    plugin_id: str,
    schema_yaml: str,
    expect_error: bool = False,
    **kwargs: Any,
) -> Any:
    log_mark = ctx.server.log_position if ctx.server else 0
    result = ctx.client.call_tool(
        "register_plugin",
        schema_yaml=schema_yaml,
        plugin_instance="default",
        **kwargs,
    )
    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
    run.step(
        label=label,
        passed=(True if expect_error else (result.status == "pass")),
        detail=expectation_detail(result) or result.error or "",
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=step_logs,
    )
    if result.status == "pass" and result.ok:
        ctx.cleanup.track_plugin_registration(plugin_id, "default")
    return result


def seed_deactivated_embedding(config_path: str, instance_id: str, name: str = "retired_entry") -> None:
    if yaml is None or psycopg is None:
        raise RuntimeError("pyyaml and psycopg are required to seed deactivated embedding scenario state")
    with open(config_path, "r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    database_url = (
        os.environ.get("DATABASE_URL")
        or (config.get("supabase") or {}).get("database_url")
        or (config.get("supabase") or {}).get("databaseUrl")
    )
    if not database_url:
        raise RuntimeError("No database URL available for deactivated embedding scenario setup")
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
                VALUES (%s, %s, 3, '[{"provider_name":"catalog-provider","model":"retired-model"}]'::jsonb, 'yaml', 'deactivated')
                ON CONFLICT(instance_id, name)
                DO UPDATE SET status = 'deactivated', dimensions = EXCLUDED.dimensions, endpoints = EXCLUDED.endpoints
                """,
                (instance_id, name),
            )
        conn.commit()

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    import psycopg
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402


def lifecycle_catalog_config(name: str = "primary", model: str | None = None) -> dict[str, Any]:
    mode = (os.environ.get("FQC_TEST_EMBEDDING_MODE") or "ollama_openai").lower().replace("-", "_")
    provider = "openai-embeddings" if mode == "openai" else "local-ollama"
    default_model = (
        os.environ.get("OPENAI_EMBEDDING_MODEL")
        if provider == "openai-embeddings"
        else os.environ.get("OLLAMA_EMBEDDING_MODEL")
    )
    return {
        "embeddings": [
            {
                "name": name,
                "dimensions": int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768")),
                "endpoints": [
                    {
                        "provider_name": provider,
                        "model": model or default_model or ("text-embedding-3-small" if provider == "openai-embeddings" else "nomic-embed-text"),
                    }
                ],
            }
        ]
    }


def parse_payload(result) -> dict[str, Any]:
    try:
        payload = json.loads(result.text)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def first_action(payload: dict[str, Any]) -> dict[str, Any]:
    actions = payload.get("actions")
    if isinstance(actions, list) and actions and isinstance(actions[0], dict):
        return actions[0]
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
    print(run.to_json() if args.output_json else "\n".join(run.summary_lines()))
    raise SystemExit(run.exit_code)


def db_url(ctx: TestContext) -> str:
    if psycopg is None or yaml is None:
        raise RuntimeError("psycopg and pyyaml are required for lifecycle scenario setup")
    if not ctx.server:
        raise RuntimeError("lifecycle scenarios require a managed server")
    with open(ctx.server.config_path, "r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    value = (config.get("supabase") or {}).get("database_url") or os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("No database_url available for lifecycle scenario setup")
    return str(value)


def create_doc_and_memory(ctx: TestContext, run: TestRun, suffix: str) -> tuple[str, str]:
    doc_path = f"lifecycle/{suffix}.md"
    doc = ctx.client.call_tool(
        "write_document",
        mode="create",
        path=doc_path,
        title=f"Lifecycle {suffix}",
        content=f"Lifecycle document body {suffix}",
        tags=["lifecycle"],
    )
    doc_payload = parse_payload(doc)
    doc_id = str(doc_payload.get("fq_id") or "")
    if doc_id:
        ctx.cleanup.track_mcp_document(doc_id)
        ctx.cleanup.track_file(doc_path)
        ctx.cleanup.track_dir("lifecycle")
    run.step(
        "seed document through write_document",
        passed=doc.ok and bool(doc_id),
        detail=expectation_detail(doc) or doc.error or json.dumps(doc_payload, sort_keys=True),
        timing_ms=doc.timing_ms,
        tool_result=doc,
    )
    if not doc_id:
        return "", ""

    mem = ctx.client.call_tool(
        "write_memory",
        mode="create",
        content=f"Lifecycle memory body {suffix}",
        tags=["lifecycle"],
    )
    mem_payload = parse_payload(mem)
    memory_id = str(mem_payload.get("memory_id") or "")
    if memory_id:
        ctx.cleanup.track_mcp_memory(memory_id)
    run.step(
        "seed memory through write_memory",
        passed=mem.ok and bool(memory_id),
        detail=expectation_detail(mem) or mem.error or json.dumps(mem_payload, sort_keys=True),
        timing_ms=mem.timing_ms,
        tool_result=mem,
    )
    return doc_id, memory_id


def clear_entry_vectors(ctx: TestContext, doc_id: str, memory_id: str, name: str = "primary") -> None:
    column = f"embedding_{name}"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            for table, row_id in (("fqc_documents", doc_id), ("fqc_memory", memory_id)):
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET {column} = NULL,
                        {column}_model = NULL,
                        {column}_dimensions = NULL,
                        {column}_provider = NULL,
                        {column}_truncated = NULL
                    WHERE id = %s
                    """,
                    (row_id,),
                )
        conn.commit()


def stamp_stale_vectors(ctx: TestContext, doc_id: str, memory_id: str, name: str = "primary") -> None:
    column = f"embedding_{name}"
    dims = int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768"))
    vector = "[" + ",".join(["0.001"] * dims) + "]"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            for table, row_id in (("fqc_documents", doc_id), ("fqc_memory", memory_id)):
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET {column} = %s::vector,
                        {column}_model = 'stale-model',
                        {column}_dimensions = %s,
                        {column}_provider = 'scenario',
                        {column}_truncated = false
                    WHERE id = %s
                    """,
                    (vector, dims, row_id),
                )
        conn.commit()


def read_stamp_models(ctx: TestContext, doc_id: str, memory_id: str, name: str = "primary") -> list[str | None]:
    column = f"embedding_{name}_model"
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            models: list[str | None] = []
            for table, row_id in (("fqc_documents", doc_id), ("fqc_memory", memory_id)):
                cur.execute(f"SELECT {column} FROM {table} WHERE id = %s", (row_id,))
                row = cur.fetchone()
                models.append(row[0] if row else None)
            return models


def wait_for_status(ctx: TestContext, job_id: str, timeout_s: int = 60) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    payload: dict[str, Any] = {}
    while time.time() < deadline:
        result = ctx.client.call_tool("maintain_vault", action="status", job_id=job_id)
        payload = parse_payload(result)
        if payload.get("status") in {"completed", "failed", "aborted"}:
            return payload
        time.sleep(1)
    return payload


def lifecycle_context(args: argparse.Namespace, *, model: str | None = None) -> TestContext:
    port_range = tuple(args.port_range) if args.port_range else None
    return TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config(model=model),
    )


def lifecycle_catalog_entries_config(entries: list[dict[str, Any]]) -> dict[str, Any]:
    mode = (os.environ.get("FQC_TEST_EMBEDDING_MODE") or "ollama_openai").lower().replace("-", "_")
    provider = "openai-embeddings" if mode == "openai" else "local-ollama"
    default_model = (
        os.environ.get("OPENAI_EMBEDDING_MODEL")
        if provider == "openai-embeddings"
        else os.environ.get("OLLAMA_EMBEDDING_MODEL")
    )
    return {
        "embeddings": [
            {
                "name": entry["name"],
                "dimensions": int(entry.get("dimensions", os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768"))),
                "endpoints": [
                    {
                        "provider_name": provider,
                        "model": entry.get("model", default_model or ("text-embedding-3-small" if provider == "openai-embeddings" else "nomic-embed-text")),
                    }
                ],
            }
            for entry in entries
        ]
    }


def retire_test_context(args: argparse.Namespace, entries: list[dict[str, Any]]) -> TestContext:
    port_range = tuple(args.port_range) if args.port_range else None
    return TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_entries_config(entries),
    )


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


def register_plugin(ctx: TestContext, plugin_id: str, schema_yaml: str, embedding_name: str | None) -> Any:
    kwargs: dict[str, Any] = {"schema_yaml": schema_yaml, "plugin_instance": "default"}
    if embedding_name is not None:
        kwargs["embedding_name"] = embedding_name
    result = ctx.client.call_tool("register_plugin", **kwargs)
    if result.ok:
        ctx.cleanup.track_plugin_registration(plugin_id, "default")
    return result


def retire_metadata(ctx: TestContext, embedding_name: str, plugin_table: str | None = None) -> dict[str, Any]:
    base = f"embedding_{embedding_name}"
    tables = ["fqc_documents", "fqc_memory"]
    if plugin_table:
        tables.append(plugin_table)
    function_names = [f"match_documents_{embedding_name}", f"match_memories_{embedding_name}"]
    if plugin_table:
        function_names.append(f"match_records_{plugin_table}_{embedding_name}"[:63])
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT count(*) FROM fqc_embeddings
                WHERE instance_id = %s AND name = %s
                """,
                (ctx.server.instance_id, embedding_name),
            )
            catalog_rows = int(cur.fetchone()[0])
            cur.execute(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = ANY(%s)
                  AND column_name LIKE %s
                ORDER BY table_name, column_name
                """,
                (tables, f"{base}%"),
            )
            columns = [f"{row[0]}.{row[1]}" for row in cur.fetchall()]
            cur.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname LIKE %s
                ORDER BY indexname
                """,
                (f"idx_%_{base}",),
            )
            indexes = [row[0] for row in cur.fetchall()]
            cur.execute(
                """
                SELECT p.proname
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND (
                    p.proname = ANY(%s)
                    OR (p.proname LIKE 'match_records_%%' AND right(p.proname, length(%s)) = %s)
                  )
                ORDER BY p.proname
                """,
                (
                    function_names,
                    f"_{embedding_name}",
                    f"_{embedding_name}",
                ),
            )
            functions = [row[0] for row in cur.fetchall()]
    return {
        "catalog_rows": catalog_rows,
        "columns": columns,
        "indexes": indexes,
        "functions": functions,
    }


def seed_deactivated_column_set(ctx: TestContext, name: str = "retired_entry") -> None:
    dims = int(os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768"))
    with psycopg.connect(db_url(ctx)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
                VALUES (%s, %s, %s, '[{"provider_name":"local-ollama","model":"retired-model"}]'::jsonb, 'yaml', 'deactivated')
                ON CONFLICT(instance_id, name)
                DO UPDATE SET status = 'deactivated', dimensions = EXCLUDED.dimensions, endpoints = EXCLUDED.endpoints
                """,
                (ctx.server.instance_id, name, dims),
            )
            for table in ("fqc_documents", "fqc_memory"):
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "embedding_{name}" vector({dims})')
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "embedding_{name}_model" TEXT')
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "embedding_{name}_dimensions" INT')
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "embedding_{name}_provider" TEXT')
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "embedding_{name}_truncated" BOOLEAN')
                cur.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_embedding_{name}" ON "{table}" USING hnsw ("embedding_{name}" vector_cosine_ops)')
        conn.commit()

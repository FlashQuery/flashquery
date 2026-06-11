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

#!/usr/bin/env python3
"""
Test: managed shutdown drains an in-flight public write without visible loss.

Scenario:
    1. Start a dedicated managed FlashQuery server with embeddings routed to a
       delayed local OpenAI-compatible endpoint.
    2. Call write_document through the public MCP surface on a worker thread.
    3. Send SIGTERM after the embedding request starts, while the tool handler
       is still active.
    4. Assert the public write returns successfully, the vault file is visible,
       and the managed server exits after draining the request.
    Cleanup is automatic through the managed test harness.

Coverage points: D-70

Modes:
    --managed   Required; this test owns a failure-injection config and server.

Usage:
    python test_shutdown_during_write_drain.py --managed
    python test_shutdown_during_write_drain.py --managed --json

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient, ToolResult  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402


TEST_NAME = "test_shutdown_during_write_drain"
COVERAGE = ["D-70"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


import os as _os
_EMBED_DIM = int(_os.environ.get("FQC_TEST_EMBEDDING_DIMENSIONS", "768"))


class DelayedEmbeddingProvider:
    """OpenAI-compatible embedding endpoint that creates a deterministic SIGTERM window."""

    def __init__(self, delay_ms: int = 900) -> None:
        self.requests: list[dict[str, Any]] = []
        self.first_request_seen = threading.Event()
        self._delay_seconds = delay_ms / 1000.0
        self._server = ThreadingHTTPServer(("127.0.0.1", _free_port()), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8") if length else "{}"
                try:
                    parent.requests.append(json.loads(body))
                except json.JSONDecodeError:
                    parent.requests.append({"raw": body})
                parent.first_request_seen.set()
                time.sleep(parent._delay_seconds)
                payload = json.dumps({
                    "data": [{
                        "embedding": [0.0] * _EMBED_DIM,
                    }],
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return Handler

    def __enter__(self) -> "DelayedEmbeddingProvider":
        self._thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _embedding_config(endpoint: str) -> dict[str, Any]:
    # The embeddings-update branch moved document embeddings from llm.models (type=embedding)
    # to the top-level embeddings: catalog consumed by the chunk scheduler. The provider
    # must be declared in llm.providers so the catalog endpoint can reference it.
    return {
        "llm": {
            "providers": [{
                "name": "delayed-embeddings",
                "type": "openai-compatible",
                "endpoint": endpoint,
                "api_key": "sk-test-delayed",
            }],
            "models": [],
            "purposes": [],
        },
        "embeddings": [{
            "name": "primary",
            "dimensions": _EMBED_DIM,
            "endpoints": [{
                "provider_name": "delayed-embeddings",
                "model": "text-embedding-3-small",
            }],
        }],
    }


def _call_write(client: FQCClient, result_box: dict[str, ToolResult], path: str, title: str, run_id: str) -> None:
    result_box["result"] = client.call_tool(
        "write_document",
        mode="create",
        path=path,
        title=title,
        content=(
            f"# {title}\n\n"
            f"D-70 verifies public write drain during managed shutdown for run {run_id}."
        ),
        tags=["fqc-test", "shutdown-drain", run_id],
    )


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    title = f"D-70 shutdown drain {run.run_id}"

    with DelayedEmbeddingProvider() as provider:
        with FQCServer(
            fqc_dir=args.fqc_dir,
            port_range=port_range,
            extra_config=_embedding_config(provider.url),
            ready_timeout=120,
        ) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            result_box: dict[str, ToolResult] = {}
            worker = threading.Thread(
                target=_call_write,
                args=(client, result_box, test_path, title, run.run_id),
                daemon=True,
            )

            worker.start()
            saw_embedding_request = provider.first_request_seen.wait(timeout=10)
            signaled = server.signal_graceful_shutdown() if saw_embedding_request else False
            worker.join(timeout=25)
            result = result_box.get("result")

            payload: dict[str, Any] = {}
            json_error = ""
            if result and result.text:
                try:
                    loaded = json.loads(result.text)
                    if isinstance(loaded, dict):
                        payload = loaded
                except json.JSONDecodeError as exc:
                    json_error = f"{type(exc).__name__}: {exc}"

            shutdown_deadline = time.monotonic() + 10
            while server.is_running and time.monotonic() < shutdown_deadline:
                time.sleep(0.05)

            vault_file = server.vault_path / test_path
            file_text = vault_file.read_text() if vault_file.is_file() else ""
            checks = {
                "embedding request observed": saw_embedding_request,
                "shutdown signal sent": signaled,
                "write thread completed": not worker.is_alive(),
                "write returned success": bool(result and result.ok),
                "response path matches": payload.get("path") == test_path,
                "response title matches": payload.get("title") == title,
                "vault file exists": vault_file.is_file(),
                "vault file contains content": "D-70 verifies public write drain" in file_text,
                "server exited": not server.is_running,
                "embedding provider was called": len(provider.requests) >= 1,
            }
            passed = all(checks.values())
            detail = json.dumps({
                "checks": checks,
                "result_error": result.error if result else "missing result",
                "json_error": json_error,
                "payload": payload,
                "request_count": len(provider.requests),
                "server_running": server.is_running,
            }, sort_keys=True)
            run.step(
                label="D-70 public write drains before managed shutdown exits",
                passed=passed,
                detail=detail,
                timing_ms=result.timing_ms if result else 0,
                tool_result=result,
                server_logs=server.captured_logs,
            )

            run.attach_server_logs(server.captured_logs)

    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test public shutdown-during-write drain behavior.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    if not args.managed:
        run = TestRun(TEST_NAME)
        run.step(
            label="managed mode is required",
            passed=False,
            detail="--managed is required because this scenario controls shutdown timing",
        )
    else:
        run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

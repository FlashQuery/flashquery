#!/usr/bin/env python3
"""D-WCO-06 / T-S-006: read-triggered repair returns a usable post-repair token."""
from __future__ import annotations

COVERAGE = ["D-WCO-06"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun

TEST_NAME = "test_read_triggered_repair_token"


def _json(text: str) -> dict:
    payload = json.loads(text)
    return payload if isinstance(payload, dict) else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path = f"_test/{TEST_NAME}_{run.run_id}.md"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        ctx.create_file(
            path,
            title="Read Triggered Repair Token",
            body="This file intentionally starts without fq_id.",
            tags=["wco"],
            fqc_id=None,
        )
        # Remove any helper-generated identity so get_document must repair it.
        doc_path = ctx.vault.vault_root / path
        raw = doc_path.read_text(encoding="utf-8")
        raw = "\n".join(line for line in raw.splitlines() if not line.startswith("fq_id:")) + "\n"
        doc_path.write_text(raw, encoding="utf-8")

        read = ctx.client.call_tool("get_document", identifiers=path, include=["frontmatter", "body"])
        token = None
        if read.ok:
            token = _json(read.text).get("version_token")
        passed_read = read.ok and isinstance(token, str) and len(token) == 64
        run.step(
            "D-WCO-06: get_document repair returns post-repair version_token",
            passed_read,
            f"version_token={token!r}",
            read.timing_ms,
            read,
        )
        if not passed_read:
            return run

        write = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=path,
            expected_version=token,
        )
        payload = _json(write.text) if write.ok else {}
        passed_write = write.ok and payload.get("error") is None and isinstance(payload.get("version_token"), str)
        run.step(
            "D-WCO-06: follow-up no-op write accepts returned token",
            passed_write,
            f"payload={payload!r}",
            write.timing_ms,
            write,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else "\n".join(run.summary_lines()))
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

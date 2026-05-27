#!/usr/bin/env python3
"""D-WCO-05 / T-S-005: version_token read-edit-write round trip."""
from __future__ import annotations

COVERAGE = ["D-WCO-05"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun

TEST_NAME = "test_version_token_round_trip"


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
            title="Version Token Round Trip",
            body="Initial body.",
            tags=["wco"],
            fqc_id="33333333-3333-4333-8333-333333333333",
        )
        scan = ctx.scan_vault()
        run.step("setup: create fixture and scan document", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            return run

        read = ctx.client.call_tool("get_document", identifiers=path, include=["body"])
        token = None
        read_detail = ""
        if read.ok:
            try:
                token = _json(read.text).get("version_token")
            except Exception as exc:
                read_detail = f"JSON parse failed: {exc}"
        passed_read = isinstance(token, str) and len(token) == 64
        run.step(
            "D-WCO-05: get_document returns version_token",
            passed_read,
            read_detail or f"version_token={token!r}",
            read.timing_ms,
            read,
        )
        if not passed_read:
            return run

        write = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=path,
            content="Updated with matching token.",
            expected_version=token,
        )
        write_payload = _json(write.text) if write.ok else {}
        new_token = write_payload.get("version_token")
        passed_write = write.ok and isinstance(new_token, str) and new_token != token
        run.step(
            "D-WCO-05: write_document accepts matching expected_version and returns new token",
            passed_write,
            f"new_token={new_token!r}",
            write.timing_ms,
            write,
        )
        if not passed_write:
            return run

        stale = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=path,
            content="Stale write must be refused.",
            expected_version=token,
        )
        stale_payload = _json(stale.text) if stale.ok else {}
        passed_stale = (
            stale.ok
            and stale_payload.get("error") == "conflict"
            and stale_payload.get("details", {}).get("reason") == "version_mismatch"
        )
        run.step(
            "D-WCO-05: stale second write is refused with version_mismatch conflict",
            passed_stale,
            f"payload={stale_payload!r}",
            stale.timing_ms,
            stale,
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

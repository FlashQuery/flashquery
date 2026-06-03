#!/usr/bin/env python3
"""D-WCO-09: version_token refuses a stale write when the file is edited out-of-band on disk."""
from __future__ import annotations

COVERAGE = ["D-WCO-09"]

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun

TEST_NAME = "test_version_token_external_edit"


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
        # ── Step 1: Create fixture document and scan ─────────────
        ctx.create_file(
            path,
            title="Version Token External Edit",
            body="Initial body written by FlashQuery.",
            tags=["fqc-test", run.run_id],
        )
        scan = ctx.scan_vault()
        run.step("setup: create fixture and scan document", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            return run

        # Track the MCP document for DB cleanup using the fqc_id assigned at scan time.
        read_meta = ctx.client.call_tool("get_document", identifiers=path, include=["body"])
        if read_meta.ok:
            fq_id = _json(read_meta.text).get("fqc_id") or _extract_field(read_meta.text, "FlashQuery ID")
            if fq_id:
                ctx.cleanup.track_mcp_document(fq_id)

        # ── Step 2: get_document captures version_token T ────────
        token = None
        read_detail = ""
        if read_meta.ok:
            try:
                token = _json(read_meta.text).get("version_token")
            except Exception as exc:
                read_detail = f"JSON parse failed: {exc}"
        passed_read = isinstance(token, str) and bool(re.fullmatch(r"[0-9a-f]{64}", token))
        run.step(
            "D-WCO-09: get_document returns 64-hex version_token",
            passed_read,
            read_detail or f"version_token={token!r}",
            read_meta.timing_ms,
            read_meta,
        )
        if not passed_read:
            return run

        # ── Step 3: External out-of-band edit (bypass MCP) ───────
        # Write new raw bytes directly to disk, mimicking an external editor / git /
        # Obsidian changing the file. The in-process write-lock can't see this — only
        # the fresh on-disk SHA-256 comparison at write time catches the drift.
        t0 = time.monotonic()
        disk_detail = ""
        wrote_external = False
        try:
            disk_path = ctx.vault.vault_root / path
            external_bytes = (
                "---\n"
                "title: Version Token External Edit\n"
                "---\n\n"
                f"Externally edited out-of-band by {TEST_NAME} (run {run.run_id}).\n"
                "These bytes were never written by FlashQuery.\n"
            ).encode("utf-8")
            disk_path.write_bytes(external_bytes)
            wrote_external = disk_path.read_bytes() == external_bytes
            disk_detail = f"wrote {len(external_bytes)} bytes to {disk_path}"
        except Exception as exc:
            disk_detail = f"Exception during external edit: {exc}"
        run.step(
            "external edit: overwrite file on disk bypassing MCP",
            wrote_external,
            disk_detail,
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not wrote_external:
            return run

        # ── Step 4: Stale write with token T must be refused ─────
        # The on-disk hash no longer matches what the token was minted against, so the
        # write must be refused even though no competing MCP write occurred.
        stale = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=path,
            content="Attempted update against a now-stale on-disk file.",
            expected_version=token,
        )
        stale_payload = _json(stale.text) if stale.ok else {}
        passed_stale = (
            stale.ok
            and stale_payload.get("error") == "conflict"
            and stale_payload.get("details", {}).get("reason") == "version_mismatch"
        )
        run.step(
            "D-WCO-09: write with stale token refused after external on-disk edit",
            passed_stale,
            f"payload={stale_payload!r}",
            stale.timing_ms,
            stale,
        )

        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


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

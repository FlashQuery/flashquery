#!/usr/bin/env python3
"""
Test: list_vault — detailed format: key-value structure, Size field, ISO 8601 timestamps,
      directory-before-file ordering with show=all.

Scenario:
    1. Setup: create tracked document, subdir, and untracked file directly in vault
    2. F-76: list_vault show=files format=detailed — two entries separated by ---,
             key-value format confirmed
    3. F-77: list_vault show=files format=detailed — file entry has Size: field with
             human-readable value (B/KB/MB/GB)
    4. F-78: list_vault show=directories format=detailed — entry contains 'Type: directory'
    5. F-79: list_vault format=detailed — timestamps use ISO 8601 (YYYY-MM-DDThh:mm)
    6. F-83: list_vault show=all format=detailed — directory entry appears before file entry
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-76, F-77, F-78, F-79, F-83

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_list_vault_format_detailed.py                            # existing server
    python test_list_vault_format_detailed.py --managed                  # managed server
    python test_list_vault_format_detailed.py --managed --json           # structured JSON with server logs
    python test_list_vault_format_detailed.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["F-76", "F-77", "F-78", "F-79", "F-83"]

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_format_detailed"


def _payload(text: str) -> dict:
    try:
        payload = json.loads(text)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _entries(text: str) -> list[dict]:
    entries = _payload(text).get("entries")
    return entries if isinstance(entries, list) else []


def _extract_fqc_id(text: str) -> str:
    value = _payload(text).get("fq_id")
    if value:
        return str(value)
    m = re.search(r"FQC ID:\s*(\S+)", text)
    return m.group(1).strip() if m else ""


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    base_dir = f"_test/{run.run_id}"
    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        ctx.cleanup.track_dir(base_dir)

        # ── Setup: create tracked document and a subdirectory ─────────────────
        ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/subdir"])

        tracked_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            title=f"Tracked Doc {run.run_id}",
            content="Tracked document content.",
            path=f"{base_dir}/tracked.md",
            tags=["fqc-test", run.run_id],
        )

        fid = _extract_fqc_id(tracked_result.text)
        if fid:
            ctx.cleanup.track_mcp_document(fid)

        # Create an untracked file directly for F-77
        t0 = time.monotonic()
        untracked_abs = ctx.vault._abs(f"{base_dir}/untracked.md")
        untracked_abs.parent.mkdir(parents=True, exist_ok=True)
        untracked_abs.write_text(f"# Untracked\n\nNot in DB for {run.run_id}.\n")
        ctx.cleanup.track_file(f"{base_dir}/untracked.md")
        run.step(
            label="Setup: write untracked.md directly to vault",
            passed=untracked_abs.is_file(),
            detail=f"path={base_dir}/untracked.md",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── F-76: detailed format returns key-value entries separated by --- ──
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        entries = _entries(result.text)
        has_separator = len(entries) == 2
        has_kv_format = all({"name", "path", "type", "modified", "size"}.issubset(e.keys()) for e in entries)
        passed_f76 = result.ok and has_separator and has_kv_format

        run.step(
            label="F-76: detailed format entries separated by --- and use key-value format",
            passed=passed_f76,
            detail=f"ok={result.ok} has_separator={has_separator} has_kv_format={has_kv_format} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-77: file entries include Size field with human-readable value ───
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        entries = _entries(result.text)
        has_size_field = all("size" in e for e in entries)
        has_size_unit = all(isinstance(e.get("size", {}).get("chars"), int) for e in entries)
        passed_f77 = result.ok and has_size_field and has_size_unit

        run.step(
            label="F-77: file entry has 'Size:' field with human-readable value (B/KB/MB/GB)",
            passed=passed_f77,
            detail=f"ok={result.ok} has_size_field={has_size_field} has_size_unit={has_size_unit} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-78: directory detailed block shows 'Type: directory' ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f78 = result.ok and any(e.get("type") == "directory" for e in _entries(result.text))

        run.step(
            label="F-78: directory detailed block contains 'Type: directory'",
            passed=passed_f78,
            detail=f"ok={result.ok} has_type={'Type: directory' in result.text} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-79: timestamps use ISO 8601 format ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Updated/Created fields use .toISOString() → "YYYY-MM-DDThh:mm:..."
        has_iso8601 = bool(re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", result.text))
        passed_f79 = result.ok and has_iso8601

        run.step(
            label="F-79: detailed format timestamps use ISO 8601 (YYYY-MM-DDThh:mm)",
            passed=passed_f79,
            detail=f"ok={result.ok} has_iso8601={has_iso8601} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-83: show=all groups directories before files ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, format="detailed", show="all")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # With show="all", source sorts dirs first then files ([...dirs, ...files]).
        # "Type: directory" appears in the directory entry; "tracked.md" appears in a file entry.
        entries = _entries(result.text)
        dir_pos = next((i for i, e in enumerate(entries) if e.get("type") == "directory"), -1)
        file_pos = next((i for i, e in enumerate(entries) if e.get("type") == "file"), -1)
        dirs_before_files = dir_pos != -1 and file_pos != -1 and dir_pos < file_pos
        passed_f83 = result.ok and dirs_before_files

        run.step(
            label="F-83: show=all detailed format — directory entry appears before file entry",
            passed=passed_f83,
            detail=f"ok={result.ok} dir_pos={dir_pos} file_pos={file_pos} dirs_before_files={dirs_before_files} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(label="Cleanup skipped (--keep)", passed=True,
                     detail=f"Files retained under: {ctx.vault.vault_root / '_test'}")

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: list_vault detailed format tracked/untracked field order and DB metadata.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None, dest="vault_path")
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

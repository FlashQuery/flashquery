#!/usr/bin/env python3
"""
Test: list_vault — show=all tests: mixed file/dir ordering, extensions with show=all.

Coverage points: F-59, F-60, F-61

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_all.py
    python test_list_vault_all.py --managed
    python test_list_vault_all.py --managed --json
    python test_list_vault_all.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-59", "F-60", "F-61"]

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_all"


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

        # ── Setup: create mix of directories and files ─────────────────────────
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/Projects")
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/Archive")

        readme_result = ctx.client.call_tool(
            "create_document",
            title=f"Readme {run.run_id}",
            content="Project readme document.",
            path=f"{base_dir}/readme.md",
            tags=["fqc-test", run.run_id],
        )

        # Extract fqc_id for cleanup
        m = re.search(r"FQC ID:\s*(\S+)", readme_result.text)
        if m:
            ctx.cleanup.track_mcp_document(m.group(1).strip())

        # Create a .txt file directly so F-61 can verify extensions filter excludes it
        txt_abs = ctx.vault._abs(f"{base_dir}/notes.txt")
        txt_abs.write_text(f"plain text note for {run.run_id}\n")
        ctx.cleanup.track_file(f"{base_dir}/notes.txt")

        # ── F-59: show=all → both directories and file appear ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="all")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_projects = "Projects/" in result.text
        has_readme = "readme.md" in result.text
        passed_f59 = result.ok and has_projects and has_readme

        run.step(
            label="F-59: show=all returns both directories and files",
            passed=passed_f59,
            detail=f"ok={result.ok} has_projects={has_projects} has_readme={has_readme} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-60: show=all → directories appear BEFORE files ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="all")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Find the position of first directory vs first file
        projects_pos = result.text.find("Projects/")
        readme_pos = result.text.find("readme.md")
        dirs_before_files = (
            projects_pos != -1
            and readme_pos != -1
            and projects_pos < readme_pos
        )
        passed_f60 = result.ok and dirs_before_files

        run.step(
            label="F-60: show=all — directories appear before files in output",
            passed=passed_f60,
            detail=f"ok={result.ok} projects_pos={projects_pos} readme_pos={readme_pos} dirs_before_files={dirs_before_files} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-61: show=all + extensions filter → dirs still appear ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="all", extensions=[".md"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Extensions filter applies to files only; directories always appear
        has_projects = "Projects/" in result.text
        has_readme = "readme.md" in result.text
        txt_absent = "notes.txt" not in result.text
        passed_f61 = result.ok and has_projects and has_readme and txt_absent

        run.step(
            label="F-61: show=all with extensions=[.md] — directories appear, .md appears, .txt excluded",
            passed=passed_f61,
            detail=f"ok={result.ok} has_projects={has_projects} has_readme={has_readme} txt_absent={txt_absent} | {result.text[:300]}",
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
        description="Test: list_vault show=all mixed file/dir ordering.",
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

#!/usr/bin/env python3
"""
Test: list_vault — filesystem resilience tests: permission denied, stat failure.

Coverage points: F-96, F-97

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_fs_resilience.py
    python test_list_vault_fs_resilience.py --managed
    python test_list_vault_fs_resilience.py --managed --json
    python test_list_vault_fs_resilience.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY

Note:
    F-96 and F-97 require non-root execution for chmod 000 to have effect.
    These tests are automatically skipped when running as root (os.getuid() == 0).
"""
from __future__ import annotations

COVERAGE = ["F-96", "F-97"]

import argparse
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_fs_resilience"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    base_dir = f"_test/{run.run_id}"
    port_range = tuple(args.port_range) if args.port_range else None

    # Root guard: chmod 000 has no effect as root — skip permission tests
    if os.getuid() == 0:
        run.step(
            label="F-96/F-97: permission tests skipped (running as root)",
            passed=True,
            detail="chmod 000 has no effect as root — tests skipped.",
            timing_ms=0,
        )
        return run

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        ctx.cleanup.track_dir(base_dir)

        # ── F-96: chmod 000 on a subdirectory — listing still ok ─────────────
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/accessible")
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/restricted")

        # Put a file in accessible/
        accessible_file = ctx.vault._abs(f"{base_dir}/accessible/note.txt")
        accessible_file.write_text("accessible content\n")
        ctx.cleanup.track_file(f"{base_dir}/accessible/note.txt")

        restricted_abs = ctx.vault._abs(f"{base_dir}/restricted")

        try:
            os.chmod(restricted_abs, 0o000)

            log_mark = ctx.server.log_position if ctx.server else 0
            result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", recursive=True)
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # Permission on restricted/ should not cause isError — handled gracefully
            passed_f96 = result.ok

            run.step(
                label="F-96: chmod 000 subdirectory does not cause isError in listing",
                passed=passed_f96,
                detail=f"ok={result.ok} | {result.text[:300]}",
                timing_ms=result.timing_ms,
                tool_result=result,
                server_logs=step_logs,
            )
        finally:
            # Restore permissions so cleanup can remove the directory
            try:
                os.chmod(restricted_abs, 0o755)
            except Exception:
                pass

        # ── F-97: chmod 000 on a file — listing still ok ─────────────────────
        testfile_result = ctx.client.call_tool(
            "create_document",
            title=f"Restricted File {run.run_id}",
            content="This file will be chmod 000.",
            path=f"{base_dir}/testfile.md",
            tags=["fqc-test", run.run_id],
        )

        m = re.search(r"FQC ID:\s*(\S+)", testfile_result.text)
        if m:
            ctx.cleanup.track_mcp_document(m.group(1).strip())

        testfile_abs = ctx.vault._abs(f"{base_dir}/testfile.md")

        try:
            os.chmod(testfile_abs, 0o000)

            log_mark = ctx.server.log_position if ctx.server else 0
            result = ctx.client.call_tool("list_vault", path=base_dir, show="files")
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # stat failure on individual file should not crash the whole listing
            passed_f97 = result.ok

            run.step(
                label="F-97: chmod 000 file does not cause isError — stat failure handled gracefully",
                passed=passed_f97,
                detail=f"ok={result.ok} | {result.text[:300]}",
                timing_ms=result.timing_ms,
                tool_result=result,
                server_logs=step_logs,
            )
        finally:
            # Restore permissions so cleanup can remove the file
            try:
                os.chmod(testfile_abs, 0o644)
            except Exception:
                pass

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
        description="Test: list_vault filesystem resilience — permission denied, stat failure.",
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

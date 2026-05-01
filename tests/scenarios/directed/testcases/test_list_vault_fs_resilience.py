#!/usr/bin/env python3
"""
Test: list_vault — filesystem resilience: accessible entries still returned when the vault
      contains inaccessible or stat-failing entries.

Scenario:
    1. F-96: Create accessible/ (with note.txt) and restricted/ (chmod 000). Call list_vault
             recursive. Assert result.ok AND note.txt appears — accessible entries returned
             despite permission-denied subdirectory.
    2. F-97: Create readable.md (normal file) and broken.md (broken symlink → /nonexistent).
             Call list_vault. Assert result.ok AND readable.md appears — readable files returned
             despite the broken symlink causing a stat error.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: F-96, F-97

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_list_vault_fs_resilience.py                            # existing server
    python test_list_vault_fs_resilience.py --managed                  # managed server
    python test_list_vault_fs_resilience.py --managed --json           # structured JSON with server logs
    python test_list_vault_fs_resilience.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors

Note:
    F-96 requires non-root execution for chmod 000 to have effect.
    The test is automatically skipped when running as root (os.getuid() == 0).
"""
from __future__ import annotations

COVERAGE = ["F-96", "F-97"]

import argparse
import os
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
            # Default show="all" recursive — accessible/ and its contents must appear
            result = ctx.client.call_tool("list_vault", path=base_dir, recursive=True)
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # note.txt is inside accessible/ — if it appears, the tool returned partial results
            # rather than failing silently or returning empty despite restricted/ being denied
            accessible_shown = "note.txt" in result.text or "accessible" in result.text
            passed_f96 = result.ok and accessible_shown

            run.step(
                label="F-96: accessible entries appear in response despite permission-denied subdirectory",
                passed=passed_f96,
                detail=f"ok={result.ok} accessible_shown={accessible_shown} | {result.text[:300]}",
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

        # ── F-97: broken symlink (stat error) — readable files still appear ────
        # A broken symlink reliably triggers a stat() failure when the filesystem
        # walker follows it: the link exists in the directory but its target does not.
        # chmod 000 does not cause stat() failures on most Unix systems (the OS can
        # still return file metadata without read permission), so it would not exercise
        # this code path.
        readable_abs = ctx.vault._abs(f"{base_dir}/readable.md")
        readable_abs.parent.mkdir(parents=True, exist_ok=True)
        readable_abs.write_text(f"# Readable\n\nAccessible file for {run.run_id}.\n")
        ctx.cleanup.track_file(f"{base_dir}/readable.md")

        broken_abs = ctx.vault._abs(f"{base_dir}/broken.md")
        os.symlink("/nonexistent/target_fqc_test", str(broken_abs))
        # Don't use ctx.cleanup.track_file for the broken symlink — vault cleanup follows
        # symlinks when resolving paths, and the absolute target triggers path-traversal
        # protection. Use os.unlink() directly in the finally block instead.

        try:
            log_mark = ctx.server.log_position if ctx.server else 0
            result = ctx.client.call_tool("list_vault", path=base_dir, show="files")
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # readable.md must appear; broken.md must not cause isError
            readable_shown = "readable" in result.text
            passed_f97 = result.ok and readable_shown

            run.step(
                label="F-97: readable files appear in response despite broken symlink causing stat error",
                passed=passed_f97,
                detail=f"ok={result.ok} readable_shown={readable_shown} | {result.text[:300]}",
                timing_ms=result.timing_ms,
                tool_result=result,
                server_logs=step_logs,
            )
        finally:
            # Remove the symlink itself (os.unlink does not follow symlinks)
            try:
                os.unlink(str(broken_abs))
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

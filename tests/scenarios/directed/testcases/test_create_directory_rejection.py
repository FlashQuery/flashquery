#!/usr/bin/env python3
"""
Test: create_directory — rejection cases (traversal, symlink, invalid root_path, vault root,
empty array, file conflict, whitespace-only, segment > 255 bytes, total > 4096 bytes, type errors).

Coverage points: F-37, F-38, F-39, F-40, F-41, F-42, F-43, F-44, F-45, F-46, F-47, F-48, F-49

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_rejection.py                            # existing server
    python test_create_directory_rejection.py --managed                  # managed server
    python test_create_directory_rejection.py --managed --json           # structured JSON with server logs
    python test_create_directory_rejection.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-37", "F-38", "F-39", "F-40", "F-41", "F-42", "F-43", "F-44", "F-45", "F-46", "F-47", "F-48", "F-49"]

import argparse
import os
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_rejection"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

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

        # ── F-37: path traversal (../../etc) is rejected ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths="../../etc")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f37 = (
            not result.ok
            and "resolves outside the vault root" in result.text
        )

        run.step(
            label="F-37: path traversal (../../etc) is rejected",
            passed=passed_f37,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-38: absolute path is rejected ───────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths="/etc/passwd")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f38 = not result.ok

        run.step(
            label="F-38: absolute path (/etc/passwd) is rejected",
            passed=passed_f38,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-39: symlink in path is rejected ────────────────────────────────
        # Setup: create a symlink inside the vault pointing to /tmp
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)
        sym_path = ctx.vault._abs(f"{base_dir}/link")
        os.symlink("/tmp", str(sym_path))

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/link/subdir")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f39 = not result.ok and "symlink" in result.text

        run.step(
            label="F-39: symlink in path is rejected",
            passed=passed_f39,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-40: invalid root_path (traversal) is rejected before any path ──
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths="a", root_path="../../etc")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f40 = not result.ok and "Invalid root_path:" in result.text

        run.step(
            label="F-40: invalid root_path (traversal) is rejected before any paths are processed",
            passed=passed_f40,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-41a: empty string path is silently skipped ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result_empty = ctx.client.call_tool("create_directory", paths="")
        step_logs_empty = ctx.server.logs_since(log_mark) if ctx.server else None

        # ── F-41b: "." path targets vault root and is rejected ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result_dot = ctx.client.call_tool("create_directory", paths=".")
        step_logs_dot = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f41 = (
            not result_empty.ok  # empty string → no valid paths → error (No paths provided or all skipped)
            and not result_dot.ok  # "." → vault root target → error
        )

        run.step(
            label="F-41: empty path skipped; '.' targets vault root and is rejected",
            passed=passed_f41,
            detail=f"empty_ok={result_empty.ok} dot_ok={result_dot.ok} | empty: {result_empty.text[:100]} | dot: {result_dot.text[:100]}",
            timing_ms=result_empty.timing_ms + result_dot.timing_ms,
            tool_result=result_dot,
            server_logs=step_logs_dot,
        )

        # ── F-42: empty array is rejected ─────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=[])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f42 = not result.ok and "No paths provided." in result.text

        run.step(
            label="F-42: empty array is rejected with 'No paths provided.'",
            passed=passed_f42,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-43: file-at-path conflict ───────────────────────────────────────
        # Setup: create a file where a dir would need to be
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)
        file_path = ctx.vault._abs(f"{base_dir}/notes.md")
        file_path.write_text("existing content")

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/notes.md/subfolder")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f43 = not result.ok and "already exists as a file at" in result.text

        run.step(
            label="F-43: file-at-path conflict gives readable error (not raw ENOTDIR)",
            passed=passed_f43,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-44: whitespace-only segment is rejected ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/   ")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f44 = not result.ok and "whitespace-only" in result.text

        run.step(
            label="F-44: whitespace-only segment is rejected",
            passed=passed_f44,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-45: segment > 255 bytes is rejected ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        long_segment = "x" * 256
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/{long_segment}")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f45 = not result.ok and "255-byte" in result.text

        run.step(
            label="F-45: segment > 255 bytes is rejected",
            passed=passed_f45,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-46: total path > 4096 bytes is rejected ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        long_path = f"{base_dir}/" + "/".join(["xx"] * 2050)
        result = ctx.client.call_tool("create_directory", paths=long_path)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f46 = not result.ok and ("4,096" in result.text or "4096" in result.text or "too long" in result.text.lower())

        run.step(
            label="F-46: total path > 4096 bytes is rejected",
            passed=passed_f46,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-47: type error (number in paths) is rejected ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=123)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f47 = not result.ok  # Zod will reject; exact text may vary

        run.step(
            label="F-47: type error (number in paths) is rejected by Zod schema",
            passed=passed_f47,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-48: missing paths parameter is rejected ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f48 = not result.ok

        run.step(
            label="F-48: missing paths parameter is rejected",
            passed=passed_f48,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-49: NUL-only segment → whitespace-only after sanitization ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/\x00\x00")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # NUL bytes → spaces → whitespace-only → rejected
        passed_f49 = not result.ok and ("whitespace-only" in result.text or "exceeds" in result.text)

        run.step(
            label="F-49: NUL-only segment sanitizes to whitespace-only and is rejected",
            passed=passed_f49,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: create_directory rejection cases (traversal, symlink, conflict, type errors).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                        help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                        help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                        help="Override auth secret (ignored with --managed).")
    parser.add_argument("--managed", action="store_true",
                        help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                        default=None,
                        help="Port range for managed server (default: 9100 9199).")
    parser.add_argument("--json", action="store_true", dest="output_json",
                        help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                        help="Retain test files for debugging (skip cleanup).")
    parser.add_argument("--vault-path", type=str, default=None, dest="vault_path",
                        help="Override vault path for managed server.")

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

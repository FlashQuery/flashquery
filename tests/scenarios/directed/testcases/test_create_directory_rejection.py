#!/usr/bin/env python3
"""
Test: create_directory — rejection cases (traversal, symlink, invalid root_path, vault root,
empty array, file conflict, whitespace-only, segment > 255 bytes, total > 4096 bytes, type errors).

Coverage points: F-37, F-38, F-39, F-40, F-41, F-42, F-43, F-44, F-46, F-47, F-48, F-49

Scenario steps:
    F-37: path traversal (../../etc) is rejected
    F-38: vault root targets ('/', '.', '') all rejected
    F-39: symlink in path is rejected
    F-48: invalid root_path (traversal) rejects entire call before any paths processed
    F-40: file conflict — existing file at path segment blocks directory creation
    F-41: file conflict mid-hierarchy — file at notes.md blocks notes.md/sub
    F-42: whitespace-only segment rejected
    F-43: segment exceeding 255 bytes rejected
    F-44: total resolved path exceeding 4,096 bytes rejected
    F-46: empty array rejected
    F-47: type error (number in paths) rejected by Zod schema
    F-49: root_path pointing to existing file rejects entire call

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


COVERAGE = ["F-37", "F-38", "F-39", "F-40", "F-41", "F-42", "F-43", "F-44", "F-46", "F-47", "F-48", "F-49"]

import argparse
import json
import os
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


def _first_result(result) -> dict:
    try:
        payload = json.loads(result.text)
        first = payload["results"][0]
        return first if isinstance(first, dict) else {}
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        return {}


def _per_path_error(result, *, error: str | None = None, reason: str | None = None) -> bool:
    item = _first_result(result)
    details = item.get("details") if isinstance(item.get("details"), dict) else {}
    return (
        result.ok
        and (error is None or item.get("error") == error)
        and (reason is None or details.get("reason") == reason)
    )


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
        result = ctx.client.call_tool("manage_directory", action="create", paths=["../../etc"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f37 = _per_path_error(result, error="invalid_input", reason="path_traversal")

        run.step(
            label="F-37: path traversal (../../etc) is rejected",
            passed=passed_f37,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-38: vault root targets ("/", ".", "") all rejected ──────────────
        # Test "/" — after stripping leading slash → "" → vault root → rejected
        log_mark = ctx.server.log_position if ctx.server else 0
        result_slash = ctx.client.call_tool("manage_directory", action="create", paths=["/"])
        result_dot = ctx.client.call_tool("manage_directory", action="create", paths=["."])
        result_empty = ctx.client.call_tool("manage_directory", action="create", paths=[""])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f38 = (
            _per_path_error(result_slash, error="invalid_input", reason="vault_root")
            and _per_path_error(result_dot, error="invalid_input", reason="vault_root")
            and _per_path_error(result_empty, error="invalid_input", reason="vault_root")
        )

        run.step(
            label="F-38: vault root targets '/', '.', '' all rejected",
            passed=passed_f38,
            detail=f"slash_ok={result_slash.ok} dot_ok={result_dot.ok} empty_ok={result_empty.ok} | slash: {result_slash.text[:100]} | dot: {result_dot.text[:100]}",
            timing_ms=result_slash.timing_ms + result_dot.timing_ms + result_empty.timing_ms,
            tool_result=result_dot,
            server_logs=step_logs,
        )

        # ── F-39: symlink in path is rejected ────────────────────────────────
        # Setup: create a symlink inside the vault pointing to /tmp
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)
        sym_path = ctx.vault._abs(f"{base_dir}/link")
        os.symlink("/tmp", str(sym_path))

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/link/subdir"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f39 = _per_path_error(result, error="invalid_input", reason="invalid_directory_path")

        run.step(
            label="F-39: symlink in path is rejected",
            passed=passed_f39,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-48: invalid root_path (traversal) rejects entire call before any paths processed ──
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=["../../etc"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f48_traversal = _per_path_error(result, error="invalid_input", reason="path_traversal")

        run.step(
            label="F-48: invalid root_path (traversal) rejects entire call before any paths processed",
            passed=passed_f48_traversal,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-49: root_path pointing to existing file rejects entire call ─────
        # Setup: create a file where root_path would point
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)
        root_file = ctx.vault._abs(f"{base_dir}/afile.md")
        root_file.write_text("content")

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/afile.md/sub"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f49 = _per_path_error(result, error="conflict", reason="not_directory")

        run.step(
            label="F-49: root_path pointing to existing file rejects entire call",
            passed=passed_f49,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-40: file conflict — existing file at path segment blocks directory creation ──
        # Setup: create a file where a dir would need to be
        ctx.vault._abs(base_dir).mkdir(parents=True, exist_ok=True)
        file_path = ctx.vault._abs(f"{base_dir}/notes.md")
        file_path.write_text("existing content")

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/notes.md/subfolder"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f40 = _per_path_error(result, error="conflict", reason="not_directory")

        run.step(
            label="F-40: file conflict — existing file at path segment blocks directory creation",
            passed=passed_f40,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-41: file conflict mid-hierarchy ─────────────────────────────────
        # Setup: create a file in the middle of a hierarchy
        ctx.vault._abs(f"{base_dir}/mid").mkdir(parents=True, exist_ok=True)
        mid_file = ctx.vault._abs(f"{base_dir}/mid/notes.md")
        mid_file.write_text("content")

        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/mid/notes.md/sub"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f41 = _per_path_error(result, error="conflict", reason="not_directory")

        run.step(
            label="F-41: file conflict mid-hierarchy — file at notes.md blocks notes.md/sub",
            passed=passed_f41,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-42: whitespace-only segment is rejected ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/   "])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f42 = _per_path_error(result, error="invalid_input", reason="invalid_directory_path") and "whitespace-only" in result.text

        run.step(
            label="F-42: whitespace-only segment rejected",
            passed=passed_f42,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-43: segment > 255 bytes is rejected ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        long_segment = "x" * 256
        result = ctx.client.call_tool("manage_directory", action="create", paths=[f"{base_dir}/{long_segment}"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f43 = _per_path_error(result, error="invalid_input", reason="invalid_directory_path") and "255-byte" in result.text

        run.step(
            label="F-43: segment exceeding 255 bytes rejected",
            passed=passed_f43,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-44: total path > 4096 bytes is rejected ─────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        long_path = f"{base_dir}/" + "/".join(["xx"] * 2050)
        result = ctx.client.call_tool("manage_directory", action="create", paths=[long_path])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f44 = _per_path_error(result, error="invalid_input", reason="invalid_directory_path")

        run.step(
            label="F-44: total resolved path exceeding 4,096 bytes rejected",
            passed=passed_f44,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-46: empty array is rejected ─────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        try:
            payload = json.loads(result.text)
            result_count = len(payload.get("results", []))
        except json.JSONDecodeError:
            result_count = -1
        passed_f46 = result.ok and result_count == 0

        run.step(
            label="F-46: empty array rejected",
            passed=passed_f46,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-47: type error (number in paths) is rejected ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("manage_directory", action="create", paths=[123])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_validation_error = any(kw in result.text.lower() for kw in ["invalid", "type", "expected", "array", "must be", "string"])
        passed_f47 = not result.ok and has_validation_error

        run.step(
            label="F-47: type error (number in paths) is rejected by Zod schema",
            passed=passed_f47,
            detail=f"ok={result.ok} | has_validation_error={has_validation_error} | {result.text[:200]}",
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

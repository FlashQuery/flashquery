#!/usr/bin/env python3
"""
Test: create_directory — illegal character sanitization (colon, multiple chars, NUL byte, control chars 1–31).

Coverage points: F-33, F-34, F-35, F-36

  F-33  Colon (:) sanitized to space; response reports original name
  F-34  Multiple illegal characters (: and |) in one segment all sanitized; response reports all replacements
  F-35  NUL byte (\\x00) sanitized to space; response reports replacement
  F-36  Control character (byte 1–31, not NUL) sanitized to space; response reports replacement

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_create_directory_sanitization.py                            # existing server
    python test_create_directory_sanitization.py --managed                  # managed server
    python test_create_directory_sanitization.py --managed --json           # structured JSON with server logs
    python test_create_directory_sanitization.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["F-33", "F-34", "F-35", "F-36"]

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_create_directory_sanitization"


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

        # ── F-33: colon (:) is sanitized to space ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/meeting:notes")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Colon → space: dir becomes "meeting notes"
        sanitized_dir_exists = ctx.vault._abs(f"{base_dir}/meeting notes").is_dir()
        sanitized_note_in_response = 'sanitized from "meeting:notes"' in result.text
        passed_f33 = result.ok and sanitized_dir_exists and sanitized_note_in_response

        run.step(
            label="F-33: colon in segment sanitized to space; response reports original name",
            passed=passed_f33,
            detail=f"dir_exists={sanitized_dir_exists} sanitized_note={sanitized_note_in_response} | ok={result.ok} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-34: multiple illegal characters in one segment all sanitized ────
        # Use "foo:|bar" — colon and pipe in same segment → "foo  bar" → collapsed → "foo bar"
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/foo:|bar")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Both illegal chars sanitized → dir becomes "foo  bar" → after collapse → "foo bar"
        sanitized_dir_exists = ctx.vault._abs(f"{base_dir}/foo  bar").is_dir() or ctx.vault._abs(f"{base_dir}/foo bar").is_dir()
        # Response must explicitly say "replaced" — ':|' alone is insufficient because the original
        # path "foo:|bar" echoes back in the "sanitized from" clause, making ':|' always present.
        replaced_reported = "replaced" in result.text
        passed_f34 = result.ok and sanitized_dir_exists and replaced_reported

        run.step(
            label="F-34: multiple illegal chars in one segment — response reports all replacements",
            passed=passed_f34,
            detail=f"dir_exists={sanitized_dir_exists} replaced_reported={replaced_reported} | ok={result.ok} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-35: NUL byte in segment sanitized to space ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/bad\x00name")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # NUL → space: dir becomes "bad name"
        sanitized_dir_exists = ctx.vault._abs(f"{base_dir}/bad name").is_dir()
        replaced_reported = "replaced" in result.text
        passed_f35 = result.ok and sanitized_dir_exists and replaced_reported

        run.step(
            label="F-35: NUL byte sanitized to space; response reports replacement",
            passed=passed_f35,
            detail=f"dir_exists={sanitized_dir_exists} replaced_reported={replaced_reported} | ok={result.ok} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-36: control character (byte 1–31, not NUL) sanitized to space ───
        log_mark = ctx.server.log_position if ctx.server else 0
        # \x01 is byte 1 (SOH), a non-NUL control character
        result = ctx.client.call_tool("create_directory", paths=f"{base_dir}/ctrl\x01char")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # \x01 → space: dir becomes "ctrl char"
        sanitized_dir_exists = ctx.vault._abs(f"{base_dir}/ctrl char").is_dir()
        replaced_reported = "replaced" in result.text
        passed_f36 = result.ok and sanitized_dir_exists and replaced_reported

        run.step(
            label="F-36: control character (byte \\x01) sanitized to space; response reports replacement",
            passed=passed_f36,
            detail=f"dir_exists={sanitized_dir_exists} replaced_reported={replaced_reported} | ok={result.ok} | {result.text[:300]}",
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
        description="Test: create_directory sanitization (illegal chars, NUL, intermediate segments).",
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

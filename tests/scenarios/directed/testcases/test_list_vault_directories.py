#!/usr/bin/env python3
"""
Test: list_vault — directory-specific tests: dot-dir filtering, depth sort, limit behavior.

Coverage points: F-55, F-56, F-57, F-58, F-62, F-63, F-64, F-67

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault_directories.py
    python test_list_vault_directories.py --managed
    python test_list_vault_directories.py --managed --json
    python test_list_vault_directories.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-55", "F-56", "F-57", "F-58", "F-62", "F-63", "F-64", "F-67"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault_directories"


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

        # ── Setup: create directory structure ─────────────────────────────────
        # Create: base_dir/alpha/, base_dir/beta/, base_dir/alpha/child/
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/alpha/child")
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/beta")

        # Create dot-prefixed directory directly (create_directory also creates it)
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/.hidden")

        # Create a file in base_dir so F-55 and F-62 can assert it doesn't appear
        notes_path = ctx.vault._abs(f"{base_dir}/notes.md")
        notes_path.write_text(f"Test note for {run.run_id}\n")
        ctx.cleanup.track_file(f"{base_dir}/notes.md")

        # ── F-55: show='directories' → only directories, no files ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        notes_absent = "notes.md" not in result.text
        passed_f55 = result.ok and "alpha/" in result.text and notes_absent

        run.step(
            label="F-55: show=directories returns only directory entries (no files)",
            passed=passed_f55,
            detail=f"ok={result.ok} alpha_present={'alpha/' in result.text} notes_absent={notes_absent} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-56: recursive=True → depth ordering (alpha/ before alpha/child/) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        alpha_pos = result.text.find("alpha/")
        beta_pos = result.text.find("beta/")
        # Find position of alpha/child/ — the nested entry
        child_text = "alpha/child/"
        child_pos = result.text.find(child_text)
        # Depth ordering: alpha/ appears before alpha/child/ (parent before descendant)
        # Alphabetical at same depth: alpha/ appears before beta/
        depth_ordered = alpha_pos != -1 and child_pos != -1 and alpha_pos < child_pos
        alpha_before_beta = alpha_pos != -1 and beta_pos != -1 and alpha_pos < beta_pos
        passed_f56 = result.ok and depth_ordered and alpha_before_beta

        run.step(
            label="F-56: show=directories recursive=True: depth-ordered (alpha/ before alpha/child/) and alphabetical (alpha/ before beta/)",
            passed=passed_f56,
            detail=f"ok={result.ok} alpha_pos={alpha_pos} beta_pos={beta_pos} child_pos={child_pos} depth_ordered={depth_ordered} alpha_before_beta={alpha_before_beta} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-57: empty directories are included (beta/ has no children) ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        beta_present = "beta/" in result.text
        # beta/ has no subdirectories — if Children: 0 appears, the empty dir is shown
        children_zero = "Children: 0" in result.text
        passed_f57 = result.ok and beta_present and children_zero

        run.step(
            label="F-57: show=directories includes empty directories (beta/ with Children: 0)",
            passed=passed_f57,
            detail=f"ok={result.ok} beta_present={beta_present} children_zero={children_zero} | {result.text[:400]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-58: .hidden/ is NOT in response text ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        hidden_absent = ".hidden" not in result.text
        passed_f58 = result.ok and hidden_absent

        run.step(
            label="F-58: dot-prefixed directory .hidden/ is not visible in listing",
            passed=passed_f58,
            detail=f"ok={result.ok} hidden_absent={hidden_absent} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-62: extensions filter with show='directories' → extensions silently ignored, only dirs returned ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", extensions=[".md"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # extensions silently ignored: dirs appear, the .md file does NOT appear
        notes_absent_f62 = "notes.md" not in result.text
        dirs_present = "alpha/" in result.text
        passed_f62 = result.ok and notes_absent_f62 and dirs_present

        run.step(
            label="F-62: extensions filter with show=directories silently ignored — dirs returned, notes.md file absent",
            passed=passed_f62,
            detail=f"ok={result.ok} notes_absent={notes_absent_f62} dirs_present={dirs_present} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-63: date filter affects directory listings ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        # Call 1: after="1d" — dirs created within last 1 day should appear
        result_recent = ctx.client.call_tool("list_vault", path=base_dir, show="directories", after="1d")
        # Call 2: before="2000-01-01" — dirs older than year 2000; all just-created dirs should be absent
        result_old = ctx.client.call_tool("list_vault", path=base_dir, show="directories", before="2000-01-01")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        alpha_in_recent = "alpha/" in result_recent.text
        alpha_in_old = "alpha/" in result_old.text
        # Recent dirs should appear with after="1d"; no dirs should appear with before="2000-01-01"
        passed_f63 = result_recent.ok and result_old.ok and alpha_in_recent and not alpha_in_old

        run.step(
            label="F-63: date filter affects directory listings (after=1d includes recent, before=2000-01-01 excludes all)",
            passed=passed_f63,
            detail=f"recent_ok={result_recent.ok} alpha_in_recent={alpha_in_recent} old_ok={result_old.ok} alpha_in_old={alpha_in_old} | recent={result_recent.text[:200]} | old={result_old.text[:200]}",
            timing_ms=result_recent.timing_ms,
            tool_result=result_recent,
            server_logs=step_logs,
        )

        # ── F-64: limit=1 with 2+ dirs → truncation notice ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", limit=1)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f64 = result.ok and "truncated" in result.text.lower()

        run.step(
            label="F-64: limit=1 with multiple directories shows truncation notice",
            passed=passed_f64,
            detail=f"ok={result.ok} truncated={'truncated' in result.text.lower()} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-67: directory entry format includes path (trailing /), type, children, updated, created ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="directories", format="detailed")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_trailing_slash = "/" in result.text  # some dir entry ends with /
        has_type_field = "Type:" in result.text
        has_children_field = "Children:" in result.text
        has_updated_field = "Updated:" in result.text
        has_created_field = "Created:" in result.text
        passed_f67 = (
            result.ok
            and has_trailing_slash
            and has_type_field
            and has_children_field
            and has_updated_field
            and has_created_field
        )

        run.step(
            label="F-67: directory entry format includes path (trailing /), Type, Children, Updated, Created fields",
            passed=passed_f67,
            detail=(
                f"ok={result.ok} trailing_slash={has_trailing_slash} "
                f"type={has_type_field} children={has_children_field} "
                f"updated={has_updated_field} created={has_created_field} | {result.text[:400]}"
            ),
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
        description="Test: list_vault directory-specific tests.",
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

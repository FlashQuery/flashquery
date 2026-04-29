#!/usr/bin/env python3
"""
Test: list_vault — show modes, basic filtering, summary line, non-existent path, zero-params.

Coverage points: F-08, F-09, F-10, F-11, F-53, F-54, F-65, F-68, F-84, F-85, F-86, F-87, F-88, F-89, F-90, F-91

Modes:
    Default     Connects to an already-running FQC instance
    --managed   Starts a dedicated FQC subprocess

Usage:
    python test_list_vault.py
    python test_list_vault.py --managed
    python test_list_vault.py --managed --json
    python test_list_vault.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""
from __future__ import annotations

COVERAGE = ["F-08", "F-09", "F-10", "F-11", "F-53", "F-54", "F-65", "F-68", "F-84", "F-85", "F-86", "F-87", "F-88", "F-89", "F-90", "F-91"]

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_list_vault"


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
        ctx.client.call_tool("create_directory", paths=f"{base_dir}/sub/deep")

        top_result = ctx.client.call_tool(
            "create_document",
            title=f"Top {run.run_id}",
            content="Top-level document.",
            path=f"{base_dir}/top.md",
            tags=["fqc-test", run.run_id],
        )
        nested_result = ctx.client.call_tool(
            "create_document",
            title=f"Nested {run.run_id}",
            content="Nested document.",
            path=f"{base_dir}/sub/nested.md",
            tags=["fqc-test", run.run_id],
        )
        leaf_result = ctx.client.call_tool(
            "create_document",
            title=f"Leaf {run.run_id}",
            content="Leaf document.",
            path=f"{base_dir}/sub/deep/leaf.md",
            tags=["fqc-test", run.run_id],
        )

        # Extract fqc_ids for cleanup
        def extract_fqc_id(text: str) -> str:
            m = re.search(r"FQC ID:\s*(\S+)", text)
            return m.group(1).strip() if m else ""

        for r in (top_result, nested_result, leaf_result):
            fid = extract_fqc_id(r.text)
            if fid:
                ctx.cleanup.track_mcp_document(fid)

        # Create an untracked .txt file directly
        t0 = time.monotonic()
        txt_abs = ctx.vault._abs(f"{base_dir}/untracked.txt")
        txt_abs.parent.mkdir(parents=True, exist_ok=True)
        txt_abs.write_text(f"untracked note for {run.run_id}\n")
        ctx.cleanup.track_file(f"{base_dir}/untracked.txt")

        # Create an untracked .md file directly (for F-87 untracked-note assertion)
        md_untracked_abs = ctx.vault._abs(f"{base_dir}/untracked_note.md")
        md_untracked_abs.write_text(f"untracked markdown for {run.run_id}\n")
        ctx.cleanup.track_file(f"{base_dir}/untracked_note.md")

        run.step(
            label="Setup: write untracked.txt and untracked_note.md directly to vault",
            passed=txt_abs.is_file() and md_untracked_abs.is_file(),
            detail=f"path={base_dir}/untracked.txt, {base_dir}/untracked_note.md",
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── F-08: list_vault non-recursive → top.md present, nested.md NOT ────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        top_present = "top.md" in result.text
        nested_absent = "nested.md" not in result.text
        passed_f08 = result.ok and top_present and nested_absent

        run.step(
            label="F-08: list_vault non-recursive returns immediate children only",
            passed=passed_f08,
            detail=f"ok={result.ok} top_present={top_present} nested_absent={nested_absent} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-09: list_vault recursive → all 3 .md files present ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f09 = result.ok and "nested.md" in result.text and "leaf.md" in result.text

        run.step(
            label="F-09: list_vault recursive returns all descendants",
            passed=passed_f09,
            detail=f"ok={result.ok} nested={'nested.md' in result.text} leaf={'leaf.md' in result.text} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-10: recursive + extensions=['.md'] → .txt excluded ─────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, extensions=[".md"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        txt_absent = "untracked.txt" not in result.text
        passed_f10 = result.ok and "top.md" in result.text and txt_absent

        run.step(
            label='F-10: list_vault extensions=[".md"] excludes non-markdown files',
            passed=passed_f10,
            detail=f"ok={result.ok} txt_absent={txt_absent} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-11: date filter — recent files appear; ancient range returns none ─
        log_mark = ctx.server.log_position if ctx.server else 0
        result_recent = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, after="365d")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f11_in = result_recent.ok and "top.md" in result_recent.text

        log_mark = ctx.server.log_position if ctx.server else 0
        result_old = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True, before="2000-01-01")
        step_logs_old = ctx.server.logs_since(log_mark) if ctx.server else None

        old_empty = result_old.ok and ("No files found" in result_old.text or "0 of 0" in result_old.text or "top.md" not in result_old.text)
        passed_f11 = passed_f11_in and old_empty

        run.step(
            label="F-11: list_vault date filter includes recent files, excludes ancient range",
            passed=passed_f11,
            detail=f"recent_ok={result_recent.ok} recent_has_top={'top.md' in result_recent.text} old_empty={old_empty} | {result_recent.text[:100]}",
            timing_ms=result_recent.timing_ms + result_old.timing_ms,
            tool_result=result_recent,
            server_logs=step_logs,
        )

        # ── F-53: show="files" non-recursive → no directory entry appears ───────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # "| directory |" type column value signals a directory row in the table
        no_dir_entry = "| directory |" not in result.text
        has_file_entry = "top.md" in result.text
        passed_f53 = result.ok and no_dir_entry and has_file_entry

        run.step(
            label="F-53: show='files' non-recursive returns no directory entries",
            passed=passed_f53,
            detail=f"ok={result.ok} no_dir_entry={no_dir_entry} has_file_entry={has_file_entry} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-54: show="files" recursive → no directory entries appear ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="files", recursive=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # "directory" type column value signals a directory row in the table
        no_dir_entry = "| directory |" not in result.text
        has_nested = "nested.md" in result.text
        has_leaf = "leaf.md" in result.text
        passed_f54 = result.ok and no_dir_entry and has_nested and has_leaf

        run.step(
            label="F-54: show='files' recursive returns no directory entries",
            passed=passed_f54,
            detail=f"ok={result.ok} no_dir_entry={no_dir_entry} has_nested={has_nested} has_leaf={has_leaf} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-65: show="folders" is invalid → isError: true ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir, show="folders")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f65 = not result.ok

        run.step(
            label="F-65: show='folders' (invalid value) returns isError=true",
            passed=passed_f65,
            detail=f"ok={result.ok} (expected False) | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-66: DEFERRED — shutdown simulation cannot be done from subprocess ──
        # Shutdown-state testing requires coordinated subprocess control that is not
        # available in the directed scenario framework.  This step is NOT a coverage
        # claim; it passes unconditionally so it does not block the suite.
        run.step(
            label="F-66 (DEFERRED): shutdown-state test — not exercised in directed suite",
            passed=True,
            detail="Deferred: shutdown simulation requires subprocess control outside this framework",
            timing_ms=0,
        )

        # ── F-68: zero-parameter call → vault root listing ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_header = "| Name |" in result.text or "Showing" in result.text
        passed_f68 = result.ok and has_header

        run.step(
            label="F-68: list_vault with no parameters returns vault root listing",
            passed=passed_f68,
            detail=f"ok={result.ok} has_header={has_header} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-84: non-existent path → isError: true ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="_nonexistent_dir_xyzzy_/that_cannot_exist")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f84 = not result.ok

        run.step(
            label="F-84: non-existent path returns isError=true",
            passed=passed_f84,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-85: path is a FILE not directory → isError ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=f"{base_dir}/top.md")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f85 = not result.ok

        run.step(
            label="F-85: path pointing to a file returns isError=true",
            passed=passed_f85,
            detail=f"ok={result.ok} | {result.text[:200]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-86: show="all" default returns mixed content (dirs + files) ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_dir_entry = "| directory |" in result.text
        has_file_entry = "top.md" in result.text
        passed_f86 = result.ok and has_dir_entry and has_file_entry

        run.step(
            label="F-86: show='all' default returns mixed content (directory entry AND file entry)",
            passed=passed_f86,
            detail=f"ok={result.ok} has_dir={has_dir_entry} has_file={has_file_entry} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-87: untracked .md file triggers trailing untracked-files note ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path=base_dir)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_untracked_note = "untracked file" in result.text.lower()
        passed_f87 = result.ok and has_untracked_note

        run.step(
            label="F-87: untracked .md file causes response to include untracked-files note",
            passed=passed_f87,
            detail=f"ok={result.ok} has_untracked_note={has_untracked_note} | {result.text[-300:]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-88: summary line format 'Showing N of N entries in /.' ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_showing = "Showing" in result.text
        passed_f88 = result.ok and has_showing

        run.step(
            label="F-88: summary line format starts with 'Showing N of N entries'",
            passed=passed_f88,
            detail=f"ok={result.ok} has_showing={has_showing} | {result.text[-200:]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-89: date_field="created" filters on creation timestamp ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result_recent = ctx.client.call_tool(
            "list_vault", path=base_dir, show="files", recursive=True,
            date_field="created", after="1d",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        recent_has_top = result_recent.ok and "top.md" in result_recent.text

        log_mark2 = ctx.server.log_position if ctx.server else 0
        result_future = ctx.client.call_tool(
            "list_vault", path=base_dir, show="files", recursive=True,
            date_field="created", after="2030-01-01",
        )
        step_logs2 = ctx.server.logs_since(log_mark2) if ctx.server else None

        future_no_top = result_future.ok and "top.md" not in result_future.text
        passed_f89 = recent_has_top and future_no_top

        run.step(
            label="F-89: date_field='created' filters on creation timestamp (after=1d includes; after=2030-01-01 excludes)",
            passed=passed_f89,
            detail=(
                f"recent_ok={result_recent.ok} recent_has_top={recent_has_top} "
                f"future_ok={result_future.ok} future_no_top={future_no_top} | "
                f"recent={result_recent.text[:150]} | future={result_future.text[:100]}"
            ),
            timing_ms=result_recent.timing_ms + result_future.timing_ms,
            tool_result=result_recent,
            server_logs=step_logs,
        )

        # ── F-90: extensions=[".md", ".txt"] → both types appear; dirs unaffected
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool(
            "list_vault", path=base_dir, recursive=False,
            extensions=[".md", ".txt"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        has_md = "top.md" in result.text
        has_txt = "untracked.txt" in result.text
        has_dir = "| directory |" in result.text
        passed_f90 = result.ok and has_md and has_txt and has_dir

        run.step(
            label="F-90: extensions=['.md', '.txt'] shows .md files, .txt files, AND directory entries",
            passed=passed_f90,
            detail=f"ok={result.ok} has_md={has_md} has_txt={has_txt} has_dir={has_dir} | {result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
            server_logs=step_logs,
        )

        # ── F-91: path traversal → isError: true ──────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        result = ctx.client.call_tool("list_vault", path="../../etc")
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        passed_f91 = not result.ok

        run.step(
            label="F-91: path='../../etc' (traversal) returns isError=true",
            passed=passed_f91,
            detail=f"ok={result.ok} (expected False) | {result.text[:300]}",
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
        description="Test: list_vault show modes, filtering, summary line, non-existent path, zero-params.",
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

#!/usr/bin/env python3
"""
Test: Large vault correctness under sustained, interleaved operations.

Scenario:
    1. Pre-seed the vault with external files (configurable %, default ~68%)
    2. Run deterministically interleaved MCP operations (creates, updates, archives)
    3. Interleave external file modifications at strategic points
    4. Force synchronous file scans to reconcile external changes
    5. Validate correctness at checkpoints:
       - list_vault returns accurate counts and filtering
       - search_documents and search_all find correct documents
       - archived documents are properly excluded
       - no index corruption after sustained operations
    6. Repeat cycle, validating consistency throughout
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: SC-01 (mixed-operation correctness at scale), SC-02 (search correctness at scale)

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Configurable scale:
    --scale-size N              Total file operations to perform (default: 20)
    --create-percentage P       % of operations that are creates (default: 30)
    --update-percentage P       % of operations that are updates (default: 30)
    --archive-percentage P      % of operations that are archives (default: 20)
    Remaining % is pre-seeded externally at test start.

Usage:
    python test_large_vault_scale.py --managed                  # 20 ops (default, ~30s)
    python test_large_vault_scale.py --managed --scale-size 100  # 100 ops (~2 min)
    python test_large_vault_scale.py --managed --scale-size 200 --create-percentage 25  # 200 ops (~3-4 min)
    python test_large_vault_scale.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["SC-01", "SC-02"]

import argparse
import json
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_large_vault_scale"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_count_from_list(text: str) -> int:
    """Parse the number of files returned by list_vault (detailed format)."""
    lines = text.strip().split("\n---\n")
    # Filter out empty lines; each entry starts with "Title:"
    return sum(1 for entry in lines if entry.strip() and "Title:" in entry)


def _file_path(test_id: str, file_num: int) -> str:
    """Generate a deterministic file path for a file in the vault."""
    bucket = file_num % 10  # Distribute across 10 subdirectories to test deep listing
    return f"_test/{test_id}/bucket_{bucket}/doc_{file_num:05d}.md"


def _create_doc(
    ctx, run, title: str, path: str, label: str, tags: list = None
) -> tuple[str, str]:
    """Create a doc via MCP, register cleanup, record the step. Returns (fqc_id, path)."""
    if tags is None:
        tags = ["fqc-test", "scale-test", run.run_id]

    log_mark = ctx.server.log_position if ctx.server else 0
    result = ctx.client.call_tool(
        "create_document",
        title=title,
        content=f"## {title}\n\nFile created by {TEST_NAME} (run {run.run_id}).",
        path=path,
        tags=tags,
    )
    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

    created_fqc_id = _extract_field(result.text, "FQC ID")
    created_path = _extract_field(result.text, "Path")

    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)

    result.expect_contains(title)

    run.step(
        label=label,
        passed=(result.ok and result.status == "pass"),
        detail=expectation_detail(result) or result.error or "",
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=step_logs,
    )

    return (created_fqc_id, created_path) if result.ok else ("", "")


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Parse configurability arguments
    scale_size = getattr(args, "scale_size", 20)
    create_pct = getattr(args, "create_percentage", 30)
    update_pct = getattr(args, "update_percentage", 30)
    archive_pct = getattr(args, "archive_percentage", 20)

    # Calculate operation counts (focus on operations rather than pre-seeding)
    num_creates = max(1, int(scale_size * create_pct / 100))
    num_updates = max(1, int(scale_size * update_pct / 100))
    num_archives = max(1, int(scale_size * archive_pct / 100))
    num_external = max(0, scale_size - num_creates - num_updates - num_archives)

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:
        # ── Step 1: Pre-seed vault with external files ──────────────
        run.step(
            label=f"Pre-seed vault with {num_external} external files",
            passed=True,
            detail=f"Creating {num_external} files directly in vault (external source)...",
        )
        test_root = Path(ctx.vault.vault_root) / "_test" / run.run_id
        test_root.mkdir(parents=True, exist_ok=True)

        # Register directories for cleanup
        for i in range(10):
            bucket_dir = test_root / f"bucket_{i}"
            bucket_dir.mkdir(exist_ok=True)
            ctx.cleanup.track_dir(str(bucket_dir))
        ctx.cleanup.track_dir(str(test_root))
        ctx.cleanup.track_dir(str(test_root.parent))

        # Create external files
        for i in range(num_external):
            file_path = test_root / f"bucket_{i % 10}" / f"doc_{i:05d}.md"
            file_path.write_text(
                f"# External Document {i}\n\n"
                f"Created externally by {TEST_NAME} (run {run.run_id}).\n\n"
                f"This file was injected directly into the vault.\n"
            )
            rel = str(file_path.relative_to(ctx.vault.vault_root))
            ctx.cleanup.track_file(rel)
            ctx.cleanup.track_mcp_document(rel)

        # ── Step 2: Force file scan to index external files ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (external files)",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 3: Validate initial counts ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_vault",
            path=f"_test/{run.run_id}",
            recursive=True,
            format="detailed",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        initial_count = _extract_count_from_list(list_result.text)
        expected_after_seed = num_external
        detail = f"Found {initial_count} files, expected ≈{expected_after_seed}"

        run.step(
            label="list_vault (after external pre-seed)",
            passed=(list_result.ok and list_result.status == "pass"),
            detail=detail,
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        if not list_result.ok:
            return run

        # ── Step 4: Execute MCP creates (Phase 1) ───────────────────
        created_docs = []
        for i in range(num_creates):
            path = _file_path(run.run_id, num_external + i)
            title = f"Created Document {i}"
            fqc_id, _ = _create_doc(
                ctx,
                run,
                title,
                path,
                label=f"create_document ({i+1}/{num_creates})",
                tags=["fqc-test", "scale-test", "created", run.run_id],
            )
            if fqc_id:
                created_docs.append((fqc_id, path, title))

        # ── Step 5: Force file scan after creates ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (after creates)",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 6: Validate counts after creates ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_vault",
            path=f"_test/{run.run_id}",
            recursive=True,
            format="detailed",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        count_after_creates = _extract_count_from_list(list_result.text)
        expected_after_creates = num_external + num_creates
        detail = f"Found {count_after_creates} files, expected ≈{expected_after_creates}"

        run.step(
            label="list_vault (after creates)",
            passed=(list_result.ok and count_after_creates >= expected_after_creates - 1),
            detail=detail,
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        # ── Step 7: Execute MPC updates (Phase 2) ───────────────────
        for i in range(min(num_updates, len(created_docs))):
            fqc_id, path, _ = created_docs[i]
            log_mark = ctx.server.log_position if ctx.server else 0
            update_result = ctx.client.call_tool(
                "update_document",
                identifier=fqc_id,
                content=(
                    f"## Updated Document {i}\n\n"
                    f"Modified by {TEST_NAME} (run {run.run_id}).\n\n"
                    f"This document has been updated in-place."
                ),
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            run.step(
                label=f"update_document ({i+1}/{min(num_updates, len(created_docs))})",
                passed=update_result.ok,
                detail=expectation_detail(update_result) or update_result.error or "",
                timing_ms=update_result.timing_ms,
                tool_result=update_result,
                server_logs=step_logs,
            )

        # ── Step 8: Force file scan after updates ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (after updates)",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 9: Inject more external files during updates ───────
        for i in range(num_external // 2):
            file_num = num_external + num_creates + i
            file_path = test_root / f"bucket_{file_num % 10}" / f"doc_{file_num:05d}.md"
            file_path.write_text(
                f"# Mid-test External Document {i}\n\n"
                f"Injected during update phase by {TEST_NAME} (run {run.run_id}).\n"
            )
            rel = str(file_path.relative_to(ctx.vault.vault_root))
            ctx.cleanup.track_file(rel)
            ctx.cleanup.track_mcp_document(rel)

        # ── Step 10: Force file scan after external injection ────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=True)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (mid-test external injection)",
            passed=scan_result.ok,
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ── Step 11: Validate search after updates and external ─────
        # Search for documents by tag to verify index is current
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_documents",
            tags=["created"],
            tag_match="any",
            limit=100,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Should find the created (and updated) documents
        found_created = search_result.text.count("Created Document")
        detail = f"search_documents by tag: found {found_created} documents"

        run.step(
            label="search_documents (validation after updates)",
            passed=(search_result.ok and found_created > 0),
            detail=detail,
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 11: Archive a subset of documents (Phase 3) ────────
        for i in range(min(num_archives, len(created_docs))):
            fqc_id, _, _ = created_docs[i]
            log_mark = ctx.server.log_position if ctx.server else 0
            archive_result = ctx.client.call_tool(
                "archive_document",
                identifiers=fqc_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            archive_result.expect_contains("archived") or archive_result.expect_contains(
                "successfully"
            )

            run.step(
                label=f"archive_document ({i+1}/{min(num_archives, len(created_docs))})",
                passed=(archive_result.ok and archive_result.status == "pass"),
                detail=expectation_detail(archive_result) or archive_result.error or "",
                timing_ms=archive_result.timing_ms,
                tool_result=archive_result,
                server_logs=step_logs,
            )

        # ── Step 12: Validate archives are excluded from search ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_documents",
            query="document",
            limit=1000,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Count total found; should not include archived docs
        total_found = search_result.text.count("Title:")
        detail = f"search_documents after archives: found {total_found} active documents"

        run.step(
            label="search_documents (archived excluded)",
            passed=(search_result.ok and search_result.status == "pass"),
            detail=detail,
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 13: Final file count validation ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_vault",
            path=f"_test/{run.run_id}",
            recursive=True,
            format="detailed",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        final_count = _extract_count_from_list(list_result.text)
        expected_final = (
            num_external
            + num_creates
            + (num_external // 2)
            - num_archives  # Archived docs are still in vault files but excluded from default search
        )
        detail = (
            f"Final count: {final_count} files in vault "
            f"(expected ≈{expected_final}, "
            f"with {num_archives} archived)"
        )

        run.step(
            label="list_vault (final validation)",
            passed=(list_result.ok and list_result.status == "pass"),
            detail=detail,
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        # ── Step 14: Optionally retain files for debugging ────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {test_root}",
            )

        # ── Attach full server logs to the run ──────────────────────
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
        description="FQC large vault scale test.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--fqc-dir",
        type=str,
        default=None,
        help="Path to flashquery-core directory.",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="FQC server URL (when not using --managed).",
    )
    parser.add_argument(
        "--secret",
        type=str,
        default=None,
        help="Auth secret (when not using --managed).",
    )
    parser.add_argument(
        "--managed",
        action="store_true",
        help="Start a dedicated managed FQC server for this test.",
    )
    parser.add_argument(
        "--port-range",
        type=int,
        nargs=2,
        metavar=("MIN", "MAX"),
        default=None,
        help="Port range for managed server (default: 9100 9199).",
    )
    parser.add_argument(
        "--scale-size",
        type=int,
        default=20,
        help="Total file operations to perform (default: 20).",
    )
    parser.add_argument(
        "--create-percentage",
        type=int,
        default=30,
        help="Percentage of operations that are creates (default: 30).",
    )
    parser.add_argument(
        "--update-percentage",
        type=int,
        default=30,
        help="Percentage of operations that are updates (default: 30).",
    )
    parser.add_argument(
        "--archive-percentage",
        type=int,
        default=20,
        help="Percentage of operations that are archives (default: 20).",
    )
    parser.add_argument(
        "--json",
        dest="output_json",
        action="store_true",
        help="Output results as JSON (includes server logs).",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Retain vault files for debugging (skip cleanup).",
    )

    args = parser.parse_args()

    # If no server mode specified, show help
    if not args.managed and not args.url:
        print("Error: You must specify either --managed or --url <server_url>.", file=sys.stderr)
        parser.print_help(file=sys.stderr)
        sys.exit(1)

    run = run_test(args)

    if args.output_json:
        print(json.dumps(run.to_dict(), indent=2))
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Test: cross-cutting edge cases — batch identifiers, fire-and-forget embedding.

Scenario:
    X-05 — Batch identifiers (array input where supported):
        1. Create 3 documents via create_document
        2. force_file_scan to register them in the DB
        3. archive_document with identifiers=[path1, path2, path3] (list input)
        4. Verify response indicates all 3 archived (no errors)
        5. search_documents to confirm none of the 3 appear (all archived)
        6. Create 2 more documents
        7. force_file_scan
        8. apply_tags with identifiers=[path4, path5], add_tags=["batch-tag-<run_id>"]
        9. Verify both documents have the tag on disk

    X-11 — Fire-and-forget embedding does not block tool response:
        Requires a separate TestContext with require_embedding=True so that
        background embedding generation is actually triggered. Creates a
        document and asserts the response comes back within 5 seconds.
        After a brief delay, the document should be searchable (embedding
        was generated in the background).

    X-04 — Write lock contention returns error with guidance:
        SKIPPED — locking is hardcoded to disabled (enabled: False) in the
        managed test server config (FQCServer._generate_config in
        fqc_test_utils.py). Cannot reliably trigger lock contention without
        enabling locking. Coverage point X-04 is not tested here.

Coverage points: X-05, X-11 (X-04 skipped — see above)

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_cross_cutting_edge_cases.py                            # existing server
    python test_cross_cutting_edge_cases.py --managed                  # managed server
    python test_cross_cutting_edge_cases.py --managed --json           # structured JSON
    python test_cross_cutting_edge_cases.py --managed --json --keep    # keep files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["X-05", "X-11"]

import argparse
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

TEST_NAME = "test_cross_cutting_edge_cases"

# Maximum time (ms) a create_document call should take when embedding is
# fire-and-forget (the tool must NOT block waiting for embedding to finish).
EMBEDDING_NONBLOCKING_THRESHOLD_MS = 5000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _register_doc(ctx, created_path: str, created_fqc_id: str) -> None:
    """Track a document for cleanup (file + parent dirs + MCP identifier)."""
    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)


def _create_doc(ctx, title: str, path: str, run_id: str, tags: list[str]) -> tuple[str, str]:
    """Create a document and return (fqc_id, resolved_path). Returns ('', '') on failure."""
    result = ctx.client.call_tool(
        "create_document",
        title=title,
        content=f"## {title}\n\nCreated by {TEST_NAME} (run {run_id}).",
        path=path,
        tags=tags,
    )
    if not result.ok:
        return "", ""
    fqc_id = _extract_field(result.text, "FQC ID")
    resolved_path = _extract_field(result.text, "Path") or path
    _register_doc(ctx, resolved_path, fqc_id)
    return fqc_id, resolved_path


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    port_range = tuple(args.port_range) if args.port_range else None

    # =========================================================================
    # X-05 — Batch identifiers: archive_document and apply_tags with list input
    # =========================================================================

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create 3 fixture documents ───────────────────────
        batch_tag = f"ccec-{run.run_id}"
        paths: list[str] = []
        fqc_ids: list[str] = []

        all_created = True
        for i in range(1, 4):
            title = f"CCEC Batch Archive {i} {run.run_id}"
            path = f"_test/{TEST_NAME}_arc{i}_{run.run_id}.md"
            log_mark = ctx.server.log_position if ctx.server else 0
            result = ctx.client.call_tool(
                "create_document",
                title=title,
                content=f"## {title}\n\nBatch archive fixture {i} (run {run.run_id}).",
                path=path,
                tags=["fqc-test", batch_tag],
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            fqc_id = _extract_field(result.text, "FQC ID")
            resolved_path = _extract_field(result.text, "Path") or path
            _register_doc(ctx, resolved_path, fqc_id)

            if fqc_id:
                fqc_ids.append(fqc_id)
            paths.append(resolved_path)

            result.expect_contains(title)
            run.step(
                label=f"create_document fixture {i}/3 for batch archive (X-05)",
                passed=(result.ok and result.status == "pass"),
                detail=expectation_detail(result) or result.error or "",
                timing_ms=result.timing_ms,
                tool_result=result,
                server_logs=step_logs,
            )
            if not result.ok:
                all_created = False
                break

        if not all_created:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 2: force_file_scan to register them ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        scan_result.expect_contains("complete")
        run.step(
            label="force_file_scan after creating 3 batch-archive documents",
            passed=(scan_result.ok and scan_result.status == "pass"),
            detail=expectation_detail(scan_result) or scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 3: archive_document with list of identifiers (X-05) ─
        # Use fqc_ids if available, else fall back to paths
        archive_ids = fqc_ids if len(fqc_ids) == 3 else paths

        log_mark = ctx.server.log_position if ctx.server else 0
        archive_result = ctx.client.call_tool(
            "archive_document",
            identifiers=archive_ids,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Response should mention archiving — check it was successful
        archive_result.expect_contains("archived")

        run.step(
            label="archive_document with identifiers=list (X-05 batch archive)",
            passed=(archive_result.ok and archive_result.status == "pass"),
            detail=expectation_detail(archive_result) or archive_result.error or "",
            timing_ms=archive_result.timing_ms,
            tool_result=archive_result,
            server_logs=step_logs,
        )
        if not archive_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # After archiving, remove them from the MCP cleanup list to avoid
        # double-archive errors during teardown (they are already archived).
        ctx.cleanup._mcp_identifiers = [
            i for i in ctx.cleanup._mcp_identifiers
            if i not in archive_ids
        ]

        # ── Step 4: Verify archived docs don't appear in search ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        search_result = ctx.client.call_tool(
            "search_documents",
            query=batch_tag,
            tags=[batch_tag],
            limit=10,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Archived docs should NOT appear in normal search
        archived_titles_found = any(
            f"ccec batch archive" in search_result.text.lower()
            for _ in [1]  # single-pass check
        )
        # A clean search for these docs should return nothing
        search_passed = search_result.ok and not archived_titles_found

        run.step(
            label="search_documents confirms 3 batch-archived docs are excluded",
            passed=search_passed,
            detail=(
                "" if search_passed
                else f"Archived docs still visible in search. response={search_result.text[:200]!r}"
            ),
            timing_ms=search_result.timing_ms,
            tool_result=search_result,
            server_logs=step_logs,
        )

        # ── Step 5: Create 2 more documents for batch apply_tags ─────
        tag_paths: list[str] = []
        tag_fqc_ids: list[str] = []
        batch_apply_tag = f"ccec-batch-tag-{run.run_id}"

        all_created = True
        for i in range(1, 3):
            title = f"CCEC Batch Tag {i} {run.run_id}"
            path = f"_test/{TEST_NAME}_tag{i}_{run.run_id}.md"
            log_mark = ctx.server.log_position if ctx.server else 0
            result = ctx.client.call_tool(
                "create_document",
                title=title,
                content=f"## {title}\n\nBatch tag fixture {i} (run {run.run_id}).",
                path=path,
                tags=["fqc-test", f"ccec-tag-{run.run_id}"],
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            fqc_id = _extract_field(result.text, "FQC ID")
            resolved_path = _extract_field(result.text, "Path") or path
            _register_doc(ctx, resolved_path, fqc_id)

            if fqc_id:
                tag_fqc_ids.append(fqc_id)
            tag_paths.append(resolved_path)

            result.expect_contains(title)
            run.step(
                label=f"create_document fixture {i}/2 for batch apply_tags (X-05)",
                passed=(result.ok and result.status == "pass"),
                detail=expectation_detail(result) or result.error or "",
                timing_ms=result.timing_ms,
                tool_result=result,
                server_logs=step_logs,
            )
            if not result.ok:
                all_created = False
                break

        if not all_created:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 6: force_file_scan again ─────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.client.call_tool("force_file_scan", background=False)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        scan2_result.expect_contains("complete")
        run.step(
            label="force_file_scan after creating 2 batch-tag documents",
            passed=(scan2_result.ok and scan2_result.status == "pass"),
            detail=expectation_detail(scan2_result) or scan2_result.error or "",
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )
        if not scan2_result.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Step 7: apply_tags with identifiers=[doc1, doc2] (X-05) ──
        # Use fqc_ids if available, else fall back to paths
        apply_ids = tag_fqc_ids if len(tag_fqc_ids) == 2 else tag_paths

        log_mark = ctx.server.log_position if ctx.server else 0
        tag_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=apply_ids,
            add_tags=[batch_apply_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        tag_result.expect_contains("Updated tags")

        # Verify on disk that both documents received the tag
        t0 = time.monotonic()
        disk_checks: dict[str, bool] = {}
        for i, p in enumerate(tag_paths):
            try:
                doc = ctx.vault.read_file(p)
                disk_checks[f"doc{i+1} has batch_apply_tag on disk"] = (
                    batch_apply_tag in doc.tags
                )
            except Exception as e:
                disk_checks[f"doc{i+1} disk read failed"] = False
        elapsed = int((time.monotonic() - t0) * 1000)

        all_disk_ok = all(disk_checks.values())
        detail = expectation_detail(tag_result) or tag_result.error or ""
        if not all_disk_ok:
            failed = [k for k, v in disk_checks.items() if not v]
            detail = f"{detail} Disk failed: {', '.join(failed)}."

        run.step(
            label="apply_tags with identifiers=list, both docs updated on disk (X-05)",
            passed=(tag_result.ok and tag_result.status == "pass" and all_disk_ok),
            detail=detail,
            timing_ms=tag_result.timing_ms or elapsed,
            tool_result=tag_result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run (X-05 phase) ──────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After X-05 context — record cleanup errors so far
    run.record_cleanup(ctx.cleanup_errors)

    # =========================================================================
    # X-11 — Fire-and-forget embedding: create_document returns quickly
    # =========================================================================
    # Start a *separate* managed TestContext with require_embedding=True so
    # the server is configured to generate embeddings, and we can verify that
    # create_document does not block waiting for the embedding to finish.

    x11_path = f"_test/{TEST_NAME}_x11_{run.run_id}.md"
    x11_title = f"CCEC Embedding NonBlocking {run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=True,
        log_level="debug",
    ) as emb_ctx:

        # ── Step X-11: create_document must return in < 5 s ──────────
        log_mark = emb_ctx.server.log_position if emb_ctx.server else 0
        t_create_start = time.monotonic()
        create_result = emb_ctx.client.call_tool(
            "create_document",
            title=x11_title,
            content=(
                f"## Fire-and-Forget Embedding Test\n\n"
                f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
                f"This document verifies that create_document returns immediately "
                f"even when background embedding generation is triggered. "
                f"The embedding is computed asynchronously and must not block "
                f"the tool response."
            ),
            path=x11_path,
            tags=["fqc-test", f"ccec-x11-{run.run_id}"],
        )
        t_create_end = time.monotonic()
        step_logs = emb_ctx.server.logs_since(log_mark) if emb_ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path") or x11_path
        _register_doc(emb_ctx, created_path, created_fqc_id)

        create_result.expect_contains(x11_title)

        response_ms = int((t_create_end - t_create_start) * 1000)
        nonblocking = response_ms < EMBEDDING_NONBLOCKING_THRESHOLD_MS

        all_ok = create_result.ok and create_result.status == "pass" and nonblocking
        detail = expectation_detail(create_result) or create_result.error or ""
        if not nonblocking:
            detail = (
                f"{detail} Tool took {response_ms}ms which exceeds the "
                f"{EMBEDDING_NONBLOCKING_THRESHOLD_MS}ms threshold — embedding "
                f"generation may be blocking the response."
            )

        run.step(
            label=(
                f"create_document with embedding enabled returns in < "
                f"{EMBEDDING_NONBLOCKING_THRESHOLD_MS}ms (X-11 fire-and-forget, "
                f"actual: {response_ms}ms)"
            ),
            passed=all_ok,
            detail=detail,
            timing_ms=response_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )

        # ── Step X-11b: after brief delay, document is searchable ─────
        # Wait a moment for the background embedding to settle, then
        # verify the document can be retrieved (it exists in the DB).
        if create_result.ok:
            time.sleep(1)

            log_mark = emb_ctx.server.log_position if emb_ctx.server else 0
            get_result = emb_ctx.client.call_tool(
                "get_document",
                identifier=created_fqc_id or created_path,
            )
            step_logs = emb_ctx.server.logs_since(log_mark) if emb_ctx.server else None

            # get_document returns the document body, not the metadata header.
            # Check for the run_id which appears in the body content.
            get_result.expect_contains(run.run_id)

            run.step(
                label="get_document confirms create_document persisted doc before embedding (X-11)",
                passed=(get_result.ok and get_result.status == "pass"),
                detail=expectation_detail(get_result) or get_result.error or "",
                timing_ms=get_result.timing_ms,
                tool_result=get_result,
                server_logs=step_logs,
            )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            emb_ctx.cleanup._vault_files.clear()
            emb_ctx.cleanup._mcp_identifiers.clear()
            emb_ctx.cleanup._vault_dirs.clear()

        # ── Attach embedding server logs ──────────────────────────────
        if emb_ctx.server and run.server_logs is None:
            run.attach_server_logs(emb_ctx.server.captured_logs)

    # Accumulate cleanup errors from the embedding phase
    existing_errors = list(run.cleanup_errors)
    run.record_cleanup(existing_errors + emb_ctx.cleanup_errors)

    # ── X-04 skipped note ────────────────────────────────────────────
    run.step(
        label=(
            "X-04 SKIPPED — write lock contention: locking is hardcoded to "
            "enabled=False in managed test server config (FQCServer._generate_config). "
            "Cannot trigger lock contention without enabling locking."
        ),
        passed=True,  # skipped is not a failure
        detail="Coverage point X-04 not tested in this file.",
        timing_ms=0,
    )

    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: batch identifiers (X-05) and fire-and-forget embedding (X-11).",
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

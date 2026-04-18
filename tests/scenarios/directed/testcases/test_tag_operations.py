#!/usr/bin/env python3
"""
Test: apply_tags add / remove / idempotent / graceful / memory / batch / normalization.

Scenario:
    1. Create two documents via MCP so we can test batch tagging (create_document x2)
    2. apply_tags add_tags on doc1 — verify tags land on disk (T-01)
    3. apply_tags add_tags with an already-present tag on doc1 — idempotent no-op (T-03)
    4. apply_tags remove_tags on doc1 — verify removed from disk (T-02)
    5. apply_tags remove_tags on doc1 with a tag not present — graceful no-op (T-04)
    6. apply_tags with identifiers=[doc1, doc2] — verify both updated on disk (T-06)
    7. apply_tags with whitespace/mixed-case tag — verify normalized on disk (T-07)
    8. save_memory, then apply_tags with memory_id — verify tag via get_memory (T-05)
    Cleanup: documents auto-archived via TestCleanup; memory archived best-effort at the end.

Coverage points: T-01, T-02, T-03, T-04, T-05, T-06, T-07

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_tag_operations.py                            # existing server
    python test_tag_operations.py --managed                  # managed server
    python test_tag_operations.py --managed --json           # structured JSON with server logs
    python test_tag_operations.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07"]

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

TEST_NAME = "test_tag_operations"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_memory_id(text: str) -> str:
    """Parse the memory UUID from a save_memory response like 'Memory saved (id: <uuid>).'"""
    m = re.search(r"\(id:\s*([0-9a-fA-F-]{36})\)", text)
    return m.group(1) if m else ""


def _register_doc(ctx, created_path: str, created_fqc_id: str) -> None:
    """Track a document for cleanup (file + parent dirs + MCP identifier)."""
    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    title1 = f"FQC Tag Test A {run.run_id}"
    title2 = f"FQC Tag Test B {run.run_id}"
    test_path1 = f"_test/{TEST_NAME}_A_{run.run_id}.md"
    test_path2 = f"_test/{TEST_NAME}_B_{run.run_id}.md"
    body = (
        f"## Tag Operations Fixture\n\n"
        f"Created by {TEST_NAME} (run {run.run_id})."
    )
    # Baseline tags applied at creation time
    initial_tags = ["fqc-test", f"tagops-{run.run_id}"]

    # Tags used across the steps
    add_new_tag = "tagops-added"           # T-01
    idempotent_tag = initial_tags[0]        # T-03 — already present
    remove_existing_tag = "tagops-added"    # T-02 — remove what we just added
    remove_absent_tag = "tagops-never-existed"  # T-04 — no-op
    batch_tag = f"tagops-batch-{run.run_id}"  # T-06
    raw_normalize_tag = "  MixedCaseTag  "  # T-07 — expect normalized
    normalized_tag = "mixedcasetag"

    port_range = tuple(args.port_range) if args.port_range else None

    memory_id: str = ""

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create two fixture documents ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create1 = ctx.client.call_tool(
            "create_document",
            title=title1,
            content=body,
            path=test_path1,
            tags=initial_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_1 = _extract_field(create1.text, "FQC ID")
        path_1 = _extract_field(create1.text, "Path") or test_path1
        _register_doc(ctx, path_1, fqc_id_1)

        create1.expect_contains(title1)
        run.step(
            label="create_document (fixture A)",
            passed=(create1.ok and create1.status == "pass"),
            detail=expectation_detail(create1) or create1.error or "",
            timing_ms=create1.timing_ms,
            tool_result=create1,
            server_logs=step_logs,
        )
        if not create1.ok:
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        create2 = ctx.client.call_tool(
            "create_document",
            title=title2,
            content=body,
            path=test_path2,
            tags=initial_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_2 = _extract_field(create2.text, "FQC ID")
        path_2 = _extract_field(create2.text, "Path") or test_path2
        _register_doc(ctx, path_2, fqc_id_2)

        create2.expect_contains(title2)
        run.step(
            label="create_document (fixture B)",
            passed=(create2.ok and create2.status == "pass"),
            detail=expectation_detail(create2) or create2.error or "",
            timing_ms=create2.timing_ms,
            tool_result=create2,
            server_logs=step_logs,
        )
        if not create2.ok:
            return run

        read_id_1 = fqc_id_1 or path_1
        read_id_2 = fqc_id_2 or path_2

        # ── Step 2: apply_tags add on doc1 (T-01) ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        add_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=read_id_1,
            add_tags=[add_new_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        add_result.expect_contains("Updated tags")
        add_result.expect_contains(add_new_tag)

        # Disk verification — ground truth
        t0 = time.monotonic()
        doc = ctx.vault.read_file(path_1)
        elapsed = int((time.monotonic() - t0) * 1000)
        checks = {
            "new tag on disk": add_new_tag in doc.tags,
            "initial tag preserved": initial_tags[1] in doc.tags,
            "fqc_id unchanged": doc.fqc_id == fqc_id_1 if fqc_id_1 else True,
        }
        all_ok = (add_result.ok and add_result.status == "pass"
                  and all(checks.values()))
        detail = expectation_detail(add_result) or add_result.error or ""
        if not all(checks.values()):
            failed = [k for k, v in checks.items() if not v]
            detail = f"{detail} Disk failed: {', '.join(failed)}. tags={doc.tags!r}"

        run.step(
            label="apply_tags add_tags (T-01)",
            passed=all_ok,
            detail=detail,
            timing_ms=add_result.timing_ms or elapsed,
            tool_result=add_result,
            server_logs=step_logs,
        )
        if not add_result.ok:
            return run

        # ── Step 3: idempotent add of already-present tag (T-03) ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        idem_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=read_id_1,
            add_tags=[idempotent_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        idem_result.expect_contains("Updated tags")

        doc = ctx.vault.read_file(path_1)
        # Count occurrences — should be exactly 1, not duplicated
        idempotent_count = sum(1 for t in doc.tags if t == idempotent_tag)
        checks = {
            "tag still present": idempotent_tag in doc.tags,
            "tag not duplicated": idempotent_count == 1,
            "previously added tag still present": add_new_tag in doc.tags,
        }
        all_ok = (idem_result.ok and idem_result.status == "pass"
                  and all(checks.values()))
        detail = expectation_detail(idem_result) or idem_result.error or ""
        if not all(checks.values()):
            failed = [k for k, v in checks.items() if not v]
            detail = f"{detail} Disk failed: {', '.join(failed)}. tags={doc.tags!r}"

        run.step(
            label="apply_tags add idempotent (T-03)",
            passed=all_ok,
            detail=detail,
            timing_ms=idem_result.timing_ms,
            tool_result=idem_result,
            server_logs=step_logs,
        )

        # ── Step 4: remove existing tag (T-02) ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        rm_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=read_id_1,
            remove_tags=[remove_existing_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        rm_result.expect_contains("Updated tags")

        doc = ctx.vault.read_file(path_1)
        checks = {
            "removed tag gone from disk": remove_existing_tag not in doc.tags,
            "other tags preserved": initial_tags[1] in doc.tags,
        }
        all_ok = (rm_result.ok and rm_result.status == "pass"
                  and all(checks.values()))
        detail = expectation_detail(rm_result) or rm_result.error or ""
        if not all(checks.values()):
            failed = [k for k, v in checks.items() if not v]
            detail = f"{detail} Disk failed: {', '.join(failed)}. tags={doc.tags!r}"

        run.step(
            label="apply_tags remove_tags (T-02)",
            passed=all_ok,
            detail=detail,
            timing_ms=rm_result.timing_ms,
            tool_result=rm_result,
            server_logs=step_logs,
        )

        # ── Step 5: graceful remove of absent tag (T-04) ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        graceful_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=read_id_1,
            remove_tags=[remove_absent_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # No error even though the tag was never there
        graceful_result.expect_contains("Updated tags")

        doc = ctx.vault.read_file(path_1)
        checks = {
            "no error response": graceful_result.ok and graceful_result.status == "pass",
            "existing tags untouched": initial_tags[1] in doc.tags,
            "absent tag still absent": remove_absent_tag not in doc.tags,
        }
        all_ok = all(checks.values())
        detail = expectation_detail(graceful_result) or graceful_result.error or ""
        if not all_ok:
            failed = [k for k, v in checks.items() if not v]
            detail = f"{detail} Failed: {', '.join(failed)}. tags={doc.tags!r}"

        run.step(
            label="apply_tags remove absent tag graceful (T-04)",
            passed=all_ok,
            detail=detail,
            timing_ms=graceful_result.timing_ms,
            tool_result=graceful_result,
            server_logs=step_logs,
        )

        # ── Step 6: batch apply_tags on [doc1, doc2] (T-06) ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        batch_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=[read_id_1, read_id_2],
            add_tags=[batch_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        batch_result.expect_contains("Updated tags")

        doc1 = ctx.vault.read_file(path_1)
        doc2 = ctx.vault.read_file(path_2)
        checks = {
            "doc1 has batch tag": batch_tag in doc1.tags,
            "doc2 has batch tag": batch_tag in doc2.tags,
            "doc1 initial tags preserved": initial_tags[1] in doc1.tags,
            "doc2 initial tags preserved": initial_tags[1] in doc2.tags,
        }
        all_ok = (batch_result.ok and batch_result.status == "pass"
                  and all(checks.values()))
        detail = expectation_detail(batch_result) or batch_result.error or ""
        if not all(checks.values()):
            failed = [k for k, v in checks.items() if not v]
            detail = (
                f"{detail} Disk failed: {', '.join(failed)}. "
                f"doc1.tags={doc1.tags!r}, doc2.tags={doc2.tags!r}"
            )

        run.step(
            label="apply_tags batch identifiers (T-06)",
            passed=all_ok,
            detail=detail,
            timing_ms=batch_result.timing_ms,
            tool_result=batch_result,
            server_logs=step_logs,
        )

        # ── Step 7: tag normalization — whitespace + case (T-07) ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        norm_result = ctx.client.call_tool(
            "apply_tags",
            identifiers=read_id_1,
            add_tags=[raw_normalize_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        norm_result.expect_contains("Updated tags")

        doc = ctx.vault.read_file(path_1)
        checks = {
            "normalized tag present": normalized_tag in doc.tags,
            "raw (un-normalized) tag NOT present": raw_normalize_tag not in doc.tags,
            "no leading/trailing whitespace": all(t == t.strip() for t in doc.tags),
            "all tags lowercased": all(t == t.lower() for t in doc.tags),
        }
        all_ok = (norm_result.ok and norm_result.status == "pass"
                  and all(checks.values()))
        detail = expectation_detail(norm_result) or norm_result.error or ""
        if not all(checks.values()):
            failed = [k for k, v in checks.items() if not v]
            detail = f"{detail} Disk failed: {', '.join(failed)}. tags={doc.tags!r}"

        run.step(
            label="apply_tags normalization (T-07)",
            passed=all_ok,
            detail=detail,
            timing_ms=norm_result.timing_ms,
            tool_result=norm_result,
            server_logs=step_logs,
        )

        # ── Step 8: apply_tags on a memory (T-05) ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        save_mem = ctx.client.call_tool(
            "save_memory",
            content=f"Memory fixture for {TEST_NAME} run {run.run_id}.",
            tags=["fqc-test", f"tagops-mem-{run.run_id}"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        memory_id = _extract_memory_id(save_mem.text)
        if memory_id:
            ctx.cleanup.track_mcp_memory(memory_id)
        save_mem.expect_contains("Memory saved")

        run.step(
            label="save_memory (fixture for T-05)",
            passed=(save_mem.ok and save_mem.status == "pass" and bool(memory_id)),
            detail=expectation_detail(save_mem) or save_mem.error or "",
            timing_ms=save_mem.timing_ms,
            tool_result=save_mem,
            server_logs=step_logs,
        )

        if memory_id:
            mem_add_tag = f"tagops-mem-added-{run.run_id}"
            log_mark = ctx.server.log_position if ctx.server else 0
            mem_tag_result = ctx.client.call_tool(
                "apply_tags",
                memory_id=memory_id,
                add_tags=[mem_add_tag],
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            # Response echoes the memory id and the applied tag
            mem_tag_result.expect_contains(memory_id)
            mem_tag_result.expect_contains(mem_add_tag)

            # Ground-truth verification via get_memory
            get_mem = ctx.client.call_tool("get_memory", memory_ids=memory_id)
            tag_visible = mem_add_tag in (get_mem.text or "")

            all_ok = (mem_tag_result.ok and mem_tag_result.status == "pass"
                      and tag_visible)
            detail = expectation_detail(mem_tag_result) or mem_tag_result.error or ""
            if not tag_visible:
                detail = f"{detail} get_memory did not show new tag. response={get_mem.text!r}"

            run.step(
                label="apply_tags on memory_id (T-05)",
                passed=all_ok,
                detail=detail,
                timing_ms=mem_tag_result.timing_ms,
                tool_result=mem_tag_result,
                server_logs=step_logs,
            )

        # ── Best-effort memory cleanup ────────────────────────────────
        if memory_id:
            try:
                ctx.client.call_tool("archive_memory", memory_id=memory_id)
            except Exception as e:
                ctx.cleanup_errors.append(
                    f"Cleanup archive_memory({memory_id}) failed: {e}"
                )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
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
        description="Test: apply_tags add/remove/idempotent/graceful/memory/batch/normalization.",
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

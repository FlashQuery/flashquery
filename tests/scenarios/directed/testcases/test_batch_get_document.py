#!/usr/bin/env python3
"""
Test: get_document batch retrieval — array identifiers with per-element partial failure.

Scenario:
    Creates two documents and exercises batch retrieval: successful two-doc batch
    (array input → array output), and partial failure (one identifier not found →
    error object at position, other succeeds).

Coverage points: D-51, D-52

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards.

Usage:
    python test_batch_get_document.py
    python test_batch_get_document.py --managed
    python test_batch_get_document.py --managed --json
    python test_batch_get_document.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-51", "D-52"]

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_batch_get_document"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _track_created(ctx: TestContext, result_text: str, fallback_path: str) -> tuple[str, str]:
    """Parse fqc_id + path from a create_document response and register cleanup."""
    created_fqc_id = _extract_field(result_text, "FQC ID")
    created_path = _extract_field(result_text, "Path") or fallback_path
    if created_path:
        ctx.cleanup.track_file(created_path)
        parts = Path(created_path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if created_fqc_id:
        ctx.cleanup.track_mcp_document(created_fqc_id)
    return created_fqc_id, created_path


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    path_a = f"_test/{TEST_NAME}_{run.run_id}_alpha.md"
    path_b = f"_test/{TEST_NAME}_{run.run_id}_beta.md"
    nonexistent = f"_test/{TEST_NAME}_{run.run_id}_nonexistent-9999.md"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:

        # ── Setup Step 1: Create document A ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title="Alpha",
            content="Body for alpha document.",
            path=path_a,
            tags=["alpha"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        ident_a, created_path_a = _track_created(ctx, create_a.text, path_a)
        # Fall back to path if FQC ID extraction fails
        if not ident_a:
            ident_a = created_path_a or path_a

        run.step(
            label="Setup: create_document A (Alpha)",
            passed=create_a.ok,
            detail=create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            return run

        # ── Setup Step 2: Create document B ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title="Beta",
            content="Body for beta document.",
            path=path_b,
            tags=["beta"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        ident_b, created_path_b = _track_created(ctx, create_b.text, path_b)
        if not ident_b:
            ident_b = created_path_b or path_b

        run.step(
            label="Setup: create_document B (Beta)",
            passed=create_b.ok,
            detail=create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            return run

        # ── Setup Step 3: Force scan ────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan (sync — index all docs)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-51: batch array input returns array output; both elements succeed
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d51_result = ctx.client.call_tool(
            "get_document",
            identifiers=[ident_a, ident_b],   # array input
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d51_passed = False
        d51_detail = ""
        if d51_result.ok:
            try:
                results = json.loads(d51_result.text)
                checks = {
                    "response is a list": isinstance(results, list),
                    "list has 2 elements": len(results) == 2,
                    "element 0 has identifier": "identifier" in results[0],
                    "element 1 has identifier": "identifier" in results[1],
                    "element 0 has no error key": "error" not in results[0],
                    "element 1 has no error key": "error" not in results[1],
                    "element 0 has body or fq_id": "body" in results[0] or "fq_id" in results[0],
                }
                d51_passed = all(checks.values())
                if not d51_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d51_detail = f"Failed: {', '.join(failed)}. results={results!r}"
            except Exception as e:
                d51_detail = f"JSON parse error: {e}"
        else:
            d51_detail = f"Expected ok=True but got error. text={d51_result.text[:200]}"

        run.step(
            label="D-51: batch array input returns array output; both elements succeed",
            passed=d51_passed,
            detail=d51_detail,
            timing_ms=d51_result.timing_ms,
            tool_result=d51_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-52: batch partial failure — one not found → error object at position; outer not isError
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d52_result = ctx.client.call_tool(
            "get_document",
            identifiers=[ident_a, nonexistent],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d52_passed = False
        d52_detail = ""
        # NOTE: batch never returns isError=true — ok=True even with partial failure
        if d52_result.ok:
            try:
                results = json.loads(d52_result.text)
                checks = {
                    "response is a list": isinstance(results, list),
                    "list has 2 elements": len(results) == 2,
                    "element 0 succeeds (no error key)": "error" not in results[0],
                    "element 1 has error key": "error" in results[1],
                    "element 1 error is document_not_found": results[1].get("error") == "document_not_found",
                    "element 1 has identifier field": "identifier" in results[1],
                    "results[0].identifier == ident_a (TC2-W1 positional)":
                        len(results) > 0 and results[0].get("identifier") == ident_a,
                    "results[1].identifier matches the missing path (TC2-W1)":
                        len(results) > 1 and results[1].get("identifier") == nonexistent,
                    "results[1] has 'message' field (TC2-W1)":
                        len(results) > 1 and "message" in results[1],
                }
                d52_passed = all(checks.values())
                if not d52_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d52_detail = f"Failed: {', '.join(failed)}. elem1={results[1]!r}"
            except Exception as e:
                d52_detail = f"JSON parse error: {e}"
        else:
            d52_detail = f"Expected ok=True (batch never isError) but got error. text={d52_result.text[:200]}"

        run.step(
            label="D-52: batch partial failure — one not found -> per-element error; outer not isError",
            passed=d52_passed,
            detail=d52_detail,
            timing_ms=d52_result.timing_ms,
            tool_result=d52_result,
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
                detail="Files retained under: _test/",
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
        description="Test: get_document batch retrieval — array identifiers with per-element partial failure (D-51, D-52).",
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
    parser.add_argument("--vault-path", type=str, default=None,
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

#!/usr/bin/env python3
"""
Test: append_to_doc → insert_in_doc (top, after_heading, before_heading, end_of_section).

Scenario:
    1. Create a multi-section document via MCP (create_document) with H2 headings
       "Alpha", "Beta", "Gamma" each followed by a paragraph of body text.
    2. append_to_doc: append a unique marker at the very end of the document; verify
       on disk that the marker is the final non-blank content (C-01).
    3. insert_in_doc position=top: prepend a unique marker; verify on disk that the
       marker precedes the "## Alpha" heading (C-02).
    4. insert_in_doc position=after_heading heading="Beta": verify the marker appears
       immediately after the "## Beta" heading line (C-03).
    5. insert_in_doc position=before_heading heading="Gamma": verify the marker
       appears immediately before the "## Gamma" heading line (C-04).
    6. insert_in_doc position=end_of_section heading="Alpha": verify the marker is
       the last content of the Alpha section (before "## Beta" starts) (C-05).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: C-01, C-02, C-03, C-04, C-05

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_content_append_and_insert.py                            # existing server
    python test_content_append_and_insert.py --managed                  # managed server
    python test_content_append_and_insert.py --managed --json           # structured JSON
    python test_content_append_and_insert.py --managed --json --keep    # keep files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["C-01", "C-02", "C-03", "C-04", "C-05"]

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

TEST_NAME = "test_content_append_and_insert"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _line_index(lines: list[str], predicate) -> int:
    """Return the index of the first line matching predicate, or -1."""
    for i, ln in enumerate(lines):
        if predicate(ln):
            return i
    return -1


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    unique_title = f"FQC Test {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    tags = ["fqc-test", "content-ops", run.run_id]

    # Distinct marker strings so assertions are unambiguous
    append_marker = f"APPEND_MARKER_{run.run_id}"
    top_marker = f"TOP_MARKER_{run.run_id}"
    after_beta_marker = f"AFTER_BETA_MARKER_{run.run_id}"
    before_gamma_marker = f"BEFORE_GAMMA_MARKER_{run.run_id}"
    end_alpha_marker = f"END_ALPHA_MARKER_{run.run_id}"

    original_body = (
        f"## Alpha\n\n"
        f"Alpha section body text.\n\n"
        f"## Beta\n\n"
        f"Beta section body text.\n\n"
        f"## Gamma\n\n"
        f"Gamma section body text."
    )

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create multi-section document via MCP ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=unique_title,
            content=original_body,
            path=test_path,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path")

        if created_path:
            ctx.cleanup.track_file(created_path)
            parts = Path(created_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        create_result.expect_contains(unique_title)

        run.step(
            label="create_document with Alpha/Beta/Gamma sections",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        identifier = created_fqc_id or test_path
        disk_path = created_path or test_path

        # ── Step 2: append_to_doc (C-01) ───────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        append_result = ctx.client.call_tool(
            "append_to_doc",
            identifier=identifier,
            content=append_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="append_to_doc appends marker at end (C-01)",
            passed=(append_result.ok and append_result.status == "pass"),
            detail=expectation_detail(append_result) or append_result.error or "",
            timing_ms=append_result.timing_ms,
            tool_result=append_result,
            server_logs=step_logs,
        )
        if not append_result.ok:
            return run

        # Verify on disk: append_marker present and is the last non-blank line
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(disk_path)
            body_lines = doc.body.splitlines()
            nonblank = [ln for ln in body_lines if ln.strip()]
            last_nonblank = nonblank[-1] if nonblank else ""
            checks = {
                "append_marker in body": append_marker in doc.body,
                "append_marker is last non-blank line": append_marker in last_nonblank,
                "Alpha heading still present": "## Alpha" in doc.body,
                "Beta heading still present": "## Beta" in doc.body,
                "Gamma heading still present": "## Gamma" in doc.body,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"last_nonblank={last_nonblank!r}"
                )
            run.step("Disk verify: append at end (C-01)", passed=all_ok,
                     detail=detail, timing_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:
            run.step("Disk verify: append at end (C-01)", passed=False,
                     detail=f"Exception: {e}",
                     timing_ms=int((time.monotonic() - t0) * 1000))

        # ── Step 3: insert_in_doc position=top (C-02) ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        top_result = ctx.client.call_tool(
            "insert_in_doc",
            identifier=identifier,
            position="top",
            content=top_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_in_doc position=top (C-02)",
            passed=(top_result.ok and top_result.status == "pass"),
            detail=expectation_detail(top_result) or top_result.error or "",
            timing_ms=top_result.timing_ms,
            tool_result=top_result,
            server_logs=step_logs,
        )
        if not top_result.ok:
            return run

        # Verify: top_marker precedes "## Alpha"
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(disk_path)
            body = doc.body
            top_idx = body.find(top_marker)
            alpha_idx = body.find("## Alpha")
            checks = {
                "top_marker present": top_idx != -1,
                "Alpha heading present": alpha_idx != -1,
                "top_marker precedes Alpha": 0 <= top_idx < alpha_idx,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"top_idx={top_idx} alpha_idx={alpha_idx}"
                )
            run.step("Disk verify: top insertion precedes Alpha (C-02)",
                     passed=all_ok, detail=detail,
                     timing_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:
            run.step("Disk verify: top insertion precedes Alpha (C-02)",
                     passed=False, detail=f"Exception: {e}",
                     timing_ms=int((time.monotonic() - t0) * 1000))

        # ── Step 4: insert_in_doc after_heading Beta (C-03) ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        after_result = ctx.client.call_tool(
            "insert_in_doc",
            identifier=identifier,
            position="after_heading",
            heading="Beta",
            content=after_beta_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_in_doc position=after_heading Beta (C-03)",
            passed=(after_result.ok and after_result.status == "pass"),
            detail=expectation_detail(after_result) or after_result.error or "",
            timing_ms=after_result.timing_ms,
            tool_result=after_result,
            server_logs=step_logs,
        )
        if not after_result.ok:
            return run

        # Verify: after_beta_marker appears immediately after "## Beta" line
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(disk_path)
            lines = doc.body.splitlines()
            beta_idx = _line_index(lines, lambda ln: ln.strip() == "## Beta")
            # Find first non-blank line after the Beta heading
            first_content_after_beta = ""
            first_content_idx = -1
            for j in range(beta_idx + 1, len(lines)):
                if lines[j].strip():
                    first_content_after_beta = lines[j]
                    first_content_idx = j
                    break
            checks = {
                "Beta heading present": beta_idx != -1,
                "after_beta_marker in body": after_beta_marker in doc.body,
                "marker is first non-blank line after Beta": (
                    after_beta_marker in first_content_after_beta
                ),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"beta_idx={beta_idx} first_after={first_content_after_beta!r} "
                    f"first_after_idx={first_content_idx}"
                )
            run.step("Disk verify: after_heading Beta (C-03)", passed=all_ok,
                     detail=detail,
                     timing_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:
            run.step("Disk verify: after_heading Beta (C-03)", passed=False,
                     detail=f"Exception: {e}",
                     timing_ms=int((time.monotonic() - t0) * 1000))

        # ── Step 5: insert_in_doc before_heading Gamma (C-04) ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        before_result = ctx.client.call_tool(
            "insert_in_doc",
            identifier=identifier,
            position="before_heading",
            heading="Gamma",
            content=before_gamma_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_in_doc position=before_heading Gamma (C-04)",
            passed=(before_result.ok and before_result.status == "pass"),
            detail=expectation_detail(before_result) or before_result.error or "",
            timing_ms=before_result.timing_ms,
            tool_result=before_result,
            server_logs=step_logs,
        )
        if not before_result.ok:
            return run

        # Verify: before_gamma_marker appears immediately before "## Gamma"
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(disk_path)
            lines = doc.body.splitlines()
            gamma_idx = _line_index(lines, lambda ln: ln.strip() == "## Gamma")
            # Walk backwards to find the last non-blank line before Gamma
            last_before_gamma = ""
            last_before_idx = -1
            for j in range(gamma_idx - 1, -1, -1):
                if lines[j].strip():
                    last_before_gamma = lines[j]
                    last_before_idx = j
                    break
            checks = {
                "Gamma heading present": gamma_idx != -1,
                "before_gamma_marker in body": before_gamma_marker in doc.body,
                "marker is last non-blank line before Gamma": (
                    before_gamma_marker in last_before_gamma
                ),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"gamma_idx={gamma_idx} last_before={last_before_gamma!r} "
                    f"last_before_idx={last_before_idx}"
                )
            run.step("Disk verify: before_heading Gamma (C-04)", passed=all_ok,
                     detail=detail,
                     timing_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:
            run.step("Disk verify: before_heading Gamma (C-04)", passed=False,
                     detail=f"Exception: {e}",
                     timing_ms=int((time.monotonic() - t0) * 1000))

        # ── Step 6: insert_in_doc end_of_section Alpha (C-05) ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        eos_result = ctx.client.call_tool(
            "insert_in_doc",
            identifier=identifier,
            position="end_of_section",
            heading="Alpha",
            content=end_alpha_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_in_doc position=end_of_section Alpha (C-05)",
            passed=(eos_result.ok and eos_result.status == "pass"),
            detail=expectation_detail(eos_result) or eos_result.error or "",
            timing_ms=eos_result.timing_ms,
            tool_result=eos_result,
            server_logs=step_logs,
        )
        if not eos_result.ok:
            return run

        # Verify: end_alpha_marker is last content of Alpha section
        # (i.e., appears after "## Alpha" and is the last non-blank line before "## Beta")
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(disk_path)
            lines = doc.body.splitlines()
            alpha_idx = _line_index(lines, lambda ln: ln.strip() == "## Alpha")
            beta_idx = _line_index(lines, lambda ln: ln.strip() == "## Beta")
            # Last non-blank line strictly between alpha_idx and beta_idx
            last_in_alpha = ""
            last_in_alpha_idx = -1
            if alpha_idx != -1 and beta_idx != -1:
                for j in range(beta_idx - 1, alpha_idx, -1):
                    if lines[j].strip():
                        last_in_alpha = lines[j]
                        last_in_alpha_idx = j
                        break
            checks = {
                "Alpha heading present": alpha_idx != -1,
                "Beta heading present": beta_idx != -1,
                "Alpha precedes Beta": 0 <= alpha_idx < beta_idx,
                "end_alpha_marker in body": end_alpha_marker in doc.body,
                "marker is last non-blank line of Alpha section": (
                    end_alpha_marker in last_in_alpha
                ),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"alpha_idx={alpha_idx} beta_idx={beta_idx} "
                    f"last_in_alpha={last_in_alpha!r} idx={last_in_alpha_idx}"
                )
            run.step("Disk verify: end_of_section Alpha (C-05)", passed=all_ok,
                     detail=detail,
                     timing_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:
            run.step("Disk verify: end_of_section Alpha (C-05)", passed=False,
                     detail=f"Exception: {e}",
                     timing_ms=int((time.monotonic() - t0) * 1000))

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
        description="Test: append_to_doc and insert_in_doc positional content operations.",
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

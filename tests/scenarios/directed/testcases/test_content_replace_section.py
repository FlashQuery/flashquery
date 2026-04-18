#!/usr/bin/env python3
"""
Test: replace_doc_section + insert_in_doc heading-targeted behaviors.

Scenario:
    1. Create doc-A with two top-level sections, the first having two nested
       subsections, plus a duplicate "## Section One" heading at the bottom
       (create_document).
    2. C-06: replace_doc_section on "Section Two" (default include_subheadings)
       and verify the heading line is preserved, body replaced, and other
       sections untouched.
    3. Create doc-B with the same structure. C-07: replace_doc_section on
       "Section One" with include_subheadings=True. Verify Subsection A and B
       are gone and the heading remains with the new body.
    4. Create doc-C with the same structure. C-08: replace_doc_section on
       "Section One" with include_subheadings=False. Verify the nested
       "### Subsection A" and "### Subsection B" headings are still present
       after the replacement.
    5. C-09: Use doc-A (which still has the duplicate "## Section One"
       headings) and call insert_in_doc with position=after_heading,
       heading="Section One", occurrence=2. Verify the marker appears after
       the SECOND "Section One" heading line, not the first.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: C-06, C-07, C-08, C-09

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_content_replace_section.py                            # existing server
    python test_content_replace_section.py --managed                  # managed server
    python test_content_replace_section.py --managed --json           # structured JSON with server logs
    python test_content_replace_section.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["C-06", "C-07", "C-08", "C-09"]

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

TEST_NAME = "test_content_replace_section"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_body() -> str:
    """Reusable structured body with nested headings and a duplicate top-level heading."""
    return (
        "## Section One\n"
        "original one-body\n"
        "### Subsection A\n"
        "subsection-a body\n"
        "### Subsection B\n"
        "subsection-b body\n"
        "## Section Two\n"
        "original two-body\n"
        "## Section One\n"
        "duplicate-heading body"
    )


def _track(ctx, fqc_id: str, path: str) -> None:
    if path:
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if fqc_id:
        ctx.cleanup.track_mcp_document(fqc_id)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    body = _build_body()
    tags = ["fqc-test", "replace-section-test", run.run_id]

    path_a = f"_test/{TEST_NAME}_A_{run.run_id}.md"
    path_b = f"_test/{TEST_NAME}_B_{run.run_id}.md"
    path_c = f"_test/{TEST_NAME}_C_{run.run_id}.md"

    title_a = f"FQC Replace A {run.run_id}"
    title_b = f"FQC Replace B {run.run_id}"
    title_c = f"FQC Replace C {run.run_id}"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create doc-A (used for C-06 and C-09) ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title=title_a,
            content=body,
            path=path_a,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        a_fqc_id = _extract_field(create_a.text, "FQC ID")
        a_path = _extract_field(create_a.text, "Path") or path_a
        _track(ctx, a_fqc_id, a_path)

        create_a.expect_contains(title_a)
        run.step(
            label="create_document doc-A (for C-06, C-09)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            return run

        # ── Step 2: C-06 replace_doc_section on "Section Two" ──────
        new_two_marker = f"REPLACED-TWO-{run.run_id}"
        log_mark = ctx.server.log_position if ctx.server else 0
        rep_two = ctx.client.call_tool(
            "replace_doc_section",
            identifier=a_fqc_id or a_path,
            heading="Section Two",
            content=new_two_marker,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        rep_two.expect_contains("Section Two")
        run.step(
            label="C-06 replace_doc_section('Section Two')",
            passed=(rep_two.ok and rep_two.status == "pass"),
            detail=expectation_detail(rep_two) or rep_two.error or "",
            timing_ms=rep_two.timing_ms,
            tool_result=rep_two,
            server_logs=step_logs,
        )

        # Verify on disk: heading line preserved, body replaced, other sections intact.
        t0 = time.monotonic()
        try:
            doc_a = ctx.vault.read_file(a_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            body_a = doc_a.body
            checks = {
                "Section Two heading preserved": "## Section Two" in body_a,
                "new two-body present": new_two_marker in body_a,
                "old two-body removed": "original two-body" not in body_a,
                "Section One heading still present": "## Section One" in body_a,
                "original one-body untouched": "original one-body" in body_a,
                "Subsection A untouched": "### Subsection A" in body_a,
                "Subsection B untouched": "### Subsection B" in body_a,
                "duplicate-heading body untouched": "duplicate-heading body" in body_a,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. body={body_a!r}"
            run.step("C-06 verify Section Two replacement on disk", passed=all_ok,
                     detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-06 verify Section Two replacement on disk", passed=False,
                     detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 3: Create doc-B for C-07 ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title=title_b,
            content=body,
            path=path_b,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        b_fqc_id = _extract_field(create_b.text, "FQC ID")
        b_path = _extract_field(create_b.text, "Path") or path_b
        _track(ctx, b_fqc_id, b_path)

        create_b.expect_contains(title_b)
        run.step(
            label="create_document doc-B (for C-07)",
            passed=(create_b.ok and create_b.status == "pass"),
            detail=expectation_detail(create_b) or create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            return run

        # ── Step 4: C-07 replace include_subheadings=True ──────────
        nuked_marker = f"NUKED-ONE-{run.run_id}"
        log_mark = ctx.server.log_position if ctx.server else 0
        rep_b = ctx.client.call_tool(
            "replace_doc_section",
            identifier=b_fqc_id or b_path,
            heading="Section One",
            content=nuked_marker,
            include_subheadings=True,
            occurrence=1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        rep_b.expect_contains("Section One")
        run.step(
            label="C-07 replace_doc_section('Section One', include_subheadings=True)",
            passed=(rep_b.ok and rep_b.status == "pass"),
            detail=expectation_detail(rep_b) or rep_b.error or "",
            timing_ms=rep_b.timing_ms,
            tool_result=rep_b,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc_b = ctx.vault.read_file(b_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            body_b = doc_b.body
            # Only the duplicate "## Section One" near the bottom should remain
            # as a Section One heading; the first occurrence's nested headings
            # must be gone.
            checks = {
                "first Section One heading preserved": body_b.count("## Section One") == 2,
                "nuked marker present": nuked_marker in body_b,
                "Subsection A removed": "### Subsection A" not in body_b,
                "Subsection B removed": "### Subsection B" not in body_b,
                "subsection-a body removed": "subsection-a body" not in body_b,
                "subsection-b body removed": "subsection-b body" not in body_b,
                "original one-body removed": "original one-body" not in body_b,
                "Section Two intact": "## Section Two" in body_b and "original two-body" in body_b,
                "duplicate Section One body intact": "duplicate-heading body" in body_b,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. body={body_b!r}"
            run.step("C-07 verify include_subheadings=True replacement on disk",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-07 verify include_subheadings=True replacement on disk",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 5: Create doc-C for C-08 ──────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_c = ctx.client.call_tool(
            "create_document",
            title=title_c,
            content=body,
            path=path_c,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        c_fqc_id = _extract_field(create_c.text, "FQC ID")
        c_path = _extract_field(create_c.text, "Path") or path_c
        _track(ctx, c_fqc_id, c_path)

        create_c.expect_contains(title_c)
        run.step(
            label="create_document doc-C (for C-08)",
            passed=(create_c.ok and create_c.status == "pass"),
            detail=expectation_detail(create_c) or create_c.error or "",
            timing_ms=create_c.timing_ms,
            tool_result=create_c,
            server_logs=step_logs,
        )
        if not create_c.ok:
            return run

        # ── Step 6: C-08 replace include_subheadings=False ─────────
        new_one_marker = f"NEW-ONE-BODY-{run.run_id}"
        log_mark = ctx.server.log_position if ctx.server else 0
        rep_c = ctx.client.call_tool(
            "replace_doc_section",
            identifier=c_fqc_id or c_path,
            heading="Section One",
            content=new_one_marker,
            include_subheadings=False,
            occurrence=1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        rep_c.expect_contains("Section One")
        run.step(
            label="C-08 replace_doc_section('Section One', include_subheadings=False)",
            passed=(rep_c.ok and rep_c.status == "pass"),
            detail=expectation_detail(rep_c) or rep_c.error or "",
            timing_ms=rep_c.timing_ms,
            tool_result=rep_c,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc_c = ctx.vault.read_file(c_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            body_c = doc_c.body
            checks = {
                "Section One heading preserved": "## Section One" in body_c,
                "new one-body present": new_one_marker in body_c,
                "original one-body removed": "original one-body" not in body_c,
                "Subsection A heading preserved": "### Subsection A" in body_c,
                "Subsection B heading preserved": "### Subsection B" in body_c,
                "subsection-a body preserved": "subsection-a body" in body_c,
                "subsection-b body preserved": "subsection-b body" in body_c,
                "Section Two intact": "## Section Two" in body_c and "original two-body" in body_c,
                "duplicate Section One body intact": "duplicate-heading body" in body_c,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. body={body_c!r}"
            run.step("C-08 verify include_subheadings=False replacement on disk",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-08 verify include_subheadings=False replacement on disk",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 7: C-09 insert_in_doc occurrence=2 on doc-A ───────
        # Doc-A still has both "## Section One" headings (only Section Two
        # was modified), so it's the right doc for the duplicate-heading
        # occurrence test.
        insert_marker = f"MARKER-OCC2-{run.run_id}"
        log_mark = ctx.server.log_position if ctx.server else 0
        ins = ctx.client.call_tool(
            "insert_in_doc",
            identifier=a_fqc_id or a_path,
            heading="Section One",
            position="after_heading",
            content=insert_marker,
            occurrence=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="C-09 insert_in_doc(after_heading, 'Section One', occurrence=2)",
            passed=(ins.ok and ins.status == "pass"),
            detail=expectation_detail(ins) or ins.error or "",
            timing_ms=ins.timing_ms,
            tool_result=ins,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc_a2 = ctx.vault.read_file(a_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            body_a2 = doc_a2.body
            body_lines = body_a2.split("\n")

            # Find every "## Section One" heading line index.
            section_one_indices = [
                i for i, ln in enumerate(body_lines) if ln.strip() == "## Section One"
            ]
            marker_indices = [
                i for i, ln in enumerate(body_lines) if insert_marker in ln
            ]

            checks = {
                "marker present in body": insert_marker in body_a2,
                "exactly one marker line": len(marker_indices) == 1,
                "two Section One headings still present": len(section_one_indices) == 2,
            }

            if marker_indices and len(section_one_indices) == 2:
                marker_line = marker_indices[0]
                first_h = section_one_indices[0]
                second_h = section_one_indices[1]
                # Marker must come AFTER the second heading, not after the first.
                checks["marker after SECOND Section One heading"] = marker_line > second_h
                checks["marker NOT immediately under FIRST heading"] = not (
                    first_h < marker_line < second_h
                )

            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"section_one_indices={section_one_indices}, "
                    f"marker_indices={marker_indices}, body={body_a2!r}"
                )
            run.step("C-09 verify insertion targets second heading occurrence",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-09 verify insertion targets second heading occurrence",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Optionally retain files for debugging ─────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────
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
        description="Test: replace_doc_section and insert_in_doc heading-targeted operations.",
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

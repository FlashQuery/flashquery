#!/usr/bin/env python3
"""
Test: consolidated get_document — error envelopes (document_not_found, section_not_found,
invalid_parameter_combination, occurrence_out_of_range).

Scenario:
    Creates the demo Weekly Standup document and exercises error paths:
    document not found, multi-section fail-fast mixed failures, available_headings
    in error response, invalid parameter combination (occurrence with multi-section),
    and occurrence out of range.

Coverage points: D-35, D-31e, D-31f, D-46, O-09, O-10

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_consolidated_get_document_errors.py                            # existing server
    python test_consolidated_get_document_errors.py --managed                  # managed server
    python test_consolidated_get_document_errors.py --managed --json           # structured JSON
    python test_consolidated_get_document_errors.py --managed --json --keep    # keep files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-35", "D-31e", "D-31f", "D-46", "O-09", "O-10"]

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

TEST_NAME = "test_consolidated_get_document_errors"

# ---------------------------------------------------------------------------
# Demo document body (spec §4.2)
# ---------------------------------------------------------------------------

DEMO_BODY = """\
## 1. Progress Updates

Body 1.

### 1.1. Native LLM Access

Sub body.

## 2. Blockers

Blockers body.

## 3. Action Items

- Item one
- Item two

## 4. Action Items

- Item three
- Item four

## 5. Notes

Final notes."""


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

    path_standup = f"_test/{TEST_NAME}_{run.run_id}_standup.md"
    nonexistent_path = f"_test/{TEST_NAME}_{run.run_id}_nonexistent-1234.md"

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

        # ── Setup: Create demo standup document ───────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_standup = ctx.client.call_tool(
            "create_document",
            title="Weekly Standup — Sprint 12",
            content=DEMO_BODY,
            path=path_standup,
            tags=["meeting-notes", "sprint-12"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_standup, created_standup = _track_created(ctx, create_standup.text, path_standup)
        create_standup.expect_contains("Weekly Standup")

        run.step(
            label="Setup: create_document (Weekly Standup — error test fixture)",
            passed=(create_standup.ok and create_standup.status == "pass"),
            detail=expectation_detail(create_standup) or create_standup.error or "",
            timing_ms=create_standup.timing_ms,
            tool_result=create_standup,
            server_logs=step_logs,
        )
        if not create_standup.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            return run

        ident_standup = fqc_id_standup or created_standup

        # ── Force scan ────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan (sync)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-35: document_not_found — get non-existent document
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d35_result = ctx.client.call_tool(
            "get_document",
            identifiers=nonexistent_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d35_passed = False
        d35_detail = ""
        # This call should fail (isError: true)
        if not d35_result.ok:
            try:
                env = json.loads(d35_result.text)
                checks = {
                    "error == document_not_found": env.get("error") == "document_not_found",
                    "identifier present": "identifier" in env,
                }
                d35_passed = all(checks.values())
                if not d35_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d35_detail = f"Failed: {', '.join(failed)}. env={env!r}"
            except Exception as e:
                d35_detail = f"JSON parse error: {e}. raw={d35_result.text[:200]}"
        else:
            d35_detail = f"Expected isError but got ok=True. text={d35_result.text[:200]}"

        run.step(
            label="D-35: document_not_found JSON error envelope",
            passed=d35_passed,
            detail=d35_detail,
            timing_ms=d35_result.timing_ms,
            tool_result=d35_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31e: multi-section fail-fast mixed failures
        # sections=['Foo', 'Action Items', 'Action Items', 'Action Items']
        # - 'Foo' has no match (no_match)
        # - 'Action Items' x3: only 2 exist → insufficient_occurrences for 3rd
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31e_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Foo", "Action Items", "Action Items", "Action Items"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31e_passed = False
        d31e_detail = ""
        if not d31e_result.ok:
            try:
                env = json.loads(d31e_result.text)
                missing = env.get("missing_sections", [])
                foo_entry = next((m for m in missing if m.get("query") == "Foo"), None)
                ai_insufficient = next(
                    (m for m in missing if m.get("query") == "Action Items"
                     and m.get("reason") == "insufficient_occurrences"),
                    None,
                )
                available = env.get("available_headings")
                checks = {
                    "error == section_not_found": env.get("error") == "section_not_found",
                    # OQ #12 / Pitfall 5: aggregate per-query — exactly 2 entries (Foo + Action Items)
                    "missing_sections has exactly 2 entries": len(missing) == 2,
                    "Foo entry has reason no_match":
                        foo_entry is not None and foo_entry.get("reason") == "no_match",
                    "Foo entry has no requested_count":
                        foo_entry is not None and "requested_count" not in foo_entry,
                    "Foo entry has no found_count":
                        foo_entry is not None and "found_count" not in foo_entry,
                    "Action Items entry has insufficient_occurrences": ai_insufficient is not None,
                    "Action Items entry requested_count == 3":
                        ai_insufficient is not None and ai_insufficient.get("requested_count") == 3,
                    "Action Items entry found_count == 2":
                        ai_insufficient is not None and ai_insufficient.get("found_count") == 2,
                    "available_headings is non-empty list":
                        isinstance(available, list) and len(available) > 0,
                    "identifier present": "identifier" in env,
                }
                d31e_passed = all(checks.values())
                if not d31e_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31e_detail = f"Failed: {', '.join(failed)}. missing={missing!r}"
            except Exception as e:
                d31e_detail = f"JSON parse error: {e}. raw={d31e_result.text[:200]}"
        else:
            d31e_detail = f"Expected isError but got ok=True. text={d31e_result.text[:200]}"

        run.step(
            label="D-31e: multi-section fail-fast mixed failures (no_match + insufficient_occurrences)",
            passed=d31e_passed,
            detail=d31e_detail,
            timing_ms=d31e_result.timing_ms,
            tool_result=d31e_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31f / O-09: section_not_found includes available_headings array
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        o09_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["NonExistentHeading"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        o09_passed = False
        o09_detail = ""
        if not o09_result.ok:
            try:
                env = json.loads(o09_result.text)
                available = env.get("available_headings", [])
                # Demo doc has exactly 6 headings: "1. Progress Updates",
                # "1.1. Native LLM Access", "2. Blockers", "3. Action Items",
                # "4. Action Items", "5. Notes"
                checks = {
                    "error == section_not_found": env.get("error") == "section_not_found",
                    "available_headings lists all 6 headings": isinstance(available, list) and len(available) == 6,
                    "available_headings includes progress": any("Progress" in a for a in available),
                    "available_headings includes native llm access": any("Native LLM Access" in a for a in available),
                    "available_headings includes blockers": any("Blockers" in a for a in available),
                    "available_headings includes action items": any("Action Items" in a for a in available),
                    "available_headings includes notes": any("Notes" in a for a in available),
                }
                o09_passed = all(checks.values())
                if not o09_passed:
                    failed = [k for k, v in checks.items() if not v]
                    o09_detail = f"Failed: {', '.join(failed)}. available={available!r}"
            except Exception as e:
                o09_detail = f"JSON parse error: {e}. raw={o09_result.text[:200]}"
        else:
            o09_detail = f"Expected isError but got ok=True. text={o09_result.text[:200]}"

        run.step(
            label="D-31f / O-09: section_not_found includes available_headings array",
            passed=o09_passed,
            detail=o09_detail,
            timing_ms=o09_result.timing_ms,
            tool_result=o09_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-46: invalid_parameter_combination — occurrence with multi-section
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d46_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Blockers", "Action Items"],
            occurrence=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d46_passed = False
        d46_detail = ""
        if not d46_result.ok:
            try:
                env = json.loads(d46_result.text)
                details = env.get("details", {})
                checks = {
                    "error == invalid_parameter_combination": env.get("error") == "invalid_parameter_combination",
                    "details.conflict == occurrence_with_multi_section": details.get("conflict") == "occurrence_with_multi_section",
                    "no identifier field (pre-I/O error)": "identifier" not in env,
                    "details.sections_count == 2 (TC1-W13)":
                        details.get("sections_count") == 2,
                    "details.occurrence == 2 (TC1-W13)":
                        details.get("occurrence") == 2,
                }
                d46_passed = all(checks.values())
                if not d46_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d46_detail = f"Failed: {', '.join(failed)}. env={env!r}"
            except Exception as e:
                d46_detail = f"JSON parse error: {e}. raw={d46_result.text[:200]}"
        else:
            d46_detail = f"Expected isError but got ok=True. text={d46_result.text[:200]}"

        run.step(
            label="D-46: invalid_parameter_combination (occurrence with multi-section)",
            passed=d46_passed,
            detail=d46_detail,
            timing_ms=d46_result.timing_ms,
            tool_result=d46_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # O-10: occurrence_out_of_range — sections=['Action Items'], occurrence=5
        # Only 2 Action Items exist → insufficient_occurrences
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        o10_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Action Items"],
            occurrence=5,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        o10_passed = False
        o10_detail = ""
        if not o10_result.ok:
            try:
                env = json.loads(o10_result.text)
                matched = env.get("matched_headings", [])
                checks = {
                    "error == occurrence_out_of_range": env.get("error") == "occurrence_out_of_range",
                    "query == 'Action Items'": env.get("query") == "Action Items",
                    "matches_found == 2": env.get("matches_found") == 2,
                    "matched_headings is list of 2": isinstance(matched, list) and len(matched) == 2,
                    "matched_headings includes '3. Action Items'": any("3. Action Items" in h for h in matched),
                    "matched_headings includes '4. Action Items'": any("4. Action Items" in h for h in matched),
                    "requested_occurrence == 5": env.get("requested_occurrence") == 5,
                    "no missing_sections key": "missing_sections" not in env,
                    "identifier present": "identifier" in env,
                }
                o10_passed = all(checks.values())
                if not o10_passed:
                    failed = [k for k, v in checks.items() if not v]
                    o10_detail = f"Failed: {', '.join(failed)}. env={env!r}"
            except Exception as e:
                o10_detail = f"JSON parse error: {e}. raw={o10_result.text[:200]}"
        else:
            o10_detail = f"Expected isError but got ok=True. text={o10_result.text[:200]}"

        run.step(
            label="O-10: occurrence_out_of_range (occurrence=5, only 2 Action Items exist)",
            passed=o10_passed,
            detail=o10_detail,
            timing_ms=o10_result.timing_ms,
            tool_result=o10_result,
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
        description="Test: consolidated get_document — error envelope tests.",
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

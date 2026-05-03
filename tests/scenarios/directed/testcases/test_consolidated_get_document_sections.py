#!/usr/bin/env python3
"""
Test: consolidated get_document — section extraction (single, multi, case-insensitive, numeric anchor, include_nested).

Scenario:
    Creates the demo Weekly Standup document and exercises section extraction
    features: single section, multi-section input order, repeat-name shorthand,
    interleaved repeats, blank-line separator, case-insensitive matching,
    numeric anchor, numeric edge cases, size.chars invariant, and include_nested.

Coverage points: D-31, D-31a, D-31b, D-31c, D-31d, D-32, D-33, D-33a, D-34, D-34a

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_consolidated_get_document_sections.py                            # existing server
    python test_consolidated_get_document_sections.py --managed                  # managed server
    python test_consolidated_get_document_sections.py --managed --json           # structured JSON
    python test_consolidated_get_document_sections.py --managed --json --keep    # keep files

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-31", "D-31a", "D-31b", "D-31c", "D-31d", "D-32", "D-33", "D-33a", "D-34", "D-34a"]

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

TEST_NAME = "test_consolidated_get_document_sections"

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

# Numeric anchor document: has headings "3. Foo" and "13. Bar"
NUMERIC_BODY = """\
## 1. Intro

Intro content.

## 3. Foo

Foo content for numeric anchor test.

## 13. Bar

Bar content for numeric anchor test."""

# Numeric edge cases document: has "12. Appendix", "112. Notes", "3.2 Details", "3D Modeling"
NUMERIC_EDGE_BODY = """\
## 12. Appendix

Appendix content.

## 112. Notes

Notes section with larger number.

## 3.2 Details

Section with dot-hierarchy numbering.

## 3D Modeling

Section starting with digit-letter (3D)."""


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
    path_numeric = f"_test/{TEST_NAME}_{run.run_id}_numeric.md"
    path_numericedge = f"_test/{TEST_NAME}_{run.run_id}_numericedge.md"

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
            label="Setup: create_document (Weekly Standup — sections test fixture)",
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

        # ── Setup: Create numeric anchor document ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_numeric = ctx.client.call_tool(
            "create_document",
            title="Numeric Anchor Test",
            content=NUMERIC_BODY,
            path=path_numeric,
            tags=["fqc-test"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_numeric, created_numeric = _track_created(ctx, create_numeric.text, path_numeric)
        run.step(
            label="Setup: create_document (numeric anchor test fixture)",
            passed=create_numeric.ok,
            detail=create_numeric.error or "",
            timing_ms=create_numeric.timing_ms,
            tool_result=create_numeric,
            server_logs=step_logs,
        )

        ident_numeric = fqc_id_numeric or created_numeric

        # ── Setup: Create numeric edge cases document ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_numericedge = ctx.client.call_tool(
            "create_document",
            title="Numeric Edge Cases",
            content=NUMERIC_EDGE_BODY,
            path=path_numericedge,
            tags=["fqc-test"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_numericedge, created_numericedge = _track_created(ctx, create_numericedge.text, path_numericedge)
        run.step(
            label="Setup: create_document (numeric edge cases fixture)",
            passed=create_numericedge.ok,
            detail=create_numericedge.error or "",
            timing_ms=create_numericedge.timing_ms,
            tool_result=create_numericedge,
            server_logs=step_logs,
        )

        ident_numericedge = fqc_id_numericedge or created_numericedge

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
        # D-31: single section returns extracted_sections metadata alongside body
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Blockers"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31_passed = False
        d31_detail = ""
        if d31_result.ok:
            try:
                env = json.loads(d31_result.text)
                body = env.get("body", "")
                extracted = env.get("extracted_sections", [])
                checks = {
                    "body contains blockers heading": "Blockers" in body,
                    "body does not contain progress": "Progress Updates" not in body,
                    "extracted_sections present": "extracted_sections" in env,
                    "extracted_sections length 1": len(extracted) == 1,
                    "extracted[0].heading contains Blockers": "Blockers" in extracted[0].get("heading", "") if extracted else False,
                    "extracted[0].chars == len(body)": extracted[0].get("chars", -1) == len(body) if extracted else False,
                }
                d31_passed = all(checks.values())
                if not d31_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31_detail = f"Failed: {', '.join(failed)}. body[:80]={body[:80]!r} extracted={extracted!r}"
            except Exception as e:
                d31_detail = f"JSON parse error: {e}"
        else:
            d31_detail = d31_result.error or d31_result.text[:200]

        run.step(
            label="D-31: sections=['Blockers'] returns extracted_sections alongside body",
            passed=d31_passed,
            detail=d31_detail,
            timing_ms=d31_result.timing_ms,
            tool_result=d31_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-32: case-insensitive substring — 'blockers' (lowercase) matches
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d32_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["blockers"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d32_passed = False
        d32_detail = ""
        if d32_result.ok:
            try:
                env = json.loads(d32_result.text)
                body = env.get("body", "")
                checks = {
                    "body contains Blockers content": "Blockers" in body,
                    "body does not contain Progress": "Progress Updates" not in body,
                }
                d32_passed = all(checks.values())
                if not d32_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d32_detail = f"Failed: {', '.join(failed)}. body[:80]={body[:80]!r}"
            except Exception as e:
                d32_detail = f"JSON parse error: {e}"
        else:
            d32_detail = d32_result.error or d32_result.text[:200]

        run.step(
            label="D-32: case-insensitive match — sections=['blockers'] matches '2. Blockers'",
            passed=d32_passed,
            detail=d32_detail,
            timing_ms=d32_result.timing_ms,
            tool_result=d32_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-33: numeric start-anchor "3" matches "3. Foo" not "13. Bar"
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d33_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_numeric,
            sections=["3"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d33_passed = False
        d33_detail = ""
        if d33_result.ok:
            try:
                env = json.loads(d33_result.text)
                body = env.get("body", "")
                checks = {
                    "body contains Foo content": "Foo content" in body,
                    "body does not contain Bar content": "Bar content" not in body,
                }
                d33_passed = all(checks.values())
                if not d33_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d33_detail = f"Failed: {', '.join(failed)}. body={body!r}"
            except Exception as e:
                d33_detail = f"JSON parse error: {e}"
        else:
            d33_detail = d33_result.error or d33_result.text[:200]

        run.step(
            label="D-33: sections=['3'] anchored to start — matches '3. Foo' not '13. Bar'",
            passed=d33_passed,
            detail=d33_detail,
            timing_ms=d33_result.timing_ms,
            tool_result=d33_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-33a: numeric edge cases — multi-digit, dot-hierarchy, mixed alpha-numeric
        # ─────────────────────────────────────────────────────────────
        t0_d33a = time.monotonic()
        d33a_steps = []

        # Test 1: sections=["12"] should match "12. Appendix" not "112. Notes"
        log_mark = ctx.server.log_position if ctx.server else 0
        res_12 = ctx.client.call_tool(
            "get_document",
            identifiers=ident_numericedge,
            sections=["12"],
        )
        if res_12.ok:
            try:
                env = json.loads(res_12.text)
                body = env.get("body", "")
                d33a_steps.append(("12 matches Appendix not Notes",
                                   "Appendix content" in body and "Notes section" not in body))
            except Exception:
                d33a_steps.append(("12 parse", False))
        else:
            d33a_steps.append(("12 request", False))

        # Test 2: sections=["3.2"] should match "3.2 Details"
        log_mark = ctx.server.log_position if ctx.server else 0
        res_32 = ctx.client.call_tool(
            "get_document",
            identifiers=ident_numericedge,
            sections=["3.2"],
        )
        if res_32.ok:
            try:
                env = json.loads(res_32.text)
                body = env.get("body", "")
                d33a_steps.append(("3.2 matches Details",
                                   "Details" in body))
            except Exception:
                d33a_steps.append(("3.2 parse", False))
        else:
            d33a_steps.append(("3.2 request", False))

        # Test 3: sections=["3D"] should match "3D Modeling" (digit-alpha, not strict numeric)
        log_mark = ctx.server.log_position if ctx.server else 0
        res_3d = ctx.client.call_tool(
            "get_document",
            identifiers=ident_numericedge,
            sections=["3D"],
        )
        if res_3d.ok:
            try:
                env = json.loads(res_3d.text)
                body = env.get("body", "")
                d33a_steps.append(("3D matches 3D Modeling",
                                   "3D Modeling" in body or "digit-letter" in body))
            except Exception:
                d33a_steps.append(("3D parse", False))
        else:
            d33a_steps.append(("3D request", False))

        all_d33a = all(v for _, v in d33a_steps)
        d33a_detail = "" if all_d33a else "; ".join(f"{k}={'PASS' if v else 'FAIL'}" for k, v in d33a_steps)

        run.step(
            label="D-33a: numeric edge cases (multi-digit, dot-hierarchy, alpha-numeric)",
            passed=all_d33a,
            detail=d33a_detail,
            timing_ms=int((time.monotonic() - t0_d33a) * 1000),
        )

        # ─────────────────────────────────────────────────────────────
        # D-34: size.chars reflects full body even with sections (GDOC-07)
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d34_full = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
        )
        log_mark2 = ctx.server.log_position if ctx.server else 0
        d34_section = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Blockers"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d34_passed = False
        d34_detail = ""
        if d34_full.ok and d34_section.ok:
            try:
                env_full = json.loads(d34_full.text)
                env_section = json.loads(d34_section.text)
                full_chars = env_full.get("size", {}).get("chars", 0)
                section_chars = env_section.get("size", {}).get("chars", 0)
                extracted_chars = env_section.get("extracted_sections", [{}])[0].get("chars", 0) if env_section.get("extracted_sections") else 0
                checks = {
                    "size.chars same in both calls": full_chars == section_chars,
                    "size.chars > extracted_sections chars": full_chars > extracted_chars if extracted_chars > 0 else True,
                    "size.chars > 0": full_chars > 0,
                }
                d34_passed = all(checks.values())
                if not d34_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d34_detail = f"Failed: {', '.join(failed)}. full_chars={full_chars} section_chars={section_chars} extracted_chars={extracted_chars}"
            except Exception as e:
                d34_detail = f"JSON parse error: {e}"
        else:
            d34_detail = d34_full.error or d34_section.error or "request failed"

        run.step(
            label="D-34: size.chars reflects full body — invariant across section extraction (GDOC-07)",
            passed=d34_passed,
            detail=d34_detail,
            timing_ms=(d34_full.timing_ms + d34_section.timing_ms),
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-34a: include_nested: false stops at first subheading
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d34a_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["1. Progress"],
            include_nested=False,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d34a_passed = False
        d34a_detail = ""
        if d34a_result.ok:
            try:
                env = json.loads(d34a_result.text)
                body = env.get("body", "")
                checks = {
                    "body contains Progress heading": "Progress Updates" in body,
                    "body does NOT contain Native LLM subheading": "1.1. Native LLM Access" not in body,
                }
                d34a_passed = all(checks.values())
                if not d34a_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d34a_detail = f"Failed: {', '.join(failed)}. body={body!r}"
            except Exception as e:
                d34a_detail = f"JSON parse error: {e}"
        else:
            d34a_detail = d34a_result.error or d34a_result.text[:200]

        run.step(
            label="D-34a: include_nested=false omits subheading content",
            passed=d34a_passed,
            detail=d34a_detail,
            timing_ms=d34a_result.timing_ms,
            tool_result=d34a_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31a: multi-section input order — ['Action Items', 'Blockers']
        # Action Items (sections 3+4) comes AFTER Blockers (section 2) in source,
        # but we request Action Items first — output should preserve input order.
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31a_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Action Items", "Blockers"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31a_passed = False
        d31a_detail = ""
        if d31a_result.ok:
            try:
                env = json.loads(d31a_result.text)
                body = env.get("body", "")
                # Input order: Action Items first, then Blockers
                # So Action Items content should appear BEFORE Blockers content in body
                pos_action = body.find("Action Items")
                pos_blockers = body.find("Blockers")
                checks = {
                    "body contains Action Items": pos_action >= 0,
                    "body contains Blockers": pos_blockers >= 0,
                    "Action Items before Blockers in output": pos_action < pos_blockers if pos_action >= 0 and pos_blockers >= 0 else False,
                }
                d31a_passed = all(checks.values())
                if not d31a_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31a_detail = f"Failed: {', '.join(failed)}. pos_action={pos_action} pos_blockers={pos_blockers}"
            except Exception as e:
                d31a_detail = f"JSON parse error: {e}"
        else:
            d31a_detail = d31a_result.error or d31a_result.text[:200]

        run.step(
            label="D-31a: multi-section input order — ['Action Items', 'Blockers'] preserves order",
            passed=d31a_passed,
            detail=d31a_detail,
            timing_ms=d31a_result.timing_ms,
            tool_result=d31a_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31b: repeat-name shorthand — ['Action Items', 'Action Items']
        # Should return 1st AND 2nd occurrences
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31b_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Action Items", "Action Items"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31b_passed = False
        d31b_detail = ""
        if d31b_result.ok:
            try:
                env = json.loads(d31b_result.text)
                extracted = env.get("extracted_sections", [])
                checks = {
                    "extracted_sections length 2": len(extracted) == 2,
                    "first heading is 3. Action Items": "3. Action Items" in extracted[0].get("heading", "") if len(extracted) > 0 else False,
                    "second heading is 4. Action Items": "4. Action Items" in extracted[1].get("heading", "") if len(extracted) > 1 else False,
                    "aggregate chars invariant: sum(chars) + 2*(N-1) == len(body) (TC1-W10)":
                        sum(s.get("chars", 0) for s in extracted)
                        + 2 * max(0, len(extracted) - 1)
                        == len(env.get("body", "")),
                }
                d31b_passed = all(checks.values())
                if not d31b_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31b_detail = f"Failed: {', '.join(failed)}. extracted={extracted!r}"
            except Exception as e:
                d31b_detail = f"JSON parse error: {e}"
        else:
            d31b_detail = d31b_result.error or d31b_result.text[:200]

        run.step(
            label="D-31b: repeat-name shorthand returns 1st and 2nd occurrences",
            passed=d31b_passed,
            detail=d31b_detail,
            timing_ms=d31b_result.timing_ms,
            tool_result=d31b_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31c: interleaved repeats ['Action Items', 'Blockers', 'Action Items']
        # Should return: [0]=3. Action Items, [1]=2. Blockers, [2]=4. Action Items
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31c_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Action Items", "Blockers", "Action Items"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31c_passed = False
        d31c_detail = ""
        if d31c_result.ok:
            try:
                env = json.loads(d31c_result.text)
                extracted = env.get("extracted_sections", [])
                checks = {
                    "extracted_sections length 3": len(extracted) == 3,
                    "[0] is 3. Action Items": "3. Action Items" in extracted[0].get("heading", "") if len(extracted) > 0 else False,
                    "[1] is Blockers": "Blockers" in extracted[1].get("heading", "") if len(extracted) > 1 else False,
                    "[2] is 4. Action Items": "4. Action Items" in extracted[2].get("heading", "") if len(extracted) > 2 else False,
                }
                d31c_passed = all(checks.values())
                if not d31c_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31c_detail = f"Failed: {', '.join(failed)}. extracted={extracted!r}"
            except Exception as e:
                d31c_detail = f"JSON parse error: {e}"
        else:
            d31c_detail = d31c_result.error or d31c_result.text[:200]

        run.step(
            label="D-31c: interleaved repeats ['A Items','Blockers','A Items'] → 1A,Blockers,2A",
            passed=d31c_passed,
            detail=d31c_detail,
            timing_ms=d31c_result.timing_ms,
            tool_result=d31c_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-31d: blank-line separator count = N-1
        # For ['Blockers', 'Action Items', 'Action Items'] (N=3) → 2 separators
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d31d_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_standup,
            sections=["Blockers", "Action Items", "Action Items"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d31d_passed = False
        d31d_detail = ""
        if d31d_result.ok:
            try:
                env = json.loads(d31d_result.text)
                body = env.get("body", "")
                extracted = env.get("extracted_sections", [])
                # The assembler joins section content (which includes each heading line)
                # with '\n\n'.  Between adjacent sections the body contains '\n\n## '
                # (blank line + level-2 heading of the next section).
                # For N=3 sections there are exactly N-1=2 such junctions.
                junction_count = body.count("\n\n## ")
                checks = {
                    "body non-empty": len(body) > 0,
                    "extracted_sections length 3": len(extracted) == 3,
                    "exactly 2 section junctions (\\n\\n## )": junction_count == 2,
                }
                d31d_passed = all(checks.values())
                if not d31d_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d31d_detail = f"Failed: {', '.join(failed)}. junction_count={junction_count}"
            except Exception as e:
                d31d_detail = f"JSON parse error: {e}"
        else:
            d31d_detail = d31d_result.error or d31d_result.text[:200]

        run.step(
            label="D-31d: blank-line separator between sections — exactly N-1=2 junctions for N=3 sections",
            passed=d31d_passed,
            detail=d31d_detail,
            timing_ms=d31d_result.timing_ms,
            tool_result=d31d_result,
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
        description="Test: consolidated get_document — section extraction tests.",
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

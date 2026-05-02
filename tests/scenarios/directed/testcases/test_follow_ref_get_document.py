#!/usr/bin/env python3
"""
Test: get_document follow_ref — frontmatter pointer dereference, error nesting,
title-fallback uniformity (D-50), and combined batch + follow_ref.

Coverage points: D-50, D-53, D-54, D-55, D-56, D-57, D-58, D-59, D-60,
                 D-39a, D-39b, D-39c, D-39d, D-39e, D-39f

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards.

Usage:
    python test_follow_ref_get_document.py
    python test_follow_ref_get_document.py --managed
    python test_follow_ref_get_document.py --managed --json
    python test_follow_ref_get_document.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = [
    "D-50",
    "D-53",
    "D-54",
    "D-55",
    "D-56",
    "D-57",
    "D-58",
    "D-59",
    "D-60",
    "D-39a",
    "D-39b",
    "D-39c",
    "D-39d",
    "D-39e",
    "D-39f",
]

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_follow_ref_get_document"

# ---------------------------------------------------------------------------
# Demo document bodies
# ---------------------------------------------------------------------------

SOURCE_BODY = (
    "## Overview\n\nSource overview content.\n\n"
    "## Notes\n\nSource notes section.\n"
)

TARGET_BODY = (
    "## Summary\n\nTarget summary content.\n\n"
    "## Action Items\n\n- First item\n- Second item\n\n"
    "## Action Items\n\n- Third item\n\n"
    "## Notes\n\nTarget notes section.\n"
)

SIMPLE_BODY = "## Hello\n\nNo pointer here.\n"

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

        # ── Create fixtures via ctx.create_file (auto-tracks cleanup) ─
        #
        # target_path: the doc that source_path will follow_ref to
        target_path = ctx.create_file(
            f"_test/{TEST_NAME}_{run.run_id}_target.md",
            title="Target Summary",
            body=TARGET_BODY,
            tags=["fref"],
        )

        # source_path: has a projections.summary pointer into target_path
        source_path = ctx.create_file(
            f"_test/{TEST_NAME}_{run.run_id}_source.md",
            title="Source Doc",
            body=SOURCE_BODY,
            tags=["fref"],
            extra_frontmatter={"projections": {"summary": target_path}},
        )

        # simple_path: has no frontmatter pointer for follow_ref tests
        simple_path = ctx.create_file(
            f"_test/{TEST_NAME}_{run.run_id}_simple.md",
            title="Simple Doc",
            body=SIMPLE_BODY,
            tags=["fref"],
        )

        # invalid_path: has projections.summary pointing to a non-string (integer)
        invalid_path = ctx.create_file(
            f"_test/{TEST_NAME}_{run.run_id}_invalid.md",
            title="Invalid Pointer",
            body="## X\n\nbody",
            tags=["fref"],
            extra_frontmatter={"projections": {"summary": 42}},
        )

        # bad_target_path: has projections.summary pointing to a path that doesn't exist
        bad_target_path = ctx.create_file(
            f"_test/{TEST_NAME}_{run.run_id}_badtarget.md",
            title="Bad Target Pointer",
            body="## Y\n\nbody",
            tags=["fref"],
            extra_frontmatter={"projections": {"summary": "_test/does_not_exist_at_all.md"}},
        )

        # ── Force scan ────────────────────────────────────────────────
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
        # D-50: title fallback when frontmatter completely absent
        #       (raw vault write — no fq_title, no frontmatter at all)
        # ─────────────────────────────────────────────────────────────
        path_raw = f"_test/{TEST_NAME}_{run.run_id}_no_fm.md"
        raw_abs = (
            os.path.join(str(ctx.server.vault_path), path_raw)
            if ctx.server
            else os.path.join(str(args.vault_path), path_raw)
        )
        os.makedirs(os.path.dirname(raw_abs), exist_ok=True)
        with open(raw_abs, "w", encoding="utf-8") as f:
            f.write("# Just a body\n\nNo frontmatter here.\n")
        ctx.cleanup.track_file(path_raw)

        log_mark = ctx.server.log_position if ctx.server else 0
        d50_result = ctx.client.call_tool("get_document", identifiers=path_raw, include=["body"])
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d50_passed = False
        d50_detail = ""
        if d50_result.ok:
            try:
                env = json.loads(d50_result.text)
                expected_basename = Path(path_raw).stem
                checks = {
                    "envelope has title": "title" in env,
                    "title equals filename basename": env.get("title") == expected_basename,
                    "title is non-empty string": isinstance(env.get("title"), str) and len(env.get("title", "")) > 0,
                    "envelope has body": "body" in env,
                }
                d50_passed = all(checks.values())
                if not d50_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d50_detail = f"Failed: {', '.join(failed)}. env keys={list(env.keys())}"
            except Exception as e:
                d50_detail = f"JSON parse error: {e}"
        else:
            d50_detail = f"Expected ok=True, got isError. text={d50_result.text[:200]}"

        run.step(
            label=f"D-50: title fallback when frontmatter absent (basename='{Path(path_raw).stem}')",
            passed=d50_passed,
            detail=d50_detail,
            timing_ms=d50_result.timing_ms,
            tool_result=d50_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-53: follow_ref basic success — source envelope + followed_ref nested
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d53_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d53_passed = False
        d53_detail = ""
        if d53_result.ok:
            try:
                env = json.loads(d53_result.text)
                fr = env.get("followed_ref", {})
                checks = {
                    "has identifier (source)": "identifier" in env,
                    "has followed_ref key": "followed_ref" in env,
                    "followed_ref.reference == 'projections.summary'": fr.get("reference") == "projections.summary",
                    "followed_ref.resolved_to present": bool(fr.get("resolved_to")),
                    "followed_ref.resolved_to is target path": fr.get("resolved_to") == target_path,
                    "followed_ref has size.chars": "size" in fr,
                    "no top-level body": "body" not in env,
                }
                d53_passed = all(checks.values())
                if not d53_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d53_detail = f"Failed: {', '.join(failed)}. fr={fr!r}"
            except Exception as e:
                d53_detail = f"JSON parse error: {e}"
        else:
            d53_detail = f"Expected ok=True, got isError. text={d53_result.text[:200]}"

        run.step(
            label="D-53: follow_ref basic success — source envelope + followed_ref nested",
            passed=d53_passed,
            detail=d53_detail,
            timing_ms=d53_result.timing_ms,
            tool_result=d53_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-54: follow_ref + include=["headings"] — headings in followed_ref
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d54_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            include=["headings"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d54_passed = False
        d54_detail = ""
        if d54_result.ok:
            try:
                env = json.loads(d54_result.text)
                fr = env.get("followed_ref", {})
                headings = fr.get("headings", [])
                checks = {
                    "has followed_ref": "followed_ref" in env,
                    "followed_ref has headings": "headings" in fr,
                    "headings is non-empty list": isinstance(headings, list) and len(headings) > 0,
                    "first heading has level": "level" in headings[0] if headings else False,
                    "first heading has text": "text" in headings[0] if headings else False,
                    "first heading has chars": "chars" in headings[0] if headings else False,
                    "no top-level body": "body" not in env,
                }
                d54_passed = all(checks.values())
                if not d54_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d54_detail = f"Failed: {', '.join(failed)}. headings={headings!r}"
            except Exception as e:
                d54_detail = f"JSON parse error: {e}"
        else:
            d54_detail = f"Expected ok=True, got isError. text={d54_result.text[:200]}"

        run.step(
            label="D-54: follow_ref + include=['headings'] returns headings in followed_ref",
            passed=d54_passed,
            detail=d54_detail,
            timing_ms=d54_result.timing_ms,
            tool_result=d54_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-55: follow_ref + include=["frontmatter","headings"]
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d55_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            include=["frontmatter", "headings"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d55_passed = False
        d55_detail = ""
        if d55_result.ok:
            try:
                env = json.loads(d55_result.text)
                fr = env.get("followed_ref", {})
                fm = fr.get("frontmatter", {})
                checks = {
                    "has followed_ref": "followed_ref" in env,
                    "followed_ref has frontmatter": "frontmatter" in fr,
                    "frontmatter fq_title == 'Target Summary'": fm.get("fq_title") == "Target Summary",
                    "followed_ref has headings": "headings" in fr,
                    "headings is non-empty": isinstance(fr.get("headings"), list) and len(fr.get("headings", [])) > 0,
                }
                d55_passed = all(checks.values())
                if not d55_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d55_detail = f"Failed: {', '.join(failed)}. fm={fm!r}"
            except Exception as e:
                d55_detail = f"JSON parse error: {e}"
        else:
            d55_detail = f"Expected ok=True, got isError. text={d55_result.text[:200]}"

        run.step(
            label="D-55: follow_ref + include=['frontmatter','headings'] returns both in followed_ref",
            passed=d55_passed,
            detail=d55_detail,
            timing_ms=d55_result.timing_ms,
            tool_result=d55_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-56: follow_ref + sections — extracts sections from target
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d56_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            include=["body"],
            sections=["Summary"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d56_passed = False
        d56_detail = ""
        if d56_result.ok:
            try:
                env = json.loads(d56_result.text)
                fr = env.get("followed_ref", {})
                body = fr.get("body", "")
                extracted = fr.get("extracted_sections", [])
                checks = {
                    "has followed_ref": "followed_ref" in env,
                    "followed_ref has body": "body" in fr,
                    "body contains Target summary content": "Target summary content" in body,
                    "followed_ref has extracted_sections": "extracted_sections" in fr,
                    "extracted_sections has 1 element": len(extracted) == 1,
                    "extracted_section heading contains Summary": "Summary" in extracted[0].get("heading", "") if extracted else False,
                }
                d56_passed = all(checks.values())
                if not d56_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d56_detail = f"Failed: {', '.join(failed)}. body={body[:100]!r}, extracted={extracted!r}"
            except Exception as e:
                d56_detail = f"JSON parse error: {e}"
        else:
            d56_detail = f"Expected ok=True, got isError. text={d56_result.text[:200]}"

        run.step(
            label="D-56: follow_ref + sections extracts sections from target document, returned in followed_ref",
            passed=d56_passed,
            detail=d56_detail,
            timing_ms=d56_result.timing_ms,
            tool_result=d56_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-57: follow_ref_path_not_found (pre-resolution, NOT nested)
        #        simple_path has no 'projections' key
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d57_result = ctx.client.call_tool(
            "get_document",
            identifiers=simple_path,
            follow_ref="projections.summary",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d57_passed = False
        d57_detail = ""
        if not d57_result.ok:
            try:
                env = json.loads(d57_result.text)
                checks = {
                    "error == follow_ref_path_not_found": env.get("error") == "follow_ref_path_not_found",
                    "identifier present at top level": "identifier" in env,
                    "reference present at top level": "reference" in env,
                    "traversal present at top level": "traversal" in env,
                    "NO followed_ref key (pre-resolution = not nested)": "followed_ref" not in env,
                }
                d57_passed = all(checks.values())
                if not d57_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d57_detail = f"Failed: {', '.join(failed)}. env keys={list(env.keys())}"
            except Exception as e:
                d57_detail = f"JSON parse error: {e}"
        else:
            d57_detail = f"Expected isError=True but got ok. text={d57_result.text[:200]}"

        run.step(
            label="D-57: follow_ref pre-resolution error: follow_ref_path_not_found (NOT nested under followed_ref)",
            passed=d57_passed,
            detail=d57_detail,
            timing_ms=d57_result.timing_ms,
            tool_result=d57_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-58: follow_ref_invalid_type (pre-resolution)
        #        invalid_path has projections.summary = 42 (integer, not string)
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d58_result = ctx.client.call_tool(
            "get_document",
            identifiers=invalid_path,
            follow_ref="projections.summary",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d58_passed = False
        d58_detail = ""
        if not d58_result.ok:
            try:
                env = json.loads(d58_result.text)
                checks = {
                    "error == follow_ref_invalid_type": env.get("error") == "follow_ref_invalid_type",
                    "found_type == 'number'": env.get("found_type") == "number",
                    "identifier present at top level": "identifier" in env,
                    "reference present at top level": "reference" in env,
                    "found_value_preview present": "found_value_preview" in env,
                    "NO followed_ref key": "followed_ref" not in env,
                }
                d58_passed = all(checks.values())
                if not d58_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d58_detail = f"Failed: {', '.join(failed)}. env={env!r}"
            except Exception as e:
                d58_detail = f"JSON parse error: {e}"
        else:
            d58_detail = f"Expected isError=True but got ok. text={d58_result.text[:200]}"

        run.step(
            label="D-58: follow_ref pre-resolution error: follow_ref_invalid_type (NOT nested)",
            passed=d58_passed,
            detail=d58_detail,
            timing_ms=d58_result.timing_ms,
            tool_result=d58_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-59: follow_ref_target_not_found (pre-resolution)
        #        bad_target_path has projections.summary pointing to a non-existent file
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d59_result = ctx.client.call_tool(
            "get_document",
            identifiers=bad_target_path,
            follow_ref="projections.summary",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d59_passed = False
        d59_detail = ""
        if not d59_result.ok:
            try:
                env = json.loads(d59_result.text)
                checks = {
                    "error == follow_ref_target_not_found": env.get("error") == "follow_ref_target_not_found",
                    "resolved_value in env": "resolved_value" in env,
                    "resolution_method in env": "resolution_method" in env,
                    "NO followed_ref key": "followed_ref" not in env,
                }
                d59_passed = all(checks.values())
                if not d59_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d59_detail = f"Failed: {', '.join(failed)}. env keys={list(env.keys())}"
            except Exception as e:
                d59_detail = f"JSON parse error: {e}"
        else:
            d59_detail = f"Expected isError=True but got ok. text={d59_result.text[:200]}"

        run.step(
            label="D-59: follow_ref pre-resolution error: follow_ref_target_not_found (NOT nested)",
            passed=d59_passed,
            detail=d59_detail,
            timing_ms=d59_result.timing_ms,
            tool_result=d59_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-60: batch + follow_ref — mixed result
        #        source_path has the pointer (succeeds); simple_path does not (path_not_found)
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d60_result = ctx.client.call_tool(
            "get_document",
            identifiers=[source_path, simple_path],
            follow_ref="projections.summary",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d60_passed = False
        d60_detail = ""
        if d60_result.ok:
            try:
                results = json.loads(d60_result.text)
                checks = {
                    "ok (batch never isError)": d60_result.ok,
                    "response is list": isinstance(results, list),
                    "list has 2 elements": len(results) == 2,
                    "element 0 has followed_ref (success)": "followed_ref" in results[0],
                    "element 1 has error (path not found for simple doc)": "error" in results[1],
                    "element 1 error type is follow_ref_path_not_found": results[1].get("error") == "follow_ref_path_not_found",
                    "element 1 has identifier field": "identifier" in results[1],
                }
                d60_passed = all(checks.values())
                if not d60_passed:
                    failed = [k for k, v in checks.items() if not v]
                    elem1_repr = repr(results[1]) if len(results) > 1 else "missing"
                    d60_detail = f"Failed: {', '.join(failed)}. elem0_keys={list(results[0].keys()) if results else []}, elem1={elem1_repr}"
            except Exception as e:
                d60_detail = f"JSON parse error: {e}"
        else:
            d60_detail = f"Expected ok=True (batch never isError) but got error. text={d60_result.text[:200]}"

        run.step(
            label="D-60: batch + follow_ref: per-element partial failure semantics apply",
            passed=d60_passed,
            detail=d60_detail,
            timing_ms=d60_result.timing_ms,
            tool_result=d60_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39a: follow_ref + sections without "body" in include
        #         -> invalid_parameter_combination
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39a_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            include=["frontmatter"],
            sections=["Summary"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39a_passed = False
        d39a_detail = ""
        if not d39a_result.ok:
            try:
                env = json.loads(d39a_result.text)
                checks = {
                    "error == invalid_parameter_combination": env.get("error") == "invalid_parameter_combination",
                }
                d39a_passed = all(checks.values())
                if not d39a_passed:
                    d39a_detail = f"Wrong error type: {env.get('error')}. env={env!r}"
            except Exception as e:
                d39a_detail = f"JSON parse error: {e}"
        else:
            d39a_detail = f"Expected isError=True but got ok. text={d39a_result.text[:200]}"

        run.step(
            label="D-39a: follow_ref + sections without 'body' in include -> invalid_parameter_combination",
            passed=d39a_passed,
            detail=d39a_detail,
            timing_ms=d39a_result.timing_ms,
            tool_result=d39a_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39b: follow_ref + multi-element sections + occurrence
        #         -> invalid_parameter_combination
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39b_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            sections=["Action Items", "Action Items"],
            occurrence=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39b_passed = False
        d39b_detail = ""
        if not d39b_result.ok:
            try:
                env = json.loads(d39b_result.text)
                checks = {
                    "error == invalid_parameter_combination": env.get("error") == "invalid_parameter_combination",
                }
                d39b_passed = all(checks.values())
                if not d39b_passed:
                    d39b_detail = f"Wrong error type: {env.get('error')}. env={env!r}"
            except Exception as e:
                d39b_detail = f"JSON parse error: {e}"
        else:
            d39b_detail = f"Expected isError=True but got ok. text={d39b_result.text[:200]}"

        run.step(
            label="D-39b: follow_ref + multi-element sections + occurrence -> invalid_parameter_combination",
            passed=d39b_passed,
            detail=d39b_detail,
            timing_ms=d39b_result.timing_ms,
            tool_result=d39b_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39c: follow_ref + multi-element sections (valid)
        #         -> sections extracted from target document
        # TARGET_BODY has two "## Action Items" sections
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39c_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            sections=["Action Items", "Action Items"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39c_passed = False
        d39c_detail = ""
        if d39c_result.ok:
            try:
                env = json.loads(d39c_result.text)
                fr = env.get("followed_ref", {})
                body = fr.get("body", "")
                extracted = fr.get("extracted_sections", [])
                checks = {
                    "has followed_ref": "followed_ref" in env,
                    "followed_ref has body": "body" in fr,
                    "body contains First item": "First item" in body,
                    "body contains Third item": "Third item" in body,
                    "extracted_sections has 2 elements": len(extracted) == 2,
                }
                d39c_passed = all(checks.values())
                if not d39c_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d39c_detail = f"Failed: {', '.join(failed)}. body={body[:200]!r}, extracted={extracted!r}"
            except Exception as e:
                d39c_detail = f"JSON parse error: {e}"
        else:
            d39c_detail = f"Expected ok=True, got isError. text={d39c_result.text[:200]}"

        run.step(
            label="D-39c: follow_ref + multi-element sections (valid) -> sections extracted from target",
            passed=d39c_passed,
            detail=d39c_detail,
            timing_ms=d39c_result.timing_ms,
            tool_result=d39c_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39d: follow_ref + sections: section_not_found on target
        #         -> section_not_found NESTED under followed_ref (post-resolution nesting)
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39d_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            sections=["NonExistentSection"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39d_passed = False
        d39d_detail = ""
        if not d39d_result.ok:
            try:
                env = json.loads(d39d_result.text)
                fr = env.get("followed_ref", {})
                checks = {
                    "error == section_not_found": env.get("error") == "section_not_found",
                    "identifier present at top level (source)": "identifier" in env,
                    "followed_ref key present (post-resolution nesting)": "followed_ref" in env,
                    "followed_ref.reference present": "reference" in fr,
                    "followed_ref.missing_sections present": "missing_sections" in fr,
                    "followed_ref.available_headings present": "available_headings" in fr,
                    "available_headings contains Summary": any("Summary" in h for h in fr.get("available_headings", [])),
                }
                d39d_passed = all(checks.values())
                if not d39d_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d39d_detail = f"Failed: {', '.join(failed)}. fr={fr!r}"
            except Exception as e:
                d39d_detail = f"JSON parse error: {e}"
        else:
            d39d_detail = f"Expected isError=True but got ok. text={d39d_result.text[:200]}"

        run.step(
            label="D-39d: follow_ref + sections: section_not_found on target nested under followed_ref",
            passed=d39d_passed,
            detail=d39d_detail,
            timing_ms=d39d_result.timing_ms,
            tool_result=d39d_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39e: follow_ref + sections + occurrence out of range
        #         -> section_not_found with nested followed_ref
        #         TARGET has only 2 "Action Items" sections; occurrence=99
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39e_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            follow_ref="projections.summary",
            sections=["Action Items"],
            occurrence=99,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39e_passed = False
        d39e_detail = ""
        if not d39e_result.ok:
            try:
                env = json.loads(d39e_result.text)
                fr = env.get("followed_ref", {})
                missing = fr.get("missing_sections", [])
                first_missing = missing[0] if missing else {}
                checks = {
                    "error == section_not_found": env.get("error") == "section_not_found",
                    "followed_ref key present": "followed_ref" in env,
                    "followed_ref.missing_sections present": "missing_sections" in fr,
                    "reason == insufficient_occurrences": first_missing.get("reason") == "insufficient_occurrences",
                }
                d39e_passed = all(checks.values())
                if not d39e_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d39e_detail = f"Failed: {', '.join(failed)}. first_missing={first_missing!r}"
            except Exception as e:
                d39e_detail = f"JSON parse error: {e}"
        else:
            d39e_detail = f"Expected isError=True but got ok. text={d39e_result.text[:200]}"

        run.step(
            label="D-39e: follow_ref + sections + occurrence out of range -> nested followed_ref error",
            passed=d39e_passed,
            detail=d39e_detail,
            timing_ms=d39e_result.timing_ms,
            tool_result=d39e_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-39f: pre-resolution follow_ref_path_not_found is NOT nested
        #         even when sections is also set
        #         simple_path has no 'nonexistent_key' in frontmatter
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d39f_result = ctx.client.call_tool(
            "get_document",
            identifiers=simple_path,
            follow_ref="nonexistent_key",
            sections=["SomeSection"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d39f_passed = False
        d39f_detail = ""
        if not d39f_result.ok:
            try:
                env = json.loads(d39f_result.text)
                checks = {
                    "error == follow_ref_path_not_found": env.get("error") == "follow_ref_path_not_found",
                    "NO followed_ref key (pre-resolution stays top-level)": "followed_ref" not in env,
                }
                d39f_passed = all(checks.values())
                if not d39f_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d39f_detail = f"Failed: {', '.join(failed)}. env keys={list(env.keys())}"
            except Exception as e:
                d39f_detail = f"JSON parse error: {e}"
        else:
            d39f_detail = f"Expected isError=True but got ok. text={d39f_result.text[:200]}"

        run.step(
            label="D-39f: pre-resolution follow_ref_path_not_found NOT nested even when sections set",
            passed=d39f_passed,
            detail=d39f_detail,
            timing_ms=d39f_result.timing_ms,
            tool_result=d39f_result,
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
        description="Test: get_document follow_ref — frontmatter pointer dereference, error nesting, and combined batch + follow_ref (D-50, D-53..D-60, D-39a..D-39f).",
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

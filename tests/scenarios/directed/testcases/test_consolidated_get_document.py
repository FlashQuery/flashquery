#!/usr/bin/env python3
"""
Test: consolidated get_document — happy-path envelope and title-fallback tests.

Scenario:
    Creates documents with various frontmatter configurations and verifies the
    JSON envelope returned by get_document across include variants, heading depth,
    duplicate headings, and title fallback behavior.

Coverage points: D-27, D-28, D-29, D-30, O-07, O-08, D-47, D-48, D-49

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_consolidated_get_document.py                            # existing server
    python test_consolidated_get_document.py --managed                  # managed server
    python test_consolidated_get_document.py --managed --json           # structured JSON with server logs
    python test_consolidated_get_document.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-27", "D-28", "D-29", "D-30", "O-07", "O-11", "O-08", "D-47", "D-48", "D-49"]

import argparse
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_consolidated_get_document"

# ---------------------------------------------------------------------------
# Demo document (spec §4.2 Weekly Standup fixture)
# ---------------------------------------------------------------------------

DEMO_FRONTMATTER_EXTRA = {
    "type": "meeting-notes",
    "priority": "medium",
    "sprint": 12,
    "team": "core-platform",
    "projections": {
        "summary": "Meetings/.projections/standup-s12-summary.md",
        "action_items": "7f8e9d0c-1234-5678-9abc-def012345678",
    },
}

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


def _write_raw_vault_file(raw_vault: str, rel_path: str, content: str, ctx: TestContext) -> None:
    """Write a raw markdown file into the vault and register it for cleanup."""
    abs_path = os.path.join(raw_vault, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)
    ctx.cleanup.track_file(rel_path)
    parts = Path(rel_path).parts
    for i in range(1, len(parts)):
        ctx.cleanup.track_dir(str(Path(*parts[:i])))


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    path_a = f"_test/{TEST_NAME}_{run.run_id}_standup.md"
    path_no_fq_title   = f"_test/{TEST_NAME}_{run.run_id}_no_fq_title.md"
    path_numeric_title = f"_test/{TEST_NAME}_{run.run_id}_numeric_title.md"
    path_padded_title  = f"_test/{TEST_NAME}_{run.run_id}_padded_title.md"

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

        # ── Setup: Create document A (demo standup doc) ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title="Weekly Standup — Sprint 12",
            content=DEMO_BODY,
            path=path_a,
            tags=["meeting-notes", "sprint-12"],
            frontmatter=DEMO_FRONTMATTER_EXTRA,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_a, created_path_a = _track_created(ctx, create_a.text, path_a)
        create_a.expect_contains("Weekly Standup")

        run.step(
            label="Setup: create_document A (Weekly Standup demo doc)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            return run

        ident_a = fqc_id_a or created_path_a

        # ── Setup: Write raw vault fixtures for D-47, D-48, D-49 ─────
        # These tests require specific frontmatter states not achievable via
        # create_document (which always sets fq_title from the title param).
        # Requires vault access — skipped gracefully when not available.
        raw_vault = str(ctx.server.vault_path) if ctx.server else getattr(args, "vault_path", None)
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        if raw_vault:
            # D-47: frontmatter with other fields but NO fq_title
            _write_raw_vault_file(raw_vault, path_no_fq_title, (
                f"---\n"
                f"fq_status: active\n"
                f"fq_tags: []\n"
                f"fq_created: {now_iso}\n"
                f"fq_updated: {now_iso}\n"
                f"fq_id: {uuid.uuid4()}\n"
                f"---\n\n"
                f"No fq_title content.\n"
            ), ctx)

            # D-48: fq_title stored as YAML integer (no quotes) to test String() coercion
            _write_raw_vault_file(raw_vault, path_numeric_title, (
                f"---\n"
                f"fq_title: 42\n"
                f"fq_status: active\n"
                f"fq_tags: []\n"
                f"fq_created: {now_iso}\n"
                f"fq_updated: {now_iso}\n"
                f"fq_id: {uuid.uuid4()}\n"
                f"---\n\n"
                f"Numeric fq_title document.\n"
            ), ctx)

            # D-49: fq_title with leading/trailing whitespace to test trim logic
            _write_raw_vault_file(raw_vault, path_padded_title, (
                f"---\n"
                f"fq_title: \"  Padded Title  \"\n"
                f"fq_status: active\n"
                f"fq_tags: []\n"
                f"fq_created: {now_iso}\n"
                f"fq_updated: {now_iso}\n"
                f"fq_id: {uuid.uuid4()}\n"
                f"---\n\n"
                f"Padded title document.\n"
            ), ctx)

        run.step(
            label="Setup: write raw vault fixtures for D-47/D-48/D-49",
            passed=bool(raw_vault),
            detail="" if raw_vault else "skipped — no vault_path; title-fallback steps will be skipped",
            timing_ms=0,
        )

        # ── Force scan to ensure all docs are indexed ────────────────
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
        # D-27: include default returns body + envelope
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d27_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d27_passed = False
        d27_detail = ""
        if d27_result.ok:
            try:
                env = json.loads(d27_result.text)
                checks = {
                    "has identifier": "identifier" in env,
                    "title contains Weekly Standup": "Weekly Standup" in env.get("title", ""),
                    "title contains Sprint 12": "Sprint 12" in env.get("title", ""),
                    "has path": "path" in env,
                    "has fq_id": bool(env.get("fq_id")),
                    "has modified": bool(env.get("modified")),
                    "size.chars > 0": env.get("size", {}).get("chars", 0) > 0,
                    "has body": "body" in env,
                    "body contains heading": "## 1. Progress Updates" in env.get("body", ""),
                    "no frontmatter key": "frontmatter" not in env,
                    "no headings key": "headings" not in env,
                    "size.chars equals len(body) (TC1-W8)":
                        env.get("size", {}).get("chars") == len(env.get("body", "")),
                }
                d27_passed = all(checks.values())
                if not d27_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d27_detail = f"Failed checks: {', '.join(failed)}. title={env.get('title')!r} keys={list(env.keys())}"
            except Exception as e:
                d27_detail = f"JSON parse error: {e}"
        else:
            d27_detail = d27_result.error or d27_result.text[:200]

        run.step(
            label="D-27: get_document (default include) returns body + envelope",
            passed=d27_passed,
            detail=d27_detail,
            timing_ms=d27_result.timing_ms,
            tool_result=d27_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-28: include: ['frontmatter'] returns ALL custom fields (GDOC-04)
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d28_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["frontmatter"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d28_passed = False
        d28_detail = ""
        if d28_result.ok:
            try:
                env = json.loads(d28_result.text)
                fm = env.get("frontmatter", {})
                projections = fm.get("projections", {})
                checks = {
                    "has frontmatter key": "frontmatter" in env,
                    "projections.summary matches": projections.get("summary") == "Meetings/.projections/standup-s12-summary.md",
                    "no body key": "body" not in env,
                    "no headings key": "headings" not in env,
                    "envelope fields present": "title" in env and "path" in env and "fq_id" in env,
                    "frontmatter has type (TC1-W7)":
                        "type" in (env.get("frontmatter") or {}),
                    "frontmatter has sprint (TC1-W7)":
                        "sprint" in (env.get("frontmatter") or {}),
                    "frontmatter has team (TC1-W7)":
                        "team" in (env.get("frontmatter") or {}),
                    # TC1-W7 follow-up: projections.action_items value matches the
                    # UUID-shaped string seeded in DEMO_FRONTMATTER_EXTRA. The prior
                    # round only covered projections.summary; the spec contract is
                    # "include:['frontmatter'] returns ALL custom fields", which
                    # includes nested entries like projections.action_items.
                    "projections.action_items matches (TC1-W7)":
                        projections.get("action_items") == "7f8e9d0c-1234-5678-9abc-def012345678",
                    # TC1-W7 follow-up: confirm fq_* canonical fields round-trip
                    # into the frontmatter response. create_document populates
                    # fq_id, fq_title, fq_status, fq_created, fq_updated; all
                    # five must be present and non-empty in the response so the
                    # AI consumer can reference them in follow-up calls.
                    "frontmatter has fq_id (TC1-W7)":
                        bool((env.get("frontmatter") or {}).get("fq_id")),
                    "frontmatter has fq_title (TC1-W7)":
                        bool((env.get("frontmatter") or {}).get("fq_title")),
                    "frontmatter has fq_status (TC1-W7)":
                        bool((env.get("frontmatter") or {}).get("fq_status")),
                    "frontmatter has fq_created (TC1-W7)":
                        bool((env.get("frontmatter") or {}).get("fq_created")),
                    "frontmatter has fq_updated (TC1-W7)":
                        bool((env.get("frontmatter") or {}).get("fq_updated")),
                }
                d28_passed = all(checks.values())
                if not d28_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d28_detail = f"Failed checks: {', '.join(failed)}. projections={projections!r}"
            except Exception as e:
                d28_detail = f"JSON parse error: {e}"
        else:
            d28_detail = d28_result.error or d28_result.text[:200]

        run.step(
            label="D-28: include: ['frontmatter'] returns ALL custom fields including projections (GDOC-04)",
            passed=d28_passed,
            detail=d28_detail,
            timing_ms=d28_result.timing_ms,
            tool_result=d28_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-29: include: ['headings'] returns level/text/chars per heading
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d29_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["headings"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d29_passed = False
        d29_detail = ""
        if d29_result.ok:
            try:
                env = json.loads(d29_result.text)
                headings = env.get("headings", [])
                # Demo doc has: 1. Progress, 1.1. Native LLM, 2. Blockers, 3. Action Items,
                #               4. Action Items, 5. Notes = 6 headings minimum
                all_valid = all(
                    isinstance(h, dict) and "level" in h and "text" in h and "chars" in h
                    for h in headings
                )
                checks = {
                    "has headings key": "headings" in env,
                    ">=6 headings": len(headings) >= 6,
                    "all have level/text/chars": all_valid,
                    "no body key": "body" not in env,
                    "no frontmatter key": "frontmatter" not in env,
                    "all heading.chars > 0 (TC1-W6)":
                        all(h.get("chars", 0) > 0 for h in headings),
                    "all heading.level in {1..6} (TC1-W6)":
                        all(1 <= h.get("level", 0) <= 6 for h in headings),
                }
                d29_passed = all(checks.values())
                if not d29_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d29_detail = f"Failed checks: {', '.join(failed)}. headings count={len(headings)}"
            except Exception as e:
                d29_detail = f"JSON parse error: {e}"
        else:
            d29_detail = d29_result.error or d29_result.text[:200]

        run.step(
            label="D-29: include: ['headings'] returns level/text/chars per heading",
            passed=d29_passed,
            detail=d29_detail,
            timing_ms=d29_result.timing_ms,
            tool_result=d29_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-30: include: ['body','frontmatter','headings'] returns all three
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        d30_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["body", "frontmatter", "headings"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        d30_passed = False
        d30_detail = ""
        if d30_result.ok:
            try:
                env = json.loads(d30_result.text)
                checks = {
                    "has body": "body" in env,
                    "has frontmatter": "frontmatter" in env,
                    "has headings": "headings" in env,
                    "envelope identifier present": "identifier" in env,
                    "envelope title present": "title" in env,
                }
                d30_passed = all(checks.values())
                if not d30_passed:
                    failed = [k for k, v in checks.items() if not v]
                    d30_detail = f"Failed checks: {', '.join(failed)}. keys={list(env.keys())}"
            except Exception as e:
                d30_detail = f"JSON parse error: {e}"
        else:
            d30_detail = d30_result.error or d30_result.text[:200]

        run.step(
            label="D-30: include: ['body','frontmatter','headings'] returns all three plus envelope",
            passed=d30_passed,
            detail=d30_detail,
            timing_ms=d30_result.timing_ms,
            tool_result=d30_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # O-07: max_depth: 2 omits level 3+ headings
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        o07_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["headings"],
            max_depth=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        o07_passed = False
        o07_detail = ""
        if o07_result.ok:
            try:
                env = json.loads(o07_result.text)
                headings = env.get("headings", [])
                levels = [h.get("level") for h in headings]
                texts  = [h.get("text", "") for h in headings]
                has_level3 = any(lvl > 2 for lvl in levels if lvl is not None)
                # Demo doc has "### 1.1. Native LLM Access" (level 3) — must be absent
                has_level3_text = any("1.1. Native LLM Access" in t for t in texts)
                checks = {
                    "has headings": len(headings) > 0,
                    "no level > 2": not has_level3,
                    "level-3 heading absent": not has_level3_text,
                }
                o07_passed = all(checks.values())
                if not o07_passed:
                    failed = [k for k, v in checks.items() if not v]
                    o07_detail = f"Failed checks: {', '.join(failed)}. levels={levels}"
            except Exception as e:
                o07_detail = f"JSON parse error: {e}"
        else:
            o07_detail = o07_result.error or o07_result.text[:200]

        run.step(
            label="O-07: max_depth=2 omits level 3+ headings; level-3 heading confirmed absent",
            passed=o07_passed,
            detail=o07_detail,
            timing_ms=o07_result.timing_ms,
            tool_result=o07_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # O-11 (Phase 1 Gap 6): max_depth=1 boundary — only H1 headings;
        # all H2/H3 headings must be excluded. The demo doc has no H1,
        # so headings list must be empty (or contain only H1s if any).
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        o11_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["headings"],
            max_depth=1,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        o11_passed = False
        o11_detail = ""
        if o11_result.ok:
            try:
                env = json.loads(o11_result.text)
                headings = env.get("headings", [])
                levels = [h.get("level") for h in headings]
                texts  = [h.get("text", "") for h in headings]
                # Demo doc has no H1, so headings must be empty.
                # All H2 ("## 1. Progress Updates", etc.) and H3 ("### 1.1. Native LLM Access")
                # must be excluded.
                checks = {
                    "headings is empty (no H1 in demo doc)": len(headings) == 0,
                    "no level > 1": all(lvl is None or lvl <= 1 for lvl in levels),
                    "H2 '1. Progress Updates' absent": not any("1. Progress Updates" in t for t in texts),
                    "H3 '1.1. Native LLM Access' absent": not any("1.1. Native LLM Access" in t for t in texts),
                }
                o11_passed = all(checks.values())
                if not o11_passed:
                    failed = [k for k, v in checks.items() if not v]
                    o11_detail = f"Failed checks: {', '.join(failed)}. levels={levels} texts={texts}"
            except Exception as e:
                o11_detail = f"JSON parse error: {e}"
        else:
            o11_detail = o11_result.error or o11_result.text[:200]

        run.step(
            label="O-11: max_depth=1 boundary — only H1 headings (Phase 1 Gap 6)",
            passed=o11_passed,
            detail=o11_detail,
            timing_ms=o11_result.timing_ms,
            tool_result=o11_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # O-08: duplicate heading names both appear with distinct chars values
        # ─────────────────────────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        o08_result = ctx.client.call_tool(
            "get_document",
            identifiers=ident_a,
            include=["headings"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        o08_passed = False
        o08_detail = ""
        if o08_result.ok:
            try:
                env = json.loads(o08_result.text)
                headings = env.get("headings", [])
                # The demo doc has "3. Action Items" and "4. Action Items"
                action_items = [h for h in headings if "Action Items" in h.get("text", "")]
                chars_vals = [h.get("chars", 0) for h in action_items]
                checks = {
                    "two Action Items headings": len(action_items) >= 2,
                    "both have chars > 0": all(c > 0 for c in chars_vals),
                    "chars values are distinct": len(set(chars_vals)) == len(chars_vals),
                }
                o08_passed = all(checks.values())
                if not o08_passed:
                    failed = [k for k, v in checks.items() if not v]
                    o08_detail = f"Failed checks: {', '.join(failed)}. action_items={action_items!r}"
            except Exception as e:
                o08_detail = f"JSON parse error: {e}"
        else:
            o08_detail = o08_result.error or o08_result.text[:200]

        run.step(
            label="O-08: duplicate heading names both appear with distinct chars values",
            passed=o08_passed,
            detail=o08_detail,
            timing_ms=o08_result.timing_ms,
            tool_result=o08_result,
            server_logs=step_logs,
        )

        # ─────────────────────────────────────────────────────────────
        # D-47: title fallback to basename when fq_title absent
        # ─────────────────────────────────────────────────────────────
        if not raw_vault:
            t0 = time.monotonic()
            run.step(
                label="D-47: title fallback when fq_title absent — SKIPPED (no vault_path in unmanaged mode)",
                passed=True,
                detail="Requires vault write access to create a file without fq_title; use --managed.",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        else:
            log_mark = ctx.server.log_position if ctx.server else 0
            d47_result = ctx.client.call_tool(
                "get_document",
                identifiers=path_no_fq_title,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            d47_passed = False
            d47_detail = ""
            if d47_result.ok:
                try:
                    env = json.loads(d47_result.text)
                    actual_title = env.get("title", "")
                    expected_basename = Path(path_no_fq_title).stem
                    checks = {
                        "title is string": isinstance(actual_title, str),
                        f"title == basename {expected_basename!r} (OQ #13)":
                            actual_title == expected_basename,
                        "title is non-empty": bool(actual_title.strip()),
                        "title does NOT contain folder separator": "/" not in actual_title,
                        "title does NOT contain .md extension": not actual_title.endswith(".md"),
                        "title does NOT include _test prefix": "_test" not in actual_title,
                    }
                    d47_passed = all(checks.values())
                    if not d47_passed:
                        failed = [k for k, v in checks.items() if not v]
                        d47_detail = (
                            f"Failed: {', '.join(failed)}. "
                            f"actual={actual_title!r}, expected={expected_basename!r}"
                        )
                except Exception as e:
                    d47_detail = f"JSON parse error: {e}"
            else:
                d47_detail = d47_result.error or d47_result.text[:200]

            run.step(
                label=f"D-47: title fallback when fq_title absent — returns basename '{Path(path_no_fq_title).stem}'",
                passed=d47_passed,
                detail=d47_detail,
                timing_ms=d47_result.timing_ms,
                tool_result=d47_result,
                server_logs=step_logs,
            )

        # ─────────────────────────────────────────────────────────────
        # D-48: title coercion — fq_title stored as YAML integer 42
        # ─────────────────────────────────────────────────────────────
        if not raw_vault:
            t0 = time.monotonic()
            run.step(
                label="D-48: title coercion when fq_title is a number — SKIPPED (no vault_path)",
                passed=True,
                detail="Requires vault write access to store fq_title as YAML integer; use --managed.",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        else:
            log_mark = ctx.server.log_position if ctx.server else 0
            d48_result = ctx.client.call_tool(
                "get_document",
                identifiers=path_numeric_title,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            d48_passed = False
            d48_detail = ""
            if d48_result.ok:
                try:
                    env = json.loads(d48_result.text)
                    actual_title = env.get("title", "")
                    # fq_title was stored as YAML integer 42; envelope.title must be the string "42"
                    checks = {
                        "title is string type": isinstance(actual_title, str),
                        "title is '42'": actual_title == "42",
                    }
                    d48_passed = all(checks.values())
                    if not d48_passed:
                        failed = [k for k, v in checks.items() if not v]
                        d48_detail = f"Failed: {', '.join(failed)}. title={actual_title!r} type={type(actual_title).__name__}"
                except Exception as e:
                    d48_detail = f"JSON parse error: {e}"
            else:
                d48_detail = d48_result.error or d48_result.text[:200]

            run.step(
                label="D-48: title coercion — fq_title integer 42 coerced to string '42'",
                passed=d48_passed,
                detail=d48_detail,
                timing_ms=d48_result.timing_ms,
                tool_result=d48_result,
                server_logs=step_logs,
            )

        # ─────────────────────────────────────────────────────────────
        # D-49: title trim — fq_title with leading/trailing whitespace
        # ─────────────────────────────────────────────────────────────
        if not raw_vault:
            t0 = time.monotonic()
            run.step(
                label="D-49: title trim when fq_title has whitespace — SKIPPED (no vault_path)",
                passed=True,
                detail="Requires vault write access to store fq_title with whitespace; use --managed.",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
        else:
            log_mark = ctx.server.log_position if ctx.server else 0
            d49_result = ctx.client.call_tool(
                "get_document",
                identifiers=path_padded_title,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            d49_passed = False
            d49_detail = ""
            if d49_result.ok:
                try:
                    env = json.loads(d49_result.text)
                    actual_title = env.get("title", "")
                    # fq_title stored as "  Padded Title  "; must be trimmed to "Padded Title"
                    checks = {
                        "title is 'Padded Title'": actual_title == "Padded Title",
                        "no leading whitespace": actual_title == actual_title.lstrip(),
                        "no trailing whitespace": actual_title == actual_title.rstrip(),
                    }
                    d49_passed = all(checks.values())
                    if not d49_passed:
                        failed = [k for k, v in checks.items() if not v]
                        d49_detail = f"Failed: {', '.join(failed)}. title={actual_title!r}"
                except Exception as e:
                    d49_detail = f"JSON parse error: {e}"
            else:
                d49_detail = d49_result.error or d49_result.text[:200]

            run.step(
                label="D-49: title trim — fq_title '  Padded Title  ' trimmed to 'Padded Title'",
                passed=d49_passed,
                detail=d49_detail,
                timing_ms=d49_result.timing_ms,
                tool_result=d49_result,
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
                detail=f"Files retained under: _test/",
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
        description="Test: consolidated get_document — happy-path envelope and title-fallback tests.",
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

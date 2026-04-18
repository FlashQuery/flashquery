#!/usr/bin/env python3
"""
Test: update_doc_header and insert_doc_link frontmatter operations.

Scenario:
    1. Create a primary document via MCP (create_document) with custom frontmatter
       and a known body.
    2. update_doc_header to add/change fields — verify on disk that fields were
       merged, pre-existing custom field preserved, and body untouched (C-10).
    3. update_doc_header with a null value to remove a field — verify on disk
       that the field is gone (C-11).
    4. Create two target documents so insert_doc_link has valid resolution targets.
    5. insert_doc_link with default property → verify `links` array contains the
       target wikilink (C-12).
    6. insert_doc_link with the SAME target again → verify dedup: still one entry (C-13).
    7. insert_doc_link with a different target and custom property name → verify
       the new property is created separately from `links` (C-14).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: C-10, C-11, C-12, C-13, C-14

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_content_frontmatter_ops.py                            # existing server
    python test_content_frontmatter_ops.py --managed                  # managed server
    python test_content_frontmatter_ops.py --managed --json           # structured JSON with server logs
    python test_content_frontmatter_ops.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["C-10", "C-11", "C-12", "C-13", "C-14"]

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

TEST_NAME = "test_content_frontmatter_ops"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _track_created(ctx, create_result) -> tuple[str, str]:
    """Parse FQC ID + Path from a create_document response and register cleanup."""
    fqc_id = _extract_field(create_result.text, "FQC ID")
    path = _extract_field(create_result.text, "Path")
    if path:
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if fqc_id:
        ctx.cleanup.track_mcp_document(fqc_id)
    return fqc_id, path


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    primary_title = f"FQC Frontmatter Primary {run.run_id}"
    target_a_title = f"FQC Frontmatter TargetA {run.run_id}"
    target_b_title = f"FQC Frontmatter TargetB {run.run_id}"

    primary_path = f"_test/{TEST_NAME}_{run.run_id}_primary.md"
    target_a_path = f"_test/{TEST_NAME}_{run.run_id}_target_a.md"
    target_b_path = f"_test/{TEST_NAME}_{run.run_id}_target_b.md"

    primary_body = (
        f"## Body\n\n"
        f"body text for {TEST_NAME} run {run.run_id}.\n\n"
        f"This paragraph must remain untouched through every header update."
    )
    tags = ["fqc-test", "frontmatter-ops", run.run_id]

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create primary document with custom frontmatter ──
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=primary_title,
            content=primary_body,
            path=primary_path,
            tags=tags,
            frontmatter={"project": "old", "priority": "high"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        primary_fqc_id, primary_actual_path = _track_created(ctx, create_result)
        create_result.expect_contains(primary_title)

        run.step(
            label="create_document (primary with custom frontmatter)",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        primary_identifier = primary_fqc_id or primary_path
        read_path = primary_actual_path or primary_path

        # ── Step 2: update_doc_header merges fields, body untouched (C-10) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        upd1_result = ctx.client.call_tool(
            "update_doc_header",
            identifier=primary_identifier,
            updates={"project": "new", "client": "acme"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_doc_header (merge project + client)",
            passed=(upd1_result.ok and upd1_result.status == "pass"),
            detail=expectation_detail(upd1_result) or upd1_result.error or "",
            timing_ms=upd1_result.timing_ms,
            tool_result=upd1_result,
            server_logs=step_logs,
        )

        # Disk verification: C-10
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(read_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "project updated to 'new'": doc.frontmatter.get("project") == "new",
                "client set to 'acme'": doc.frontmatter.get("client") == "acme",
                "priority preserved as 'high'": doc.frontmatter.get("priority") == "high",
                "title preserved": doc.title == primary_title,
                "body untouched": "body text" in doc.body and "Body" in doc.body,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"project={doc.frontmatter.get('project')!r}, "
                    f"client={doc.frontmatter.get('client')!r}, "
                    f"priority={doc.frontmatter.get('priority')!r}, "
                    f"body[:80]={doc.body[:80]!r}"
                )
            run.step("C-10: header merge preserves body + untouched fields",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-10: header merge preserves body + untouched fields",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 3: update_doc_header with null removes field (C-11) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        upd2_result = ctx.client.call_tool(
            "update_doc_header",
            identifier=primary_identifier,
            updates={"priority": None},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_doc_header (priority = null)",
            passed=(upd2_result.ok and upd2_result.status == "pass"),
            detail=expectation_detail(upd2_result) or upd2_result.error or "",
            timing_ms=upd2_result.timing_ms,
            tool_result=upd2_result,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(read_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "priority field removed": "priority" not in doc.frontmatter,
                "project still 'new'": doc.frontmatter.get("project") == "new",
                "client still 'acme'": doc.frontmatter.get("client") == "acme",
                "body still untouched": "body text" in doc.body,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"frontmatter_keys={list(doc.frontmatter.keys())!r}"
                )
            run.step("C-11: null value removes frontmatter field",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-11: null value removes frontmatter field",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 4: Create two target documents for link resolution ──
        log_mark = ctx.server.log_position if ctx.server else 0
        target_a_result = ctx.client.call_tool(
            "create_document",
            title=target_a_title,
            content=f"Target A body ({run.run_id}).",
            path=target_a_path,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        target_a_fqc_id, target_a_actual_path = _track_created(ctx, target_a_result)

        run.step(
            label="create_document (target A)",
            passed=(target_a_result.ok and target_a_result.status == "pass"),
            detail=expectation_detail(target_a_result) or target_a_result.error or "",
            timing_ms=target_a_result.timing_ms,
            tool_result=target_a_result,
            server_logs=step_logs,
        )
        if not target_a_result.ok:
            return run

        log_mark = ctx.server.log_position if ctx.server else 0
        target_b_result = ctx.client.call_tool(
            "create_document",
            title=target_b_title,
            content=f"Target B body ({run.run_id}).",
            path=target_b_path,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        target_b_fqc_id, target_b_actual_path = _track_created(ctx, target_b_result)

        run.step(
            label="create_document (target B)",
            passed=(target_b_result.ok and target_b_result.status == "pass"),
            detail=expectation_detail(target_b_result) or target_b_result.error or "",
            timing_ms=target_b_result.timing_ms,
            tool_result=target_b_result,
            server_logs=step_logs,
        )
        if not target_b_result.ok:
            return run

        target_a_identifier = target_a_fqc_id or target_a_path
        target_b_identifier = target_b_fqc_id or target_b_path
        expected_link_a = f"[[{target_a_title}]]"
        expected_link_b = f"[[{target_b_title}]]"

        # ── Step 5: insert_doc_link default property (C-12) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        link1_result = ctx.client.call_tool(
            "insert_doc_link",
            identifier=primary_identifier,
            target=target_a_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_doc_link (default 'links' property)",
            passed=(link1_result.ok and link1_result.status == "pass"),
            detail=expectation_detail(link1_result) or link1_result.error or "",
            timing_ms=link1_result.timing_ms,
            tool_result=link1_result,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(read_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            links = doc.frontmatter.get("links", [])
            checks = {
                "links is a list": isinstance(links, list),
                "links contains target A wikilink": expected_link_a in (links or []),
                "links has exactly one entry": isinstance(links, list) and len(links) == 1,
                "body still untouched": "body text" in doc.body,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. links={links!r}"
            run.step("C-12: insert_doc_link adds wikilink to links array",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-12: insert_doc_link adds wikilink to links array",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 6: insert_doc_link dedup — same target again (C-13) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        link2_result = ctx.client.call_tool(
            "insert_doc_link",
            identifier=primary_identifier,
            target=target_a_identifier,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_doc_link (duplicate target)",
            passed=(link2_result.ok and link2_result.status == "pass"),
            detail=expectation_detail(link2_result) or link2_result.error or "",
            timing_ms=link2_result.timing_ms,
            tool_result=link2_result,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(read_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            links = doc.frontmatter.get("links", [])
            checks = {
                "links still has exactly one entry": isinstance(links, list) and len(links) == 1,
                "links still contains target A wikilink": expected_link_a in (links or []),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. links={links!r}"
            run.step("C-13: insert_doc_link deduplicates same link",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-13: insert_doc_link deduplicates same link",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 7: insert_doc_link custom property (C-14) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        link3_result = ctx.client.call_tool(
            "insert_doc_link",
            identifier=primary_identifier,
            target=target_b_identifier,
            property="related",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="insert_doc_link (custom 'related' property)",
            passed=(link3_result.ok and link3_result.status == "pass"),
            detail=expectation_detail(link3_result) or link3_result.error or "",
            timing_ms=link3_result.timing_ms,
            tool_result=link3_result,
            server_logs=step_logs,
        )

        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(read_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            links = doc.frontmatter.get("links", [])
            related = doc.frontmatter.get("related", [])
            checks = {
                "related is a list": isinstance(related, list),
                "related contains target B wikilink": expected_link_b in (related or []),
                "related has exactly one entry": isinstance(related, list) and len(related) == 1,
                "links array unchanged (still has A only)":
                    isinstance(links, list) and links == [expected_link_a],
                "related and links are distinct fields":
                    "related" in doc.frontmatter and "links" in doc.frontmatter,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"links={links!r}, related={related!r}"
                )
            run.step("C-14: insert_doc_link writes to custom property",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("C-14: insert_doc_link writes to custom property",
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
        description="Test: update_doc_header and insert_doc_link frontmatter operations.",
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

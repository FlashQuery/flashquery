#!/usr/bin/env python3
"""
Test: update_document partial updates preserve untouched fields, and reserved
frontmatter fields are protected from override via both create and update.

Scenario:
    1. Create a document (create_document) with title T1, body B, tags [t1, t2],
       custom frontmatter {project: "x"}, AND attempt to override reserved
       fields {fqc_id: "bogus-uuid-123", status: "archived"}. Verify on disk
       that the server-generated fqc_id and status="active" won (D-21).
    2. Update title only (update_document title=T2) — verify body and tags
       unchanged on disk (D-09).
    3. Update tags only — verify title T2 preserved, body preserved (D-10).
    4. Update custom frontmatter adding {client: "acme"} and again attempt
       to override fqc_id — verify custom field added, project preserved,
       and fqc_id still unchanged (D-11, D-22).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-09, D-10, D-11, D-21, D-22

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_update_partial.py                            # existing server
    python test_document_update_partial.py --managed                  # managed server
    python test_document_update_partial.py --managed --json           # structured JSON with server logs
    python test_document_update_partial.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["D-09", "D-10", "D-11", "D-21", "D-22"]

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

TEST_NAME = "test_document_update_partial"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    title_1 = f"FQC Partial {run.run_id}"
    title_2 = f"FQC Partial Updated {run.run_id}"
    test_path = f"_test/{TEST_NAME}_{run.run_id}.md"
    body = (
        f"## Preserved Body\n\n"
        f"Written by {TEST_NAME} (run {run.run_id}).\n\n"
        f"This body text must be preserved across partial updates."
    )
    tag_a = f"fqc-test"
    tag_b = f"partial-{run.run_id}"
    original_tags = [tag_a, tag_b]
    updated_tags = [tag_a, tag_b, "retagged"]
    bogus_fqc_id = "bogus-uuid-123"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create with custom + reserved-field override attempt ──
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "create_document",
            title=title_1,
            content=body,
            path=test_path,
            tags=original_tags,
            frontmatter={
                "project": "x",
                "fqc_id": bogus_fqc_id,
                "status": "archived",
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Parse the real fqc_id and path from the response for cleanup tracking
        created_fqc_id = _extract_field(create_result.text, "FQC ID")
        created_path = _extract_field(create_result.text, "Path")

        if created_path:
            ctx.cleanup.track_file(created_path)
            parts = Path(created_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if created_fqc_id:
            ctx.cleanup.track_mcp_document(created_fqc_id)

        create_result.expect_contains(title_1)

        run.step(
            label="create_document with custom + reserved frontmatter override attempt",
            passed=(create_result.ok and create_result.status == "pass"),
            detail=expectation_detail(create_result) or create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        # ── Step 2: Verify reserved fields were NOT overridden (D-21) ─────
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "fqc_id is server-generated (not bogus)": doc.fqc_id and doc.fqc_id != bogus_fqc_id,
                "fqc_id matches response": doc.fqc_id == created_fqc_id if created_fqc_id else True,
                "status is active (not archived)": doc.status == "active",
                "custom project field present": doc.frontmatter.get("project") == "x",
                "title matches T1": doc.title == title_1,
                "original tags present": all(t in doc.tags for t in original_tags),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id={doc.fqc_id!r}, status={doc.status!r}, "
                    f"title={doc.title!r}, tags={doc.tags!r}, "
                    f"project={doc.frontmatter.get('project')!r}"
                )
            run.step("D-21: reserved fields protected on create",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("D-21: reserved fields protected on create",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        read_identifier = created_fqc_id or test_path

        # ── Step 3: Update title only (D-09) ──────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        title_update_result = ctx.client.call_tool(
            "update_document",
            identifier=read_identifier,
            title=title_2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        title_update_result.expect_contains(title_2)

        run.step(
            label="update_document (title only)",
            passed=(title_update_result.ok and title_update_result.status == "pass"),
            detail=expectation_detail(title_update_result) or title_update_result.error or "",
            timing_ms=title_update_result.timing_ms,
            tool_result=title_update_result,
            server_logs=step_logs,
        )
        if not title_update_result.ok:
            return run

        # Verify on disk: title changed, body + tags preserved
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title updated to T2": doc.title == title_2,
                "body preserved": "Preserved Body" in doc.body and run.run_id in doc.body,
                "tag_a preserved": tag_a in doc.tags,
                "tag_b preserved": tag_b in doc.tags,
                "custom project preserved": doc.frontmatter.get("project") == "x",
                "fqc_id unchanged": doc.fqc_id == created_fqc_id if created_fqc_id else True,
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc.title!r}, tags={doc.tags!r}, "
                    f"body_len={len(doc.body)}, fqc_id={doc.fqc_id!r}"
                )
            run.step("D-09: title-only update preserves body and tags",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("D-09: title-only update preserves body and tags",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 4: Update tags only (D-10) ───────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        tags_update_result = ctx.client.call_tool(
            "update_document",
            identifier=read_identifier,
            tags=updated_tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_document (tags only)",
            passed=(tags_update_result.ok and tags_update_result.status == "pass"),
            detail=expectation_detail(tags_update_result) or tags_update_result.error or "",
            timing_ms=tags_update_result.timing_ms,
            tool_result=tags_update_result,
            server_logs=step_logs,
        )
        if not tags_update_result.ok:
            return run

        # Verify on disk: tags changed, title (T2) and body preserved
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "new tag 'retagged' present": "retagged" in doc.tags,
                "tag_a still present": tag_a in doc.tags,
                "tag_b still present": tag_b in doc.tags,
                "title still T2": doc.title == title_2,
                "body still preserved": "Preserved Body" in doc.body,
                "custom project still preserved": doc.frontmatter.get("project") == "x",
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc.title!r}, tags={doc.tags!r}, "
                    f"project={doc.frontmatter.get('project')!r}"
                )
            run.step("D-10: tags-only update preserves title and body",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("D-10: tags-only update preserves title and body",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

        # ── Step 5: Update custom frontmatter + retry reserved override (D-11, D-22) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        fm_update_result = ctx.client.call_tool(
            "update_document",
            identifier=read_identifier,
            frontmatter={
                "client": "acme",
                "fqc_id": bogus_fqc_id,
                "status": "archived",
            },
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="update_document (custom frontmatter + reserved override attempt)",
            passed=(fm_update_result.ok and fm_update_result.status == "pass"),
            detail=expectation_detail(fm_update_result) or fm_update_result.error or "",
            timing_ms=fm_update_result.timing_ms,
            tool_result=fm_update_result,
            server_logs=step_logs,
        )
        if not fm_update_result.ok:
            return run

        # Verify on disk: client added, project preserved, reserved fields protected
        t0 = time.monotonic()
        try:
            doc = ctx.vault.read_file(created_path or test_path)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "new custom field 'client' set": doc.frontmatter.get("client") == "acme",
                "prior custom field 'project' preserved": doc.frontmatter.get("project") == "x",
                "title still T2": doc.title == title_2,
                "body still preserved": "Preserved Body" in doc.body,
                "fqc_id still server-generated (not bogus)": doc.fqc_id and doc.fqc_id != bogus_fqc_id,
                "fqc_id unchanged from create": doc.fqc_id == created_fqc_id if created_fqc_id else True,
                "status still active (not archived)": doc.status == "active",
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id={doc.fqc_id!r}, status={doc.status!r}, "
                    f"title={doc.title!r}, "
                    f"project={doc.frontmatter.get('project')!r}, "
                    f"client={doc.frontmatter.get('client')!r}"
                )
            run.step("D-11 & D-22: custom frontmatter update, reserved fields protected",
                     passed=all_ok, detail=detail, timing_ms=elapsed)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step("D-11 & D-22: custom frontmatter update, reserved fields protected",
                     passed=False, detail=f"Exception: {e}", timing_ms=elapsed)

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
        description="Test: update_document partial updates + reserved frontmatter protection.",
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

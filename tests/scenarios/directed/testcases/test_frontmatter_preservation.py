#!/usr/bin/env python3
"""
Test: user-defined custom frontmatter fields survive document operations.

Scenario:
    1. Create Doc A via MCP with custom frontmatter fields (project, priority)
    2. Update Doc A title via update_document — verify custom fields survive (D-25)
    3. Archive Doc A via archive_document — verify custom fields survive with status=archived (D-26)
    4. Create Doc B via MCP with custom frontmatter fields (workflow, reviewer)
    5. Append content to Doc B via append_to_doc — verify custom fields survive (C-18)
    6. Insert content into Doc B via insert_in_doc — verify custom fields survive (C-18)
    7. Replace a section in Doc B via replace_doc_section — verify custom fields survive (C-18)
    8. Update Doc B custom field via update_doc_header — verify field was changed (C-19)
    9. Update Doc B title via update_doc_header — verify custom fields untouched (C-20)
    10. Write external file to vault with custom frontmatter but no fqc_id
    11. Scan vault via force_file_scan — verify fqc_id assigned, custom fields preserved (F-18)
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-25, D-26, C-18, C-19, C-20, F-18

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_frontmatter_preservation.py                            # existing server
    python test_frontmatter_preservation.py --managed                  # managed server
    python test_frontmatter_preservation.py --managed --json           # structured JSON with server logs
    python test_frontmatter_preservation.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-25", "D-26", "C-18", "C-19", "C-20", "F-18"]

import argparse
import re
import sys
import time
from pathlib import Path

# testcases/ -> directed/ -> scenarios/ -> framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_frontmatter_preservation"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Doc A — for D-25 (update_document) and D-26 (archive_document)
    title_a = f"FlashQuery FM Preservation A {run.run_id}"
    path_a = f"_test/{TEST_NAME}_{run.run_id}_a.md"
    body_a = f"## Content A\n\nDocument A created by {TEST_NAME} (run {run.run_id})."

    # Doc B — for C-18, C-19, C-20 (content editing and header updates)
    title_b = f"FlashQuery FM Preservation B {run.run_id}"
    path_b = f"_test/{TEST_NAME}_{run.run_id}_b.md"
    body_b = (
        f"## Section One\n\n"
        f"Initial content for {TEST_NAME} (run {run.run_id}).\n\n"
        f"## Section Two\n\n"
        f"Second section content."
    )

    # External file — for F-18 (scan preserves custom fields on a newly discovered file)
    path_ext = f"_test/{TEST_NAME}_{run.run_id}_ext.md"

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create Doc A with custom frontmatter ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title=title_a,
            content=body_a,
            path=path_a,
            tags=["fqc-test", run.run_id],
            frontmatter={"project": "alpha", "priority": "high"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_a = _extract_field(create_a.text, "FQC ID")
        created_path_a = _extract_field(create_a.text, "Path") or path_a

        # Register for cleanup immediately after creation
        if created_path_a:
            ctx.cleanup.track_file(created_path_a)
            parts = Path(created_path_a).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_a:
            ctx.cleanup.track_mcp_document(fqc_id_a)

        create_a.expect_contains(title_a)

        run.step(
            label="create_document Doc A with custom frontmatter (project=alpha, priority=high)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            return run

        identifier_a = fqc_id_a or path_a

        # ── Step 2: update_document (title only) — custom fields survive [D-25] ──
        updated_title_a = f"FlashQuery FM Updated A {run.run_id}"

        log_mark = ctx.server.log_position if ctx.server else 0
        update_a = ctx.client.call_tool(
            "update_document",
            identifier=identifier_a,
            title=updated_title_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_a = ctx.vault.read_file(created_path_a)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "custom field project=alpha": doc_a.frontmatter.get("project") == "alpha",
                "custom field priority=high": doc_a.frontmatter.get("priority") == "high",
                "title updated": doc_a.title == updated_title_a,
            }
            all_ok = all(checks.values()) and update_a.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"project={doc_a.frontmatter.get('project')!r}, "
                    f"priority={doc_a.frontmatter.get('priority')!r}, "
                    f"title={doc_a.title!r}"
                )
            run.step(
                label="update_document (title only) — custom fields survive on disk [D-25]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=update_a,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="update_document (title only) — custom fields survive on disk [D-25]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=update_a,
                server_logs=step_logs,
            )
        if not update_a.ok:
            return run

        # ── Step 3: archive_document — custom fields survive, status=archived [D-26] ──
        log_mark = ctx.server.log_position if ctx.server else 0
        archive_a = ctx.client.call_tool(
            "archive_document",
            identifiers=identifier_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_a2 = ctx.vault.read_file(created_path_a)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "status=archived": doc_a2.status == "archived",
                "custom field project=alpha": doc_a2.frontmatter.get("project") == "alpha",
                "custom field priority=high": doc_a2.frontmatter.get("priority") == "high",
            }
            all_ok = all(checks.values()) and archive_a.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"status={doc_a2.status!r}, "
                    f"project={doc_a2.frontmatter.get('project')!r}, "
                    f"priority={doc_a2.frontmatter.get('priority')!r}"
                )
            run.step(
                label="archive_document — custom fields survive with status=archived [D-26]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=archive_a,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="archive_document — custom fields survive with status=archived [D-26]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=archive_a,
                server_logs=step_logs,
            )

        # ── Step 4: Create Doc B with custom frontmatter ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title=title_b,
            content=body_b,
            path=path_b,
            tags=["fqc-test", run.run_id],
            frontmatter={"workflow": "draft", "reviewer": "alice"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_b = _extract_field(create_b.text, "FQC ID")
        created_path_b = _extract_field(create_b.text, "Path") or path_b

        if created_path_b:
            ctx.cleanup.track_file(created_path_b)
            parts = Path(created_path_b).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if fqc_id_b:
            ctx.cleanup.track_mcp_document(fqc_id_b)

        create_b.expect_contains(title_b)

        run.step(
            label="create_document Doc B with custom frontmatter (workflow=draft, reviewer=alice)",
            passed=(create_b.ok and create_b.status == "pass"),
            detail=expectation_detail(create_b) or create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            return run

        identifier_b = fqc_id_b or path_b

        # ── Step 5: append_to_doc — custom fields survive [C-18] ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        append_result = ctx.client.call_tool(
            "append_to_doc",
            identifier=identifier_b,
            content="\n## Appended Section\n\nAppended by test.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_b = ctx.vault.read_file(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "custom field workflow=draft": doc_b.frontmatter.get("workflow") == "draft",
                "custom field reviewer=alice": doc_b.frontmatter.get("reviewer") == "alice",
            }
            all_ok = all(checks.values()) and append_result.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"workflow={doc_b.frontmatter.get('workflow')!r}, "
                    f"reviewer={doc_b.frontmatter.get('reviewer')!r}"
                )
            run.step(
                label="append_to_doc — custom fields survive on disk [C-18]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=append_result,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="append_to_doc — custom fields survive on disk [C-18]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=append_result,
                server_logs=step_logs,
            )
        if not append_result.ok:
            return run

        # ── Step 6: insert_in_doc — custom fields survive [C-18] ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        insert_result = ctx.client.call_tool(
            "insert_in_doc",
            identifier=identifier_b,
            heading="Section One",
            position="after_heading",
            content="Inserted by test.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_b2 = ctx.vault.read_file(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "custom field workflow=draft": doc_b2.frontmatter.get("workflow") == "draft",
                "custom field reviewer=alice": doc_b2.frontmatter.get("reviewer") == "alice",
            }
            all_ok = all(checks.values()) and insert_result.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"workflow={doc_b2.frontmatter.get('workflow')!r}, "
                    f"reviewer={doc_b2.frontmatter.get('reviewer')!r}"
                )
            run.step(
                label="insert_in_doc — custom fields survive on disk [C-18]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=insert_result,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="insert_in_doc — custom fields survive on disk [C-18]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=insert_result,
                server_logs=step_logs,
            )
        if not insert_result.ok:
            return run

        # ── Step 7: replace_doc_section — custom fields survive [C-18] ───
        log_mark = ctx.server.log_position if ctx.server else 0
        replace_result = ctx.client.call_tool(
            "replace_doc_section",
            identifier=identifier_b,
            heading="Section Two",
            content="Replaced section content by test.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_b3 = ctx.vault.read_file(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "custom field workflow=draft": doc_b3.frontmatter.get("workflow") == "draft",
                "custom field reviewer=alice": doc_b3.frontmatter.get("reviewer") == "alice",
            }
            all_ok = all(checks.values()) and replace_result.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"workflow={doc_b3.frontmatter.get('workflow')!r}, "
                    f"reviewer={doc_b3.frontmatter.get('reviewer')!r}"
                )
            run.step(
                label="replace_doc_section — custom fields survive on disk [C-18]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=replace_result,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="replace_doc_section — custom fields survive on disk [C-18]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=replace_result,
                server_logs=step_logs,
            )
        if not replace_result.ok:
            return run

        # ── Step 8: update_doc_header targeting custom field — value changed [C-19] ──
        log_mark = ctx.server.log_position if ctx.server else 0
        header_c19 = ctx.client.call_tool(
            "update_doc_header",
            identifier=identifier_b,
            updates={"workflow": "review"},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_b4 = ctx.vault.read_file(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "workflow updated to review": doc_b4.frontmatter.get("workflow") == "review",
                "reviewer still alice": doc_b4.frontmatter.get("reviewer") == "alice",
            }
            all_ok = all(checks.values()) and header_c19.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"workflow={doc_b4.frontmatter.get('workflow')!r}, "
                    f"reviewer={doc_b4.frontmatter.get('reviewer')!r}"
                )
            run.step(
                label="update_doc_header targeting custom field 'workflow' — value changed [C-19]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=header_c19,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="update_doc_header targeting custom field 'workflow' — value changed [C-19]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=header_c19,
                server_logs=step_logs,
            )
        if not header_c19.ok:
            return run

        # ── Step 9: update_doc_header targeting title only — custom fields untouched [C-20] ──
        updated_title_b = f"FlashQuery FM Updated B {run.run_id}"

        log_mark = ctx.server.log_position if ctx.server else 0
        header_c20 = ctx.client.call_tool(
            "update_doc_header",
            identifier=identifier_b,
            updates={FM.TITLE: updated_title_b},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_b5 = ctx.vault.read_file(created_path_b)
            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "title updated": doc_b5.title == updated_title_b,
                "workflow still review": doc_b5.frontmatter.get("workflow") == "review",
                "reviewer still alice": doc_b5.frontmatter.get("reviewer") == "alice",
            }
            all_ok = all(checks.values()) and header_c20.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"title={doc_b5.title!r}, "
                    f"workflow={doc_b5.frontmatter.get('workflow')!r}, "
                    f"reviewer={doc_b5.frontmatter.get('reviewer')!r}"
                )
            run.step(
                label="update_doc_header targeting title only — custom fields untouched [C-20]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=header_c20,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="update_doc_header targeting title only — custom fields untouched [C-20]",
                passed=False,
                detail=f"Exception reading disk: {e}",
                timing_ms=elapsed,
                tool_result=header_c20,
                server_logs=step_logs,
            )

        # ── Step 10: Write external file with custom frontmatter (no fqc_id) ──
        t0 = time.monotonic()
        try:
            ext_abs = ctx.vault.vault_root / path_ext
            ext_abs.parent.mkdir(parents=True, exist_ok=True)
            ext_abs.write_text(
                "---\n"
                f"title: External Doc {run.run_id}\n"
                f"project: external-{run.run_id}\n"
                "custom_marker: preserved\n"
                "---\n\n"
                "Body of the externally created document.\n",
                encoding="utf-8",
            )
            elapsed = int((time.monotonic() - t0) * 1000)
            exists = ctx.vault.exists(path_ext)
            # Register filesystem cleanup now; DB cleanup registered after scan adds fqc_id
            ctx.cleanup.track_file(path_ext)
            run.step(
                label=f"Write external vault file with custom frontmatter, no fqc_id: {path_ext}",
                passed=exists,
                detail="" if exists else "File not found on disk after write",
                timing_ms=elapsed,
            )
            if not exists:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="Write external vault file with custom frontmatter, no fqc_id",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 11: force_file_scan — fqc_id assigned, custom fields preserved [F-18] ──
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        try:
            doc_ext = ctx.vault.read_file(path_ext)
            elapsed = int((time.monotonic() - t0) * 1000)
            discovered_id = doc_ext.fqc_id
            # Now that scan has assigned a fqc_id, register for DB cleanup
            if discovered_id:
                ctx.cleanup.track_mcp_document(discovered_id)
            checks = {
                "fqc_id assigned by scan": discovered_id is not None,
                f"custom field project=external-{run.run_id}": (
                    doc_ext.frontmatter.get("project") == f"external-{run.run_id}"
                ),
                "custom field custom_marker=preserved": (
                    doc_ext.frontmatter.get("custom_marker") == "preserved"
                ),
            }
            all_ok = all(checks.values()) and scan_result.ok
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"fqc_id={discovered_id!r}, "
                    f"project={doc_ext.frontmatter.get('project')!r}, "
                    f"custom_marker={doc_ext.frontmatter.get('custom_marker')!r}"
                )
            run.step(
                label="force_file_scan — fqc_id assigned, custom fields preserved [F-18]",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
                tool_result=scan_result,
                server_logs=step_logs,
            )
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="force_file_scan — fqc_id assigned, custom fields preserved [F-18]",
                passed=False,
                detail=f"Exception reading disk after scan: {e}",
                timing_ms=elapsed,
                tool_result=scan_result,
                server_logs=step_logs,
            )

        # ── Optionally retain files for debugging ─────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────────
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
        description="Test: user-defined custom frontmatter fields survive document operations.",
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
                         help="Start a dedicated FlashQuery server for this test run.")
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

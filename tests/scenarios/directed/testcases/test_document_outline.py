#!/usr/bin/env python3
"""
Test: get_doc_outline returns heading hierarchy, links, and respects options.

Scenario:
    1. Create document A via MCP (create_document) with H1/H2/H3 headings and
       two wiki-style links — one resolved ([[doc-b]]) and one unresolved
       ([[nonexistent-doc]]).
    2. Create document B via MCP so doc A's [[doc-b]] link resolves.
    3. Force a file scan so FQC indexes both documents (get_doc_outline reads
       DB metadata on the batch path).
    4. Call get_doc_outline(identifier=A) → verify full heading hierarchy
       (H1/H2/H3) is returned.
    5. Call get_doc_outline(identifier=A, max_depth=2) → verify H3 headings
       are omitted.
    6. Call get_doc_outline(identifier=A) → verify the resolved link to
       doc B is shown and the unresolved link is marked as such.
    7. Call get_doc_outline(identifier=A, exclude_headings=True) → verify
       frontmatter-only response (no heading text).
    8. Call get_doc_outline(identifiers=[A, B]) → verify batch response
       surfaces both documents' metadata.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: O-01, O-02, O-03, O-04, O-05, O-06

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_document_outline.py                            # existing server
    python test_document_outline.py --managed                  # managed server
    python test_document_outline.py --managed --json           # structured JSON with server logs
    python test_document_outline.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["O-01", "O-02", "O-03", "O-04", "O-05", "O-06"]

import argparse
import re
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_document_outline"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _track_created(ctx, result_text: str, fallback_path: str) -> tuple[str, str]:
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

    title_a = f"FQC Outline A {run.run_id}"
    title_b = f"FQC Outline B {run.run_id}"
    # Stable slugs so the wiki link [[outline-b-<run>]] resolves to doc B
    slug_a = f"outline-a-{run.run_id}"
    slug_b = f"outline-b-{run.run_id}"
    missing_slug = f"nonexistent-{run.run_id}"
    path_a = f"_test/{slug_a}.md"
    path_b = f"_test/{slug_b}.md"

    # Doc A body — H1/H2/H3 hierarchy + one resolved link + one unresolved link
    body_a = (
        f"# Top Heading A {run.run_id}\n\n"
        f"Intro paragraph with a resolved link to [[{slug_b}]] and "
        f"an unresolved link to [[{missing_slug}]].\n\n"
        f"## Section One\n\n"
        f"Section one content.\n\n"
        f"### Subsection One A\n\n"
        f"Deep content that should only appear at max_depth >= 3.\n\n"
        f"## Section Two\n\n"
        f"Section two content.\n"
    )
    body_b = (
        f"# Top Heading B {run.run_id}\n\n"
        f"Doc B is the resolution target for doc A's wiki link.\n"
    )
    tags = ["fqc-test", "outline-test", run.run_id]

    port_range = tuple(args.port_range) if args.port_range else None

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Create document A (with headings + links) ────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title=title_a,
            content=body_a,
            path=path_a,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_a, created_path_a = _track_created(ctx, create_a.text, path_a)
        create_a.expect_contains(title_a)

        run.step(
            label="create_document A (headings + wiki links)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            return run

        # ── Step 2: Create document B (link target) ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title=title_b,
            content=body_b,
            path=path_b,
            tags=tags,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        fqc_id_b, created_path_b = _track_created(ctx, create_b.text, path_b)
        create_b.expect_contains(title_b)

        run.step(
            label="create_document B (link target)",
            passed=(create_b.ok and create_b.status == "pass"),
            detail=expectation_detail(create_b) or create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            return run

        # ── Step 3: Force scan so outline reads indexed metadata ─
        # Batch get_doc_outline reads DB metadata; a scan guarantees both
        # docs are indexed before we query.
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
        if not scan_result.ok:
            return run

        ident_a = fqc_id_a or created_path_a
        ident_b = fqc_id_b or created_path_b

        # ── Step 4: Full outline of doc A (O-01) ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        outline_full = ctx.client.call_tool(
            "get_doc_outline",
            identifiers=ident_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        outline_full.expect_contains("Top Heading A")
        outline_full.expect_contains("Section One")
        outline_full.expect_contains("Section Two")
        outline_full.expect_contains("Subsection One A")

        run.step(
            label="get_doc_outline (full hierarchy, O-01)",
            passed=(outline_full.ok and outline_full.status == "pass"),
            detail=expectation_detail(outline_full) or outline_full.error or "",
            timing_ms=outline_full.timing_ms,
            tool_result=outline_full,
            server_logs=step_logs,
        )

        # ── Step 5: Outline with max_depth=2 (O-02) ──────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        outline_depth = ctx.client.call_tool(
            "get_doc_outline",
            identifiers=ident_a,
            max_depth=2,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        outline_depth.expect_contains("Section One")
        outline_depth.expect_contains("Section Two")
        # H3 subsection must not appear when max_depth=2
        outline_depth.expect_not_contains("Subsection One A")

        run.step(
            label="get_doc_outline max_depth=2 omits H3 (O-02)",
            passed=(outline_depth.ok and outline_depth.status == "pass"),
            detail=expectation_detail(outline_depth) or outline_depth.error or "",
            timing_ms=outline_depth.timing_ms,
            tool_result=outline_depth,
            server_logs=step_logs,
        )

        # ── Step 6: Resolved + unresolved links (O-03, O-04) ─────
        # The full outline response from Step 4 already contains link data;
        # assert against it so we don't rely on a second call.
        link_checks = {
            "resolved link target slug present": slug_b in outline_full.text,
            "unresolved link target slug present": missing_slug in outline_full.text,
            "unresolved marker present": bool(
                re.search(r"unresolved", outline_full.text, re.IGNORECASE)
            ),
        }
        link_ok = all(link_checks.values())
        link_detail = ""
        if not link_ok:
            failed = [k for k, v in link_checks.items() if not v]
            link_detail = (
                f"Failed: {', '.join(failed)}. "
                f"Full response text (first 600 chars): "
                f"{outline_full.text[:600]!r}"
            )

        run.step(
            label="get_doc_outline shows resolved + unresolved links (O-03, O-04)",
            passed=link_ok,
            detail=link_detail,
        )

        # ── Step 7: exclude_headings returns frontmatter only (O-05)
        log_mark = ctx.server.log_position if ctx.server else 0
        outline_nohead = ctx.client.call_tool(
            "get_doc_outline",
            identifiers=ident_a,
            exclude_headings=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Frontmatter/metadata should still identify the doc by title,
        # but the heading text must be absent from the body.
        outline_nohead.expect_not_contains("Section One")
        outline_nohead.expect_not_contains("Section Two")
        outline_nohead.expect_not_contains("Subsection One A")

        run.step(
            label="get_doc_outline exclude_headings=True (O-05)",
            passed=(outline_nohead.ok and outline_nohead.status == "pass"),
            detail=expectation_detail(outline_nohead) or outline_nohead.error or "",
            timing_ms=outline_nohead.timing_ms,
            tool_result=outline_nohead,
            server_logs=step_logs,
        )

        # ── Step 8: Batch outline of [A, B] (O-06) ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        outline_batch = ctx.client.call_tool(
            "get_doc_outline",
            identifiers=[ident_a, ident_b],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        outline_batch.expect_contains(title_a)
        outline_batch.expect_contains(title_b)
        # FQC IDs are DB-assigned UUIDs — their presence proves DB metadata was returned
        if fqc_id_a:
            outline_batch.expect_contains(fqc_id_a)
        if fqc_id_b:
            outline_batch.expect_contains(fqc_id_b)

        run.step(
            label="get_doc_outline batch identifiers=[A, B] (O-06)",
            passed=(outline_batch.ok and outline_batch.status == "pass"),
            detail=expectation_detail(outline_batch) or outline_batch.error or "",
            timing_ms=outline_batch.timing_ms,
            tool_result=outline_batch,
            server_logs=step_logs,
        )

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
        description="Test: get_doc_outline heading hierarchy, links, depth, batch.",
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

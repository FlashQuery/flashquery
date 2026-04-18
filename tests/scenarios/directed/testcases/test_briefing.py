#!/usr/bin/env python3
"""
Test: get_briefing returns grouped results filtered by tag, and includes plugin records.

Scenario:
    Setup:
        1. Create 2 documents with a unique tag (briefing-test-{run_id})
        2. force_file_scan to register them in the DB
        3. Save 2 memories with the same unique tag
        4. Register a plugin and create 2 records in it (for B-03)

    Part A — B-01: Basic briefing:
        5. Call get_briefing with the unique tag
        6. Verify response contains document entries (## Documents section)
        7. Verify response contains memory entries (## Memories section)
        8. Verify both section headers appear, proving grouping by type

    Part B — B-02: Tag filtering:
        9.  Create 1 more document with a DIFFERENT tag (briefing-other-{run_id})
        10. force_file_scan
        11. Call get_briefing with tags=[briefing-test-{run_id}] only
        12. Verify the "other" document does NOT appear (tag filter works)

    Part C — B-03: Plugin record counts:
        13. Call get_briefing with tags=[briefing-test-{run_id}] and plugin_id
        14. Verify response includes the ## Plugin Records section

    Cleanup:
        - Archive all documents (MCP)
        - Archive all memories (archive_memory)
        - Unregister plugin (confirm_destroy=True)

Coverage points: B-01, B-02, B-03

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_briefing.py                            # existing server
    python test_briefing.py --managed                  # managed server
    python test_briefing.py --managed --json           # structured JSON with server logs
    python test_briefing.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["B-01", "B-02", "B-03"]

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

TEST_NAME = "test_briefing"

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _build_plugin_schema(plugin_id: str) -> str:
    """Return an inline YAML plugin schema for the briefing test plugin."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Briefing Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture plugin for get_briefing B-03 coverage\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Test notes\n"
        "    columns:\n"
        "      - name: content\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: category\n"
        "        type: text\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Unique identifiers for this run
    unique_tag = f"briefing-test-{run.run_id}"
    other_tag = f"briefing-other-{run.run_id}"
    # plugin_id must be a-z0-9_ only and be unique per run
    plugin_id = f"briefing_{run.run_id}"
    # plugin_instance also unique per run
    instance_name = f"briefing_{run.run_id}"

    schema_yaml = _build_plugin_schema(plugin_id)

    port_range = tuple(args.port_range) if args.port_range else None

    # Track resources for cleanup
    memory_ids: list[str] = []
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:

        # ── Setup Step 1: Create 2 documents with unique_tag ─────────────
        doc_paths = [
            f"_test/{TEST_NAME}_{run.run_id}_doc1.md",
            f"_test/{TEST_NAME}_{run.run_id}_doc2.md",
        ]
        doc_titles = [
            f"Briefing Doc A {run.run_id}",
            f"Briefing Doc B {run.run_id}",
        ]
        doc_ids: list[str] = []

        for i, (path, title) in enumerate(zip(doc_paths, doc_titles)):
            log_mark = ctx.server.log_position if ctx.server else 0
            create_result = ctx.client.call_tool(
                "create_document",
                title=title,
                content=f"Content for briefing test document {i + 1} (run {run.run_id}).",
                path=path,
                tags=[unique_tag, "briefing-test", "fqc-test"],
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            fqc_id = _extract_field(create_result.text, "FQC ID")
            created_path = _extract_field(create_result.text, "Path")

            if created_path:
                ctx.cleanup.track_file(created_path)
                parts = Path(created_path).parts
                for j in range(1, len(parts)):
                    ctx.cleanup.track_dir(str(Path(*parts[:j])))
            if fqc_id:
                ctx.cleanup.track_mcp_document(fqc_id)
                doc_ids.append(fqc_id)

            create_result.expect_contains(title)

            run.step(
                label=f"create_document '{title}'",
                passed=(create_result.ok and create_result.status == "pass"),
                detail=expectation_detail(create_result) or create_result.error or "",
                timing_ms=create_result.timing_ms,
                tool_result=create_result,
                server_logs=step_logs,
            )
            if not create_result.ok:
                return run

        # ── Setup Step 2: force_file_scan ────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (after setup docs)",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # ── Setup Step 3: Save 2 memories with unique_tag ────────────────
        memory_contents = [
            f"Memory alpha for briefing test run {run.run_id}. Tag: {unique_tag}.",
            f"Memory beta for briefing test run {run.run_id}. Tag: {unique_tag}.",
        ]

        for i, mem_content in enumerate(memory_contents):
            log_mark = ctx.server.log_position if ctx.server else 0
            save_result = ctx.client.call_tool(
                "save_memory",
                content=mem_content,
                tags=[unique_tag, "briefing-test", "fqc-test"],
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            m = re.search(r"\(id:\s*([0-9a-fA-F-]{36})\)", save_result.text)
            mem_id = m.group(1) if m else ""
            if mem_id:
                memory_ids.append(mem_id)
                ctx.cleanup.track_mcp_memory(mem_id)

            save_result.expect_contains("Memory saved")

            run.step(
                label=f"save_memory {i + 1} (tag={unique_tag})",
                passed=(save_result.ok and save_result.status == "pass" and bool(mem_id)),
                detail=expectation_detail(save_result) or save_result.error or "",
                timing_ms=save_result.timing_ms,
                tool_result=save_result,
                server_logs=step_logs,
            )
            if not save_result.ok:
                return run

        # ── Setup Step 4: Register plugin and create 2 records ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)

        run.step(
            label="register_plugin (for B-03)",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(plugin_id, instance_name)

        # Create 2 records in the plugin
        for i in range(2):
            log_mark = ctx.server.log_position if ctx.server else 0
            create_rec_result = ctx.client.call_tool(
                "create_record",
                plugin_id=plugin_id,
                plugin_instance=instance_name,
                table="notes",
                fields={
                    "content": f"Briefing plugin record {i + 1} (run {run.run_id})",
                    "category": "briefing-test",
                },
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

            create_rec_result.expect_contains("Created record")

            run.step(
                label=f"create_record in plugin (record {i + 1})",
                passed=(create_rec_result.ok and create_rec_result.status == "pass"),
                detail=expectation_detail(create_rec_result) or create_rec_result.error or "",
                timing_ms=create_rec_result.timing_ms,
                tool_result=create_rec_result,
                server_logs=step_logs,
            )
            if not create_rec_result.ok:
                return run

        # ── Part A — B-01: Basic briefing (documents + memories grouped) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        briefing_result = ctx.client.call_tool(
            "get_briefing",
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # B-01: response must contain both section headers
        briefing_result.expect_contains("## Documents")
        briefing_result.expect_contains("## Memories")
        # At least one document title should appear
        briefing_result.expect_contains(doc_titles[0])
        # At least one memory content snippet should appear
        briefing_result.expect_contains(run.run_id)

        run.step(
            label="get_briefing — B-01: documents and memories grouped by type",
            passed=(briefing_result.ok and briefing_result.status == "pass"),
            detail=expectation_detail(briefing_result) or briefing_result.error or "",
            timing_ms=briefing_result.timing_ms,
            tool_result=briefing_result,
            server_logs=step_logs,
        )

        # ── Part B — B-02: Tag filtering ─────────────────────────────────
        # Create 1 document with a different tag
        other_doc_path = f"_test/{TEST_NAME}_{run.run_id}_other.md"
        other_doc_title = f"Briefing Other Doc {run.run_id}"

        log_mark = ctx.server.log_position if ctx.server else 0
        other_create_result = ctx.client.call_tool(
            "create_document",
            title=other_doc_title,
            content=f"This document has a different tag and should be excluded by briefing filter (run {run.run_id}).",
            path=other_doc_path,
            tags=[other_tag, "fqc-test"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        other_fqc_id = _extract_field(other_create_result.text, "FQC ID")
        other_created_path = _extract_field(other_create_result.text, "Path")

        if other_created_path:
            ctx.cleanup.track_file(other_created_path)
        if other_fqc_id:
            ctx.cleanup.track_mcp_document(other_fqc_id)

        other_create_result.expect_contains(other_doc_title)

        run.step(
            label=f"create_document with different tag '{other_tag}'",
            passed=(other_create_result.ok and other_create_result.status == "pass"),
            detail=expectation_detail(other_create_result) or other_create_result.error or "",
            timing_ms=other_create_result.timing_ms,
            tool_result=other_create_result,
            server_logs=step_logs,
        )

        # Scan so the new document is indexed
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan (after other-tag doc)",
            passed=scan2_result.ok,
            detail=scan2_result.error or "",
            timing_ms=scan2_result.timing_ms,
            tool_result=scan2_result,
            server_logs=step_logs,
        )

        # Now call get_briefing with only the original unique_tag
        log_mark = ctx.server.log_position if ctx.server else 0
        filtered_briefing_result = ctx.client.call_tool(
            "get_briefing",
            tags=[unique_tag],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # B-02: original docs present, "other" doc absent
        filtered_briefing_result.expect_contains(doc_titles[0])
        filtered_briefing_result.expect_not_contains(other_doc_title)

        run.step(
            label="get_briefing — B-02: tag filter excludes other-tag document",
            passed=(filtered_briefing_result.ok and filtered_briefing_result.status == "pass"),
            detail=expectation_detail(filtered_briefing_result) or filtered_briefing_result.error or "",
            timing_ms=filtered_briefing_result.timing_ms,
            tool_result=filtered_briefing_result,
            server_logs=step_logs,
        )

        # ── Part C — B-03: Plugin records included when plugin_id given ───
        log_mark = ctx.server.log_position if ctx.server else 0
        plugin_briefing_result = ctx.client.call_tool(
            "get_briefing",
            tags=[unique_tag],
            plugin_id=plugin_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # B-03: response must include the Plugin Records section
        plugin_briefing_result.expect_contains("## Plugin Records")
        plugin_briefing_result.expect_contains("briefing-test")

        run.step(
            label="get_briefing — B-03: plugin_id includes plugin record data",
            passed=(plugin_briefing_result.ok and plugin_briefing_result.status == "pass"),
            detail=expectation_detail(plugin_briefing_result) or plugin_briefing_result.error or "",
            timing_ms=plugin_briefing_result.timing_ms,
            tool_result=plugin_briefing_result,
            server_logs=step_logs,
        )

        # ── Cleanup: archive all memories ─────────────────────────────────
        for mid in memory_ids:
            try:
                ctx.client.call_tool("archive_memory", memory_id=mid)
            except Exception as e:
                ctx.cleanup_errors.append(f"archive_memory({mid}) failed: {e}")

        # ── Cleanup: unregister plugin ────────────────────────────────────
        if plugin_registered:
            try:
                teardown = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=plugin_id,
                    plugin_instance=instance_name,
                    confirm_destroy=True,
                )
                if not teardown.ok:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin failed: {teardown.error or teardown.text}"
                    )
            except Exception as e:
                ctx.cleanup_errors.append(f"unregister_plugin exception: {e}")

        # ── Optionally retain files for debugging ─────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files and plugin instance retained. plugin_id={plugin_id}",
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
        description="Test: get_briefing returns grouped results filtered by tag.",
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

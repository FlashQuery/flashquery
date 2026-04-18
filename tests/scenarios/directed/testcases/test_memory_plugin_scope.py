#!/usr/bin/env python3
"""
Test: save_memory with plugin_scope — fuzzy-matched plugin scope association (M-15).

Scenario:
    1. Register a test plugin with a short distinct ID
    2. Save a memory with plugin_scope set to the exact plugin ID (exact match is
       a valid degenerate case of fuzzy matching — similarity(x, x) = 1.0 > 0.8)
    3. Verify the save succeeded with a memory ID and no "not found" warning
    4. Save a second memory with no plugin_scope — verify it defaults to Global
    5. Retrieve both memories by ID (get_memory) and confirm they are accessible
    6. Cleanup: archive both memories, unregister the plugin (confirm_destroy=True)

Coverage points: M-15

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_memory_plugin_scope.py                            # existing server
    python test_memory_plugin_scope.py --managed                  # managed server
    python test_memory_plugin_scope.py --managed --json           # structured JSON with server logs
    python test_memory_plugin_scope.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["M-15"]

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

TEST_NAME = "test_memory_plugin_scope"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _extract_memory_id(text: str) -> str:
    """Extract memory ID from save_memory response: 'Memory saved (id: <uuid>)'."""
    m = re.search(r"\(id:\s*([0-9a-fA-F-]{36})\)", text)
    return m.group(1) if m else ""


def _build_plugin_schema_yaml(plugin_id: str) -> str:
    """Minimal inline plugin schema YAML for the scope test plugin."""
    return (
        "plugin:\n"
        f"  id: {plugin_id}\n"
        "  name: Memory Scope Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Fixture plugin for testing plugin_scope on save_memory\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Placeholder table\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "        required: true\n"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Use a short but unique plugin ID — must match /^[a-z][a-z0-9_]*$/
    # Keep it short so trigram similarity with itself is exactly 1.0
    plugin_id = f"mscope{run.run_id}"
    schema_yaml = _build_plugin_schema_yaml(plugin_id)

    scoped_content = (
        f"Plugin-scoped memory created by {TEST_NAME} (run {run.run_id}). "
        f"This memory is associated with plugin '{plugin_id}'."
    )
    global_content = (
        f"Global memory created by {TEST_NAME} (run {run.run_id}). "
        f"This memory uses no plugin_scope and should default to global."
    )

    port_range = tuple(args.port_range) if args.port_range else None

    scoped_memory_id: str = ""
    global_memory_id: str = ""
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

        # ── Step 1: Register a test plugin (needed for scope resolution) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(plugin_id)

        run.step(
            label=f"register_plugin (id={plugin_id})",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(plugin_id, "default")

        # ── Step 2: Save memory WITH plugin_scope (M-15) ─────────────
        # Use exact plugin ID as the scope value. exact match is the degenerate
        # case of fuzzy matching (similarity = 1.0 > 0.8 threshold) and confirms
        # the full save_memory → find_plugin_scope → store path works end-to-end.
        log_mark = ctx.server.log_position if ctx.server else 0
        scoped_save_result = ctx.client.call_tool(
            "save_memory",
            content=scoped_content,
            tags=["fqc-test", f"scope-test-{run.run_id}"],
            plugin_scope=plugin_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        scoped_memory_id = _extract_memory_id(scoped_save_result.text)
        if scoped_memory_id:
            ctx.cleanup.track_mcp_memory(scoped_memory_id)
        # Must save successfully and return a memory ID
        scoped_save_result.expect_contains("Memory saved")
        # Must NOT show "not found" warning — scope was resolved
        scoped_save_result.expect_not_contains("not found")

        run.step(
            label=f"save_memory with plugin_scope='{plugin_id}' (M-15)",
            passed=(
                scoped_save_result.ok
                and scoped_save_result.status == "pass"
                and bool(scoped_memory_id)
            ),
            detail=expectation_detail(scoped_save_result) or scoped_save_result.error or "",
            timing_ms=scoped_save_result.timing_ms,
            tool_result=scoped_save_result,
            server_logs=step_logs,
        )
        if not scoped_save_result.ok or not scoped_memory_id:
            # Still try to clean up the plugin before returning
            if plugin_registered:
                try:
                    ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=plugin_id,
                        confirm_destroy=True,
                    )
                except Exception as e:
                    ctx.cleanup_errors.append(f"Cleanup unregister_plugin failed: {e}")
            return run

        # ── Step 3: Save memory WITHOUT plugin_scope (global baseline) ─
        log_mark = ctx.server.log_position if ctx.server else 0
        global_save_result = ctx.client.call_tool(
            "save_memory",
            content=global_content,
            tags=["fqc-test", f"scope-test-{run.run_id}"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        global_memory_id = _extract_memory_id(global_save_result.text)
        if global_memory_id:
            ctx.cleanup.track_mcp_memory(global_memory_id)
        global_save_result.expect_contains("Memory saved")
        # Without a plugin_scope, response should mention Global
        global_save_result.expect_contains("Global")

        run.step(
            label="save_memory without plugin_scope → defaults to Global",
            passed=(
                global_save_result.ok
                and global_save_result.status == "pass"
                and bool(global_memory_id)
            ),
            detail=expectation_detail(global_save_result) or global_save_result.error or "",
            timing_ms=global_save_result.timing_ms,
            tool_result=global_save_result,
            server_logs=step_logs,
        )

        # ── Step 4: Retrieve scoped memory by ID ─────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        get_scoped_result = ctx.client.call_tool(
            "get_memory",
            memory_ids=scoped_memory_id,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Full content must be present; the memory must be retrievable by ID
        get_scoped_result.expect_contains(scoped_memory_id)
        get_scoped_result.expect_contains(plugin_id)

        run.step(
            label="get_memory — scoped memory retrievable by ID",
            passed=(get_scoped_result.ok and get_scoped_result.status == "pass"),
            detail=expectation_detail(get_scoped_result) or get_scoped_result.error or "",
            timing_ms=get_scoped_result.timing_ms,
            tool_result=get_scoped_result,
            server_logs=step_logs,
        )

        # ── Step 5: list_memories by tag — scoped memory appears ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        list_result = ctx.client.call_tool(
            "list_memories",
            tags=[f"scope-test-{run.run_id}"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Both memories (scoped and global) should appear in tag-filtered listing
        list_result.expect_contains(scoped_memory_id)
        if global_memory_id:
            list_result.expect_contains(global_memory_id)

        run.step(
            label="list_memories by tag — scoped and global memories both visible",
            passed=(list_result.ok and list_result.status == "pass"),
            detail=expectation_detail(list_result) or list_result.error or "",
            timing_ms=list_result.timing_ms,
            tool_result=list_result,
            server_logs=step_logs,
        )

        # ── Best-effort cleanup: archive memories ────────────────────
        for mid, label in [
            (scoped_memory_id, "scoped"),
            (global_memory_id, "global"),
        ]:
            if not mid:
                continue
            try:
                ctx.client.call_tool("archive_memory", memory_id=mid)
            except Exception as e:
                ctx.cleanup_errors.append(f"Cleanup archive_memory({label}={mid}) failed: {e}")

        # ── Best-effort cleanup: unregister plugin ───────────────────
        if plugin_registered:
            try:
                ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=plugin_id,
                    confirm_destroy=True,
                )
            except Exception as e:
                ctx.cleanup_errors.append(f"Cleanup unregister_plugin({plugin_id}) failed: {e}")

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._memory_ids.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=(
                    f"Memory IDs retained: scoped={scoped_memory_id} "
                    f"global={global_memory_id} plugin_id={plugin_id}"
                ),
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
        description="Test: save_memory with plugin_scope (fuzzy-matched) — M-15.",
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

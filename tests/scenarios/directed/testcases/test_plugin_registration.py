#!/usr/bin/env python3
"""
Test: register v1 → add column → reject unsafe → instance isolation → dry-run → confirmed teardown.

Scenario:
    1. Register plugin v1 with items(name, quantity) under instance inst_a (register_plugin)
    2. Create a couple of records so there is active data (create_record)
    3. Register v2 that ADDS a `price` column — safe migration applied (P-13)
    4. Create a record setting the new `price` column — verify via get_record
    5. Attempt v3 that REMOVES the `quantity` column — must be rejected as unsafe (P-14)
    6. Verify `quantity` column still works by creating/getting a record with it
    7. Register the same plugin id under a second instance inst_b, create an isolated record (P-15)
    8. Cross-instance isolation: get_record for inst_a's id from inst_b fails and vice versa
    9. Dry-run unregister of inst_a without confirm_destroy — impact shown, data untouched (P-11)
    10. Confirmed unregister of inst_a with confirm_destroy=True — tables/data gone (P-12)
    11. Verify inst_b still intact (isolation confirmed post-teardown)
    Cleanup: inst_b is torn down with confirm_destroy=True at the end of the test.

Coverage points: P-11, P-12, P-13, P-14, P-15

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_plugin_registration.py                            # existing server
    python test_plugin_registration.py --managed                  # managed server
    python test_plugin_registration.py --managed --json           # structured JSON with server logs
    python test_plugin_registration.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["P-11", "P-12", "P-13", "P-14", "P-15"]

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

TEST_NAME = "test_plugin_registration"
PLUGIN_ID = "testreg"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _schema_v1(version: str = "1.0.0") -> str:
    """Initial schema: items(name, quantity)."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Test Registration Plugin\n"
        f"  version: {version}\n"
        "  description: Scenario-test fixture for register/unregister migrations\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Test items\n"
        "    columns:\n"
        "      - name: name\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: quantity\n"
        "        type: integer\n"
    )


def _schema_v2_add_price() -> str:
    """Safe migration: adds a `price` column."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Test Registration Plugin\n"
        "  version: 1.1.0\n"
        "  description: Scenario-test fixture for register/unregister migrations\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Test items\n"
        "    columns:\n"
        "      - name: name\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: quantity\n"
        "        type: integer\n"
        "      - name: price\n"
        "        type: integer\n"
    )


def _schema_v3_drop_quantity() -> str:
    """Unsafe migration: removes the `quantity` column."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Test Registration Plugin\n"
        "  version: 1.2.0\n"
        "  description: Scenario-test fixture for register/unregister migrations\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Test items\n"
        "    columns:\n"
        "      - name: name\n"
        "        type: text\n"
        "        required: true\n"
        "      - name: price\n"
        "        type: integer\n"
    )


def _extract_record_id(text: str) -> str:
    m = _UUID_RE.search(text or "")
    return m.group(0) if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    # Two unique instances per run so parallel/repeat runs don't collide
    suffix = run.run_id.replace("-", "_")
    inst_a = f"inst_a_{suffix}"
    inst_b = f"inst_b_{suffix}"

    port_range = tuple(args.port_range) if args.port_range else None

    inst_a_registered = False
    inst_b_registered = False
    inst_a_torn_down = False
    record_a1_id = ""
    record_a_priced_id = ""
    record_a_after_reject_id = ""
    record_b1_id = ""

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin v1 under inst_a ────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg1 = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_schema_v1(),
            plugin_instance=inst_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg1.expect_contains("registered successfully")
        reg1.expect_contains(inst_a)
        reg1.expect_contains("items")

        run.step(
            label="register_plugin v1 (inst_a)",
            passed=(reg1.ok and reg1.status == "pass"),
            detail=expectation_detail(reg1) or reg1.error or "",
            timing_ms=reg1.timing_ms,
            tool_result=reg1,
            server_logs=step_logs,
        )
        if not reg1.ok:
            return run
        inst_a_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, inst_a)

        # ── Step 2: Create baseline records in inst_a ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        cr_a1 = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_a,
            table="items",
            fields={"name": f"alpha-{run.run_id}", "quantity": 3},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        cr_a1.expect_contains("Created record")
        record_a1_id = _extract_record_id(cr_a1.text)

        run.step(
            label="create_record (inst_a v1, quantity column)",
            passed=(cr_a1.ok and cr_a1.status == "pass" and bool(record_a1_id)),
            detail=expectation_detail(cr_a1) or cr_a1.error or "",
            timing_ms=cr_a1.timing_ms,
            tool_result=cr_a1,
            server_logs=step_logs,
        )
        if not cr_a1.ok or not record_a1_id:
            _teardown(ctx, inst_a, inst_b, inst_a_registered, inst_b_registered, inst_a_torn_down)
            return run

        # ── Step 3: Register v2 — safe migration adds `price` (P-13) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        reg2 = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_schema_v2_add_price(),
            plugin_instance=inst_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Response confirms version bump and at least one safe change applied.
        reg2.expect_contains("1.0.0")
        reg2.expect_contains("1.1.0")
        reg2.expect_contains("safe change")

        run.step(
            label="register_plugin v2 — safe add column (P-13)",
            passed=(reg2.ok and reg2.status == "pass"),
            detail=expectation_detail(reg2) or reg2.error or "",
            timing_ms=reg2.timing_ms,
            tool_result=reg2,
            server_logs=step_logs,
        )

        # ── Step 4: Create record using new `price` column ────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        cr_priced = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_a,
            table="items",
            fields={"name": f"priced-{run.run_id}", "quantity": 2, "price": 4242},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        cr_priced.expect_contains("Created record")
        record_a_priced_id = _extract_record_id(cr_priced.text)

        run.step(
            label="create_record using migrated-in `price` column",
            passed=(cr_priced.ok and cr_priced.status == "pass" and bool(record_a_priced_id)),
            detail=expectation_detail(cr_priced) or cr_priced.error or "",
            timing_ms=cr_priced.timing_ms,
            tool_result=cr_priced,
            server_logs=step_logs,
        )

        if record_a_priced_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            get_priced = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                table="items",
                id=record_a_priced_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            get_priced.expect_contains("4242")
            get_priced.expect_contains(f"priced-{run.run_id}")
            run.step(
                label="get_record — price field round-trips (P-13 verify)",
                passed=(get_priced.ok and get_priced.status == "pass"),
                detail=expectation_detail(get_priced) or get_priced.error or "",
                timing_ms=get_priced.timing_ms,
                tool_result=get_priced,
                server_logs=step_logs,
            )

        # ── Step 5: Register v3 — unsafe, remove quantity (P-14) ──────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg3 = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_schema_v3_drop_quantity(),
            plugin_instance=inst_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Must surface as a tool error (ok=False). FQC wraps isError:true as ok=False.
        reg3_rejected = (not reg3.ok) and (
            "breaking changes" in (reg3.text or "").lower()
            or "unsafe" in (reg3.text or "").lower()
            or "migration failed" in (reg3.text or "").lower()
        )

        run.step(
            label="register_plugin v3 rejected as unsafe (P-14)",
            passed=reg3_rejected,
            detail=(
                f"ok={reg3.ok!r}; text_head={(reg3.text or '')[:200]!r}; error={reg3.error!r}"
                if not reg3_rejected
                else f"rejected as expected: {(reg3.text or '')[:160]!r}"
            ),
            timing_ms=reg3.timing_ms,
            tool_result=reg3,
            server_logs=step_logs,
        )

        # ── Step 6: Verify `quantity` column still usable post-reject ─
        log_mark = ctx.server.log_position if ctx.server else 0
        cr_after_reject = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_a,
            table="items",
            fields={"name": f"still-has-qty-{run.run_id}", "quantity": 9},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        cr_after_reject.expect_contains("Created record")
        record_a_after_reject_id = _extract_record_id(cr_after_reject.text)

        run.step(
            label="create_record with quantity after unsafe rejection",
            passed=(cr_after_reject.ok and cr_after_reject.status == "pass" and bool(record_a_after_reject_id)),
            detail=expectation_detail(cr_after_reject) or cr_after_reject.error or "",
            timing_ms=cr_after_reject.timing_ms,
            tool_result=cr_after_reject,
            server_logs=step_logs,
        )

        if record_a_after_reject_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            get_after_reject = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                table="items",
                id=record_a_after_reject_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            get_after_reject.expect_contains("9")
            run.step(
                label="get_record confirms quantity column intact",
                passed=(get_after_reject.ok and get_after_reject.status == "pass"),
                detail=expectation_detail(get_after_reject) or get_after_reject.error or "",
                timing_ms=get_after_reject.timing_ms,
                tool_result=get_after_reject,
                server_logs=step_logs,
            )

        # ── Step 7: Register same plugin under inst_b (P-15 setup) ────
        # Use v2 schema (matching current inst_a version) to keep them comparable.
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_b = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=_schema_v2_add_price(),
            plugin_instance=inst_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        reg_b.expect_contains("registered successfully")
        reg_b.expect_contains(inst_b)
        run.step(
            label="register_plugin v2 under second instance (inst_b)",
            passed=(reg_b.ok and reg_b.status == "pass"),
            detail=expectation_detail(reg_b) or reg_b.error or "",
            timing_ms=reg_b.timing_ms,
            tool_result=reg_b,
            server_logs=step_logs,
        )
        if reg_b.ok:
            inst_b_registered = True
            ctx.cleanup.track_plugin_registration(PLUGIN_ID, inst_b)

        # Create a distinct record in inst_b
        log_mark = ctx.server.log_position if ctx.server else 0
        cr_b1 = ctx.client.call_tool(
            "create_record",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_b,
            table="items",
            fields={"name": f"beta-{run.run_id}", "quantity": 1, "price": 99},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        cr_b1.expect_contains("Created record")
        record_b1_id = _extract_record_id(cr_b1.text)
        run.step(
            label="create_record in inst_b",
            passed=(cr_b1.ok and cr_b1.status == "pass" and bool(record_b1_id)),
            detail=expectation_detail(cr_b1) or cr_b1.error or "",
            timing_ms=cr_b1.timing_ms,
            tool_result=cr_b1,
            server_logs=step_logs,
        )

        # ── Step 8: Cross-instance isolation (P-15) ───────────────────
        # Fetching inst_a's record from inst_b must fail (and vice versa).
        if record_a1_id and record_b1_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            cross_a_from_b = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_b,
                table="items",
                id=record_a1_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            isolated_a_from_b = (not cross_a_from_b.ok) or (
                "not found" in (cross_a_from_b.text or "").lower()
            )
            run.step(
                label="isolation: inst_a record invisible from inst_b (P-15)",
                passed=isolated_a_from_b,
                detail=f"ok={cross_a_from_b.ok!r}; text={(cross_a_from_b.text or '')[:160]!r}; error={cross_a_from_b.error!r}",
                timing_ms=cross_a_from_b.timing_ms,
                tool_result=cross_a_from_b,
                server_logs=step_logs,
            )

            log_mark = ctx.server.log_position if ctx.server else 0
            cross_b_from_a = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                table="items",
                id=record_b1_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            isolated_b_from_a = (not cross_b_from_a.ok) or (
                "not found" in (cross_b_from_a.text or "").lower()
            )
            run.step(
                label="isolation: inst_b record invisible from inst_a (P-15)",
                passed=isolated_b_from_a,
                detail=f"ok={cross_b_from_a.ok!r}; text={(cross_b_from_a.text or '')[:160]!r}; error={cross_b_from_a.error!r}",
                timing_ms=cross_b_from_a.timing_ms,
                tool_result=cross_b_from_a,
                server_logs=step_logs,
            )

        # ── Step 9: Dry-run unregister inst_a (P-11) ──────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        dry = ctx.client.call_tool(
            "unregister_plugin",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_a,
            confirm_destroy=False,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        dry.expect_contains("DRY RUN")
        dry.expect_contains("Tables to drop")
        dry.expect_contains("active records")
        dry.expect_contains("confirm_destroy")

        run.step(
            label="unregister_plugin dry-run shows impact (P-11)",
            passed=(dry.ok and dry.status == "pass"),
            detail=expectation_detail(dry) or dry.error or "",
            timing_ms=dry.timing_ms,
            tool_result=dry,
            server_logs=step_logs,
        )

        # Data in inst_a must still be reachable after dry-run.
        if record_a1_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            still_there = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                table="items",
                id=record_a1_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            still_there.expect_contains(record_a1_id)
            run.step(
                label="inst_a data still present after dry-run",
                passed=(still_there.ok and still_there.status == "pass"),
                detail=expectation_detail(still_there) or still_there.error or "",
                timing_ms=still_there.timing_ms,
                tool_result=still_there,
                server_logs=step_logs,
            )

        # ── Step 10: Confirmed unregister inst_a (P-12) ───────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        confirmed = ctx.client.call_tool(
            "unregister_plugin",
            plugin_id=PLUGIN_ID,
            plugin_instance=inst_a,
            confirm_destroy=True,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        confirmed.expect_contains("unregistered")
        confirmed.expect_contains(inst_a)
        run.step(
            label="unregister_plugin confirmed teardown (P-12)",
            passed=(confirmed.ok and confirmed.status == "pass"),
            detail=expectation_detail(confirmed) or confirmed.error or "",
            timing_ms=confirmed.timing_ms,
            tool_result=confirmed,
            server_logs=step_logs,
        )
        if confirmed.ok:
            inst_a_torn_down = True

        # Follow-up: records in inst_a must no longer be retrievable.
        if record_a1_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            gone = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                table="items",
                id=record_a1_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            gone_ok = (not gone.ok) or (
                "not found" in (gone.text or "").lower()
                or "not registered" in (gone.text or "").lower()
            )
            run.step(
                label="inst_a records gone after confirmed teardown (P-12 verify)",
                passed=gone_ok,
                detail=f"ok={gone.ok!r}; text={(gone.text or '')[:160]!r}; error={gone.error!r}",
                timing_ms=gone.timing_ms,
                tool_result=gone,
                server_logs=step_logs,
            )

        # ── Step 11: inst_b still intact (isolation post-teardown) ────
        if record_b1_id:
            log_mark = ctx.server.log_position if ctx.server else 0
            b_still = ctx.client.call_tool(
                "get_record",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_b,
                table="items",
                id=record_b1_id,
            )
            step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
            b_still.expect_contains(record_b1_id)
            b_still.expect_contains(f"beta-{run.run_id}")
            run.step(
                label="inst_b data intact after inst_a teardown (P-15 reinforced)",
                passed=(b_still.ok and b_still.status == "pass"),
                detail=expectation_detail(b_still) or b_still.error or "",
                timing_ms=b_still.timing_ms,
                tool_result=b_still,
                server_logs=step_logs,
            )

        # ── Cleanup: tear down remaining plugin instances ─────────────
        _teardown(ctx, inst_a, inst_b, inst_a_registered, inst_b_registered, inst_a_torn_down)

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Plugin instances: {PLUGIN_ID}/{inst_a}, {PLUGIN_ID}/{inst_b}",
            )

        # ── Attach full server logs to the run ────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


def _teardown(ctx, inst_a: str, inst_b: str, a_registered: bool, b_registered: bool, a_torn_down: bool) -> None:
    """Best-effort teardown of any plugin instances still registered."""
    if a_registered and not a_torn_down:
        try:
            result = ctx.client.call_tool(
                "unregister_plugin",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_a,
                confirm_destroy=True,
            )
            if not result.ok:
                ctx.cleanup_errors.append(
                    f"unregister_plugin inst_a failed: {result.error or result.text}"
                )
        except Exception as e:
            ctx.cleanup_errors.append(f"unregister_plugin inst_a exception: {e}")

    if b_registered:
        try:
            result = ctx.client.call_tool(
                "unregister_plugin",
                plugin_id=PLUGIN_ID,
                plugin_instance=inst_b,
                confirm_destroy=True,
            )
            if not result.ok:
                ctx.cleanup_errors.append(
                    f"unregister_plugin inst_b failed: {result.error or result.text}"
                )
        except Exception as e:
            ctx.cleanup_errors.append(f"unregister_plugin inst_b exception: {e}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: plugin registration migrations, instance isolation, and teardown.",
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

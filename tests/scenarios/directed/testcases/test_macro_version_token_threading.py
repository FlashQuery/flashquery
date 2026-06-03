#!/usr/bin/env python3
"""
Test: concurrent version-token-threading macros -> exactly one conflict (REQ-025 AC#4)

Scenario:
    1. Seed a target document via write_document(mode="create") (write_document).
    2. Define a macro that reads the doc, captures its version_token, then writes
       an update threading that same token into expected_version (call_macro):
           a = fq.get_document({ identifiers: "<path>" })
           exit fq.write_document({ mode: "update", identifier: "<path>",
                                    expected_version: $a.version_token, content: "..." })
    3. Run two such macros concurrently (ThreadPoolExecutor, max_workers=2).
    4. Both read the same token T and both attempt a write with T. The first write
       to land succeeds and bumps the token; the second write carrying the now-stale
       T is refused with the REQ-015 conflict envelope (error="conflict",
       details.reason="version_mismatch"). The conflict envelope surfaces as the
       losing macro's exit value (write_document returns it with isError:false, so
       the macro does not halt — it returns the envelope).
    Assert: exactly ONE macro's write succeeded (returned a fresh version_token)
    and exactly ONE surfaced a version_mismatch conflict.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-17

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_macro_version_token_threading.py --managed
    python test_macro_version_token_threading.py --managed --json
    python test_macro_version_token_threading.py --managed --json --keep

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

COVERAGE = ["D-WCO-17"]
REQUIRES_MANAGED = True

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Framework path setup — three levels up from testcases/ to reach scenarios/framework/
# testcases/ -> directed/ -> scenarios/ -> framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_macro_version_token_threading"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _macro_exit_value(result) -> dict:
    """Parse a call_macro response and return the macro's exit value (`result`).

    The call_macro envelope is `{ "result": <macro exit value>, ... }` on success.
    The threaded write_document return lands directly under `result` because the
    macro does `exit fq.write_document(...)`.
    """
    try:
        payload = json.loads(result.text)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    inner = payload.get("result")
    return inner if isinstance(inner, dict) else {}


def _is_conflict(value: dict) -> bool:
    """True when the macro exit value is a REQ-015 version_mismatch conflict."""
    return (
        value.get("error") == "conflict"
        and isinstance(value.get("details"), dict)
        and value["details"].get("reason") == "version_mismatch"
    )


def _is_success_write(value: dict) -> bool:
    """True when the macro exit value is a successful write (fresh version_token, no error)."""
    return value.get("error") is None and isinstance(value.get("version_token"), str)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — concurrent read-modify-write
        # contention requires the file-lock machinery, which the shared suite
        # server runs with disabled.
        managed=True,
        port_range=port_range,
        enable_locking=True,
    ) as ctx:
        # ── Step 1: Seed the target document ──────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=path,
            title="Macro Version Token Threading Target",
            content="Initial body before concurrent macro writes.",
            tags=["fqc-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # Register for cleanup immediately, before any step that might throw
        if create_result.ok:
            ctx.cleanup.track_file(path)
            ctx.cleanup.track_dir("_test")
            try:
                payload = json.loads(create_result.text)
                if isinstance(payload, dict) and payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass

        run.step(
            label="setup: create target document",
            passed=create_result.ok,
            detail=create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
            server_logs=step_logs,
        )
        if not create_result.ok:
            return run

        # ── Step 2: Run two token-threading macros concurrently ───
        # Each macro reads the doc, captures its version_token, then threads that
        # token into a write. Both read the same token T; the first write wins and
        # bumps the token, so the second write (still carrying T) must be refused
        # with the version_mismatch conflict envelope (REQ-025 AC#4 / REQ-015).
        def macro(name: str):
            source = (
                f'a = fq.get_document({{ identifiers: "{path}" }})\n'
                f'exit fq.write_document({{ '
                f'mode: "update", '
                f'identifier: "{path}", '
                f'expected_version: $a.version_token, '
                f'content: "macro {name} body" '
                f'}})'
            )
            return ctx.client.call_tool("call_macro", source=source)

        log_mark = ctx.server.log_position if ctx.server else 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            result_a, result_b = list(
                pool.map(macro, [f"macro-a-{run.run_id}", f"macro-b-{run.run_id}"])
            )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        value_a = _macro_exit_value(result_a)
        value_b = _macro_exit_value(result_b)

        # Both macro calls must succeed at the MCP layer — the conflict is a
        # value the losing macro returns, not a call-level failure.
        both_calls_ok = result_a.ok and result_b.ok

        successes = [v for v in (value_a, value_b) if _is_success_write(v)]
        conflicts = [v for v in (value_a, value_b) if _is_conflict(v)]

        checks = {
            "both call_macro invocations succeeded": both_calls_ok,
            "exactly one macro write succeeded": len(successes) == 1,
            "exactly one macro write hit version_mismatch conflict": len(conflicts) == 1,
        }
        all_ok = all(checks.values())
        detail = ""
        if not all_ok:
            failed = [k for k, v in checks.items() if not v]
            detail = (
                f"Failed: {', '.join(failed)}. "
                f"a_ok={result_a.ok} b_ok={result_b.ok} "
                f"value_a={value_a!r} value_b={value_b!r} "
                f"a_err={expectation_detail(result_a) or result_a.error} "
                f"b_err={expectation_detail(result_b) or result_b.error}"
            )

        run.step(
            label="D-WCO-17: concurrent token-threading macros — one write succeeds, the stale one is refused with version_mismatch",
            passed=all_ok,
            detail=detail,
            timing_ms=max(result_a.timing_ms, result_b.timing_ms),
            tool_result=result_a,
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

def _cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=TEST_NAME,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", nargs=2, type=int, default=None)
    parser.add_argument("--json", dest="output_json", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    return parser


def main() -> None:
    args = _cli().parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    raise SystemExit(run.exit_code)


if __name__ == "__main__":
    main()

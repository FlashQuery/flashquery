#!/usr/bin/env python3
"""
Test: batch archive_document accepts a mixed Array<string | {identifier, version_token}>
in one call -> bare string is unconditional, object token IS checked.

Scenario:
    1. Seed docA, docB, docC (ctx.create_file) and scan the vault (maintain_vault sync).
    2. Capture each doc's current version_token (get_document). Make docB STALE by
       updating it once (write_document update) so its captured token is now stale.
    3. Single archive_document call with a MIXED identifiers array:
         - docA path as a BARE STRING            -> unconditional, no version check
         - {docB path, STALE_B token}            -> object, stale token -> conflicted
         - {docC path, CUR_C token}              -> object, current token -> succeeded
    4. Assert the ordered 3-entry batch response: entry[0] succeeded (bare string archived
       with no version check), entry[1] conflicted (version_mismatch — object token honored),
       entry[2] succeeded (object token matched). Proves mixed arrays are valid in one call
       and the version check fires ONLY on object elements.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-15

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_batch_mixed_array_input.py                            # existing server
    python test_batch_mixed_array_input.py --managed                  # managed server
    python test_batch_mixed_array_input.py --managed --json           # structured JSON with server logs
    python test_batch_mixed_array_input.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

COVERAGE = ["D-WCO-15"]

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_batch_mixed_array_input"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(text: str):
    """Parse FlashQuery JSON response text into a dict or list."""
    return json.loads(text)


def _version_token(text: str) -> str | None:
    """Pull version_token out of a get_document JSON response."""
    payload = _json(text)
    return payload.get("version_token") if isinstance(payload, dict) else None


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    doc_a = f"_test/{TEST_NAME}_{run.run_id}_a.md"
    doc_b = f"_test/{TEST_NAME}_{run.run_id}_b.md"
    doc_c = f"_test/{TEST_NAME}_{run.run_id}_c.md"
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
        # ── Step 1: Seed docA, docB, docC and scan ───────────────
        ctx.create_file(doc_a, title="Mixed Batch A", body="Body A.", tags=["wco"])
        ctx.create_file(doc_b, title="Mixed Batch B", body="Body B.", tags=["wco"])
        ctx.create_file(doc_c, title="Mixed Batch C", body="Body C.", tags=["wco"])
        scan = ctx.scan_vault()
        run.step(
            "setup: create docA/docB/docC fixtures and scan",
            scan.ok,
            scan.error or "",
            scan.timing_ms,
            scan,
        )
        if not scan.ok:
            return run
        # The scan indexes doc rows; give the (potentially fire-and-forget on
        # cloud Supabase) writes time to commit before we archive against them.
        time.sleep(3)

        # ── Step 2: Capture current version tokens for B and C ────
        read_b = ctx.client.call_tool("get_document", identifiers=doc_b, include=["body"])
        read_c = ctx.client.call_tool("get_document", identifiers=doc_c, include=["body"])
        stale_b = _version_token(read_b.text) if read_b.ok else None
        cur_c = _version_token(read_c.text) if read_c.ok else None
        tokens_ok = (
            read_b.ok
            and read_c.ok
            and isinstance(stale_b, str)
            and isinstance(cur_c, str)
        )
        run.step(
            "setup: capture docB and docC version_tokens",
            tokens_ok,
            f"stale_b={stale_b!r} cur_c={cur_c!r}",
            (read_b.timing_ms or 0) + (read_c.timing_ms or 0),
            read_c,
        )
        if not tokens_ok:
            return run

        # ── Step 3: Make docB's captured token STALE ─────────────
        # Update docB once. STALE_B (captured above) no longer matches the file's
        # current token, so an object-form element carrying STALE_B must conflict.
        mutate_b = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=doc_b,
            content="Body B mutated — STALE_B is now stale.",
        )
        run.step(
            "setup: mutate docB so STALE_B is stale",
            mutate_b.ok,
            mutate_b.error or "",
            mutate_b.timing_ms,
            mutate_b,
        )
        if not mutate_b.ok:
            return run

        # ── Step 4: Single archive_document call with a MIXED array
        log_mark = ctx.server.log_position if ctx.server else 0
        archive = ctx.client.call_tool(
            "archive_document",
            identifiers=[
                doc_a,                                              # bare string -> unconditional
                {"identifier": doc_b, "version_token": stale_b},    # object, stale -> conflicted
                {"identifier": doc_c, "version_token": cur_c},      # object, current -> succeeded
            ],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        entries = _json(archive.text) if archive.ok else None
        is_array = isinstance(entries, list) and len(entries) == 3

        # All three docs are already tracked for cleanup by ctx.create_file
        # (track_file registers each path as both a vault file and an MCP
        # identifier), so no extra cleanup registration is needed here.

        detail = f"entries={entries!r}"
        ordered_ok = False
        if is_array:
            e0, e1, e2 = entries[0], entries[1], entries[2]
            checks = {
                # entry[0]: bare string -> unconditional -> succeeded, no version check
                "entry[0] is docA": e0.get("identifier") == doc_a,
                "entry[0] succeeded (bare string, no version check)": e0.get("status") == "succeeded",
                "entry[0] archived status": e0.get("status") == "succeeded" and e0.get("result_status") in (None, "archived") and e0.get("path") == doc_a,
                # entry[1]: object with stale token -> conflicted on version_mismatch
                "entry[1] is docB": e1.get("identifier") == doc_b,
                "entry[1] conflicted (object token honored)": e1.get("status") == "conflicted",
                "entry[1] error is conflict": e1.get("error") == "conflict",
                "entry[1] reason version_mismatch": isinstance(e1.get("details"), dict)
                and e1.get("details", {}).get("reason") == "version_mismatch",
                # entry[2]: object with current token -> succeeded (token matched)
                "entry[2] is docC": e2.get("identifier") == doc_c,
                "entry[2] succeeded (object token matched)": e2.get("status") == "succeeded",
            }
            ordered_ok = all(checks.values())
            if not ordered_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. entries={entries!r}"

        run.step(
            "D-WCO-15: mixed array — bare string unconditional, object tokens checked",
            archive.ok and is_array and ordered_ok,
            detail,
            archive.timing_ms,
            archive,
            server_logs=step_logs,
        )
        if not (archive.ok and is_array and ordered_ok):
            return run

        # ── Step 5: Bare-string element is unconditional ─────────
        # Reinforces "bare string = no version check". In step 4 docB's object-form
        # element (carrying STALE_B) was refused with a version_mismatch, so docB is
        # still active. Re-archive docB here as a BARE STRING: it must succeed
        # unconditionally despite the prior conflict, because bare strings skip the
        # version check entirely.
        log_mark2 = ctx.server.log_position if ctx.server else 0
        archive_b_bare = ctx.client.call_tool("archive_document", identifiers=[doc_b])
        step_logs2 = ctx.server.logs_since(log_mark2) if ctx.server else None
        b_entries = _json(archive_b_bare.text) if archive_b_bare.ok else None
        b_ok = (
            archive_b_bare.ok
            and isinstance(b_entries, list)
            and len(b_entries) == 1
            and b_entries[0].get("identifier") == doc_b
            and b_entries[0].get("status") == "succeeded"
        )
        run.step(
            "D-WCO-15: bare-string docB archives unconditionally (no version check) after prior conflict",
            b_ok,
            f"entries={b_entries!r}",
            archive_b_bare.timing_ms,
            archive_b_bare,
            server_logs=step_logs2,
        )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch archive_document mixed-array input: bare string unconditional, object token checked",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None)
    parser.add_argument("--url", type=str, default=None)
    parser.add_argument("--secret", type=str, default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", type=int, nargs=2, default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", type=str, default=None)
    args = parser.parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else "\n".join(run.summary_lines()))
    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()

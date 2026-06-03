#!/usr/bin/env python3
"""
Test: batch archive_document -> ordered succeeded/conflicted/failed per-item envelope

Scenario:
    1. Seed docA + docB via ctx.create_file + ctx.scan_vault().
    2. Read each doc's version_token (get_document); keep docB's token as STALE_B.
    3. Mutate docB once (write_document update) so its STALE_B token is now out of date.
    4. Call archive_document with a mixed Array<string | {identifier, version_token}>:
         - docA path (untokened)            -> succeeded
         - {docB path, version_token=STALE} -> conflicted (version_mismatch)
         - nonexistent identifier           -> failed (not_found)
    5. Assert the response is an ordered 3-entry array in input order with the
       correct per-item status taxonomy, version_token on succeeded/conflicted,
       targeted_region on conflicted, and the reserved-name `result_status`
       rename on the archived success entry.
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-14

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_batch_item_envelope.py                            # existing server
    python test_batch_item_envelope.py --managed                  # managed server
    python test_batch_item_envelope.py --managed --json           # structured JSON with server logs
    python test_batch_item_envelope.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

COVERAGE = ["D-WCO-14"]

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_batch_item_envelope"

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(text: str):
    """Parse a FlashQuery JSON response; return the decoded value (or {} on object miss)."""
    return json.loads(text)


def _is_hex64(value) -> bool:
    return isinstance(value, str) and bool(_HEX64.match(value))


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path_a = f"_test/{TEST_NAME}_a_{run.run_id}.md"
    path_b = f"_test/{TEST_NAME}_b_{run.run_id}.md"
    missing_id = f"nonexistent-identifier-{run.run_id}"
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
        # ── Step 1: Seed docA + docB and scan ─────────────────────
        ctx.create_file(
            path_a,
            title="Batch Envelope Doc A",
            body="Doc A body.",
            tags=["wco"],
            fqc_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )
        ctx.create_file(
            path_b,
            title="Batch Envelope Doc B",
            body="Doc B body.",
            tags=["wco"],
            fqc_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        )
        scan = ctx.scan_vault()
        run.step("setup: create two fixtures and scan", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            return run

        # ── Step 2: Read docB's current token (STALE_B candidate) ─
        read_b = ctx.client.call_tool("get_document", identifiers=path_b, include=["body"])
        stale_b = None
        read_detail = ""
        if read_b.ok:
            try:
                stale_b = _json(read_b.text).get("version_token")
            except Exception as exc:
                read_detail = f"JSON parse failed: {exc}"
        passed_read = _is_hex64(stale_b)
        run.step(
            "setup: capture docB version_token",
            passed_read,
            read_detail or f"stale_b={stale_b!r}",
            read_b.timing_ms,
            read_b,
        )
        if not passed_read:
            return run

        # ── Step 3: Mutate docB so STALE_B is now out of date ─────
        bump = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=path_b,
            content="Doc B body, mutated to invalidate the captured token.",
            expected_version=stale_b,
        )
        bump_payload = _json(bump.text) if bump.ok else {}
        bumped_token = bump_payload.get("version_token") if isinstance(bump_payload, dict) else None
        passed_bump = bump.ok and _is_hex64(bumped_token) and bumped_token != stale_b
        run.step(
            "setup: mutate docB (STALE_B now out of date)",
            passed_bump,
            f"bumped_token={bumped_token!r}",
            bump.timing_ms,
            bump,
        )
        if not passed_bump:
            return run

        # ── Step 4: Batch archive producing all three outcomes ────
        # Mixed Array<string | {identifier, version_token}> input (REQ-019):
        #   - docA path (untokened)              -> succeeded
        #   - {docB path, STALE_B token}         -> conflicted (version_mismatch)
        #   - nonexistent identifier             -> failed (not_found)
        batch = ctx.client.call_tool(
            "archive_document",
            identifiers=[
                path_a,
                {"identifier": path_b, "version_token": stale_b},
                missing_id,
            ],
        )
        entries = None
        parse_detail = ""
        if batch.ok:
            try:
                entries = _json(batch.text)
            except Exception as exc:
                parse_detail = f"JSON parse failed: {exc}"
        is_array = isinstance(entries, list) and len(entries) == 3
        run.step(
            "D-WCO-14: batch returns an ordered 3-entry array",
            batch.ok and is_array,
            parse_detail or f"entries={entries!r}",
            batch.timing_ms,
            batch,
        )
        if not (batch.ok and is_array):
            return run

        e0, e1, e2 = entries[0], entries[1], entries[2]

        # ── Step 5: entry[0] — succeeded with result_status rename ─
        # The per-item envelope reserves `status` for the outcome taxonomy, so
        # documentArchiveResult's own status:"archived" is emitted as result_status (AC#7).
        e0_checks = {
            "input order: docA first": e0.get("identifier") == path_a,
            "status == succeeded": e0.get("status") == "succeeded",
            "version_token is 64-hex": _is_hex64(e0.get("version_token")),
            "reserved-name rename result_status == archived": e0.get("result_status") == "archived",
            "no bare status:archived leak": "archived" not in (e0.get("status"),),
        }
        e0_ok = all(e0_checks.values())
        e0_detail = ""
        if not e0_ok:
            failed = [k for k, v in e0_checks.items() if not v]
            e0_detail = f"Failed: {', '.join(failed)}. entry[0]={e0!r}"
        run.step(
            "D-WCO-14: entry[0] succeeded carries version_token + result_status rename",
            e0_ok,
            e0_detail,
        )

        # ── Step 6: entry[1] — conflicted with token + targeted region ─
        e1_details = e1.get("details") if isinstance(e1.get("details"), dict) else {}
        e1_checks = {
            "input order: docB second": e1.get("identifier") == path_b,
            "status == conflicted": e1.get("status") == "conflicted",
            "version_token is 64-hex (current)": _is_hex64(e1.get("version_token")),
            "version_token reflects mutation": e1.get("version_token") == bumped_token,
            "carries targeted_region": isinstance(e1.get("targeted_region"), dict),
            "details.reason == version_mismatch": e1_details.get("reason") == "version_mismatch",
        }
        e1_ok = all(e1_checks.values())
        e1_detail = ""
        if not e1_ok:
            failed = [k for k, v in e1_checks.items() if not v]
            e1_detail = f"Failed: {', '.join(failed)}. entry[1]={e1!r}"
        run.step(
            "D-WCO-14: entry[1] conflicted carries version_token + targeted_region + version_mismatch",
            e1_ok,
            e1_detail,
        )

        # ── Step 7: entry[2] — failed with non-conflict not_found envelope ─
        e2_error = e2.get("error") if isinstance(e2.get("error"), dict) else {}
        e2_checks = {
            "input order: missing third": e2.get("identifier") == missing_id,
            "status == failed": e2.get("status") == "failed",
            "carries nested error envelope": isinstance(e2.get("error"), dict),
            "error.error == not_found": e2_error.get("error") == "not_found",
            "not a conflict": e2_error.get("error") != "conflict",
        }
        e2_ok = all(e2_checks.values())
        e2_detail = ""
        if not e2_ok:
            failed = [k for k, v in e2_checks.items() if not v]
            e2_detail = f"Failed: {', '.join(failed)}. entry[2]={e2!r}"
        run.step(
            "D-WCO-14: entry[2] failed carries non-conflict not_found error envelope",
            e2_ok,
            e2_detail,
        )

        # docA was archived in the batch — still track it for cleanup.
        # (ctx.create_file already registered both files + dirs for cleanup.)

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
        description="Batch archive_document ordered per-item envelope (D-WCO-14).",
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

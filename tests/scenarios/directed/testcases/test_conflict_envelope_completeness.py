#!/usr/bin/env python3
"""
Test: replace_doc_section conflict envelope completeness (refusal -> new token + targeted_region; removed region -> not_found).

Scenario:
    Case A - refusal payload completeness (REQ-015 AC#1/#2):
        1. Seed a doc with a "## Target" section and scan (maintain_vault).
        2. Read it (get_document) to capture version_token T1.
        3. Mutate the Target section (replace_doc_section) so the on-disk token becomes T2.
        4. replace_doc_section with the stale expected_version=T1 -> refusal:
           error=="conflict", details.reason=="version_mismatch", a NEW 64-hex
           version_token != T1 (the current on-disk hash), and a present targeted_region.
    Case B - not_found region when the target was removed (REQ-015 AC#3):
        5. Seed a second doc with a "## Gone" section and scan.
        6. Read it (get_document) to capture version_token T1b.
        7. Delete the Gone section (replace_doc_section content="") -> heading removed, token changes.
        8. replace_doc_section with the stale expected_version=T1b -> refusal with
           targeted_region.not_found == true (the section no longer exists).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-13

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_conflict_envelope_completeness.py                            # existing server
    python test_conflict_envelope_completeness.py --managed                  # managed server
    python test_conflict_envelope_completeness.py --managed --json           # structured JSON with server logs
    python test_conflict_envelope_completeness.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-WCO-13"]

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

TEST_NAME = "test_conflict_envelope_completeness"

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(text: str) -> dict:
    """Parse a FlashQuery JSON tool response into a dict (empty dict on non-dict)."""
    try:
        payload = json.loads(text)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _is_hex64(value: object) -> bool:
    return isinstance(value, str) and bool(_HEX64.match(value))


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path_a = f"_test/{TEST_NAME}_a_{run.run_id}.md"
    path_b = f"_test/{TEST_NAME}_b_{run.run_id}.md"
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
        # ── Step 1: Case A — seed doc with a Target section and scan ──────────
        ctx.create_file(
            path_a,
            title="Conflict Envelope Case A",
            body="## Target\n\noriginal body\n",
            tags=["wco"],
        )
        scan_a = ctx.scan_vault()
        run.step("setup A: create fixture with Target section and scan", scan_a.ok,
                 scan_a.error or "", scan_a.timing_ms, scan_a)
        if not scan_a.ok:
            return run

        # ── Step 2: Case A — read to capture version_token T1 ────────────────
        read_a = ctx.client.call_tool("get_document", identifiers=path_a, include=["body"])
        t1 = _json(read_a.text).get("version_token") if read_a.ok else None
        passed_read_a = _is_hex64(t1)
        run.step("Case A: get_document returns version_token T1", passed_read_a,
                 f"T1={t1!r}", read_a.timing_ms, read_a)
        if not passed_read_a:
            return run

        # ── Step 3: Case A — mutate Target so the on-disk token becomes T2 ────
        mutate_a = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path_a,
            heading="Target",
            content="late mutation that bumps the token",
        )
        mutate_payload_a = _json(mutate_a.text) if mutate_a.ok else {}
        t2 = mutate_payload_a.get("version_token")
        passed_mutate_a = mutate_a.ok and _is_hex64(t2) and t2 != t1
        run.step("Case A: replace_doc_section bumps token to T2", passed_mutate_a,
                 f"T2={t2!r}", mutate_a.timing_ms, mutate_a)
        if not passed_mutate_a:
            return run

        # ── Step 4: Case A — stale write refused with complete envelope ──────
        # REQ-015 AC#1/#2: refusal carries the NEW (current) version_token plus
        # the per-tool targeted_region (section body for replace_doc_section).
        stale_a = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path_a,
            heading="Target",
            content="late edit",
            expected_version=t1,
        )
        payload_a = _json(stale_a.text) if stale_a.ok else {}
        envelope_token_a = payload_a.get("version_token")
        targeted_region_a = payload_a.get("targeted_region")
        checks_a = {
            "tool returned a parseable payload": stale_a.ok,
            "error == conflict": payload_a.get("error") == "conflict",
            "details.reason == version_mismatch":
                isinstance(payload_a.get("details"), dict)
                and payload_a["details"].get("reason") == "version_mismatch",
            "new version_token is 64-hex": _is_hex64(envelope_token_a),
            "new version_token != T1": envelope_token_a != t1,
            "new version_token == T2 (current on-disk hash)": envelope_token_a == t2,
            "targeted_region present (non-null)": targeted_region_a is not None,
        }
        passed_a = all(checks_a.values())
        detail_a = "" if passed_a else (
            f"Failed: {', '.join(k for k, v in checks_a.items() if not v)}. "
            f"payload={payload_a!r}"
        )
        run.step("D-WCO-13 Case A: refusal carries new version_token + targeted_region",
                 passed_a, detail_a, stale_a.timing_ms, stale_a)
        if not passed_a:
            return run

        # ── Step 5: Case B — seed doc with a Gone section and scan ───────────
        ctx.create_file(
            path_b,
            title="Conflict Envelope Case B",
            body="## Keep\n\nkeep me\n\n## Gone\n\nremove me\n",
            tags=["wco"],
        )
        scan_b = ctx.scan_vault()
        run.step("setup B: create fixture with Gone section and scan", scan_b.ok,
                 scan_b.error or "", scan_b.timing_ms, scan_b)
        if not scan_b.ok:
            return run

        # ── Step 6: Case B — read to capture version_token T1b ───────────────
        read_b = ctx.client.call_tool("get_document", identifiers=path_b, include=["body"])
        t1b = _json(read_b.text).get("version_token") if read_b.ok else None
        passed_read_b = _is_hex64(t1b)
        run.step("Case B: get_document returns version_token T1b", passed_read_b,
                 f"T1b={t1b!r}", read_b.timing_ms, read_b)
        if not passed_read_b:
            return run

        # ── Step 7: Case B — delete the Gone section (empty content) ─────────
        delete_b = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path_b,
            heading="Gone",
            content="",
        )
        delete_payload_b = _json(delete_b.text) if delete_b.ok else {}
        # Documented delete-section behavior changes the token; the heading is removed.
        passed_delete_b = delete_b.ok and _is_hex64(delete_payload_b.get("version_token"))
        run.step("Case B: replace_doc_section deletes the Gone section", passed_delete_b,
                 f"payload={delete_payload_b!r}", delete_b.timing_ms, delete_b)
        if not passed_delete_b:
            return run

        # ── Step 8: Case B — stale write on a now-missing region -> not_found ─
        # REQ-015 AC#3: the version check fails AND the section is gone, so the
        # refusal's targeted_region reports not_found:true.
        stale_b = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path_b,
            heading="Gone",
            content="resurrect",
            expected_version=t1b,
        )
        payload_b = _json(stale_b.text) if stale_b.ok else {}
        targeted_region_b = payload_b.get("targeted_region")
        not_found_b = (
            isinstance(targeted_region_b, dict) and bool(targeted_region_b.get("not_found"))
        )
        checks_b = {
            "tool returned a parseable payload": stale_b.ok,
            "error == conflict": payload_b.get("error") == "conflict",
            "details.reason == version_mismatch":
                isinstance(payload_b.get("details"), dict)
                and payload_b["details"].get("reason") == "version_mismatch",
            "targeted_region.not_found is true": not_found_b,
        }
        passed_b = all(checks_b.values())
        detail_b = "" if passed_b else (
            f"Failed: {', '.join(k for k, v in checks_b.items() if not v)}. "
            f"payload={payload_b!r}"
        )
        run.step("D-WCO-13 Case B: refusal targeted_region reports not_found when region removed",
                 passed_b, detail_b, stale_b.timing_ms, stale_b)

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────────────
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
        description="replace_doc_section conflict envelope completeness (D-WCO-13)",
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

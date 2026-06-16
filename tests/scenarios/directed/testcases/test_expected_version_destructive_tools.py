#!/usr/bin/env python3
"""
Test: expected_version / if_match precondition on destructive & structural tools

Scenario:
    For each tool, seed a fresh doc, read its version_token (T1), mutate it once via
    write_document update (token becomes T2 — T1 is now stale), then:
      1. Call the tool with expected_version=T1 (stale) -> conflict / version_mismatch.
      2. Call the tool with the CURRENT token -> success.
    Sub-cases:
      - archive_document(identifiers=, expected_version=) checks the acted-on file.
      - remove_document(identifiers=, expected_version=) checks the acted-on file.
      - move_document(identifier=, destination=, expected_version=) checks the SOURCE file.
      - copy_document(identifier=, destination=, expected_version=) checks the SOURCE file.
      - write_document(mode=update, if_match=) proves if_match is accepted as an
        alias for expected_version (stale -> conflict; current -> success).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-11

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_expected_version_destructive_tools.py                            # existing server
    python test_expected_version_destructive_tools.py --managed                  # managed server
    python test_expected_version_destructive_tools.py --managed --json           # structured JSON with server logs
    python test_expected_version_destructive_tools.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["D-WCO-11"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_expected_version_destructive_tools"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(text: str) -> dict:
    """Parse a FlashQuery JSON tool response into a dict (empty dict on failure)."""
    try:
        payload = json.loads(text)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _is_conflict(payload: dict) -> bool:
    """True if the payload is a version_mismatch conflict envelope."""
    return (
        payload.get("error") == "conflict"
        and payload.get("details", {}).get("reason") == "version_mismatch"
    )


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
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

        def stale_and_current(path: str, label: str) -> tuple[str, str] | None:
            """
            Read the doc's version_token (T1), bump it via write_document update
            (T2). Returns (stale=T1, current=T2). Records its own steps; returns
            None on setup failure so the caller can early-return.
            """
            read = ctx.client.call_tool("get_document", identifiers=path, include=["body"])
            t1 = _json(read.text).get("version_token") if read.ok else None
            passed_read = isinstance(t1, str) and len(t1) == 64
            run.step(
                f"{label}: get_document returns version_token (T1)",
                passed_read,
                f"T1={t1!r}" if passed_read else (read.error or read.text[:200]),
                read.timing_ms,
                read,
            )
            if not passed_read:
                return None

            bump = ctx.client.call_tool(
                "write_document",
                mode="update",
                identifier=path,
                content="Mutated once to make T1 stale.",
                expected_version=t1,
            )
            t2 = _json(bump.text).get("version_token") if bump.ok else None
            passed_bump = (
                bump.ok and isinstance(t2, str) and len(t2) == 64 and t2 != t1
            )
            run.step(
                f"{label}: write_document update bumps token (T2 != T1)",
                passed_bump,
                f"T2={t2!r}" if passed_bump else (bump.error or bump.text[:200]),
                bump.timing_ms,
                bump,
            )
            if not passed_bump:
                return None

            # write_document update rewrites file content; re-sync so the DB row
            # tracks the new content_hash. move_document in particular refuses an
            # un-indexed source (error=unindexed_document) if the row is stale.
            # Scanning does not alter file bytes, so the version_token stays T2.
            ctx.scan_vault()
            return t1, t2

        # ── Step group: archive_document ─────────────────────────
        archive_path = f"_test/{TEST_NAME}_archive_{run.run_id}.md"
        ctx.create_file(archive_path, title="WCO Archive", body="Archive me.", tags=["wco"])

        # ── Step group: remove_document ──────────────────────────
        remove_path = f"_test/{TEST_NAME}_remove_{run.run_id}.md"
        ctx.create_file(remove_path, title="WCO Remove", body="Remove me.", tags=["wco"])

        # ── Step group: move_document ────────────────────────────
        move_path = f"_test/{TEST_NAME}_move_{run.run_id}.md"
        move_dest = f"_test/{TEST_NAME}_moved_{run.run_id}.md"
        ctx.create_file(move_path, title="WCO Move", body="Move me.", tags=["wco"])
        # Destination is created by move_document (not create_file), so register it for
        # MCP cleanup too — otherwise its fqc_documents row leaks past strict cleanup.
        ctx.cleanup.track_file(move_dest, mcp_identifier=move_dest)

        # ── Step group: copy_document ────────────────────────────
        copy_path = f"_test/{TEST_NAME}_copy_{run.run_id}.md"
        copy_dest = f"_test/{TEST_NAME}_copied_{run.run_id}.md"
        ctx.create_file(copy_path, title="WCO Copy", body="Copy me.", tags=["wco"])
        ctx.cleanup.track_file(copy_dest)

        # ── Step group: if_match alias ───────────────────────────
        alias_path = f"_test/{TEST_NAME}_alias_{run.run_id}.md"
        ctx.create_file(alias_path, title="WCO Alias", body="Alias me.", tags=["wco"])

        scan = ctx.scan_vault()
        run.step("setup: create fixtures and scan vault", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # remove_path is cleaned up by remove_document later in the test (file+DB row deleted).
        # The rest need MCP tracking so their fqc_documents rows are archived on cleanup.
        for path in [archive_path, move_path, copy_path, alias_path]:
            resp = ctx.client.call_tool("get_document", identifiers=path)
            fq_id = _json(resp.text).get("fq_id") if resp.ok else None
            if fq_id:
                ctx.cleanup.track_mcp_document(fq_id)

        # ── archive_document ─────────────────────────────────────
        tokens = stale_and_current(archive_path, "archive_document")
        if tokens is None:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        stale, current = tokens

        a_stale = ctx.client.call_tool(
            "archive_document", identifiers=archive_path, expected_version=stale
        )
        a_stale_payload = _json(a_stale.text) if a_stale.ok else {}
        run.step(
            "D-WCO-11: archive_document with STALE expected_version is refused (version_mismatch)",
            a_stale.ok and _is_conflict(a_stale_payload),
            f"payload={a_stale_payload!r}",
            a_stale.timing_ms,
            a_stale,
        )

        a_ok = ctx.client.call_tool(
            "archive_document", identifiers=archive_path, expected_version=current
        )
        a_ok_payload = _json(a_ok.text) if a_ok.ok else {}
        run.step(
            "D-WCO-11: archive_document with CURRENT expected_version succeeds (archived)",
            a_ok.ok and a_ok_payload.get("status") == "archived",
            f"payload={a_ok_payload!r}",
            a_ok.timing_ms,
            a_ok,
        )

        # ── remove_document ──────────────────────────────────────
        tokens = stale_and_current(remove_path, "remove_document")
        if tokens is None:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        stale, current = tokens

        r_stale = ctx.client.call_tool(
            "remove_document", identifiers=remove_path, expected_version=stale
        )
        r_stale_payload = _json(r_stale.text) if r_stale.ok else {}
        run.step(
            "D-WCO-11: remove_document with STALE expected_version is refused (version_mismatch)",
            r_stale.ok and _is_conflict(r_stale_payload),
            f"payload={r_stale_payload!r}",
            r_stale.timing_ms,
            r_stale,
        )

        r_ok = ctx.client.call_tool(
            "remove_document", identifiers=remove_path, expected_version=current
        )
        r_ok_payload = _json(r_ok.text) if r_ok.ok else {}
        run.step(
            "D-WCO-11: remove_document with CURRENT expected_version succeeds",
            r_ok.ok and r_ok_payload.get("path") == remove_path and "error" not in r_ok_payload,
            f"payload={r_ok_payload!r}",
            r_ok.timing_ms,
            r_ok,
        )

        # ── move_document (token refers to the SOURCE file) ──────
        tokens = stale_and_current(move_path, "move_document")
        if tokens is None:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        stale, current = tokens

        m_stale = ctx.client.call_tool(
            "move_document", identifier=move_path, destination=move_dest, expected_version=stale
        )
        m_stale_payload = _json(m_stale.text) if m_stale.ok else {}
        run.step(
            "D-WCO-11: move_document with STALE source expected_version is refused (version_mismatch)",
            m_stale.ok and _is_conflict(m_stale_payload),
            f"payload={m_stale_payload!r}",
            m_stale.timing_ms,
            m_stale,
        )

        m_ok = ctx.client.call_tool(
            "move_document", identifier=move_path, destination=move_dest, expected_version=current
        )
        m_ok_payload = _json(m_ok.text) if m_ok.ok else {}
        run.step(
            "D-WCO-11: move_document with CURRENT source expected_version succeeds",
            m_ok.ok and m_ok_payload.get("path") == move_dest and "error" not in m_ok_payload,
            f"payload={m_ok_payload!r}",
            m_ok.timing_ms,
            m_ok,
        )

        # ── copy_document (token refers to the SOURCE file) ──────
        tokens = stale_and_current(copy_path, "copy_document")
        if tokens is None:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        stale, current = tokens

        c_stale = ctx.client.call_tool(
            "copy_document", identifier=copy_path, destination=copy_dest, expected_version=stale
        )
        c_stale_payload = _json(c_stale.text) if c_stale.ok else {}
        run.step(
            "D-WCO-11: copy_document with STALE source expected_version is refused (version_mismatch)",
            c_stale.ok and _is_conflict(c_stale_payload),
            f"payload={c_stale_payload!r}",
            c_stale.timing_ms,
            c_stale,
        )

        c_ok = ctx.client.call_tool(
            "copy_document", identifier=copy_path, destination=copy_dest, expected_version=current
        )
        c_ok_payload = _json(c_ok.text) if c_ok.ok else {}
        c_ok_fqc = c_ok_payload.get("fq_id") or c_ok_payload.get("fqc_id")
        if c_ok_fqc:
            ctx.cleanup.track_mcp_document(c_ok_fqc)
        run.step(
            "D-WCO-11: copy_document with CURRENT source expected_version succeeds",
            c_ok.ok and c_ok_payload.get("path") == copy_dest and "error" not in c_ok_payload,
            f"payload={c_ok_payload!r}",
            c_ok.timing_ms,
            c_ok,
        )

        # ── if_match alias on write_document ─────────────────────
        tokens = stale_and_current(alias_path, "if_match alias")
        if tokens is None:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run
        stale, current = tokens

        if_match_stale = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=alias_path,
            content="if_match stale write must be refused.",
            if_match=stale,
        )
        if_match_stale_payload = _json(if_match_stale.text) if if_match_stale.ok else {}
        run.step(
            "D-WCO-11: write_document if_match=STALE is refused (proves if_match aliases expected_version)",
            if_match_stale.ok and _is_conflict(if_match_stale_payload),
            f"payload={if_match_stale_payload!r}",
            if_match_stale.timing_ms,
            if_match_stale,
        )

        if_match_ok = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=alias_path,
            content="if_match current write succeeds.",
            if_match=current,
        )
        if_match_ok_payload = _json(if_match_ok.text) if if_match_ok.ok else {}
        if_match_new = if_match_ok_payload.get("version_token")
        run.step(
            "D-WCO-11: write_document if_match=CURRENT succeeds and returns a new token",
            if_match_ok.ok
            and isinstance(if_match_new, str)
            and if_match_new != current
            and "error" not in if_match_ok_payload,
            f"new_token={if_match_new!r}",
            if_match_ok.timing_ms,
            if_match_ok,
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
        description="REQ-012 AC#1/#5: expected_version / if_match on destructive & structural tools.",
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

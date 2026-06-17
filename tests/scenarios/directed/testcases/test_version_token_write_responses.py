#!/usr/bin/env python3
"""
Test: write-tool success responses carry post-write version_token (remove omits it)

Scenario:
    1. Seed docA (with a "## Notes" section), docB, docToRemove via ctx.create_file + scan.
    2. write_document(update) on docA -> version_token present (write_document).
    3. insert_in_doc(bottom) on docA -> version_token present (insert_in_doc).
    4. replace_doc_section(## Notes) on docA -> version_token present (replace_doc_section).
    5. apply_tags(targets=[document docA]) -> version_token present (apply_tags).
    6. insert_doc_link(docA -> docB) -> version_token present (insert_doc_link).
    7. copy_document(docA -> docCopy) -> version_token present AND equals
       get_document(docCopy).version_token (proves it's the destination bytes).
    8. move_document(docB -> docMoved) -> version_token present AND equals
       get_document(docMoved).version_token (destination bytes).
    9. archive_document(docA) -> version_token present (single-target object form).
       Done LAST among docA operations because archiving may exclude it.
   10. remove_document(docToRemove) -> version_token ABSENT (file is gone).
    Cleanup is automatic (filesystem + database) even if the test fails.

Coverage points: D-WCO-10

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_version_token_write_responses.py                            # existing server
    python test_version_token_write_responses.py --managed                  # managed server
    python test_version_token_write_responses.py --managed --json           # structured JSON with server logs
    python test_version_token_write_responses.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""

from __future__ import annotations

COVERAGE = ["D-WCO-10"]

import argparse
import json
import re
import sys
from pathlib import Path

# Framework path setup — three levels up from testcases/ to reach scenarios/framework/
# testcases/ -> directed/ -> scenarios/ -> framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_version_token_write_responses"

# A 64-character lowercase hex string (SHA-256 fingerprint).
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json(text: str):
    """Parse a FlashQuery JSON tool response; returns dict, list, or {} on failure."""
    try:
        return json.loads(text)
    except Exception:
        return {}


def _is_token(value: object) -> bool:
    """True when value is a 64-char lowercase hex version_token string."""
    return isinstance(value, str) and bool(_HEX64.match(value))


def _doc_token(text: str):
    """Extract a top-level version_token from a single-object document response."""
    payload = _json(text)
    if isinstance(payload, dict):
        return payload.get("version_token")
    return None


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    doc_a = f"_test/{TEST_NAME}_a_{run.run_id}.md"
    doc_b = f"_test/{TEST_NAME}_b_{run.run_id}.md"
    doc_remove = f"_test/{TEST_NAME}_remove_{run.run_id}.md"
    doc_copy = f"_test/{TEST_NAME}_copy_{run.run_id}.md"
    doc_moved = f"_test/{TEST_NAME}_moved_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        # ── Step 0: Seed fixtures and scan ────────────────────────
        # docA carries a "## Notes" section so replace_doc_section has a target.
        ctx.create_file(
            doc_a,
            title="Version Token Doc A",
            body="Initial body.\n\n## Notes\n\nOriginal notes content.",
            tags=["fqc-test", run.run_id],
        )
        ctx.create_file(
            doc_b,
            title="Version Token Doc B",
            body="Link target body.",
            tags=["fqc-test", run.run_id],
        )
        # Destinations created by copy/move are tracked explicitly for cleanup.
        ctx.cleanup.track_file(doc_copy)
        ctx.cleanup.track_file(doc_moved)
        ctx.create_file(
            doc_remove,
            title="Version Token Doc To Remove",
            body="Throwaway body for remove_document.",
            tags=["fqc-test", run.run_id],
        )
        scan = ctx.scan_vault()
        run.step("setup: create fixtures and scan", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            return run

        # doc_remove is cleaned up by remove_document later in the test (file+DB row deleted).
        # doc_a and doc_b need MCP tracking so their fqc_documents rows are archived on cleanup.
        for path in [doc_a, doc_b]:
            resp = ctx.client.call_tool("get_document", identifiers=path)
            fq_id = _json(resp.text).get("fq_id") if resp.ok else None
            if fq_id:
                ctx.cleanup.track_mcp_document(fq_id)

        # ── Step 1: write_document(update) carries version_token ──
        log_mark = ctx.server.log_position if ctx.server else 0
        write = ctx.client.call_tool(
            "write_document",
            mode="update",
            identifier=doc_a,
            content="Updated body via write_document.\n\n## Notes\n\nOriginal notes content.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        token = _doc_token(write.text) if write.ok else None
        passed = write.ok and _is_token(token)
        run.step(
            "D-WCO-10: write_document success carries version_token",
            passed,
            f"version_token={token!r}",
            write.timing_ms,
            write,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 2: insert_in_doc carries version_token ───────────
        log_mark = ctx.server.log_position if ctx.server else 0
        insert = ctx.client.call_tool(
            "insert_in_doc",
            identifier=doc_a,
            position="bottom",
            content="\nAppended line from insert_in_doc.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        token = _doc_token(insert.text) if insert.ok else None
        passed = insert.ok and _is_token(token)
        run.step(
            "D-WCO-10: insert_in_doc success carries version_token",
            passed,
            f"version_token={token!r}",
            insert.timing_ms,
            insert,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 3: replace_doc_section carries version_token ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        replace = ctx.client.call_tool(
            "replace_doc_section",
            identifier=doc_a,
            heading="Notes",
            content="Replaced notes content.",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        token = _doc_token(replace.text) if replace.ok else None
        passed = replace.ok and _is_token(token)
        run.step(
            "D-WCO-10: replace_doc_section success carries version_token",
            passed,
            f"version_token={token!r}",
            replace.timing_ms,
            replace,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 4: apply_tags carries version_token ──────────────
        # targets is an array, so the response is a wrapped batch array;
        # the document result is results[0] with a top-level version_token.
        log_mark = ctx.server.log_position if ctx.server else 0
        tag = ctx.client.call_tool(
            "apply_tags",
            targets=[{"entity_type": "document", "identifier": doc_a}],
            add_tags=["fqc-test-tagged"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        tag_payload = _json(tag.text) if tag.ok else None
        token = None
        if isinstance(tag_payload, list) and tag_payload and isinstance(tag_payload[0], dict):
            token = tag_payload[0].get("version_token")
        passed = tag.ok and _is_token(token)
        run.step(
            "D-WCO-10: apply_tags success carries version_token",
            passed,
            f"version_token={token!r}",
            tag.timing_ms,
            tag,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 5: insert_doc_link carries version_token ─────────
        # Single (non-array) identifiers -> response is { results: [ {…} ], … };
        # the document result is results[0] with a top-level version_token.
        log_mark = ctx.server.log_position if ctx.server else 0
        link = ctx.client.call_tool(
            "insert_doc_link",
            identifiers=doc_a,
            target_identifier=doc_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        link_payload = _json(link.text) if link.ok else None
        token = None
        if isinstance(link_payload, dict):
            results = link_payload.get("results")
            if isinstance(results, list) and results and isinstance(results[0], dict):
                token = results[0].get("version_token")
        passed = link.ok and _is_token(token)
        run.step(
            "D-WCO-10: insert_doc_link success carries version_token",
            passed,
            f"version_token={token!r}",
            link.timing_ms,
            link,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 6: copy_document returns the destination's token ──
        log_mark = ctx.server.log_position if ctx.server else 0
        copy = ctx.client.call_tool(
            "copy_document",
            identifier=doc_a,
            destination=doc_copy,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        copy_token = _doc_token(copy.text) if copy.ok else None
        copy_fq_id = _json(copy.text).get("fq_id") if copy.ok else None
        if copy_fq_id:
            ctx.cleanup.track_mcp_document(copy_fq_id)
        copy_get = ctx.client.call_tool("get_document", identifiers=doc_copy, include=["body"])
        copy_get_token = _doc_token(copy_get.text) if copy_get.ok else None
        checks = {
            "copy response carries version_token": copy.ok and _is_token(copy_token),
            "get_document(copy) carries version_token": copy_get.ok and _is_token(copy_get_token),
            "copy token equals destination's token": (
                copy_token is not None and copy_token == copy_get_token
            ),
        }
        passed = all(checks.values())
        detail = (
            f"copy_token={copy_token!r}, dest_token={copy_get_token!r}"
            if passed
            else f"Failed: {', '.join(k for k, v in checks.items() if not v)}. "
            f"copy_token={copy_token!r}, dest_token={copy_get_token!r}"
        )
        run.step(
            "D-WCO-10: copy_document returns destination file's version_token",
            passed,
            detail,
            copy.timing_ms,
            copy,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 7: move_document returns the destination's token ──
        log_mark = ctx.server.log_position if ctx.server else 0
        move = ctx.client.call_tool(
            "move_document",
            identifier=doc_b,
            destination=doc_moved,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        move_token = _doc_token(move.text) if move.ok else None
        move_get = ctx.client.call_tool("get_document", identifiers=doc_moved, include=["body"])
        move_get_token = _doc_token(move_get.text) if move_get.ok else None
        checks = {
            "move response carries version_token": move.ok and _is_token(move_token),
            "get_document(moved) carries version_token": move_get.ok and _is_token(move_get_token),
            "move token equals destination's token": (
                move_token is not None and move_token == move_get_token
            ),
        }
        passed = all(checks.values())
        detail = (
            f"move_token={move_token!r}, dest_token={move_get_token!r}"
            if passed
            else f"Failed: {', '.join(k for k, v in checks.items() if not v)}. "
            f"move_token={move_token!r}, dest_token={move_get_token!r}"
        )
        run.step(
            "D-WCO-10: move_document returns destination file's version_token",
            passed,
            detail,
            move.timing_ms,
            move,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 8: archive_document (single object) carries token ─
        # Done LAST among docA operations — archiving may exclude docA.
        log_mark = ctx.server.log_position if ctx.server else 0
        archive = ctx.client.call_tool("archive_document", identifiers=doc_a)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        token = _doc_token(archive.text) if archive.ok else None
        passed = archive.ok and _is_token(token)
        run.step(
            "D-WCO-10: archive_document success carries version_token",
            passed,
            f"version_token={token!r}",
            archive.timing_ms,
            archive,
            step_logs,
        )
        if not passed:
            return run

        # ── Step 9: remove_document OMITS version_token ───────────
        # The file is gone, so there are no post-write bytes to fingerprint.
        log_mark = ctx.server.log_position if ctx.server else 0
        remove = ctx.client.call_tool("remove_document", identifiers=doc_remove)
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        remove_payload = _json(remove.text) if remove.ok else {}
        has_token = isinstance(remove_payload, dict) and "version_token" in remove_payload
        passed = remove.ok and not has_token
        run.step(
            "D-WCO-10: remove_document success OMITS version_token",
            passed,
            f"payload_keys={sorted(remove_payload.keys()) if isinstance(remove_payload, dict) else remove_payload!r}",
            remove.timing_ms,
            remove,
            step_logs,
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
        description="version_token presence across write-tool success responses",
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

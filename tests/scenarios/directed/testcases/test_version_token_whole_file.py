#!/usr/bin/env python3
"""D-WCO-12 / REQ-016 AC#1,#2: version_token is whole-file, not section-scoped."""
from __future__ import annotations

COVERAGE = ["D-WCO-12"]

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun

TEST_NAME = "test_version_token_whole_file"


def _json(text: str) -> dict:
    payload = json.loads(text)
    return payload if isinstance(payload, dict) else {}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path = f"_test/{TEST_NAME}_{run.run_id}.md"
    port_range = tuple(args.port_range) if args.port_range else None

    # Two sections so an edit to one (Beta) can invalidate a token used to write
    # the other (Alpha), proving the token covers the whole file, not a section.
    body = "## Alpha\n\nalpha body\n\n## Beta\n\nbeta body"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        # ── Setup: create two-section fixture and scan ───────────
        ctx.create_file(
            path,
            title="Version Token Whole File",
            body=body,
            tags=["wco"],
            fqc_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        )
        scan = ctx.scan_vault()
        run.step("setup: create two-section fixture and scan", scan.ok, scan.error or "", scan.timing_ms, scan)
        if not scan.ok:
            return run

        # ── Step 1: whole-file read returns version_token ────────
        full_read = ctx.client.call_tool("get_document", identifiers=path, include=["body"])
        t_full = None
        full_detail = ""
        if full_read.ok:
            try:
                t_full = _json(full_read.text).get("version_token")
            except Exception as exc:
                full_detail = f"JSON parse failed: {exc}"
        passed_full = isinstance(t_full, str) and len(t_full) == 64
        run.step(
            "D-WCO-12: whole-file get_document returns version_token (T_full)",
            passed_full,
            full_detail or f"t_full={t_full!r}",
            full_read.timing_ms,
            full_read,
        )
        if not passed_full:
            return run

        # ── Step 2: section read returns the WHOLE-FILE token ────
        # REQ-016 AC#2: reading only the Alpha section must still return the
        # whole-file token, not a section-scoped fingerprint.
        section_read = ctx.client.call_tool(
            "get_document", identifiers=path, sections=["Alpha"], include=["body"]
        )
        t_section = None
        section_detail = ""
        if section_read.ok:
            try:
                t_section = _json(section_read.text).get("version_token")
            except Exception as exc:
                section_detail = f"JSON parse failed: {exc}"
        passed_section = isinstance(t_section, str) and t_section == t_full
        run.step(
            "D-WCO-12: section read returns whole-file token (T_section == T_full)",
            passed_section,
            section_detail or f"t_section={t_section!r} t_full={t_full!r}",
            section_read.timing_ms,
            section_read,
        )
        if not passed_section:
            return run

        # ── Step 3: unrelated edit to Beta changes whole-file bytes
        beta_edit = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path,
            heading="Beta",
            content="beta body edited",
        )
        beta_payload = _json(beta_edit.text) if beta_edit.ok else {}
        new_token = beta_payload.get("version_token")
        passed_beta = beta_edit.ok and isinstance(new_token, str) and new_token != t_full
        run.step(
            "D-WCO-12: unrelated Beta edit succeeds and yields a new whole-file token",
            passed_beta,
            f"new_token={new_token!r} t_full={t_full!r}",
            beta_edit.timing_ms,
            beta_edit,
        )
        if not passed_beta:
            return run

        # ── Step 4: surgical Alpha write with the stale T_full ───
        # The token was valid for the original file but the unrelated Beta edit
        # changed whole-file bytes, so this surgical Alpha write must be refused.
        # This is the documented false-conflict behavior of a whole-file token.
        stale = ctx.client.call_tool(
            "replace_doc_section",
            identifier=path,
            heading="Alpha",
            content="alpha body edited",
            expected_version=t_full,
        )
        stale_payload = _json(stale.text) if stale.ok else {}
        passed_stale = (
            stale.ok
            and stale_payload.get("error") == "conflict"
            and stale_payload.get("details", {}).get("reason") == "version_mismatch"
        )
        run.step(
            "D-WCO-12: surgical Alpha write with stale whole-file token is refused (version_mismatch)",
            passed_stale,
            f"payload={stale_payload!r}",
            stale.timing_ms,
            stale,
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

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
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

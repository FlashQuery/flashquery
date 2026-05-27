#!/usr/bin/env python3
"""Directed scenario: D-WCO-02 case-variant public read-modify-writes serialize."""
from __future__ import annotations

COVERAGE = ["D-WCO-02"]
REQUIRES_MANAGED = True

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_case_variant_path_locking"


def _cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--port-range", nargs=2, type=int, default=None)
    parser.add_argument("--json", dest="output_json", action="store_true")
    parser.add_argument("--keep", action="store_true")
    return parser


def _case_insensitive(root: Path) -> bool:
    probe = root / "CaseProbe"
    probe.write_text("probe", encoding="utf-8")
    try:
      return (root / "caseprobe").exists()
    finally:
      probe.unlink(missing_ok=True)


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    path_a = f"_test/{TEST_NAME}_{run.run_id}/Notes/Plan.md"
    path_b = f"_test/{TEST_NAME}_{run.run_id}/notes/plan.md"

    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range, enable_locking=True) as ctx:
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}/Notes")
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}/notes")
        ctx.cleanup.track_dir(f"_test/{TEST_NAME}_{run.run_id}")
        ctx.cleanup.track_dir("_test")

        if not _case_insensitive(ctx.vault.vault_root):
            run.step(
                label="D-WCO-02 / T-S-002: case-variant path locking",
                passed=True,
                detail="skipped: vault filesystem is case-sensitive, so case variants are distinct files",
            )
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        create_result = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=path_a,
            title="Case Variant Lock Target",
            content="Case-variant tag race target.",
            tags=["fqc-test", run.run_id],
        )
        if create_result.ok:
            ctx.cleanup.track_file(path_a)
            try:
                payload = json.loads(create_result.text)
                if payload.get("fq_id"):
                    ctx.cleanup.track_mcp_document(payload["fq_id"])
            except Exception:
                pass
        run.step(
            label="setup: create case-variant target document",
            passed=create_result.ok,
            detail=create_result.error or "",
            timing_ms=create_result.timing_ms,
            tool_result=create_result,
        )
        if not create_result.ok:
            return run

        tag_a = f"case-original-{run.run_id}"
        tag_b = f"case-variant-{run.run_id}"

        def apply(path: str, tag_name: str):
            return path, tag_name, ctx.client.call_tool(
                "apply_tags",
                targets=[{"entity_type": "document", "identifier": path}],
                add_tags=[tag_name],
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(apply, path_a, tag_a),
                pool.submit(apply, path_b, tag_b),
            ]
            results = [future.result() for future in futures]

        fm = ctx.vault.read_frontmatter(path_a)
        tags = set(fm.get("fq_tags", []) or fm.get("tags", []))
        expected = {tag_a, tag_b}
        passed = all(item[2].ok for item in results) and expected.issubset(tags)
        detail = (
            ""
            if passed
            else f"tags={sorted(tags)!r}; "
                 f"a={expectation_detail(results[0][2]) or results[0][2].error}; "
                 f"b={expectation_detail(results[1][2]) or results[1][2].error}"
        )
        run.step(
            label="D-WCO-02 / T-S-002: case-variant apply_tags calls preserve both read-modify-write updates",
            passed=passed,
            detail="" if passed else detail,
            timing_ms=max(item[2].timing_ms for item in results),
            tool_result=results[0][2],
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)
    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    args = _cli().parse_args()
    run = run_test(args)
    print(run.to_json() if args.output_json else run.to_text())
    raise SystemExit(run.exit_code)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""D-WCO-07 / T-S-007: consecutive managed scans keep fq_updated stable."""
from __future__ import annotations

COVERAGE = ["D-WCO-07"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun

TEST_NAME = "test_scanner_token_stability"


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    path = f"_test/{TEST_NAME}_{run.run_id}.md"
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
        ctx.create_file(
            path,
            title="Scanner Token Stability",
            body="Scanner should not retimestamp this unchanged file.",
            tags=["wco"],
            fqc_id="22222222-2222-4222-8222-222222222222",
        )

        scan1 = ctx.scan_vault()
        run.step("D-WCO-07: first managed scan indexes fixture", scan1.ok, scan1.error or "", scan1.timing_ms, scan1)
        if not scan1.ok:
            return run
        first_updated = ctx.vault.read_frontmatter(path).get("fq_updated")

        scan2 = ctx.scan_vault()
        second_updated = ctx.vault.read_frontmatter(path).get("fq_updated")
        passed_second = scan2.ok and second_updated == first_updated
        run.step(
            "D-WCO-07: second managed scan leaves fq_updated unchanged",
            passed_second,
            f"first={first_updated!r}; second={second_updated!r}",
            scan2.timing_ms,
            scan2,
        )

        scan3 = ctx.scan_vault()
        third_updated = ctx.vault.read_frontmatter(path).get("fq_updated")
        passed_third = scan3.ok and third_updated == second_updated
        run.step(
            "D-WCO-07: third managed scan remains stable with zero retimestamp drift",
            passed_third,
            f"second={second_updated!r}; third={third_updated!r}",
            scan3.timing_ms,
            scan3,
        )

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

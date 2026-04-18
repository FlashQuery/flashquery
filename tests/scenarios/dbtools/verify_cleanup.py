#!/usr/bin/env python3
"""
verify_cleanup.py — did a specific test run clean up after itself?

Narrower than orphans.py: given one --instance-id (typically the one a test
just finished using), confirm that every instance-scoped FQC table has zero
rows for it. Exits 0 if clean, 1 if residue is found.

Intended to be called:
    - Right after a scenario test finishes, to verify TestCleanup succeeded.
    - Optionally from run_suite.py in a strict-cleanup mode that fails the
      suite run when any test leaves residue.

This is a READ-ONLY operation. Use reset.py to actually clean up.

Usage:
    python3 verify_cleanup.py --instance-id test-ab12cd34
    python3 verify_cleanup.py --instance-id test-ab12cd34 --json

Exit codes:
    0   Clean (no rows found for the instance)
    1   Residue found (details printed unless --json)
    2   Configuration, driver, or argument error
"""

from __future__ import annotations

import sys

from _common import (
    TABLES,
    base_parser,
    connect,
    count_rows,
    discover_db_config,
    print_json,
)


def main() -> int:
    parser = base_parser(description=__doc__)
    parser.add_argument(
        "--instance-id",
        required=True,
        help="The instance_id to verify has been cleaned up.",
    )
    args = parser.parse_args()

    db = discover_db_config(fqc_dir=args.fqc_dir)

    with connect(db) as conn:
        per_table: dict[str, int] = {}
        for spec in TABLES:
            per_table[spec.name] = count_rows(conn, spec, instance_id=args.instance_id)

    residue_total = sum(per_table.values())
    clean = residue_total == 0

    result = {
        "connection": db.database_url,
        "instance_id": args.instance_id,
        "clean": clean,
        "residue_rows_total": residue_total,
        "by_table": dict(sorted(per_table.items())),
    }

    if args.output_json:
        print_json(result, pretty=False)
    else:
        _print_human(result)

    return 0 if clean else 1


def _print_human(result: dict) -> None:
    iid = result["instance_id"]
    if result["clean"]:
        print(f"✓ {iid}: clean (no rows in any instance-scoped table).")
        return
    print(f"✗ {iid}: residue found.")
    for table, count in result["by_table"].items():
        if count:
            print(f"    {table}: {count}")
    print(
        f"\nTotal residue: {result['residue_rows_total']} row"
        f"{'s' if result['residue_rows_total'] != 1 else ''}."
    )
    print(f"To clean up: python3 reset.py --instance-id {iid}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)

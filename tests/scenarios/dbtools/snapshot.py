#!/usr/bin/env python3
"""
snapshot.py — dump the DB footprint of a test instance.

Given a test instance_id, pull every row from every instance-scoped FQC table
and emit a structured snapshot. Useful when a scenario test fails and the
report doesn't tell you enough about what ended up in the DB.

This is a READ-ONLY operation. It does not modify the database. It can be run
against any instance_id (including non-test instances) since it only reads —
but for sanity, unscoped runs (no --instance-id) are limited to test-pattern
rows.

Usage:
    python3 snapshot.py --instance-id test-ab12cd34
    python3 snapshot.py --instance-id test-ab12cd34 --json > snap.json
    python3 snapshot.py                                  # all test-pattern instances
    python3 snapshot.py --limit 10                       # cap rows per table

Exit codes:
    0   Snapshot produced
    2   Configuration or driver missing
"""

from __future__ import annotations

import sys

from _common import (
    TABLES,
    base_parser,
    connect,
    discover_db_config,
    distinct_instances,
    fetch_rows,
    print_json,
)


def main() -> None:
    parser = base_parser(description=__doc__)
    parser.add_argument(
        "--instance-id",
        default=None,
        help="Specific instance_id to snapshot. Omit to dump every test-pattern instance.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap rows returned per table (useful for large dumps).",
    )
    args = parser.parse_args()

    db = discover_db_config(fqc_dir=args.fqc_dir)

    with connect(db) as conn:
        if args.instance_id:
            snapshot = _snapshot_for_instance(conn, args.instance_id, limit=args.limit)
            out = {
                "connection": db.database_url,
                "source_yaml": db.source_yaml,
                "instance_id": args.instance_id,
                "snapshot": snapshot,
            }
        else:
            instances = distinct_instances(conn, test_pattern=args.test_pattern)
            if not instances:
                out = {
                    "connection": db.database_url,
                    "source_yaml": db.source_yaml,
                    "test_pattern": args.test_pattern,
                    "instances": {},
                }
            else:
                per_instance: dict[str, dict] = {}
                for iid in sorted(instances):
                    per_instance[iid] = _snapshot_for_instance(
                        conn, iid, limit=args.limit
                    )
                out = {
                    "connection": db.database_url,
                    "source_yaml": db.source_yaml,
                    "test_pattern": args.test_pattern,
                    "instances": per_instance,
                }

    if args.output_json:
        print_json(out, pretty=False)
    else:
        _print_human(out)


def _snapshot_for_instance(conn, instance_id: str, limit: int | None) -> dict:
    """Collect all rows for *instance_id* across the registered tables."""
    tables_data: dict[str, dict] = {}
    for spec in TABLES:
        rows = fetch_rows(conn, spec, instance_id=instance_id, limit=limit)
        tables_data[spec.name] = {
            "count": len(rows),
            "rows": rows,
        }
    return tables_data


def _print_human(out: dict) -> None:
    """Render a compact human-readable snapshot."""
    print(f"Connection: {out['connection']}")
    if out.get("source_yaml"):
        print(f"Source config: {out['source_yaml']}")

    if "instance_id" in out:
        # single-instance snapshot
        print(f"Instance: {out['instance_id']}")
        _print_tables(out["snapshot"])
    else:
        pattern = out["test_pattern"]
        instances = out["instances"]
        if not instances:
            print(f"No instances matching {pattern!r}.")
            return
        print(f"Test pattern: {pattern}")
        print(f"Instances found: {len(instances)}")
        for iid in sorted(instances):
            print(f"\n─── {iid} ─────────────────────────────────")
            _print_tables(instances[iid])


def _print_tables(tables: dict) -> None:
    any_rows = False
    for name in sorted(tables):
        entry = tables[name]
        count = entry["count"]
        if count:
            any_rows = True
            print(f"  {name}: {count} row{'s' if count != 1 else ''}")
    if not any_rows:
        print("  (no rows)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)

#!/usr/bin/env python3
"""
orphans.py — find residue from dead test runs.

Scans every instance-scoped FQC table for rows whose instance_id matches the
test pattern. These rows belong to test runs that should have cleaned up after
themselves — if they're still here, either TestCleanup failed, the test
process was killed mid-run, or an operation bypassed cleanup.

This is a READ-ONLY operation. It surfaces orphans but does not remove them.
Use reset.py to clean up a specific instance once you've reviewed what's
there.

Quiet by default (CI-friendly): exit 0 and print nothing if no orphans found,
exit 1 and print a report if orphans found. Use --verbose for a full
breakdown either way.

Usage:
    python3 orphans.py                 # quiet scan, exit 1 if orphans found
    python3 orphans.py --verbose       # always print what was checked
    python3 orphans.py --json          # machine-readable output
    python3 orphans.py --min-age 60    # only flag rows older than 60 minutes

Exit codes:
    0   No orphans found
    1   Orphans found (details printed unless --json)
    2   Configuration or driver missing
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

from _common import (
    base_parser,
    connect,
    discover_db_config,
    distinct_instances,
    print_json,
)


def main() -> int:
    parser = base_parser(description=__doc__)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print a report even when no orphans are found.",
    )
    parser.add_argument(
        "--min-age",
        type=int,
        default=0,
        metavar="MINUTES",
        help=(
            "Only flag instances whose most recent row is older than this many "
            "minutes. Useful to exclude currently-running tests."
        ),
    )
    args = parser.parse_args()

    db = discover_db_config(fqc_dir=args.fqc_dir)

    with connect(db) as conn:
        instances = distinct_instances(conn, test_pattern=args.test_pattern)
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=args.min_age)
            if args.min_age
            else None
        )
        aged_instances = _filter_by_age(conn, instances, cutoff) if cutoff else instances

    orphan_count = sum(sum(t.values()) for t in aged_instances.values())
    has_orphans = orphan_count > 0

    result = {
        "connection": db.database_url,
        "source_yaml": db.source_yaml,
        "test_pattern": args.test_pattern,
        "min_age_minutes": args.min_age,
        "orphan_instances": len(aged_instances),
        "orphan_rows_total": orphan_count,
        "by_instance": {
            iid: dict(sorted(tables.items())) for iid, tables in aged_instances.items()
        },
    }

    if args.output_json:
        print_json(result, pretty=False)
    elif has_orphans or args.verbose:
        _print_human(result)

    return 1 if has_orphans else 0


def _filter_by_age(
    conn,
    instances: dict[str, dict[str, int]],
    cutoff: datetime,
) -> dict[str, dict[str, int]]:
    """
    Filter the *instances* map to only those whose most recent row across any
    table is older than *cutoff*. An instance with ongoing activity is not an
    orphan — it's a running test.
    """
    kept: dict[str, dict[str, int]] = {}
    for iid, tables in instances.items():
        most_recent = _most_recent_activity(conn, iid, tables.keys())
        if most_recent is None:
            # No timestamped tables touched — conservatively treat as orphan
            kept[iid] = tables
            continue
        if most_recent < cutoff:
            kept[iid] = tables
    return kept


def _most_recent_activity(
    conn,
    instance_id: str,
    table_names,
) -> datetime | None:
    """
    Return the most recent updated_at / created_at / detected_at / locked_at
    timestamp for *instance_id* across the given tables. Returns None if none
    of the tables have a usable timestamp column.
    """
    timestamp_candidates = {
        "fqc_documents": "updated_at",
        "fqc_memory": "updated_at",
        "fqc_vault": "created_at",
        "fqc_plugin_registry": "updated_at",
        "fqc_change_queue": "detected_at",
        "fqc_write_locks": "locked_at",
    }
    most_recent: datetime | None = None
    with conn.cursor() as cur:
        for table in table_names:
            col = timestamp_candidates.get(table)
            if not col:
                continue
            cur.execute(
                f'SELECT MAX({col}) FROM "{table}" WHERE instance_id = %s',
                (instance_id,),
            )
            ts = cur.fetchone()[0]
            if ts is not None and (most_recent is None or ts > most_recent):
                most_recent = ts
    return most_recent


def _print_human(result: dict) -> None:
    by_instance = result["by_instance"]
    if not by_instance:
        print("No orphans found.")
        return
    total_rows = result["orphan_rows_total"]
    print(
        f"Found {total_rows} orphan row{'s' if total_rows != 1 else ''} "
        f"across {len(by_instance)} instance{'s' if len(by_instance) != 1 else ''} "
        f"(pattern {result['test_pattern']!r})."
    )
    for iid in sorted(by_instance):
        tables = by_instance[iid]
        instance_total = sum(tables.values())
        print(f"\n  {iid}  ({instance_total} row{'s' if instance_total != 1 else ''})")
        for table, count in sorted(tables.items()):
            if count:
                print(f"    {table}: {count}")

    print(
        "\nTo clean up a specific instance: python3 reset.py --instance-id <id>"
    )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted.\n")
        sys.exit(130)

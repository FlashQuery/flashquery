#!/usr/bin/env python3
"""
reset.py — nuke every row belonging to a test instance.

DESTRUCTIVE. Hard-deletes every row in every instance-scoped FQC table for
the given --instance-id. Intended as the escape hatch for when a test has
left the DB in a state that normal cleanup can't recover from.

Guardrails (all enforced before anything is deleted):

  1. --instance-id is REQUIRED. This script will not operate unscoped.
  2. The instance_id must match the test pattern (default: "test-%"). If you
     try to reset a non-test instance you will be refused. There is no
     override for this guard — production data is not this script's
     responsibility.
  3. The DB connection must look local (localhost / 127.0.0.1 / docker host)
     unless you pass --i-know-this-is-not-local.
  4. --confirm is required, OR you must answer "yes" to the interactive
     prompt. The dry-run plan is always printed before the prompt.

Usage:
    python3 reset.py --instance-id test-ab12cd34                      # interactive confirm
    python3 reset.py --instance-id test-ab12cd34 --confirm             # skip prompt
    python3 reset.py --instance-id test-ab12cd34 --dry-run             # plan only, no deletes

Exit codes:
    0   Reset completed (or dry-run completed)
    1   User declined at the confirmation prompt
    2   Configuration, driver, or guardrail violation
"""

from __future__ import annotations

import sys

from _common import (
    TABLES,
    UnsafeScopeError,
    assert_connection_is_local_or_override,
    assert_instance_is_test_safe,
    base_parser,
    connect,
    count_rows,
    discover_db_config,
)


def main() -> int:
    parser = base_parser(description=__doc__)
    parser.add_argument(
        "--instance-id",
        required=True,
        help="Test instance_id to reset. Must match --test-pattern (default test-%).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Skip the interactive confirmation prompt. Still enforces scope guards.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without deleting anything.",
    )
    parser.add_argument(
        "--i-know-this-is-not-local",
        dest="allow_nonlocal",
        action="store_true",
        help="Allow reset against a non-local database. Use with extreme caution.",
    )
    args = parser.parse_args()

    db = discover_db_config(fqc_dir=args.fqc_dir)

    # ── Guardrails (raise before touching the DB) ───────────────────────────
    try:
        assert_instance_is_test_safe(args.instance_id, pattern=args.test_pattern)
        assert_connection_is_local_or_override(db, override=args.allow_nonlocal)
    except UnsafeScopeError as e:
        sys.stderr.write(f"Refused: {e}\n")
        return 2

    # ── Plan (count what's there) ───────────────────────────────────────────
    with connect(db) as conn:
        plan: dict[str, int] = {}
        for spec in TABLES:
            plan[spec.name] = count_rows(conn, spec, instance_id=args.instance_id)

    plan_total = sum(plan.values())
    _print_plan(db, args.instance_id, plan, plan_total, dry_run=args.dry_run)

    if args.dry_run:
        return 0

    if plan_total == 0:
        print("Nothing to delete. Exiting.")
        return 0

    # ── Confirmation ────────────────────────────────────────────────────────
    if not args.confirm:
        answer = input("\nProceed with deletion? Type 'yes' to confirm: ").strip().lower()
        if answer != "yes":
            print("Aborted.")
            return 1

    # ── Execute (single transaction) ────────────────────────────────────────
    with connect(db) as conn:
        deleted: dict[str, int] = {}
        try:
            with conn.cursor() as cur:
                for spec in TABLES:
                    if plan.get(spec.name, 0) == 0:
                        continue
                    cur.execute(
                        f'DELETE FROM "{spec.name}" WHERE {spec.instance_col} = %s',
                        (args.instance_id,),
                    )
                    # rowcount reflects actual deletions (may differ from plan
                    # if rows were added between the count and the delete)
                    deleted[spec.name] = cur.rowcount
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    _print_result(args.instance_id, deleted)
    return 0


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _print_plan(db, instance_id: str, plan: dict[str, int], total: int, dry_run: bool) -> None:
    header = "Dry run — would delete:" if dry_run else "Plan — would delete:"
    print(header)
    print(f"  Connection: {db.database_url}")
    print(f"  Instance:   {instance_id}")
    if total == 0:
        print("  (no rows match — nothing to delete)")
        return
    for table in sorted(plan):
        count = plan[table]
        if count:
            print(f"    {table}: {count}")
    print(f"  Total: {total} row{'s' if total != 1 else ''}")


def _print_result(instance_id: str, deleted: dict[str, int]) -> None:
    total = sum(deleted.values())
    print(f"\nDeleted {total} row{'s' if total != 1 else ''} for {instance_id}:")
    for table in sorted(deleted):
        count = deleted[table]
        if count:
            print(f"  {table}: {count}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted — no changes committed.\n")
        sys.exit(130)

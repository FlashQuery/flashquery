#!/usr/bin/env python3
"""
Pilot validator — sanity-checks that every pilot YAML in cases/ has the
required fields filled in to be considered a "valid" smoke test.

A pilot is INCOMPLETE if any of these are true:
  - Missing required top-level fields
  - predicted_expect block missing or empty
  - reconciliation.predicted_matched_captured is null (golden capture
    never ran)
  - reconciliation.captured_at is null (same signal)
  - golden_snapshot block missing
  - expect block missing or empty
  - golden_version mismatch with current GOLDEN_VERSION

Exit codes:
  0 — all pilots valid
  1 — at least one pilot incomplete (details printed)

Usage:
  python3 tests/macro-framework/_pilot-validate.py
  python3 tests/macro-framework/_pilot-validate.py --json
"""

import json
import os
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)


CASES_DIR = Path(__file__).parent / "cases"
GOLDEN_VERSION_FILE = Path(__file__).parent / "macro-golden-model" / "src" / "version.ts"

REQUIRED_TOP_LEVEL_FIELDS = [
    "id",
    "name",
    "intent",
    "macro",
    "golden_version",
    "predicted_expect",
    "reconciliation",
    "expect",
]


def get_current_golden_version():
    """Parse `export const GOLDEN_VERSION = "X.Y.Z";` from version.ts."""
    if not GOLDEN_VERSION_FILE.exists():
        return None
    text = GOLDEN_VERSION_FILE.read_text()
    for line in text.splitlines():
        if "GOLDEN_VERSION" in line and "=" in line:
            # crude parse: find the string literal
            parts = line.split("=", 1)[1].strip().rstrip(";").strip()
            if parts.startswith('"') and parts.endswith('"'):
                return parts[1:-1]
    return None


def validate_pilot(path: Path, current_golden: str | None) -> list[str]:
    """Return a list of validation findings for one pilot file. Empty list = valid."""
    findings: list[str] = []
    try:
        with open(path) as f:
            doc = yaml.safe_load(f)
    except yaml.YAMLError as e:
        return [f"YAML parse error: {e}"]
    if not isinstance(doc, dict):
        return ["Top-level YAML is not a mapping"]

    # 1. Required top-level fields
    for field in REQUIRED_TOP_LEVEL_FIELDS:
        if field not in doc:
            findings.append(f"missing required field: {field}")

    # 2. predicted_expect non-empty
    pe = doc.get("predicted_expect")
    if not pe or not isinstance(pe, dict):
        findings.append("predicted_expect: missing or empty")
    elif "outcome" not in pe:
        findings.append("predicted_expect: missing outcome field")

    # 3. reconciliation block — golden capture must have happened
    rec = doc.get("reconciliation")
    if not rec or not isinstance(rec, dict):
        findings.append("reconciliation: block missing")
    else:
        if rec.get("predicted_matched_captured") is None:
            findings.append("reconciliation.predicted_matched_captured: null (golden capture never ran)")
        if rec.get("captured_at") is None:
            findings.append("reconciliation.captured_at: null (golden capture never ran)")

    # 4. golden_snapshot block — should be present for completed pilots
    # (Required ONLY when reconciliation says capture happened)
    if rec and rec.get("predicted_matched_captured") is True:
        gs = doc.get("golden_snapshot")
        if not gs or not isinstance(gs, dict):
            findings.append("golden_snapshot: missing (but reconciliation claims capture succeeded)")

    # 5. expect block non-empty
    ex = doc.get("expect")
    if not ex or not isinstance(ex, dict):
        findings.append("expect: missing or empty")
    elif "outcome" not in ex:
        findings.append("expect: missing outcome field")

    # 6. golden_version matches current
    if current_golden and doc.get("golden_version") and doc.get("golden_version") != current_golden:
        findings.append(
            f"golden_version mismatch: pilot has {doc.get('golden_version')!r}, current is {current_golden!r}"
        )

    return findings


def main():
    json_mode = "--json" in sys.argv
    current_golden = get_current_golden_version()

    all_files = sorted(CASES_DIR.rglob("*.yml"))
    total = len(all_files)
    incomplete: list[tuple[str, list[str]]] = []

    for path in all_files:
        # Skip non-pilot files (e.g., index.yml or other utility YAMLs)
        rel = path.relative_to(CASES_DIR)
        findings = validate_pilot(path, current_golden)
        if findings:
            incomplete.append((str(rel), findings))

    if json_mode:
        print(
            json.dumps(
                {
                    "total_pilots": total,
                    "valid_count": total - len(incomplete),
                    "incomplete_count": len(incomplete),
                    "current_golden_version": current_golden,
                    "incomplete": [
                        {"path": p, "findings": f} for p, f in incomplete
                    ],
                },
                indent=2,
            )
        )
    else:
        print(f"Pilot validator — {CASES_DIR}")
        print(f"Current golden version: {current_golden}")
        print(f"Total pilots: {total}")
        print(f"Valid:        {total - len(incomplete)}")
        print(f"Incomplete:   {len(incomplete)}")
        print()
        if incomplete:
            # Group by category of finding
            by_finding: dict[str, list[str]] = {}
            for path, findings in incomplete:
                key = findings[0]  # group by first finding
                # Normalize to category
                if "predicted_matched_captured: null" in key or "captured_at: null" in key:
                    key = "GOLDEN CAPTURE NEVER RAN"
                elif "golden_snapshot: missing" in key:
                    key = "GOLDEN SNAPSHOT MISSING"
                elif "predicted_expect" in key:
                    key = "PREDICTED EXPECT MISSING"
                elif "golden_version mismatch" in key:
                    key = "GOLDEN VERSION STALE"
                else:
                    key = "OTHER"
                by_finding.setdefault(key, []).append(path)

            for category, paths in sorted(by_finding.items()):
                print(f"== {category} ({len(paths)} pilot{'s' if len(paths) > 1 else ''}) ==")
                for p in paths[:5]:
                    print(f"   {p}")
                if len(paths) > 5:
                    print(f"   ... and {len(paths) - 5} more")
                print()

    sys.exit(1 if incomplete else 0)


if __name__ == "__main__":
    main()

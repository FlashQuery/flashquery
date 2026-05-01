#!/usr/bin/env python3
"""
RETIRED: get_doc_outline was removed in Phase 107 (consolidated get_document).

This test covered O-01..O-06 (heading hierarchy, link resolution, max_depth,
exclude_headings, batch outline). Those behaviors are now covered by:

  - test_consolidated_get_document.py    (O-07, O-08, D-27..D-30, D-47..D-50)
  - test_consolidated_get_document_sections.py  (D-31..D-34a)
  - test_consolidated_get_document_errors.py    (D-35, D-31e/f, D-46, O-09, O-10)

O-01..O-06 are marked SUPERSEDED in DIRECTED_COVERAGE.md.

Exit codes:
    0   SKIP    Always exits 0 — test is retired, not failed.
"""
from __future__ import annotations

COVERAGE: list[str] = []  # retired; coverage moved to consolidated tests

import sys


def main() -> None:
    print(
        "SKIP: test_document_outline is retired (Phase 107). "
        "Coverage O-01..O-06 superseded by test_consolidated_get_document* tests.",
        file=sys.stderr,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()

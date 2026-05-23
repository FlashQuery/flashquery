#!/usr/bin/env python3
"""Unit checks for clean_test_tables.py."""

from __future__ import annotations

import unittest

import clean_test_tables


class CleanTestTablesSqlTests(unittest.TestCase):
    def test_build_cleanup_sql_drops_plugin_tables_and_deletes_core_rows(self) -> None:
        sql = clean_test_tables.build_cleanup_sql(
            plugin_tables=[
                "fqcp_example_contacts",
                'fqcp_quote_"_table',
            ],
            core_tables=[
                "fqc_documents",
            ],
        )

        self.assertEqual(sql.count("DO $$"), 1)
        self.assertIn('DROP TABLE IF EXISTS "fqcp_example_contacts" CASCADE', sql)
        self.assertIn('DROP TABLE IF EXISTS "fqcp_quote_""_table" CASCADE', sql)
        self.assertIn('DELETE FROM "fqc_documents"', sql)
        self.assertIn("FQC_CLEANUP_TOTAL=%", sql)
        self.assertIn("FQC_CLEANUP_DROPPED_PLUGIN_TABLES=%", sql)


if __name__ == "__main__":
    unittest.main()

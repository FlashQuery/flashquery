#!/usr/bin/env python3

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fqc_test_utils  # noqa: E402
from fqc_client import ToolResult  # noqa: E402
from fqc_test_utils import TestCleanup  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def call_tool(self, tool: str, **kwargs):
        self.calls.append((tool, kwargs))
        text = "{}"
        if tool == "get_memory":
            text = "[]"
        return ToolResult(
            tool=tool,
            ok=True,
            text=text,
            timing_ms=0,
            arguments=kwargs,
        )


class CleanupMemoryBatchingTests(unittest.TestCase):
    def test_memory_cleanup_dedupes_and_batches_archive_calls(self) -> None:
        old_batch_size = fqc_test_utils.MEMORY_CLEANUP_BATCH_SIZE
        fqc_test_utils.MEMORY_CLEANUP_BATCH_SIZE = 2
        try:
            client = FakeClient()
            cleanup = TestCleanup(vault=None, client=client)  # type: ignore[arg-type]
            for memory_id in ["mem-1", "mem-2", "mem-1", "mem-3"]:
                cleanup.track_mcp_memory(memory_id)

            errors = cleanup.run_cleanup()

            self.assertEqual(errors, [])
            self.assertEqual(
                client.calls,
                [
                    ("archive_memory", {"memory_ids": ["mem-3", "mem-1"]}),
                    ("archive_memory", {"memory_ids": ["mem-2"]}),
                    ("get_memory", {"memory_ids": ["mem-3", "mem-1"]}),
                    ("get_memory", {"memory_ids": ["mem-2"]}),
                ],
            )
        finally:
            fqc_test_utils.MEMORY_CLEANUP_BATCH_SIZE = old_batch_size


if __name__ == "__main__":
    unittest.main()

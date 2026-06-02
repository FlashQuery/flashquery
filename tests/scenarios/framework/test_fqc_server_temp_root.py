#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fqc_test_utils import FQCServer  # noqa: E402


class FQCServerTempRootTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_tmpdir = os.environ.pop("FQC_SCENARIO_TMPDIR", None)

    def tearDown(self) -> None:
        if self._old_tmpdir is not None:
            os.environ["FQC_SCENARIO_TMPDIR"] = self._old_tmpdir
        else:
            os.environ.pop("FQC_SCENARIO_TMPDIR", None)

    def test_managed_vault_defaults_to_repo_local_scenario_temp_root(self) -> None:
        server = FQCServer(instance_id="temp-root-default")
        try:
            expected_root = (Path(server.project_dir) / ".tmp" / "scenario-vaults").resolve()
            self.assertTrue(
                server.vault_path.is_relative_to(expected_root),
                f"{server.vault_path} should be under {expected_root}",
            )
        finally:
            server.stop()

    def test_managed_vault_uses_canonicalized_env_override(self) -> None:
        override_parent = Path(tempfile.mkdtemp(prefix="fqc-scenario-root-"))
        try:
            override = override_parent / "child" / ".." / "vaults"
            os.environ["FQC_SCENARIO_TMPDIR"] = str(override)

            server = FQCServer(instance_id="temp-root-override")
            try:
                expected_root = override.resolve()
                self.assertTrue(
                    server.vault_path.is_relative_to(expected_root),
                    f"{server.vault_path} should be under {expected_root}",
                )
            finally:
                server.stop()
        finally:
            shutil.rmtree(override_parent, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

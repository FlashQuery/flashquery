"""
Git helpers for scenario tests.

Minimal API for asserting that FQC auto-commits on vault changes. Used via
ctx.git when TestContext is constructed with enable_git=True. See
framework/fqc_test_utils.py for the init/config flow that sets up the vault
as a git repo before FQC starts.

This module is intentionally narrow. Scenario tests care about:

    - did a commit happen?
    - did the commit touch the right file?
    - is the working tree clean afterwards?

Everything else (branch introspection, tag handling, remote operations,
rich log formatting) is out of scope for scenario tests. If the debug loop
needs more than this API exposes, run `git -C <vault>` directly rather
than expanding the surface.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Commit:
    sha: str
    message: str


class GitHelper:
    """
    Thin wrapper around `git -C <vault>` exposing the assertion helpers
    scenario tests need to verify FQC's auto-commit behavior.

    A GitHelper is bound to a vault directory. It does not manage or own the
    repo lifecycle — FQCServer.init_git_repo() does that before the server
    starts, and the repo is torn down with the vault at test end.
    """

    def __init__(self, vault_path: str | Path) -> None:
        self.vault_path = Path(vault_path)

    # ─── Internal ───────────────────────────────────────────────────────────

    def _git(self, *args: str) -> subprocess.CompletedProcess:
        """Run `git -C <vault> <args>`, raising on non-zero exit."""
        return subprocess.run(
            ["git", "-C", str(self.vault_path), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    # ─── Queries ────────────────────────────────────────────────────────────

    def head_sha(self) -> str:
        """Return the current HEAD commit SHA as a 40-char hex string."""
        return self._git("rev-parse", "HEAD").stdout.strip()

    def commits_since(self, ref: str) -> list[Commit]:
        """
        Return commits added after *ref* in the current branch, oldest first.

        The canonical scenario-test pattern:
            before = ctx.git.head_sha()
            ctx.client.call_tool(...)
            new_commits = ctx.git.commits_since(before)
            assert len(new_commits) == 1
        """
        # Tab separator is safe because commit subjects don't normally contain tabs.
        result = self._git(
            "log",
            "--reverse",
            "--pretty=format:%H%x09%s",
            f"{ref}..HEAD",
        )
        commits: list[Commit] = []
        for line in result.stdout.splitlines():
            if not line:
                continue
            sha, _, message = line.partition("\t")
            commits.append(Commit(sha=sha, message=message))
        return commits

    def commit_touches(self, sha: str, path: str) -> bool:
        """
        Return True if the commit *sha* modified *path* (vault-relative).

        Uses `git show --name-only` so the check is a direct "was this file
        in the commit's file list" lookup. Handles adds, modifies, deletes,
        and renames (the rename target is what appears in --name-only).
        """
        result = self._git("show", "--name-only", "--pretty=format:", sha)
        touched = {line.strip() for line in result.stdout.splitlines() if line.strip()}
        return path in touched

    def is_clean(self) -> bool:
        """
        True if the working tree has nothing staged or unstaged.

        A clean tree after a tool call is evidence that FQC committed every
        change it made rather than leaving partial state behind. A dirty
        tree is the kind of bug auto-commit tests exist to catch.
        """
        result = self._git("status", "--porcelain")
        return result.stdout.strip() == ""

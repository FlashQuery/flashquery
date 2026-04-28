"""
FlashQuery Test Utilities
================================
Shared helpers for writing isolated, self-cleaning FQC test scripts.

Key components:
    FQCServer      Optional managed FQC subprocess. Starts a dedicated instance
                   with its own vault, port, and instance ID. Captures all server
                   logs for inclusion in test output.

    TestContext     Context manager that bundles FQCClient + VaultHelper + TestCleanup.
                   Guarantees cleanup runs even if the test fails or exits early.
                   Optionally spins up a managed FQCServer.

    TestCleanup    Tracks resources created during a test and tears them down.
                   Handles both filesystem (vault files) and database (MCP archive).

    TestRun        Collects step results and produces structured output, including
                   captured server logs when a managed server is used.

Usage (connect to existing FQC):
    with TestContext(fqc_dir="/path/to/flashquery-core") as ctx:
        run = TestRun("my_test")
        ctx.create_file("_test/doc.md", title="Test", tags=["test"])
        result = ctx.client.call_tool("search_documents", query="Test")
        # cleanup is automatic

Usage (managed server — test spins up its own FQC):
    with TestContext(managed=True, fqc_dir="/path/to/flashquery-core") as ctx:
        run = TestRun("my_test")
        ctx.create_file("_test/doc.md", title="Test", tags=["test"])
        result = ctx.client.call_tool("search_documents", query="Test")
        # server logs available via ctx.server.captured_logs
        run.attach_server_logs(ctx.server.captured_logs)
        # server shutdown + cleanup is automatic

Design principles:
    - Every test is self-contained: no leftover files, no leftover DB records.
    - Tests are order-independent: no test assumes state from a prior test.
    - Tests are re-runnable: stale leftovers from a crashed prior run are
      cleaned before the test starts (pre-clean phase).
    - Cleanup failures are logged but never mask the real test result.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fqc_client import FQCClient, ToolResult, _find_project_dir, _load_env_file

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore[assignment]

from fqc_vault import VaultHelper


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deep_merge(base: dict, overlay: dict) -> dict:
    """Recursively merge overlay into a copy of base.

    Behavior:
      - dict values are recursively merged
      - list values in overlay REPLACE the base value
      - scalar values in overlay REPLACE the base value
      - keys present only in base are preserved
    """
    result = dict(base)
    for key, val in overlay.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


# ---------------------------------------------------------------------------
# FQCServer — managed subprocess with log capture
# ---------------------------------------------------------------------------

DEFAULT_PORT_RANGE = (9100, 9199)


def _find_free_port(port_range: tuple[int, int] = DEFAULT_PORT_RANGE) -> int:
    """Find an available TCP port on localhost within the given range (inclusive).

    Tries each port in the range in random order. Raises RuntimeError if
    every port in the range is already in use.

    Args:
        port_range: (min_port, max_port) inclusive. Default: 9100–9199.
    """
    import random
    lo, hi = port_range
    candidates = list(range(lo, hi + 1))
    random.shuffle(candidates)

    for port in candidates:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue

    raise RuntimeError(f"No free port found in range {lo}–{hi}")


class FQCServer:
    """
    Manages a FlashQuery server subprocess for isolated testing.

    Starts a dedicated FQC instance with:
        - A temporary vault directory (or a specified one)
        - A random available port
        - A unique instance ID
        - streamable-http transport
        - Log level set to debug for maximum traceability
        - All server logs captured in memory

    The server process is started on __enter__ and killed on __exit__,
    regardless of how the test exits.
    """

    DEFAULT_READY_TIMEOUT = 15  # seconds
    DEFAULT_SHUTDOWN_TIMEOUT = 35  # 30s FQC grace + 5s buffer

    def __init__(
        self,
        fqc_dir: str | Path | None = None,
        vault_path: str | Path | None = None,
        auth_secret: str | None = None,
        port: int | None = None,
        port_range: tuple[int, int] | None = None,
        instance_id: str | None = None,
        log_level: str = "debug",
        ready_timeout: int | None = None,
        require_embedding: bool = False,
        enable_locking: bool = False,
        enable_git: bool = False,
        extra_config: dict | None = None,
    ) -> None:
        # Resolve the flashquery-core project directory
        dir_hint = fqc_dir or os.environ.get("FQC_DIR")
        self.project_dir = Path(dir_hint) if dir_hint else _find_project_dir()
        if not self.project_dir or not self.project_dir.is_dir():
            raise ValueError(
                "Cannot find flashquery-core directory. "
                "Provide fqc_dir or set FQC_DIR."
            )

        effective_range = port_range or DEFAULT_PORT_RANGE
        self.port = port or _find_free_port(effective_range)
        self.auth_secret = auth_secret or f"test-secret-{uuid4().hex[:12]}"
        self.instance_id = instance_id or f"test-{uuid4().hex[:8]}"
        self.log_level = log_level
        self.ready_timeout = ready_timeout or self.DEFAULT_READY_TIMEOUT
        self.require_embedding = require_embedding
        self.enable_locking = enable_locking
        self.enable_git = enable_git
        self.extra_config = extra_config or {}

        # Vault: use provided path or create a temp directory
        self._owns_vault = vault_path is None
        if vault_path:
            self.vault_path = Path(vault_path).resolve()
            self.vault_path.mkdir(parents=True, exist_ok=True)
        else:
            self._vault_tmpdir = tempfile.mkdtemp(prefix=f"fqc-vault-{self.instance_id}-")
            self.vault_path = Path(self._vault_tmpdir)

        self.base_url = f"http://127.0.0.1:{self.port}"

        # Process and log state
        self._process: subprocess.Popen | None = None
        self._config_path: str | None = None
        self._log_thread: threading.Thread | None = None
        self._logs: list[str] = []
        self._log_lock = threading.Lock()

    # -- Properties --------------------------------------------------------

    @property
    def captured_logs(self) -> list[str]:
        """Return a copy of all captured server log lines."""
        with self._log_lock:
            return list(self._logs)

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    # -- Config generation -------------------------------------------------

    def _generate_config(self) -> str:
        """Generate a temporary flashquery.yml for this test instance."""
        if yaml is None:
            raise RuntimeError("pyyaml is required for managed server: pip install pyyaml")

        # Load Supabase credentials from the project's .env.test
        env = _load_env_file(self.project_dir)

        config = {
            "instance": {
                "name": f"Test FQC ({self.instance_id})",
                "id": self.instance_id,
                "vault": {
                    "path": str(self.vault_path),
                    "markdown_extensions": [".md"],
                },
            },
            "server": {
                "host": "127.0.0.1",
                "port": self.port,
                "url": self.base_url,
            },
            "supabase": {
                "url": env.get("SUPABASE_URL", os.environ.get("SUPABASE_URL", "")),
                "service_role_key": env.get("SUPABASE_SERVICE_ROLE_KEY",
                                            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")),
                "database_url": env.get("DATABASE_URL", os.environ.get("DATABASE_URL", "")),
            },
            "git": {
                "auto_commit": self.enable_git,
                "auto_push": False,
            },
            "mcp": {
                "transport": "streamable-http",
                "port": self.port,
                "auth_secret": self.auth_secret,
            },
            "embedding": self._resolve_embedding_config(env),
            "locking": {
                "enabled": self.enable_locking,
            },
            "logging": {
                "level": self.log_level,
                "output": "stdout",
            },
        }

        # Deep-merge any caller-supplied extra_config (e.g., directed scenarios that
        # need to inject an `llm:` block). Top-level keys in extra_config are merged
        # at the root; nested dict keys are recursively merged; list values are
        # replaced (not appended).
        if self.extra_config:
            config = _deep_merge(config, self.extra_config)

        fd, path = tempfile.mkstemp(prefix="fqc-test-config-", suffix=".yml")
        with os.fdopen(fd, "w") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)
        self._config_path = path
        return path

    # -- Embedding config --------------------------------------------------

    def _resolve_embedding_config(self, env: dict[str, str]) -> dict:
        """Return the embedding config block for the generated flashquery.yml.

        If require_embedding=False (the default), embedding is disabled so tests
        run fast and without network or API key requirements.

        If require_embedding=True, credentials are read from the env files
        (.env.test takes priority over .env, matching _load_env_file order).
        Raises RuntimeError if no API key is found — the test cannot run
        meaningfully without embeddings, so a loud failure is correct.
        """
        if not self.require_embedding:
            return {
                "provider": "none",
                "model": "",
                "api_key": "",
                "dimensions": 1536,
            }

        provider = env.get("EMBEDDING_PROVIDER", "openai")
        # EMBEDDING_API_KEY is the canonical name in .env;
        # OPENAI_API_KEY is the shorter form used in .env.test.example.
        api_key = env.get("EMBEDDING_API_KEY") or env.get("OPENAI_API_KEY", "")
        model = env.get("EMBEDDING_MODEL", "text-embedding-3-small")

        if not api_key:
            raise RuntimeError(
                "FQCServer started with require_embedding=True but no API key was found "
                "in .env.test or .env. Set EMBEDDING_API_KEY (or OPENAI_API_KEY for "
                "OpenAI) in .env.test and try again."
            )

        return {
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "dimensions": 1536,
        }

    # -- Lifecycle ---------------------------------------------------------

    def init_git_repo(self) -> None:
        """
        Initialize the test vault as a git repo when enable_git is True.

        Runs before FQC starts, so the server comes up with a repo already
        in place at the vault path. The identity is set on the repo itself
        (not global) so commits don't depend on the developer's git config
        and don't pollute it. The initial commit on .gitkeep gives the repo
        a HEAD, which makes commits_since() usable from the first tool call.

        No-op when enable_git is False — tests that don't care about git
        get a plain temp directory as before.
        """
        if not self.enable_git:
            return

        def _run(*args: str) -> None:
            subprocess.run(
                ["git", "-C", str(self.vault_path), *args],
                check=True,
                capture_output=True,
                text=True,
            )

        _run("init", "--initial-branch=main")
        _run("config", "user.name", "FQC Test")
        _run("config", "user.email", "test@flashquery.local")

        gitkeep = self.vault_path / ".gitkeep"
        gitkeep.touch()
        _run("add", ".gitkeep")
        _run("commit", "-m", "Initial test vault commit")

    def start(self) -> None:
        """Start the FQC server subprocess and wait for it to be ready."""
        self.init_git_repo()
        config_path = self._generate_config()
        dist_entry = self.project_dir / "dist" / "index.js"

        if not dist_entry.is_file():
            raise FileNotFoundError(
                f"dist/index.js not found at {dist_entry}. "
                f"Run 'npm run build' in {self.project_dir} first."
            )

        cmd = [
            "node", str(dist_entry),
            "start",
            "--config", config_path,
            "--transport", "http",
        ]

        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout so the pipe is always drained
            text=True,
            cwd=str(self.project_dir),
        )

        # Capture combined stdout+stderr — merging prevents the stderr pipe buffer
        # from filling up and blocking the FQC process during startup.
        self._log_thread = threading.Thread(
            target=self._capture_output,
            daemon=True,
        )
        self._log_thread.start()

        # Poll /mcp/info until ready
        self._wait_for_ready()

    def _capture_output(self) -> None:
        """Background thread: read both stdout and stderr from the server."""
        proc = self._process
        if not proc:
            return

        # Read stdout (where FQC logs go when output=stdout)
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                stripped = line.rstrip("\n")
                with self._log_lock:
                    self._logs.append(stripped)

    def _wait_for_ready(self) -> None:
        """Poll /mcp/info until the server responds with 200."""
        deadline = time.monotonic() + self.ready_timeout
        last_err = ""

        while time.monotonic() < deadline:
            # Check if process died
            if self._process and self._process.poll() is not None:
                rc = self._process.returncode
                logs = "\n".join(self.captured_logs[-20:])
                raise RuntimeError(
                    f"FQC server exited during startup (code {rc}). "
                    f"Last logs:\n{logs}"
                )
            try:
                resp = requests.get(f"{self.base_url}/mcp/info", timeout=1)
                if resp.status_code == 200:
                    return  # Server is ready
            except requests.ConnectionError as e:
                last_err = str(e)
            except Exception as e:
                last_err = str(e)

            time.sleep(0.5)

        logs = "\n".join(self.captured_logs[-20:])
        raise TimeoutError(
            f"FQC server not ready after {self.ready_timeout}s at {self.base_url}. "
            f"Last error: {last_err}\n"
            f"Last logs:\n{logs}"
        )

    def stop(self) -> None:
        """Gracefully stop the server. Falls back to SIGKILL after timeout."""
        if not self._process:
            return

        if self._process.poll() is None:
            # Send SIGTERM for graceful shutdown
            self._process.send_signal(signal.SIGTERM)
            try:
                self._process.wait(timeout=self.DEFAULT_SHUTDOWN_TIMEOUT)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)

        # Wait for log thread to finish
        if self._log_thread and self._log_thread.is_alive():
            self._log_thread.join(timeout=3)

        # Cleanup temp config file
        if self._config_path and os.path.isfile(self._config_path):
            os.unlink(self._config_path)

        # Cleanup temp vault if we created it
        if self._owns_vault and self.vault_path.is_dir():
            import shutil
            shutil.rmtree(self.vault_path, ignore_errors=True)

    def __enter__(self) -> "FQCServer":
        self.start()
        return self

    def __exit__(self, *_: Any) -> bool:
        self.stop()
        return False

    # -- Log filtering (for debugging) ------------------------------------

    def logs_for_request(self, substring: str) -> list[str]:
        """Return log lines containing a substring (e.g., a tool name or REQ: id)."""
        with self._log_lock:
            return [l for l in self._logs if substring in l]

    def logs_since(self, marker: int) -> list[str]:
        """Return log lines captured after position `marker` (len of logs at that point)."""
        with self._log_lock:
            return self._logs[marker:]

    @property
    def log_position(self) -> int:
        """Current log position — use as a marker before a test step."""
        with self._log_lock:
            return len(self._logs)


# ---------------------------------------------------------------------------
# TestCleanup — resource tracker with guaranteed teardown
# ---------------------------------------------------------------------------

class TestCleanup:
    """
    Tracks resources created during a test and cleans them all up.

    Resources are torn down in reverse order (LIFO) so dependent resources
    are removed before the things they depend on.

    Cleanup errors are collected but never raised — they're returned so the
    test can report them without masking the real test result.
    """

    def __init__(self, vault: VaultHelper, client: FQCClient) -> None:
        self.vault = vault
        self.client = client
        self._vault_files: list[str] = []           # vault-relative paths
        self._vault_dirs: list[str] = []             # vault-relative directories
        self._mcp_identifiers: list[str] = []        # paths or fqc_ids for archive_document
        self._memory_ids: list[str] = []             # memory UUIDs for archive_memory
        self._plugin_registrations: list[tuple[str, str]] = []  # (plugin_id, plugin_instance)
        self._errors: list[str] = []

    # -- Registration methods (call these as you create resources) ----------

    def track_file(self, relative_path: str, mcp_identifier: str | None = None) -> None:
        """Register a vault file for cleanup. Optionally also track the MCP identifier."""
        self._vault_files.append(relative_path)
        if mcp_identifier:
            self._mcp_identifiers.append(mcp_identifier)

    def track_dir(self, relative_path: str) -> None:
        """Register a vault directory for cleanup (removed after files)."""
        if relative_path not in self._vault_dirs:
            self._vault_dirs.append(relative_path)

    def track_mcp_document(self, identifier: str) -> None:
        """Register an MCP document identifier (path or fqc_id) for archival."""
        self._mcp_identifiers.append(identifier)

    def track_mcp_memory(self, memory_id: str) -> None:
        """Register a memory UUID for archival on cleanup."""
        self._memory_ids.append(memory_id)

    def track_plugin_registration(self, plugin_id: str, plugin_instance: str) -> None:
        """Register a plugin registration for unregister+destroy on cleanup."""
        self._plugin_registrations.append((plugin_id, plugin_instance))

    # -- Teardown -----------------------------------------------------------

    def run_cleanup(self) -> list[str]:
        """
        Execute all cleanup actions. Returns a list of error messages (empty = clean).

        Order:
            1. Unregister plugins (reverse order — plugins own tables that must go first)
            2. Archive memories via MCP (database cleanup)
            3. Archive documents via MCP (database cleanup)
            4. Delete vault files (filesystem cleanup)
            5. Remove empty vault directories
        """
        self._errors = []

        # 1. Unregister plugins (reverse registration order)
        for plugin_id, plugin_instance in reversed(self._plugin_registrations):
            try:
                result = self.client.call_tool(
                    "unregister_plugin",
                    plugin_id=plugin_id,
                    plugin_instance=plugin_instance,
                    confirm_destroy=True,
                )
                if not result.ok:
                    # "is not registered" means the test already unregistered inline — not an error
                    if "is not registered" in (result.error or ""):
                        pass
                    else:
                        self._errors.append(
                            f"Plugin unregister failed for '{plugin_id}/{plugin_instance}': {result.error}"
                        )
            except Exception as e:
                self._errors.append(
                    f"Plugin unregister exception for '{plugin_id}/{plugin_instance}': {e}"
                )

        # 2. Archive memories (database side)
        for memory_id in reversed(self._memory_ids):
            try:
                result = self.client.call_tool("archive_memory", memory_id=memory_id)
                if not result.ok:
                    # "Cannot coerce..." is FQC's response when the memory is already archived — not an error
                    if "Cannot coerce" in (result.error or "") or "not found" in (result.error or "").lower():
                        pass
                    else:
                        self._errors.append(f"Memory archive failed for '{memory_id}': {result.error}")
            except Exception as e:
                self._errors.append(f"Memory archive exception for '{memory_id}': {e}")

        # 3. Archive MCP documents (database side)
        if self._mcp_identifiers:
            unique_ids = list(dict.fromkeys(reversed(self._mcp_identifiers)))
            for identifier in unique_ids:
                try:
                    result = self.client.call_tool("archive_document", identifiers=identifier)
                    if not result.ok:
                        self._errors.append(f"MCP archive failed for '{identifier}': {result.error}")
                except Exception as e:
                    self._errors.append(f"MCP archive exception for '{identifier}': {e}")

        # 4. Delete vault files (filesystem side, reverse order)
        for path in reversed(self._vault_files):
            try:
                self.vault.delete_file(path)
            except Exception as e:
                self._errors.append(f"Vault delete failed for '{path}': {e}")

        # 5. Remove empty directories (deepest first)
        sorted_dirs = sorted(self._vault_dirs, key=lambda d: d.count("/"), reverse=True)
        for d in sorted_dirs:
            try:
                abs_dir = self.vault.vault_root / d
                if abs_dir.is_dir():
                    abs_dir.rmdir()
            except OSError:
                pass  # directory not empty, that's fine
            except Exception as e:
                self._errors.append(f"Dir cleanup failed for '{d}': {e}")

        return self._errors


# ---------------------------------------------------------------------------
# TestContext — bundles client + vault + cleanup with guaranteed teardown
# ---------------------------------------------------------------------------

class TestContext:
    """
    Context manager that provides FQCClient, VaultHelper, and TestCleanup.

    Modes:
        managed=False (default):
            Connects to an already-running FQC instance. Configuration is
            discovered from flashquery.yml or overridden with url/secret.

        managed=True:
            Starts a dedicated FQC subprocess with its own port, vault,
            and instance ID. The server is stopped on exit. Server logs
            are captured for debugging.

    Usage:
        with TestContext(managed=True, fqc_dir="/path/to/fqc") as ctx:
            ctx.create_file("_test/doc.md", title="Test", tags=["test"])
            result = ctx.client.call_tool("search_documents", query="Test")
            # ctx.server is available for log inspection
    """

    def __init__(
        self,
        test_prefix: str = "_test",
        fqc_dir: str | None = None,
        url: str | None = None,
        secret: str | None = None,
        vault_path: str | None = None,
        managed: bool = False,
        port_range: tuple[int, int] | None = None,
        log_level: str = "debug",
        ready_timeout: int | None = None,
        require_embedding: bool = False,
        enable_locking: bool = False,
        enable_git: bool = False,
        extra_config: dict | None = None,
    ) -> None:
        self.test_prefix = test_prefix
        self._fqc_dir = fqc_dir
        self._port_range = port_range
        self._url = url
        self._secret = secret
        self._vault_path = vault_path
        self._managed = managed
        self._log_level = log_level
        self._ready_timeout = ready_timeout
        self._require_embedding = require_embedding
        self._enable_locking = enable_locking
        self._enable_git = enable_git
        self.extra_config = extra_config

        # Initialized in __enter__
        self.client: FQCClient = None  # type: ignore
        self.vault: VaultHelper = None  # type: ignore
        self.cleanup: TestCleanup = None  # type: ignore
        self.server: FQCServer | None = None
        self.git: "GitHelper | None" = None
        self.cleanup_errors: list[str] = []

    def __enter__(self) -> "TestContext":
        if self._managed:
            # Start a dedicated FQC server
            self.server = FQCServer(
                fqc_dir=self._fqc_dir,
                vault_path=self._vault_path,
                port=None,  # auto-assign from range
                port_range=self._port_range,
                log_level=self._log_level,
                ready_timeout=self._ready_timeout,
                require_embedding=self._require_embedding,
                enable_locking=self._enable_locking,
                enable_git=self._enable_git,
                extra_config=self.extra_config,
            )
            self.server.start()

            # Wire client and vault to the managed server
            self.client = FQCClient(
                base_url=self.server.base_url,
                auth_secret=self.server.auth_secret,
            )
            self.vault = VaultHelper(vault_path=self.server.vault_path)

        else:
            # Connect to existing server
            self.client = FQCClient(
                base_url=self._url,
                auth_secret=self._secret,
                fqc_dir=self._fqc_dir,
            )
            self.vault = VaultHelper(
                vault_path=self._vault_path,
                fqc_dir=self._fqc_dir,
            )

        # Expose GitHelper for tests that opted in with enable_git=True.
        # Works with both managed servers (own instance) and external servers
        # (shared instance with vault_path provided by test runner).
        # For tests without enable_git, this stays None and any access surfaces
        # as an AttributeError-style failure (intentional).
        if self._enable_git:
            vault_for_git = self.server.vault_path if self.server else self._vault_path
            if vault_for_git:
                from fqc_git import GitHelper  # local import to keep the framework lean

                self.git = GitHelper(vault_path=vault_for_git)

        self.cleanup = TestCleanup(self.vault, self.client)
        self._pre_clean()
        return self

    def __exit__(self, *exc_info: Any) -> bool:
        # 1. Run test resource cleanup (archive + delete files)
        self.cleanup_errors = self.cleanup.run_cleanup()

        # 2. Close the MCP session
        try:
            self.client.close()
        except Exception:
            pass

        # 3. Try to remove the test prefix directory if empty
        try:
            test_dir = self.vault.vault_root / self.test_prefix
            if test_dir.is_dir():
                test_dir.rmdir()
        except OSError:
            pass

        # 4. Stop the managed server (if any). This also cleans up its
        #    temp vault and config file.
        if self.server:
            self.server.stop()

        return False  # do not suppress exceptions

    def _pre_clean(self) -> None:
        """Remove any stale files under the test prefix directory from prior runs."""
        stale = self.vault.list_files(directory=self.test_prefix)
        for path in stale:
            try:
                self.vault.delete_file(path)
            except Exception:
                pass

    # -- Convenience methods (create + auto-register for cleanup) -----------

    def create_file(
        self,
        relative_path: str,
        title: str,
        body: str = "",
        tags: list[str] | None = None,
        status: str = "active",
        fqc_id: str | None = None,
        extra_frontmatter: dict[str, Any] | None = None,
    ) -> str:
        """Create a vault file AND register it for cleanup."""
        self.vault.create_file(
            relative_path,
            title=title,
            body=body,
            tags=tags,
            status=status,
            fqc_id=fqc_id,
            extra_frontmatter=extra_frontmatter,
        )
        self.cleanup.track_file(relative_path, mcp_identifier=relative_path)
        parts = Path(relative_path).parts
        for i in range(1, len(parts)):
            self.cleanup.track_dir(str(Path(*parts[:i])))
        return relative_path

    def scan_vault(self) -> ToolResult:
        """Call force_file_scan (sync) — a common step after creating files."""
        return self.client.call_tool("force_file_scan", background=False)


# ---------------------------------------------------------------------------
# TestRun — step recorder with structured output
# ---------------------------------------------------------------------------

class TestRun:
    """Collects step results and produces structured output for a single test."""

    def __init__(self, name: str, run_id: str | None = None) -> None:
        self.name = name
        self.run_id = run_id or uuid4().hex[:8]
        self.steps: list[dict] = []
        self.cleanup_errors: list[str] = []
        self.server_logs: list[str] | None = None
        self.t0 = time.monotonic()

    def step(
        self,
        label: str,
        passed: bool,
        detail: str = "",
        timing_ms: int = 0,
        tool_result: ToolResult | None = None,
        server_logs: list[str] | None = None,
    ) -> None:
        """Record the outcome of a test step."""
        entry: dict = {
            "step": len(self.steps) + 1,
            "label": label,
            "passed": passed,
            "timing_ms": timing_ms,
        }
        if detail:
            entry["detail"] = detail
        if tool_result:
            entry["tool_result"] = tool_result.to_dict()
        if server_logs:
            entry["server_logs"] = server_logs
        self.steps.append(entry)

    def record_cleanup(self, errors: list[str]) -> None:
        """Attach cleanup errors to the run (called after TestContext exits)."""
        self.cleanup_errors = errors

    def attach_server_logs(self, logs: list[str]) -> None:
        """Attach the full server log capture to the run output."""
        self.server_logs = logs

    # -- Status / exit code ------------------------------------------------

    @property
    def all_passed(self) -> bool:
        return all(s["passed"] for s in self.steps) and not self.cleanup_errors

    @property
    def status(self) -> str:
        if not self.steps:
            return "EMPTY"
        if any(not s["passed"] for s in self.steps):
            return "FAIL"
        if self.cleanup_errors:
            return "DIRTY"
        return "PASS"

    @property
    def exit_code(self) -> int:
        s = self.status
        if s == "PASS":
            return 0
        if s == "DIRTY":
            return 3
        return 2

    @property
    def total_ms(self) -> int:
        return int((time.monotonic() - self.t0) * 1000)

    # -- Serialization -----------------------------------------------------

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "test": self.name,
            "run_id": self.run_id,
            "status": self.status,
            "exit_code": self.exit_code,
            "total_ms": self.total_ms,
            "steps": self.steps,
        }
        if self.cleanup_errors:
            d["cleanup_errors"] = self.cleanup_errors
        if self.server_logs is not None:
            d["server_logs"] = self.server_logs
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    def summary_lines(self) -> list[str]:
        lines: list[str] = []
        for s in self.steps:
            icon = "PASS" if s["passed"] else "FAIL"
            line = f"  [{icon}] Step {s['step']}: {s['label']}"
            if s.get("timing_ms"):
                line += f" ({s['timing_ms']}ms)"
            lines.append(line)

            if not s["passed"]:
                tr = s.get("tool_result")
                detail = s.get("detail", "")
                err = ""
                if tr and tr.get("response", {}).get("is_error"):
                    err = tr.get("response", {}).get("error_detail", "")

                # Show the error detail, but avoid printing the same text twice
                # when detail and tool error carry the same message
                if detail:
                    for detail_line in detail.split("\n"):
                        lines.append(f"         {detail_line}")
                if err and err != detail:
                    for err_line in err.split("\n"):
                        lines.append(f"         {err_line}")

                # Show the tool's response text (truncated) so we can see what came back
                if tr:
                    resp_text = tr.get("response", {}).get("text", "")
                    if resp_text:
                        preview = resp_text[:300]
                        if len(resp_text) > 300:
                            preview += f"... ({len(resp_text)} chars total)"
                        lines.append(f"         Response: {preview}")

                # Show connection context so it's obvious which server was hit
                if tr:
                    cfg = tr.get("config", {})
                    url = cfg.get("server_url", "")
                    src = cfg.get("config_source", "")
                    if url:
                        ctx_line = f"         Server: {url}"
                        if src:
                            ctx_line += f"  (from {src})"
                        lines.append(ctx_line)

                # Show per-step server logs for quick debugging
                if s.get("server_logs"):
                    lines.append("         Server logs:")
                    for sl in s["server_logs"][-15:]:  # last 15 lines
                        lines.append(f"           {sl}")

        if self.cleanup_errors:
            lines.append("")
            lines.append("  Cleanup warnings:")
            for err in self.cleanup_errors:
                lines.append(f"    - {err}")

        passed = sum(1 for s in self.steps if s["passed"])
        lines.append("")
        lines.append(f"[{self.status}] {self.name} — {passed}/{len(self.steps)} steps ({self.total_ms}ms)")
        return lines


# ---------------------------------------------------------------------------
# Expectation helper (shared across tests)
# ---------------------------------------------------------------------------

def expectation_detail(result: ToolResult) -> str:
    """Build a human-readable detail string from failed expectations on a ToolResult."""
    failed = [e for e in result.expectations if not e["passed"]]
    if not failed:
        return ""
    parts = []
    for e in failed:
        if "actual" in e:
            parts.append(f"{e['label']} (actual: {e['actual']})")
        else:
            parts.append(e["label"])
    return "Failed: " + "; ".join(parts)

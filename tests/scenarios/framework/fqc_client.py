"""
FlashQuery MCP Client
===========================
Reusable Python client for calling FlashQuery MCP tools over HTTP.

Prerequisites:
    pip install requests pyyaml python-dotenv

Configuration resolution (highest priority wins):
    1. Explicit arguments to FQCClient(base_url=..., auth_secret=...)
    2. Environment variables FQC_URL / FQC_AUTH_SECRET
    3. Auto-discovered from flashquery.yml + .env files in the FQC project directory

Auto-discovery:
    The client looks for flashquery.yml (then flashquery.test.yml) starting from
    the --fqc-dir path, or the FQC_DIR env var, or by walking up from this script's
    location until it finds a directory containing one of those files.

    If the YAML contains ${VAR} references, the client loads .env / .env.test from
    the same directory to resolve them.

Usage:
    from fqc_client import FQCClient

    client = FQCClient()
    result = client.call_tool("search_documents", query="authentication")

    print(result.ok)           # True/False
    print(result.text)         # response text
    print(result.timing_ms)    # round-trip time
    print(result.to_dict())    # full structured output for JSON serialization
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Optional imports — degrade gracefully if not installed
# ---------------------------------------------------------------------------
try:
    import yaml  # pyyaml
except ImportError:
    yaml = None  # type: ignore[assignment]

try:
    import dotenv  # python-dotenv
except ImportError:
    dotenv = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Config discovery helpers
# ---------------------------------------------------------------------------

_YAML_NAMES = ("flashquery.yml", "flashquery.test.yml")
_ENV_NAMES = (".env.test",)

_ENV_VAR_RE = re.compile(r"\$\{([^}]+)\}")


def _find_project_dir(start: Path | None = None) -> Path | None:
    """Walk upward from *start* looking for a directory that contains a flashquery YAML."""
    cur = (start or Path(__file__).resolve().parent).resolve()
    for _ in range(10):  # safety cap
        for name in _YAML_NAMES:
            if (cur / name).is_file():
                return cur
        parent = cur.parent
        if parent == cur:
            break
        cur = parent
    return None


def _load_env_file(directory: Path) -> dict[str, str]:
    """Load key=value pairs from .env or .env.test in *directory*."""
    env: dict[str, str] = {}
    for name in _ENV_NAMES:
        path = directory / name
        if path.is_file():
            if dotenv is not None:
                env.update(dotenv.dotenv_values(str(path)))
            else:
                # Minimal parser when python-dotenv isn't installed
                for line in path.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _expand_vars(value: str, env: dict[str, str]) -> str:
    """Replace ${VAR} placeholders using *env* dict, then os.environ as fallback."""
    def _replace(m: re.Match) -> str:
        key = m.group(1)
        return env.get(key, os.environ.get(key, m.group(0)))
    return _ENV_VAR_RE.sub(_replace, value)


def _load_yaml_config(directory: Path) -> dict:
    """Load and return the first flashquery YAML found in *directory*."""
    if yaml is None:
        print(
            "Warning: pyyaml is not installed — cannot read flashquery.yml. "
            "Install it with: pip install pyyaml",
            file=sys.stderr,
        )
        return {}

    # Load env vars for ${VAR} expansion
    env = _load_env_file(directory)

    for name in _YAML_NAMES:
        path = directory / name
        if path.is_file():
            raw = path.read_text()
            expanded = _expand_vars(raw, env)
            cfg = yaml.safe_load(expanded) or {}
            cfg["_source_file"] = str(path)
            return cfg

    return {}


def discover_config(
    fqc_dir: str | Path | None = None,
) -> tuple[str, str, str | None]:
    """
    Auto-discover FQC server URL and auth secret.

    Resolution order (first non-empty value wins):
        1. FQC_URL / FQC_AUTH_SECRET environment variables
        2. flashquery.yml → server.url (or server.host + mcp.port) and mcp.auth_secret

    Returns:
        (base_url, auth_secret, config_source_file_or_None)
    """
    # Determine the project directory
    dir_hint = fqc_dir or os.environ.get("FQC_DIR")
    project_dir = Path(dir_hint) if dir_hint else _find_project_dir()

    cfg: dict = {}
    if project_dir and project_dir.is_dir():
        cfg = _load_yaml_config(project_dir)

    # --- URL ---
    mcp_cfg = cfg.get("mcp", {}) or {}
    server_cfg = cfg.get("server", {}) or {}

    env_url = os.environ.get("FQC_URL", "")
    if env_url:
        base_url = env_url
    elif server_cfg.get("url"):
        base_url = str(server_cfg["url"])
    else:
        host = server_cfg.get("host", "localhost")
        port = mcp_cfg.get("port", server_cfg.get("port", 3100))
        base_url = f"http://{host}:{port}"

    # --- Auth secret ---
    env_secret = os.environ.get("FQC_AUTH_SECRET", "")
    if env_secret:
        auth_secret = env_secret
    else:
        auth_secret = str(mcp_cfg.get("auth_secret", ""))

    source = cfg.get("_source_file")
    return base_url, auth_secret, source


def config_summary(fqc_dir: str | Path | None = None) -> dict:
    """
    Return a structured summary of the discovered configuration.

    Useful for printing a diagnostic banner at the start of a test run so
    failures can be traced back to misconfiguration quickly.

    Keys returned:
      project_dir        — resolved flashquery-core directory (str or "(not found)")
      config_file        — absolute path to flashquery.yml used (or None)
      env_files          — list of absolute paths for .env / .env.test that exist
      supabase_url       — SUPABASE_URL from env (or None)
      database_url       — DATABASE_URL from env (or None)
      vault_path         — instance.vault.path from YAML (or None)
      server_url         — resolved server base URL (from YAML or defaults)
      auth_secret_masked — last-4 of auth_secret, prefixed with "****" (or None)
    """
    dir_hint = fqc_dir or os.environ.get("FQC_DIR")
    project_dir = Path(dir_hint).resolve() if dir_hint else _find_project_dir()

    result: dict = {
        "project_dir": str(project_dir) if project_dir else "(not found)",
        "config_file": None,
        "env_files": [],
        "supabase_url": None,
        "database_url": None,
        "vault_path": None,
        "server_url": None,
        "auth_secret_masked": None,
    }

    if not project_dir or not project_dir.is_dir():
        return result

    for name in _ENV_NAMES:
        p = project_dir / name
        if p.is_file():
            result["env_files"].append(str(p))

    env = _load_env_file(project_dir)
    result["supabase_url"] = (
        env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    )
    result["database_url"] = (
        env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    )

    cfg = _load_yaml_config(project_dir)
    if cfg:
        result["config_file"] = cfg.get("_source_file")
        vault_cfg = ((cfg.get("instance") or {}).get("vault") or {})
        result["vault_path"] = vault_cfg.get("path")
        server_cfg = cfg.get("server") or {}
        mcp_cfg = cfg.get("mcp") or {}
        if server_cfg.get("url"):
            result["server_url"] = str(server_cfg["url"])
        else:
            host = server_cfg.get("host", "localhost")
            port = mcp_cfg.get("port", server_cfg.get("port", 3100))
            result["server_url"] = f"http://{host}:{port}"
        secret = str(mcp_cfg.get("auth_secret", ""))
        if secret:
            result["auth_secret_masked"] = (
                "****" + secret[-4:] if len(secret) > 4 else "****"
            )

    return result


# ---------------------------------------------------------------------------
# ToolResult — structured output from every tool call
# ---------------------------------------------------------------------------

@dataclass
class ToolResult:
    """Structured result from a single MCP tool call.

    Carries everything a calling program needs: the outcome, the raw data,
    what was sent, how long it took, and any expectation results.
    """
    tool: str
    ok: bool                              # True if tool call succeeded (no errors)
    text: str                             # response text (or error message)
    timing_ms: int                        # round-trip time in milliseconds
    arguments: dict[str, Any]             # what was sent to the tool
    raw_response: dict | None = None      # full JSON-RPC response body
    error: str | None = None              # error detail if ok=False
    server_url: str = ""
    config_source: str | None = None
    expectations: list[dict] = field(default_factory=list)

    @property
    def status(self) -> str:
        """Overall status: 'pass', 'fail' (expectation miss), or 'error' (tool/transport)."""
        if not self.ok:
            return "error"
        if self.expectations and any(not e["passed"] for e in self.expectations):
            return "fail"
        return "pass"

    @property
    def exit_code(self) -> int:
        """Suggested process exit code: 0=pass, 1=error, 2=expectation failure."""
        s = self.status
        if s == "pass":
            return 0
        if s == "error":
            return 1
        return 2  # fail

    # -- Expectation helpers (called by scripts after the tool call) --------

    def expect_contains(self, substring: str, label: str | None = None) -> bool:
        """Check that response text contains a substring."""
        passed = substring in self.text
        self.expectations.append({
            "check": "result_contains",
            "value": substring,
            "passed": passed,
            "label": label or f"text contains '{substring}'",
        })
        return passed

    def expect_not_contains(self, substring: str, label: str | None = None) -> bool:
        """Check that response text does NOT contain a substring."""
        passed = substring not in self.text
        self.expectations.append({
            "check": "result_not_contains",
            "value": substring,
            "passed": passed,
            "label": label or f"text does not contain '{substring}'",
        })
        return passed

    def _count_results(self) -> int:
        """Count the number of result entries in the response text.

        FQC formats tool responses as key-value entries separated by '---'.
        Each entry starts with 'Title: ...'. We count entries by counting
        'Title:' lines. If the response is the empty-results message
        ('No documents found.' etc.), this returns 0.
        """
        import re
        # Each result entry begins with a 'Title: ...' line
        return len(re.findall(r"^Title: ", self.text, re.MULTILINE))

    def expect_count_gte(self, n: int, label: str | None = None) -> bool:
        """Check that the response contains at least N result entries."""
        actual = self._count_results()
        passed = actual >= n
        self.expectations.append({
            "check": "count_gte",
            "expected": n,
            "actual": actual,
            "passed": passed,
            "label": label or f"result count >= {n}",
        })
        return passed

    def expect_count_eq(self, n: int, label: str | None = None) -> bool:
        """Check that the response contains exactly N result entries."""
        actual = self._count_results()
        passed = actual == n
        self.expectations.append({
            "check": "count_eq",
            "expected": n,
            "actual": actual,
            "passed": passed,
            "label": label or f"result count == {n}",
        })
        return passed

    # -- Serialization -----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Full structured output suitable for JSON serialization."""
        d: dict[str, Any] = {
            "tool": self.tool,
            "status": self.status,
            "exit_code": self.exit_code,
            "timing_ms": self.timing_ms,
            "request": {
                "arguments": self.arguments,
            },
            "response": {
                "text": self.text,
                "is_error": not self.ok,
            },
            "config": {
                "server_url": self.server_url,
                "config_source": self.config_source,
            },
        }
        if self.error:
            d["response"]["error_detail"] = self.error
        if self.expectations:
            d["expectations"] = self.expectations
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    def summary(self) -> str:
        """One-line human-readable summary."""
        icon = {"pass": "PASS", "fail": "FAIL", "error": "ERROR"}[self.status]
        line = f"[{icon}] {self.tool} ({self.timing_ms}ms)"
        if self.expectations:
            passed = sum(1 for e in self.expectations if e["passed"])
            total = len(self.expectations)
            line += f" — {passed}/{total} expectations met"
        if self.error:
            line += f" — {self.error}"
        return line


# ---------------------------------------------------------------------------
# MCP Client
# ---------------------------------------------------------------------------

class FQCClient:
    """Manages an authenticated MCP session against a FlashQuery HTTP server."""

    def __init__(
        self,
        base_url: str | None = None,
        auth_secret: str | None = None,
        fqc_dir: str | Path | None = None,
    ) -> None:
        # Auto-discover anything not explicitly provided
        discovered_url, discovered_secret, source = discover_config(fqc_dir)

        self.base_url = (base_url or discovered_url).rstrip("/")
        self.auth_secret = auth_secret if auth_secret is not None else discovered_secret
        self.config_source = source
        self.session_id: str | None = None
        self._request_id = 0
        self._http = requests.Session()

        if not self.auth_secret:
            print(
                "Warning: No auth secret found (checked flashquery.yml, "
                "FQC_AUTH_SECRET env var, and --secret flag). "
                "Requests will fail if the server requires authentication.",
                file=sys.stderr,
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.auth_secret:
            headers["Authorization"] = f"Bearer {self.auth_secret}"
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        return headers

    @staticmethod
    def _parse_sse(text: str) -> list[dict]:
        """Extract JSON-RPC messages from an SSE (text/event-stream) body.

        SSE format from the MCP SDK:
            event: message
            id: <optional>
            data: {"jsonrpc":"2.0", ...}
            <blank line>

        Returns a list of parsed JSON objects from all data: lines.
        """
        messages: list[dict] = []
        for line in text.splitlines():
            if line.startswith("data:"):
                data = line[5:].strip()
                if data:  # skip empty data lines (priming events)
                    try:
                        messages.append(json.loads(data))
                    except json.JSONDecodeError:
                        pass  # skip non-JSON data lines
        return messages

    def _post_mcp(self, payload: dict) -> dict:
        """POST a JSON-RPC message to /mcp and return the parsed response.

        Handles both application/json and text/event-stream (SSE) responses.
        The MCP streamable-http transport defaults to SSE for all POST responses,
        so most responses will arrive as SSE even though the exchange is a single
        JSON-RPC request/response pair.
        """
        url = f"{self.base_url}/mcp"
        hdrs = self._headers()
        resp = self._http.post(url, headers=hdrs, json=payload, timeout=30)

        if not resp.ok:
            # Build a diagnostic message that actually helps someone debug
            diag_lines = [
                f"HTTP {resp.status_code} {resp.reason} from POST {url}",
                f"  Request headers:",
            ]
            for k, v in hdrs.items():
                val = f"Bearer ***" if k == "Authorization" else v
                diag_lines.append(f"    {k}: {val}")
            diag_lines.append(f"  Response headers:")
            for k, v in resp.headers.items():
                diag_lines.append(f"    {k}: {v}")
            body_preview = resp.text[:500] if resp.text else "(empty body)"
            diag_lines.append(f"  Response body: {body_preview}")
            raise requests.HTTPError("\n".join(diag_lines), response=resp)

        # Capture session ID from response header if present
        sid = resp.headers.get("mcp-session-id")
        if sid:
            self.session_id = sid

        # Parse response based on content type
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            messages = self._parse_sse(resp.text)
            if not messages:
                raise RuntimeError(
                    f"SSE response contained no JSON-RPC messages.\n"
                    f"  Content-Type: {content_type}\n"
                    f"  Body preview: {resp.text[:500]}"
                )
            # Find the message matching our request ID, or fall back to the last one.
            # Notifications (no id) may precede the actual result in the stream.
            req_id = payload.get("id")
            for msg in reversed(messages):
                if msg.get("id") == req_id:
                    return msg
            return messages[-1]
        else:
            return resp.json()

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    def initialize(self) -> dict:
        """Send the MCP initialize handshake. Must be called before any tool call.

        The MCP protocol requires a two-step init: the client sends 'initialize',
        the server responds with capabilities, then the client sends an 'initialized'
        notification to confirm the session is ready.
        """
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": {"listChanged": False},
                },
                "clientInfo": {
                    "name": "fqc-python-cli",
                    "version": "1.0.0",
                },
            },
        }
        result = self._post_mcp(payload)

        if "error" in result:
            raise RuntimeError(f"Initialize failed: {result['error']}")

        # Send the required 'initialized' notification to complete the handshake.
        # This is a notification (no id), so the server may respond with 202/204.
        notify = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }
        try:
            notify_resp = self._http.post(
                f"{self.base_url}/mcp",
                headers=self._headers(),
                json=notify,
                timeout=10,
            )
            # 200, 202, 204 are all acceptable for a notification
            if not notify_resp.ok:
                print(
                    f"Warning: initialized notification returned {notify_resp.status_code}",
                    file=sys.stderr,
                )
        except Exception:
            pass  # best-effort; some servers don't require it

        return result

    def close(self) -> None:
        """Explicitly close the MCP session (optional but polite)."""
        if self.session_id:
            try:
                self._http.delete(
                    f"{self.base_url}/mcp",
                    headers=self._headers(),
                    timeout=10,
                )
            except Exception:
                pass  # best-effort cleanup
            self.session_id = None

    # ------------------------------------------------------------------
    # Tool invocation
    # ------------------------------------------------------------------

    def call_tool(self, tool_name: str, **arguments: Any) -> ToolResult:
        """
        Call an MCP tool by name, passing keyword arguments as the tool's parameters.

        Automatically initializes the session on first call.

        Returns a ToolResult with structured data about the call.
        """
        # Strip None values so optional params aren't sent
        clean_args = {k: v for k, v in arguments.items() if v is not None}

        # Auto-initialize if we don't have a session yet
        if not self.session_id:
            try:
                self.initialize()
            except Exception as e:
                return ToolResult(
                    tool=tool_name,
                    ok=False,
                    text="",
                    timing_ms=0,
                    arguments=clean_args,
                    error=f"Session init failed: {e}",
                    server_url=self.base_url,
                    config_source=self.config_source,
                )

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": clean_args,
            },
        }

        t0 = time.monotonic()
        try:
            raw = self._post_mcp(payload)
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            return ToolResult(
                tool=tool_name,
                ok=False,
                text="",
                timing_ms=elapsed,
                arguments=clean_args,
                error=f"HTTP request failed: {e}",
                server_url=self.base_url,
                config_source=self.config_source,
            )
        elapsed = int((time.monotonic() - t0) * 1000)

        # Handle JSON-RPC level errors
        if "error" in raw:
            err_msg = raw["error"].get("message", str(raw["error"]))
            return ToolResult(
                tool=tool_name,
                ok=False,
                text="",
                timing_ms=elapsed,
                arguments=clean_args,
                raw_response=raw,
                error=f"JSON-RPC error: {err_msg}",
                server_url=self.base_url,
                config_source=self.config_source,
            )

        tool_result = raw.get("result", {})
        texts = [c.get("text", "") for c in tool_result.get("content", [])]
        text = "\n".join(texts)

        # Handle tool-level errors
        if tool_result.get("isError"):
            return ToolResult(
                tool=tool_name,
                ok=False,
                text=text,
                timing_ms=elapsed,
                arguments=clean_args,
                raw_response=raw,
                error=f"Tool returned error: {text[:200]}",
                server_url=self.base_url,
                config_source=self.config_source,
            )

        return ToolResult(
            tool=tool_name,
            ok=True,
            text=text,
            timing_ms=elapsed,
            arguments=clean_args,
            raw_response=raw,
            server_url=self.base_url,
            config_source=self.config_source,
        )

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "FQCClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


# ------------------------------------------------------------------
# Quick diagnostic when run directly
# ------------------------------------------------------------------

def _cli_info() -> None:
    """Print resolved config and check server health."""
    import argparse

    parser = argparse.ArgumentParser(description="FlashQuery MCP client — config check")
    parser.add_argument("--fqc-dir", type=str, default=None, help="Path to flashquery-core directory")
    args = parser.parse_args()

    url, secret, source = discover_config(fqc_dir=args.fqc_dir)
    masked = f"{secret[:4]}...{secret[-4:]}" if len(secret) > 8 else ("(set)" if secret else "(empty)")

    print(f"Config source:  {source or '(none found — using defaults)'}")
    print(f"Server URL:     {url}")
    print(f"Auth secret:    {masked}")

    try:
        resp = requests.get(f"{url}/health", timeout=5)
        print(f"Health check:   {resp.json()}")
    except requests.ConnectionError:
        print(f"Health check:   UNREACHABLE at {url}")
        sys.exit(1)


if __name__ == "__main__":
    _cli_info()

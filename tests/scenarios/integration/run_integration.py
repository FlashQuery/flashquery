#!/usr/bin/env python3
"""
FlashQuery Core — Integration Test Runner
==========================================
Executes YAML-defined integration test cases against a FlashQuery Core instance.

These tests complement the directed scenario tests by exercising multi-step
workflows and cross-domain behaviors: write a document, write a memory,
assert both are discoverable, archive one and verify the other survives, etc.

Configuration is auto-discovered from flashquery.yml / .env exactly as the
directed test suite does — no extra setup required when running in the same
environment.

Cleanup follows the same before/after contract as the directed tests:
  - Before: stale files under _integration/ from prior runs are removed
  - After:  all resources created during the test are archived (database)
            and deleted (filesystem) via TestContext / TestCleanup

────────────────────────────────────────────────────────────
YAML test format
────────────────────────────────────────────────────────────

  name: descriptive_test_name
  description: Human-readable explanation of what this tests
  coverage: [IS-01, IX-01]          # integration coverage IDs
  deps: [embeddings]                 # optional: capabilities this test requires

  steps:
    - label: "Write a document"         # optional display label
      action: vault.write
      name: sunset_doc                  # optional variable binding
      path: "notes/sunset.md"
      title: "Sunset Document"
      content: "the sun sets in the west"
      tags: [nature, sunset]

    - label: "Document is searchable"
      assert:
        op: search_documents
        args:
          query: "sun sets"
        expect_path: "notes/sunset.md"

    - label: "Archive it"
      action: archive_document
      args:
        fqc_id: "${sunset_doc.fqc_id}"

    - label: "Gone from search after archive"
      assert:
        op: search_documents
        args:
          query: "sun sets"
        expect_empty: true

────────────────────────────────────────────────────────────
Step types
────────────────────────────────────────────────────────────

  action:  Perform an operation. Supported actions:
             vault.write        → create_document MCP tool
             memory.write       → save_memory MCP tool
             archive_document   → archive_document MCP tool
             update_document    → update_document MCP tool
             scan_vault         → force_file_scan MCP tool (background=False)
             <any MCP tool>     → called directly; use args: {...}

  assert:  Call an MCP tool and check the result. Fields:
             op               MCP tool name (e.g. search_documents)
             args             keyword arguments passed to the tool
             expect_contains      response text contains this string
             expect_not_contains  response text does NOT contain this
             expect_path          response includes this exact path (substring)
             expect_path_contains a path in results contains this substring
             expect_empty         result count == 0
             expect_count_gte     result count >= N
             expect_count_lte     result count <= N
             expect_count_eq      result count == N

────────────────────────────────────────────────────────────
Variable binding
────────────────────────────────────────────────────────────

  Add name: <identifier> to any action step. After that step executes,
  its return fields are stored in a variable registry and can be referenced
  in later steps with ${name.field}.

  Fields available by action:
    vault.write   → fqc_id, path, title, status
    memory.write  → memory_id, content

  Example:
    - action: vault.write
      name: doc_a
      ...
    - assert:
        op: get_document
        args: { identifier: "${doc_a.fqc_id}" }
        expect_contains: "expected content"

────────────────────────────────────────────────────────────
Usage
────────────────────────────────────────────────────────────

  # Run all tests in the tests/ subdirectory
  python run_integration.py

  # Run specific files or patterns
  python run_integration.py tests/cross_domain_search.yaml   # exact path
  python run_integration.py document                         # substring — matches any test with "document" in name
  python run_integration.py archive*                         # glob wildcard

  # Use a managed FQC subprocess (own port, own vault, isolated)
  python run_integration.py --managed

  # Structured JSON output
  python run_integration.py --json

  # Stop after first failure
  python run_integration.py --stop-on-fail

Exit codes:
  0   All tests passed (and cleanup was clean)
  2   One or more tests failed
  3   Tests passed but cleanup had errors
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import platform
import random
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Build verification
# ---------------------------------------------------------------------------

def ensure_build(project_dir: Path) -> None:
    """
    Verify the FQC binary is up to date. Rebuilds if source is newer than dist.

    Mirrors the same check in run_suite.py so both runners behave consistently
    when using --managed mode.
    """
    dist_entry = project_dir / "dist" / "index.js"
    src_entry  = project_dir / "src"  / "index.ts"

    needs_build = False
    if not dist_entry.exists():
        needs_build = True
        reason = "dist/index.js not found"
    elif src_entry.exists() and src_entry.stat().st_mtime > dist_entry.stat().st_mtime:
        needs_build = True
        reason = "source code newer than binary"

    if not needs_build:
        return

    print(f"\n{'='*68}", file=sys.stderr)
    print(f"BUILD PHASE: {reason}", file=sys.stderr)
    print(f"{'='*68}", file=sys.stderr)
    print("Building FQC...", file=sys.stderr)

    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(project_dir),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("\n❌ Build failed:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    print("✓ Build complete\n", file=sys.stderr)


def _clean_test_tables(project_dir: Path) -> None:
    """
    Delete all rows from fqc_* tables to guarantee a clean DB slate.

    Mirrors the same call in run_suite.py — run once before the first test
    and once after each test so residue from any previous run (or from the
    test that just finished) never leaks into the next test.

    Failures are warnings, not hard errors — a cleanup hiccup shouldn't fail
    a test run that otherwise passed.
    """
    try:
        result = subprocess.run(
            ["python3", "tests/scenarios/dbtools/clean_test_tables.py"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(
                f"  Warning: table cleanup failed (exit {result.returncode}): "
                f"{result.stderr.strip() or result.stdout.strip()}",
                file=sys.stderr,
            )
    except Exception as e:
        print(f"  Warning: exception during table cleanup: {e}", file=sys.stderr)


# Reuse the existing scenario test framework unchanged
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_client import FQCClient, ToolResult, _find_project_dir, _load_env_file, config_summary
from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Dependency declarations and checking
# ---------------------------------------------------------------------------

# Valid dep names, matching FQCServer optional capability flags
_KNOWN_DEPS = {"embeddings", "git", "locking", "llm"}

# Substring FQC returns when a memory search is attempted without embeddings
_NO_EMBEDDINGS_SIGNAL = "semantic embeddings"


def _probe_llm(args: argparse.Namespace) -> bool:
    """Check whether an LLM API key is available in .env.test.

    Used for non-managed mode only — managed mode raises DepNotMet at startup
    if the key is missing. Returns True (optimistic) if the project dir or key
    cannot be determined.
    """
    try:
        project_dir = (
            Path(args.fqc_dir) if getattr(args, "fqc_dir", None) else _find_project_dir()
        )
        if not project_dir:
            return True
        env = _load_env_file(project_dir)
        return bool(env.get("OPENAI_API_KEY"))
    except Exception:
        return True


def _probe_embeddings(args: argparse.Namespace) -> bool:
    """
    Probe the external FQC server to detect whether embeddings are configured.

    Makes a single read-only call (search_all scoped to memories) and checks
    whether the response indicates embeddings are unavailable. No side effects.

    Returns True if embeddings appear to be configured, False if not.
    If the server is unreachable, returns True (optimistic — let the test run).
    """
    try:
        client = FQCClient(
            base_url=getattr(args, "url", None),
            auth_secret=getattr(args, "secret", None),
            fqc_dir=args.fqc_dir,
        )
        result = client.call_tool(
            "search_all",
            query="_dep_probe_",
            entity_types=["memories"],
        )
        client.close()
        return _NO_EMBEDDINGS_SIGNAL not in result.text
    except Exception:
        return True  # can't probe — optimistically assume deps may be met


class DepNotMet(Exception):
    """Raised when a test's declared deps cannot be satisfied at runtime."""
    def __init__(self, dep: str, reason: str) -> None:
        self.dep = dep
        self.reason = reason
        super().__init__(reason)


class SkipResult:
    """
    Lightweight record for a test that was skipped due to unsatisfied deps.
    Compatible with the output handling in main() (to_dict, to_json, summary_lines).
    """

    def __init__(self, name: str, unmet: list[str]) -> None:
        self.name = name
        self.unmet = unmet

    @property
    def status(self) -> str:
        return "SKIP"

    @property
    def exit_code(self) -> int:
        return 0  # skipped is not a failure

    def to_dict(self) -> dict:
        return {
            "test": self.name,
            "status": "SKIP",
            "exit_code": 0,
            "total_ms": 0,
            "steps": [],
            "skip_reason": f"Unsatisfied deps: {', '.join(self.unmet)}",
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    def summary_lines(self) -> list[str]:
        return [f"[SKIP] {self.name} — requires: {', '.join(self.unmet)}"]


# ---------------------------------------------------------------------------
# Variable reference substitution  (${name.field} syntax)
# ---------------------------------------------------------------------------

_REF_RE = re.compile(r"\$\{([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _substitute(value: Any, variables: dict[str, dict]) -> Any:
    """Recursively replace ${name.field} references in arg values."""
    if isinstance(value, dict):
        return {k: _substitute(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(item, variables) for item in value]
    if isinstance(value, str):
        def _replace(m: re.Match) -> str:
            name, field = m.group(1), m.group(2)
            if name not in variables:
                raise ValueError(
                    f"Unresolved reference ${{{name}.{field}}}: "
                    f"step '{name}' has not run or did not produce output"
                )
            if field not in variables[name]:
                raise ValueError(
                    f"Unresolved reference ${{{name}.{field}}}: "
                    f"step '{name}' ran but did not return field '{field}'"
                )
            return str(variables[name][field])
        return _REF_RE.sub(_replace, value)
    return value


# ---------------------------------------------------------------------------
# Response field extraction
# ---------------------------------------------------------------------------

# FQC responses use "Field: value" lines — these patterns extract named fields.
# Extended here as new action types are added.
_EXTRACT_PATTERNS: dict[str, str] = {
    "fq_id":     r"^FQC ID:\s*(.+)$",
    "path":      r"^Path:\s*(.+)$",
    "title":     r"^Title:\s*(.+)$",
    "status":    r"^Status:\s*(.+)$",
    # save_memory returns: "Memory saved (id: <uuid>). Tags: ..."
    # list_memories/search_memory return: "Memory ID: <uuid>"
    # Both forms are handled by this pattern.
    "memory_id": r"(?:Memory ID:\s*|\(id:\s*)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    "content":   r"^Content:\s*(.+)$",
}

# Fields to extract for variable binding, keyed by action name
_ACTION_EXTRACT_FIELDS: dict[str, tuple[str, ...]] = {
    "vault.write":  ("fq_id", "path", "title", "status"),
    "memory.write": ("memory_id", "content"),
}


def _extract(text: str, *fields: str) -> dict[str, str]:
    """Extract named fields from an FQC key-value response string."""
    result: dict[str, str] = {}
    for field in fields:
        pattern = _EXTRACT_PATTERNS.get(field)
        if pattern:
            m = re.search(pattern, text, re.MULTILINE)
            if m:
                result[field] = m.group(1).strip()
    return result


# ---------------------------------------------------------------------------
# Assertion evaluation
# ---------------------------------------------------------------------------

def _evaluate_assertions(
    result: ToolResult,
    assert_spec: dict,
    label: str,
    run: TestRun,
) -> bool:
    """
    Apply all expect_* keys in assert_spec to result.
    Records one step on run. Returns True if every check passes.
    """
    if not result.ok:
        run.step(
            label=label,
            passed=False,
            detail=f"Tool error: {result.error or result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        return False

    if "expect_contains" in assert_spec:
        result.expect_contains(str(assert_spec["expect_contains"]))

    if "expect_not_contains" in assert_spec:
        result.expect_not_contains(str(assert_spec["expect_not_contains"]))

    if "expect_path" in assert_spec:
        result.expect_contains(
            str(assert_spec["expect_path"]),
            label=f"path '{assert_spec['expect_path']}' in results",
        )

    if "expect_path_contains" in assert_spec:
        result.expect_contains(
            str(assert_spec["expect_path_contains"]),
            label=f"path containing '{assert_spec['expect_path_contains']}' in results",
        )

    if assert_spec.get("expect_empty"):
        count = result._count_results()
        result.expectations.append({
            "check": "expect_empty",
            "passed": count == 0,
            "actual": count,
            "label": "results are empty",
        })

    if "expect_count_gte" in assert_spec:
        result.expect_count_gte(int(assert_spec["expect_count_gte"]))

    if "expect_count_lte" in assert_spec:
        count = result._count_results()
        n = int(assert_spec["expect_count_lte"])
        result.expectations.append({
            "check": "count_lte",
            "expected": n,
            "actual": count,
            "passed": count <= n,
            "label": f"result count <= {n}",
        })

    if "expect_count_eq" in assert_spec:
        result.expect_count_eq(int(assert_spec["expect_count_eq"]))

    all_passed = not result.expectations or all(
        e["passed"] for e in result.expectations
    )
    detail = expectation_detail(result) if not all_passed else ""

    run.step(
        label=label,
        passed=all_passed,
        detail=detail,
        timing_ms=result.timing_ms,
        tool_result=result,
    )
    return all_passed


# ---------------------------------------------------------------------------
# Action dispatch
# ---------------------------------------------------------------------------

# Maps YAML action names to MCP tool names.
# Any MCP tool name can also be used directly as an action value.
_ACTION_TOOL_MAP: dict[str, str] = {
    "vault.write":      "create_document",
    "memory.write":     "save_memory",
    "archive_document": "archive_document",
    "update_document":  "update_document",
    "scan_vault":       "force_file_scan",
}

# Keys that are step-level metadata, not tool arguments
_STEP_META_KEYS = {"action", "label", "name", "args"}


def _execute_action(
    step: dict,
    ctx: TestContext,
    run: TestRun,
    variables: dict[str, dict],
) -> tuple[bool, dict]:
    """
    Execute an action step.

    Builds tool arguments, substitutes variable references, calls the tool,
    registers cleanup, and extracts variable fields if the step is named.

    Returns (passed, extracted_vars_for_registry).
    On failure returns (False, {}).
    """
    op: str = step["action"]
    label: str = step.get("label") or f"action: {op}"
    step_name: str | None = step.get("name")

    tool_name = _ACTION_TOOL_MAP.get(op, op)  # fall through to bare MCP tool name

    # Build args: prefer explicit args: {...} block; otherwise pull top-level keys
    if "args" in step:
        raw_args: dict = dict(step["args"] or {})
    else:
        raw_args = {k: v for k, v in step.items() if k not in _STEP_META_KEYS}

    # Auto-prefix vault.write paths to isolate under _integration/
    if op == "vault.write" and "path" in raw_args:
        p = str(raw_args["path"])
        if not p.startswith("_integration/"):
            raw_args["path"] = f"_integration/{p}"

    # Force synchronous scan when using scan_vault
    if op == "scan_vault":
        raw_args["background"] = False

    # Substitute ${name.field} references
    try:
        args = _substitute(raw_args, variables)
    except ValueError as e:
        run.step(label=label, passed=False, detail=str(e), timing_ms=0)
        return False, {}

    result = ctx.client.call_tool(tool_name, **args)

    if not result.ok:
        run.step(
            label=label,
            passed=False,
            detail=f"Action failed: {result.error or result.text[:300]}",
            timing_ms=result.timing_ms,
            tool_result=result,
        )
        return False, {}

    # --- Register cleanup resources ----------------------------------------

    if op == "vault.write":
        # Extract actual path and fqc_id from the response for reliable cleanup
        resp_fields = _extract(result.text, "fq_id", "path")
        actual_path = resp_fields.get("path") or args.get("path", "")
        if actual_path:
            ctx.cleanup.track_file(actual_path)
            parts = Path(actual_path).parts
            for i in range(1, len(parts)):
                ctx.cleanup.track_dir(str(Path(*parts[:i])))
        if resp_fields.get("fq_id"):
            ctx.cleanup.track_mcp_document(resp_fields["fq_id"])

    elif op == "memory.write":
        resp_fields = _extract(result.text, "memory_id")
        if resp_fields.get("memory_id"):
            ctx.cleanup.track_mcp_memory(resp_fields["memory_id"])

    # --- Extract variable fields for named steps ----------------------------

    extracted_vars: dict = {}
    if step_name:
        extract_fields = _ACTION_EXTRACT_FIELDS.get(op, ())
        extracted_vars = _extract(result.text, *extract_fields)
        # Ensure the path we actually used is always available
        if op == "vault.write" and "path" not in extracted_vars:
            extracted_vars["path"] = args.get("path", "")

    run.step(
        label=label,
        passed=True,
        detail="",
        timing_ms=result.timing_ms,
        tool_result=result,
    )
    return True, extracted_vars


def _execute_assert(
    step: dict,
    ctx: TestContext,
    run: TestRun,
    variables: dict[str, dict],
) -> bool:
    """Execute an assert step. Returns True if all assertions pass."""
    assert_spec: dict = step["assert"]
    op: str = assert_spec.get("op", "")
    label: str = step.get("label") or f"assert: {op}"
    raw_args: dict = assert_spec.get("args") or {}

    try:
        args = _substitute(raw_args, variables)
    except ValueError as e:
        run.step(label=label, passed=False, detail=str(e), timing_ms=0)
        return False

    result = ctx.client.call_tool(op, **args)
    return _evaluate_assertions(result, assert_spec, label, run)


# ---------------------------------------------------------------------------
# Single-test executor
# ---------------------------------------------------------------------------

def run_yaml_test(
    test_def: dict,
    args: argparse.Namespace,
    require_embedding: bool = False,
    require_llm: bool = False,
) -> TestRun:  # noqa: C901
    """
    Execute a single YAML integration test definition.

    Uses TestContext for setup/teardown — this provides:
      - Pre-clean: removes stale _integration/ files from prior runs
      - Post-clean: archives + deletes all resources created during the test
      - Optional managed FQC server (--managed flag)
      - Config auto-discovery from flashquery.yml / .env

    If require_embedding=True and the managed server cannot start because no
    embedding API key is configured, raises DepNotMet("embeddings", ...) so
    the caller can record a SKIP rather than a FAIL.
    """
    name = test_def.get("name", "unnamed_test")
    run = TestRun(name)
    variables: dict[str, dict] = {}  # variable registry: name → {field: value}
    cleanup_errors: list[str] = []   # populated after TestContext exits

    # extra_config from YAML lets individual tests inject llm:, etc. into the
    # managed server config without requiring a separate server invocation.
    yaml_extra_config: dict | None = test_def.get("extra_config") or None

    try:
        with TestContext(
            test_prefix="_integration",
            fqc_dir=args.fqc_dir,
            url=getattr(args, "url", None),
            secret=getattr(args, "secret", None),
            vault_path=getattr(args, "vault_path", None),
            managed=args.managed,
            port_range=getattr(args, "port_range", None),
            require_embedding=require_embedding,
            require_llm=require_llm,
            enable_git=getattr(args, "enable_git", False),
            enable_locking=getattr(args, "enable_locking", False),
            extra_config=yaml_extra_config,
        ) as ctx:

            for i, step in enumerate(test_def.get("steps", []), start=1):

                if "action" in step:
                    passed, extracted = _execute_action(step, ctx, run, variables)
                    step_name = step.get("name")
                    if step_name:
                        # Always register the step — even if extraction yielded no
                        # fields. This ensures ${step.field} substitution produces
                        # "field not found in step" rather than "step not found",
                        # giving a much clearer diagnosis on pattern mismatches.
                        variables[step_name] = extracted
                    if not passed:
                        # Action failure aborts the test — downstream steps would
                        # operate on resources that don't exist
                        break

                elif "assert" in step:
                    # Assert failures don't abort — collect the full picture
                    _execute_assert(step, ctx, run, variables)

                else:
                    run.step(
                        label=f"step {i}: unrecognized",
                        passed=False,
                        detail=(
                            f"Each step must have an 'action' or 'assert' key. "
                            f"Got: {list(step.keys())}"
                        ),
                        timing_ms=0,
                    )

            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)

        # __exit__ has run by here — cleanup_errors is now populated
        cleanup_errors = ctx.cleanup_errors

    except RuntimeError as e:
        # Managed server couldn't start — map missing-key errors to DepNotMet so
        # the caller records a SKIP rather than a hard failure.
        msg = str(e)
        if "require_llm" in msg or ("OPENAI_API_KEY" in msg and "require_llm" in msg):
            raise DepNotMet("llm", msg) from e
        if "API key" in msg or "require_embedding" in msg:
            raise DepNotMet("embeddings", msg) from e
        raise  # any other RuntimeError is a real failure

    run.record_cleanup(cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _fmt_ms(ms: int) -> str:
    """Format milliseconds as a human-readable duration."""
    if ms < 1000:
        return f"{ms}ms"
    secs = ms / 1000
    if secs < 60:
        return f"{secs:.1f}s"
    mins = int(secs // 60)
    remaining = secs - mins * 60
    return f"{mins}m {remaining:.1f}s"


def _write_step_detail(lines: list[str], step: dict) -> None:
    """Write the H3 detail block for a single step."""
    num = step["step"]
    label = step["label"]
    passed = step["passed"]
    status = "PASS" if passed else "FAIL"
    timing = f" ({_fmt_ms(step['timing_ms'])})" if step.get("timing_ms") else ""

    lines.append(f"### Step {num}: {label} — {status}{timing}")
    lines.append("")

    tr = step.get("tool_result")
    if tr:
        tool = tr.get("tool", "")
        if tool:
            lines.append(f"**Tool:** `{tool}`")
            lines.append("")

        args = tr.get("request", {}).get("arguments", {})
        if args:
            lines.append("**Arguments:**")
            lines.append("```json")
            lines.append(json.dumps(args, indent=2))
            lines.append("```")
            lines.append("")

        resp_text = tr.get("response", {}).get("text", "")
        error_detail = tr.get("response", {}).get("error_detail", "")

        if error_detail:
            lines.append("**Error:**")
            lines.append("```")
            lines.append(error_detail)
            lines.append("```")
            lines.append("")

        if resp_text:
            lines.append("**Response:**")
            lines.append("```")
            lines.append(resp_text)
            lines.append("```")
            lines.append("")

        server_url = tr.get("config", {}).get("server_url", "")
        if server_url and not passed:
            config_src = tr.get("config", {}).get("config_source", "")
            src_note = f" (from {config_src})" if config_src else ""
            lines.append(f"**Server:** {server_url}{src_note}")
            lines.append("")

        expectations = tr.get("expectations", [])
        if expectations:
            lines.append("**Expectations:**")
            lines.append("")
            for exp in expectations:
                icon = "✅" if exp["passed"] else "❌"
                label_text = exp.get("label", exp.get("check", ""))
                detail_parts = []
                if "actual" in exp and "expected" in exp:
                    detail_parts.append(f"expected `{exp['expected']}`, got `{exp['actual']}`")
                lines.append(
                    f"- {icon} {label_text}"
                    + (f" — {', '.join(detail_parts)}" if detail_parts else "")
                )
            lines.append("")

    else:
        # Non-tool step (parse error, unrecognised step type, etc.)
        detail = step.get("detail", "")
        if detail:
            lines.append(f"**Detail:** {detail}")
            lines.append("")

    # Step-level server logs (attached when the step's tool call triggers a log burst)
    step_logs = step.get("server_logs")
    if step_logs:
        lines.append(f"**Server logs (step {num}):**")
        lines.append("```")
        for sl in step_logs:
            lines.append(sl)
        lines.append("```")
        lines.append("")


def generate_report(
    test_results: list[dict],
    suite_duration_ms: int = 0,
    server_mode: str = "external",
    seed: int | None = None,
) -> str:
    """Generate a markdown debug report from collected integration test results.

    Each entry in test_results must have:
      "run"        — TestRun.to_dict() or SkipResult.to_dict()
      "server_logs"— list[str] of server log lines captured during the test
      "yaml_meta"  — {"description": str, "deps": list, "coverage": list, "yaml_path": str}
    """
    lines: list[str] = []

    now = datetime.now().astimezone()
    date_str     = now.strftime("%Y-%m-%d %H:%M:%S %Z")
    iso_date     = now.isoformat(timespec="seconds")
    duration_s   = round(suite_duration_ms / 1000, 1)

    passed  = sum(1 for r in test_results if r["run"]["status"] == "PASS")
    skipped = sum(1 for r in test_results if r["run"]["status"] == "SKIP")
    failed  = len(test_results) - passed - skipped
    total   = len(test_results)

    mode_label = {
        "managed":  "Managed (dedicated server per test)",
        "external": "External (existing server)",
    }.get(server_mode, server_mode)

    # ── YAML frontmatter ───────────────────────────────────────────────────
    # Written so FQC can later index and query these reports like any other
    # document — run date, outcome counts, and environment details are all
    # machine-readable without parsing the body.
    #
    # Coverage IDs from all tests are aggregated (deduped, order-preserved)
    # into `tags` so FQC's tag index makes individual coverage points
    # queryable: search_all tags:[ia-04] finds every report that ran IA-04.
    seen_cov: set[str] = set()
    coverage_tags: list[str] = []
    for r in test_results:
        for cid in (r.get("yaml_meta", {}).get("coverage") or []):
            key = f"coverage-{str(cid).lower()}"
            if key not in seen_cov:
                seen_cov.add(key)
                coverage_tags.append(key)

    date_slug = now.strftime("%Y-%m-%d %H:%M")
    lines.append("---")
    lines.append(f'title: "Integration Test Report — {date_slug}"')
    lines.append(f'created: "{iso_date}"')
    lines.append(f"duration_s: {duration_s}")
    lines.append(f"total: {total}")
    lines.append(f"pass: {passed}")
    lines.append(f"fail: {failed}")
    lines.append(f"skipped: {skipped}")
    lines.append(f'server_mode: "{server_mode}"')
    lines.append(f'os: "{platform.system()}"')
    if seed is not None:
        lines.append(f"seed: {seed}")
    if coverage_tags:
        lines.append(f"tags: [{', '.join(coverage_tags)}]")
    lines.append("---")
    lines.append("")

    # ── Report header (human-readable summary) ─────────────────────────────
    lines.append("# FlashQuery Core — Integration Test Report")
    lines.append("")
    lines.append(f"**Run date:** {date_str}")
    lines.append(f"**Server mode:** {mode_label}")
    if seed is not None:
        lines.append(f"**Test order:** shuffled (seed={seed})")
    lines.append(f"**Duration:** {_fmt_ms(suite_duration_ms)}")
    lines.append(
        f"**Summary:** {passed} passed, {failed} failed, {skipped} skipped"
        f" — {total} total"
    )
    lines.append("")

    # ── Per-test sections ──────────────────────────────────────────────────
    for entry in test_results:
        run         = entry["run"]
        yaml_meta   = entry.get("yaml_meta", {})
        server_logs = entry.get("server_logs") or []

        test_name = run["test"]
        status    = run["status"]
        total_ms  = run.get("total_ms", 0)
        steps     = run.get("steps", [])
        cleanup_errors = run.get("cleanup_errors", [])

        lines.append("---")
        lines.append("")
        # H1 per test — makes each test a top-level navigable section
        lines.append(f"# {status}: {test_name} ({_fmt_ms(total_ms)})")
        lines.append("")

        # YAML metadata block
        meta_lines: list[str] = []
        if yaml_meta.get("description"):
            meta_lines.append(f"**Description:** {yaml_meta['description']}")
        if yaml_meta.get("coverage"):
            meta_lines.append(
                f"**Coverage:** {', '.join(str(c) for c in yaml_meta['coverage'])}"
            )
        if yaml_meta.get("deps"):
            meta_lines.append(f"**Deps:** {', '.join(yaml_meta['deps'])}")
        if yaml_meta.get("yaml_path"):
            meta_lines.append(f"**File:** `{yaml_meta['yaml_path']}`")
        lines.extend(meta_lines)
        if meta_lines:
            lines.append("")

        # SKIP — no steps to show
        if status == "SKIP":
            skip_reason = run.get("skip_reason", "")
            if skip_reason:
                lines.append(f"*{skip_reason}*")
            lines.append("")
            continue

        # Step summary table
        if steps:
            lines.append("| Step | Status | Label | Time |")
            lines.append("|------|--------|-------|------|")
            for s in steps:
                s_icon = "✅" if s["passed"] else "❌"
                s_time = _fmt_ms(s["timing_ms"]) if s.get("timing_ms") else "—"
                lines.append(
                    f"| {s['step']} | {s_icon} | {s['label']} | {s_time} |"
                )
            lines.append("")

        # Per-step detail sections
        for s in steps:
            _write_step_detail(lines, s)

        # Test-level server logs (only on failure — success logs are noise)
        if server_logs and status != "PASS":
            lines.append(f"## Server logs for {test_name}")
            lines.append("")
            lines.append("```")
            for sl in server_logs:
                lines.append(sl)
            lines.append("```")
            lines.append("")

        # Cleanup errors
        if cleanup_errors:
            lines.append("## Cleanup errors")
            lines.append("")
            for err in cleanup_errors:
                lines.append(f"- {err}")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Coverage matrix auto-update
# ---------------------------------------------------------------------------

def update_coverage_matrix(
    coverage_path: Path,
    test_results: list[dict],
    run_date: str,
) -> None:
    """
    Update INTEGRATION_COVERAGE.md after a run.

    For every test that PASSED: fill in Covered By, Date Updated, Last Passing.
    For every test that FAILED: fill in Covered By, Date Updated (leave Last Passing).
    SKIP entries are ignored.

    The file is rewritten in-place.  Column widths are kept proportional to
    the header widths so the table stays readable in raw markdown.
    """
    if not coverage_path.exists():
        return

    text  = coverage_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    # Map coverage_id → (test_name, status) for all non-skipped results
    id_to_result: dict[str, tuple[str, str]] = {}
    for entry in test_results:
        run    = entry["run"]
        status = run["status"]
        if status == "SKIP":
            continue
        for cid in entry.get("yaml_meta", {}).get("coverage", []):
            id_to_result[str(cid)] = (run["test"], status)

    if not id_to_result:
        return

    # Match data rows (5 pipe-delimited columns)
    # Example: | IS-01  | Create document → … | write_then_search  | 2026-01-01 | 2026-01-01 |
    row_re = re.compile(
        r"^\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|$"
    )

    updated: list[str] = []
    for line in lines:
        m = row_re.match(line)
        if m:
            row_id = m.group(1).strip()
            if row_id in id_to_result:
                test_name, status = id_to_result[row_id]
                # Preserve original column-1 padding (ID cell)
                id_cell      = m.group(1)
                behavior_cell = m.group(2)
                # Pad the mutable cells to consistent widths
                covered_cell = f" {test_name:<28} "
                date_cell    = f" {run_date:<12} "
                if status == "PASS":
                    last_cell = f" {run_date:<12} "
                else:
                    last_cell = m.group(5)  # keep existing value on failure
                line = f"|{id_cell}|{behavior_cell}|{covered_cell}|{date_cell}|{last_cell}|"
        updated.append(line)

    coverage_path.write_text("\n".join(updated) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI + suite runner
# ---------------------------------------------------------------------------

def _print_config_banner(fqc_dir: str | None, managed: bool) -> None:
    """Print a configuration summary to stderr before any tests run."""
    info = config_summary(fqc_dir)
    W = 68
    print(f"\n{'═' * W}", file=sys.stderr)
    print("CONFIGURATION", file=sys.stderr)
    print(f"{'═' * W}", file=sys.stderr)
    print(f"  Project dir:  {info['project_dir']}", file=sys.stderr)
    if info["config_file"]:
        print(f"  Config file:  {info['config_file']}", file=sys.stderr)
    else:
        print("  Config file:  (none found — using defaults)", file=sys.stderr)
    env_files = info["env_files"]
    if env_files:
        print(f"  Env:          {env_files[0]}", file=sys.stderr)
    else:
        print("  Env:          (.env.test not found — credentials will be missing)", file=sys.stderr)
    if info["supabase_url"]:
        print(f"  Supabase:     {info['supabase_url']}", file=sys.stderr)
    else:
        print("  Supabase:     (SUPABASE_URL not set — tests will likely fail)", file=sys.stderr)
    if info["database_url"]:
        db_display = re.sub(r"(:)[^:@]+(@)", r"\1****\2", info["database_url"])
        print(f"  Database URL: {db_display}", file=sys.stderr)
    if managed:
        print("  Vault:        (temp dir — created per test run)", file=sys.stderr)
        print("  Server URL:   (auto-assigned port — managed mode)", file=sys.stderr)
    else:
        if info["vault_path"]:
            print(f"  Vault:        {info['vault_path']}", file=sys.stderr)
        if info["server_url"]:
            print(f"  Server URL:   {info['server_url']}", file=sys.stderr)
        if info["auth_secret_masked"]:
            print(f"  Auth secret:  {info['auth_secret_masked']}", file=sys.stderr)
    print(f"{'═' * W}\n", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="FlashQuery Core integration test runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "test_files", nargs="*",
        help="YAML test files to run (default: all *.yaml in tests/ subdirectory)",
    )
    parser.add_argument(
        "--fqc-dir", default=None,
        help="Path to flashquery-core directory (default: auto-discovered)",
    )
    parser.add_argument("--url", default=None, help="FQC server URL")
    parser.add_argument("--secret", default=None, help="FQC auth secret")
    parser.add_argument("--vault-path", default=None, dest="vault_path")
    parser.add_argument(
        "--managed", action="store_true",
        help="Start a dedicated FQC subprocess per test (build is verified first)",
    )
    parser.add_argument(
        "--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
        default=None,
        help="Port range for managed servers (default: 9100–9199)",
    )
    parser.add_argument(
        "--enable-git", action="store_true",
        help="Initialize git in the managed server's vault (for git-behavior tests)",
    )
    parser.add_argument(
        "--enable-locking", action="store_true",
        help="Enable write-lock contention handling in the managed server",
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Shuffle test execution order using this seed (reproducible). "
             "Omit for alphabetical order.",
    )
    parser.add_argument(
        "--json", action="store_true", dest="output_json",
        help="Emit structured JSON output instead of human-readable text",
    )
    parser.add_argument(
        "--stop-on-fail", action="store_true",
        help="Stop after the first failing test",
    )

    args = parser.parse_args()

    # Project root — used for build verification and table cleanup script path.
    # run_integration.py lives at flashquery-core/tests/scenarios/integration/,
    # so four parents up lands at flashquery-core/.
    _project_dir: Path = (
        Path(args.fqc_dir).resolve()
        if args.fqc_dir
        else Path(__file__).resolve().parent.parent.parent.parent
    )

    # Verify / rebuild FQC binary before starting a managed server.
    # External-server mode skips this — the server is already running.
    if args.managed:
        ensure_build(_project_dir)

    _script_dir = Path(__file__).resolve().parent
    _test_dir   = _script_dir / "tests"

    # Always discover all available tests first
    all_test_paths = sorted(_test_dir.glob("*.yaml")) + sorted(_test_dir.glob("*.yml"))

    # Resolve the test set
    if args.test_files:
        test_paths: list[Path] = []
        for token in args.test_files:
            p = Path(token)
            # 1. Direct file path (absolute or relative to CWD)
            if p.exists():
                resolved = p.resolve()
                if resolved not in test_paths:
                    test_paths.append(resolved)
                continue
            # 2. Name/glob pattern matched against discovered tests
            #    Strip .yml/.yaml so "deliberate_fail.yml" and "deliberate_fail" both work.
            #    Wildcards like "*fail*" or "write*" are supported via fnmatch.
            #    Plain words with no wildcards are treated as substring matches, so
            #    "document" automatically becomes "*document*".
            stem_pattern = Path(token).stem
            if not any(c in stem_pattern for c in ("*", "?", "[")):
                stem_pattern = f"*{stem_pattern}*"
            matched = [
                tp for tp in all_test_paths
                if fnmatch.fnmatch(tp.stem, stem_pattern)
            ]
            if matched:
                for tp in matched:
                    if tp not in test_paths:
                        test_paths.append(tp)
            else:
                print(f"Error: no tests matched: {token!r}", file=sys.stderr)
                print("Available tests:", file=sys.stderr)
                for tp in all_test_paths:
                    print(f"  - {tp.stem}", file=sys.stderr)
                sys.exit(1)
    else:
        test_paths = all_test_paths

    if not test_paths:
        print("No test files found.", file=sys.stderr)
        sys.exit(1)

    # Optionally shuffle test order with a reproducible seed
    seed_used: int | None = None
    if args.seed is not None:
        seed_used = args.seed
        random.seed(seed_used)
        random.shuffle(test_paths)

    _print_config_banner(args.fqc_dir, args.managed)

    # Echo the final run order so it's clear what will execute and in what sequence
    order_label = f"shuffled (seed={seed_used})" if seed_used is not None else "alphabetical"
    print(f"\nOrder: {order_label}", file=sys.stderr)
    for tp in test_paths:
        print(f"  - {tp.stem}", file=sys.stderr)

    # full_results stores rich entries for report generation
    full_results: list[dict] = []
    overall_pass = True
    suite_t0 = time.monotonic()

    # Initial table cleanup — ensures the first test starts with a clean DB
    # even if a previous run left residue behind.
    if args.managed:
        _clean_test_tables(_project_dir)

    for path in test_paths:
        try:
            with open(path) as f:
                test_def = yaml.safe_load(f)
        except Exception as e:
            print(f"Failed to load {path.name}: {e}", file=sys.stderr)
            overall_pass = False
            if args.stop_on_fail:
                break
            continue

        # --- Parse deps and coverage ---
        deps_raw = test_def.get("deps", [])
        deps: list[str] = [deps_raw] if isinstance(deps_raw, str) else list(deps_raw or [])

        coverage_raw = test_def.get("coverage")
        coverage_ids: list[str] = (
            [str(c) for c in (coverage_raw if isinstance(coverage_raw, list) else [coverage_raw])]
            if coverage_raw else []
        )

        try:
            yaml_path_display = str(path.relative_to(_script_dir))
        except ValueError:
            yaml_path_display = str(path)

        yaml_meta = {
            "description": test_def.get("description", ""),
            "deps": deps,
            "coverage": coverage_ids,
            "yaml_path": yaml_path_display,
        }

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Running: {path.name}", file=sys.stderr)
        if test_def.get("description"):
            print(f"  {test_def['description']}", file=sys.stderr)
        if coverage_ids:
            print(f"  Coverage: {', '.join(coverage_ids)}", file=sys.stderr)
        if deps:
            print(f"  Deps:     {', '.join(deps)}", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        # --- Check deps for external server (managed server checks at startup) ---
        unmet: list[str] = []
        if not args.managed:
            for dep in deps:
                if dep not in _KNOWN_DEPS:
                    print(f"  Warning: unknown dep '{dep}'", file=sys.stderr)
                elif dep == "embeddings" and not _probe_embeddings(args):
                    unmet.append(dep)
                elif dep == "llm" and not _probe_llm(args):
                    unmet.append(dep)

        if unmet:
            result_obj: TestRun | SkipResult = SkipResult(
                test_def.get("name", path.stem), unmet
            )
        else:
            require_embedding = "embeddings" in deps
            require_llm = "llm" in deps
            try:
                result_obj = run_yaml_test(
                    test_def, args,
                    require_embedding=require_embedding,
                    require_llm=require_llm,
                )
            except DepNotMet as e:
                result_obj = SkipResult(test_def.get("name", path.stem), [e.dep])

        run_dict = result_obj.to_dict()
        # Server logs are stored inside the TestRun dict by attach_server_logs().
        # Hoist them to the top level of the entry (consistent with run_suite.py)
        # so generate_report() can include them in the per-test section.
        server_logs = run_dict.pop("server_logs", None) or []
        full_results.append({
            "run": run_dict,
            "server_logs": server_logs,
            "yaml_meta": yaml_meta,
        })

        if args.output_json:
            print(result_obj.to_json())
        else:
            for line in result_obj.summary_lines():
                print(line, file=sys.stderr)

        # Post-test table cleanup — wipe the DB so the next test starts clean.
        # Mirrors run_suite.py's between-test cleanup in shared server mode.
        if args.managed:
            _clean_test_tables(_project_dir)

        if result_obj.exit_code != 0:
            overall_pass = False
            if args.stop_on_fail:
                print("\nStopping after first failure (--stop-on-fail)", file=sys.stderr)
                break

    suite_duration = int((time.monotonic() - suite_t0) * 1000)

    # --- Generate markdown report ---
    server_mode = "managed" if args.managed else "external"
    report_dir = Path(__file__).parent / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now().astimezone()
    report_filename = f"integration-report-{now.strftime('%Y-%m-%d-%H%M%S')}.md"
    report_path = report_dir / report_filename
    report_md = generate_report(
        full_results, suite_duration,
        server_mode=server_mode,
        seed=seed_used,
    )
    report_path.write_text(report_md, encoding="utf-8")

    # --- Update INTEGRATION_COVERAGE.md ---
    coverage_matrix_path = Path(__file__).parent / "INTEGRATION_COVERAGE.md"
    run_date = now.strftime("%Y-%m-%d")
    try:
        update_coverage_matrix(coverage_matrix_path, full_results, run_date)
    except Exception as e:
        print(f"  Warning: could not update coverage matrix: {e}", file=sys.stderr)

    # --- Final summary ---
    results_flat = [e["run"] for e in full_results]
    total         = len(results_flat)
    passed_count  = sum(1 for r in results_flat if r["status"] == "PASS")
    skipped_count = sum(1 for r in results_flat if r["status"] == "SKIP")
    failed_count  = total - passed_count - skipped_count
    cleanup_errors_count = sum(
        1 for e in full_results if e["run"].get("cleanup_errors")
    )

    print(f"\n{'='*60}", file=sys.stderr)
    summary = f"Results: {passed_count}/{total} passed"
    if skipped_count:
        summary += f"  ({skipped_count} skipped)"
    if failed_count:
        summary += f"  ({failed_count} failed)"
    if cleanup_errors_count:
        summary += f"  ({cleanup_errors_count} with cleanup errors)"
    print(summary, file=sys.stderr)
    print(f"Report:  {report_path}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    # Exit codes mirror run_suite.py:
    #   0 — all passed, clean cleanup
    #   2 — one or more tests failed
    #   3 — tests passed but cleanup had errors
    if failed_count > 0:
        sys.exit(2)
    if cleanup_errors_count > 0:
        sys.exit(3)
    sys.exit(0)


if __name__ == "__main__":
    main()

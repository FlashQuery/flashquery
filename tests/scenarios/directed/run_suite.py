#!/usr/bin/env python3
"""
FQC Scenario Test Suite Runner
================================
Discovers and runs all scenario tests, optionally on a single shared managed
FQC server, and produces a timestamped markdown report.

Usage:
    python run_suite.py --managed                     # all tests on a shared managed server
    python run_suite.py --managed create*             # only tests matching "create*"
    python run_suite.py --managed document            # substring match — any test containing "document"
    python run_suite.py --managed "*search*" "*tag*"  # multiple patterns
    python run_suite.py --managed --seed 42           # reproducible shuffled order
    python run_suite.py --per-test-server             # fresh server per test (isolation diagnostic)
    python run_suite.py --managed --stop-on-fail      # stop after first failure
    python run_suite.py --url http://localhost:3001/mcp  # run against existing server

The runner auto-discovers all test_*.py files in the testcases directory,
imports each one, and calls its run_test() function. Results are collected
and written to a markdown report under the reports directory.

Each test still works standalone:
    python tests/scenarios/directed/testcases/test_search_after_create.py --managed
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib.util
import json
import os
import platform
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

# Add framework and dbtools to path
# _SCRIPT_DIR   = tests/scenarios/directed/
# _SCENARIOS_DIR = tests/scenarios/         (framework/ and dbtools/ live here)
# _PROJECT_ROOT  = flashquery-core/
_SCRIPT_DIR    = Path(__file__).resolve().parent
_SCENARIOS_DIR = _SCRIPT_DIR.parent
_PROJECT_ROOT  = _SCENARIOS_DIR.parent.parent  # flashquery-core root
sys.path.insert(0, str(_SCENARIOS_DIR / "framework"))
sys.path.insert(0, str(_SCENARIOS_DIR / "dbtools"))

from fqc_test_utils import FQCServer, TestRun
from fqc_client import config_summary


# ---------------------------------------------------------------------------
# Build verification and auto-rebuild
# ---------------------------------------------------------------------------

def ensure_build(project_dir: Path) -> None:
    """
    Verify FQC binary is up to date. Rebuild if source is newer than dist.

    Prints clear messaging about what's happening:
    - "Checking FQC build..." if checking
    - "Building FQC..." if rebuild needed
    - "✓ Build complete" if successful

    Exits with code 1 if build fails.
    """
    dist_entry = project_dir / "dist" / "index.js"
    src_entry = project_dir / "src" / "index.ts"

    # Check if rebuild is needed
    needs_build = False
    if not dist_entry.exists():
        needs_build = True
        reason = "dist/index.js not found"
    elif src_entry.exists():
        src_mtime = src_entry.stat().st_mtime
        dist_mtime = dist_entry.stat().st_mtime
        if src_mtime > dist_mtime:
            needs_build = True
            reason = "source code newer than binary"

    if needs_build:
        print(f"\n════════════════════════════════════════════════════════════════════", file=sys.stderr)
        print(f"BUILD PHASE: {reason}", file=sys.stderr)
        print(f"════════════════════════════════════════════════════════════════════", file=sys.stderr)
        print(f"Building FQC...", file=sys.stderr)
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(project_dir),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"\n❌ Build failed:", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            sys.exit(1)
        print(f"✓ Build complete\n", file=sys.stderr)


# ---------------------------------------------------------------------------
# Test discovery
# ---------------------------------------------------------------------------

def discover_tests(testcases_dir: Path) -> list[Path]:
    """Find all test_*.py files in the testcases directory, sorted by name."""
    if not testcases_dir.is_dir():
        print(f"Error: testcases directory not found: {testcases_dir}", file=sys.stderr)
        sys.exit(1)
    tests = sorted(testcases_dir.glob("test_*.py"))
    if not tests:
        print(f"Warning: no test_*.py files found in {testcases_dir}", file=sys.stderr)
    return tests


def load_test_module(path: Path):
    """Dynamically import a test module and return it."""
    spec = importlib.util.spec_from_file_location(path.stem, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {path}")
    mod = importlib.util.module_from_spec(spec)
    # Ensure the framework is importable from the test module's perspective
    if str(_SCENARIOS_DIR / "framework") not in sys.path:
        sys.path.insert(0, str(_SCENARIOS_DIR / "framework"))
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Report writer
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
            lines.append(f"**Tool:** {tool}")

        args = tr.get("request", {}).get("arguments", {})
        if args:
            lines.append("**Arguments:**")
            lines.append("```json")
            lines.append(json.dumps(args, indent=2))
            lines.append("```")

        resp_text = tr.get("response", {}).get("text", "")
        error_detail = tr.get("response", {}).get("error_detail", "")

        if error_detail:
            lines.append("**Error:**")
            lines.append("```")
            lines.append(error_detail)
            lines.append("```")

        if resp_text:
            lines.append("**Response:**")
            lines.append("```")
            lines.append(resp_text)
            lines.append("```")

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
                icon = "PASS" if exp["passed"] else "FAIL"
                label_text = exp.get("label", exp.get("check", ""))
                detail_parts = []
                if "actual" in exp and "expected" in exp:
                    detail_parts.append(f"expected {exp['expected']}, got {exp['actual']}")
                lines.append(f"- {icon}: {label_text}" + (f" — {', '.join(detail_parts)}" if detail_parts else ""))
            lines.append("")
    else:
        # Non-tool steps (vault reads, etc.)
        detail = step.get("detail", "")
        if detail:
            lines.append(f"**Detail:** {detail}")
            lines.append("")

    # Step-level server logs
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
    server_info: dict | None = None,
    suite_duration_ms: int = 0,
) -> str:
    """Generate the markdown report from collected test results.

    Args:
        test_results: list of dicts, each with keys:
            - "run": TestRun.to_dict() output
            - "server_logs": list[str] server log lines during this test (or None)
        server_info: optional dict with server metadata (mode, url, instance_id, vault_path, config_source)
        suite_duration_ms: total wall-clock time for the suite
    """
    lines: list[str] = []

    now = datetime.now().astimezone()
    date_str    = now.strftime("%Y-%m-%d %H:%M:%S %Z")
    iso_date    = now.isoformat(timespec="seconds")
    duration_s  = round(suite_duration_ms / 1000, 1)
    date_slug   = now.strftime("%Y-%m-%d %H:%M")

    passed = sum(1 for r in test_results if r["run"]["status"] == "PASS")
    failed = sum(1 for r in test_results if r["run"]["status"] != "PASS")
    total  = len(test_results)

    server_mode = (server_info or {}).get("mode", "external")
    seed        = (server_info or {}).get("seed")

    # ── YAML frontmatter ───────────────────────────────────────────────────
    # Written so FQC can later index and query these reports like any other
    # document — run date, outcome counts, and environment details are all
    # machine-readable without parsing the body.
    #
    # Coverage IDs from all tests are aggregated (deduped, order-preserved)
    # into `tags` so FQC's tag index makes individual coverage points
    # queryable: search_all tags:[coverage-d-09] finds every report that ran D-09.
    seen_cov: set[str] = set()
    coverage_tags: list[str] = []
    for r in test_results:
        for cid in (r.get("coverage") or []):
            key = f"coverage-{str(cid).lower()}"
            if key not in seen_cov:
                seen_cov.add(key)
                coverage_tags.append(key)

    lines.append("---")
    lines.append(f'title: "Scenario Test Report — {date_slug}"')
    lines.append(f'created: "{iso_date}"')
    lines.append(f"duration_s: {duration_s}")
    lines.append(f"total: {total}")
    lines.append(f"pass: {passed}")
    lines.append(f"fail: {failed}")
    lines.append(f'server_mode: "{server_mode}"')
    lines.append(f'os: "{platform.system()}"')
    if seed is not None:
        lines.append(f"seed: {seed}")
    if coverage_tags:
        lines.append(f"tags: [{', '.join(coverage_tags)}]")
    lines.append("---")
    lines.append("")

    # ── Header ────────────────────────────────────────────────────────────
    lines.append("# FQC Scenario Test Report")
    lines.append("")
    lines.append(f"**Run date:** {date_str}")

    if server_info:
        mode = server_info.get("mode", "external")
        url = server_info.get("url", "")
        lines.append(f"**Server mode:** {mode}" + (f" ({url})" if url else ""))
        if server_info.get("instance_id"):
            lines.append(f"**Instance ID:** {server_info['instance_id']}")
        if server_info.get("vault_path"):
            lines.append(f"**Vault:** {server_info['vault_path']}")
        if server_info.get("config_source"):
            lines.append(f"**Config source:** {server_info['config_source']}")
        if seed is not None:
            lines.append(f"**Test order:** shuffled (seed={seed})")
    lines.append(f"**Duration:** {_fmt_ms(suite_duration_ms)}")
    lines.append(f"**Summary:** {passed} passed, {failed} failed — {total} tests total")
    lines.append("")

    # ── Per-test sections ─────────────────────────────────────────────────
    for entry in test_results:
        run = entry["run"]
        test_server_logs = entry.get("server_logs")

        test_name = run["test"]
        status = run["status"]
        total_ms = run.get("total_ms", 0)
        steps = run.get("steps", [])
        cleanup_errors = run.get("cleanup_errors", [])

        lines.append("---")
        lines.append("")
        # H1 per test — makes each test a top-level navigable section
        lines.append(f"# {status}: {test_name} ({_fmt_ms(total_ms)})")
        lines.append("")

        # Summary table
        if steps:
            lines.append("| Step | Status | Label | Time |")
            lines.append("|------|--------|-------|------|")
            for s in steps:
                s_status = "PASS" if s["passed"] else "FAIL"
                s_time = _fmt_ms(s["timing_ms"]) if s.get("timing_ms") else "—"
                lines.append(f"| {s['step']} | {s_status} | {s['label']} | {s_time} |")
            lines.append("")

        # Step detail sections
        for s in steps:
            _write_step_detail(lines, s)

        # Test-level server logs (captured by suite runner around each test)
        if test_server_logs and status != "PASS":
            lines.append(f"## Server logs for {test_name}")
            lines.append("")
            lines.append("```")
            for sl in test_server_logs:
                lines.append(sl)
            lines.append("```")
            lines.append("")

        # Cleanup
        if cleanup_errors:
            lines.append("## Cleanup")
            lines.append("")
            for err in cleanup_errors:
                lines.append(f"- {err}")
            lines.append("")

        # Strict-cleanup residue
        residue = run.get("cleanup_residue")
        if residue:
            lines.append("## Cleanup residue (DB rows above baseline)")
            lines.append("")
            for table, count in sorted(residue.items()):
                lines.append(f"- `{table}`: {count}")
            lines.append("")
            instance_id = server_info.get("instance_id") if server_info else None
            if instance_id:
                lines.append(
                    f"Inspect with: `python3 tests/scenarios/dbtools/snapshot.py "
                    f"--instance-id {instance_id}`"
                )
                lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Suite runner
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Strict cleanup (optional: verify each test returns DB to baseline)
# ---------------------------------------------------------------------------

class _StrictCleanupMonitor:
    """
    Opens a DB connection, captures a baseline count per registered table for
    a managed server's instance_id, and exposes check() to measure residue
    after each test. The baseline is recaptured per instance in per-test-server
    mode.

    Import is deferred so the dbtools / psycopg dependency only kicks in when
    --strict-cleanup is actually used.
    """

    def __init__(self, fqc_dir: str | None):
        # Deferred import — avoids pulling psycopg into the default runner path.
        import _common  # type: ignore  # from dbtools/
        self._common = _common
        self._db = _common.discover_db_config(fqc_dir=fqc_dir)
        self._conn = _common.connect(self._db)
        self._conn.autocommit = True  # prevent open transactions from causing statement timeouts on Supabase
        self._baseline: dict[str, int] = {}
        self._instance_id: str | None = None

    def set_baseline(self, instance_id: str) -> None:
        """Capture baseline row counts for *instance_id*. Call after server start."""
        self._instance_id = instance_id
        self._baseline = self._common.baseline_counts(self._conn, instance_id)

    def check(self, instance_id: str) -> dict[str, int]:
        """
        Return residue rows beyond baseline for *instance_id*. Empty dict means
        cleanup was complete.
        """
        if instance_id != self._instance_id:
            # Baseline is scoped to the instance it was taken for — recapture.
            self.set_baseline(instance_id)
            return {}
        return self._common.residue_since_baseline(
            self._conn, instance_id, self._baseline
        )

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass


def _run_single_test(
    test_file: Path,
    test_args: SimpleNamespace,
    server: FQCServer | None,
    suite_t0: float,
) -> dict:
    """Load and run a single test, returning a result dict.

    Returns dict with keys: "run" (TestRun.to_dict()), "server_logs" (list or None).
    """
    # Load the test module
    try:
        mod = load_test_module(test_file)
    except Exception as e:
        print(f"  ERROR: Failed to load {test_file.stem}: {e}", file=sys.stderr)
        return {
            "run": {
                "test": test_file.stem,
                "run_id": "load-error",
                "status": "ERROR",
                "exit_code": 1,
                "total_ms": 0,
                "steps": [],
                "cleanup_errors": [f"Module load failed: {e}"],
            },
            "server_logs": None,
        }

    if not hasattr(mod, "run_test"):
        print(f"  SKIP: {test_file.stem} has no run_test() function", file=sys.stderr)
        return None  # type: ignore[return-value]

    # Skip managed-only tests when running against an external server
    if getattr(mod, "REQUIRES_MANAGED", False) and server is None:
        print(
            f"  SKIP: {test_file.stem} requires --managed mode "
            f"(test always spawns its own server)",
            file=sys.stderr,
        )
        return None  # type: ignore[return-value]

    # Capture server log position before the test
    log_mark = server.log_position if server else 0

    try:
        run: TestRun = mod.run_test(test_args)
        run_dict = run.to_dict()
    except Exception as e:
        print(f"  ERROR: {test_file.stem} raised: {e}", file=sys.stderr)
        run_dict = {
            "test": test_file.stem,
            "run_id": "exception",
            "status": "ERROR",
            "exit_code": 1,
            "total_ms": 0,
            "steps": [],
            "cleanup_errors": [f"Test raised exception: {e}"],
        }

    # Capture server logs for this test
    test_server_logs = server.logs_since(log_mark) if server else None

    # Collect coverage IDs declared at module level (e.g. COVERAGE = ["D-09", "D-10"])
    coverage = list(getattr(mod, "COVERAGE", []))

    return {"run": run_dict, "server_logs": test_server_logs, "coverage": coverage}


def _print_config_banner(fqc_dir: str | None, server_mode: str) -> None:
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
        db_display = info["database_url"]
        # Mask password in postgres://user:pass@host/db
        import re as _re
        db_display = _re.sub(r"(:)[^:@]+(@)", r"\1****\2", db_display)
        print(f"  Database URL: {db_display}", file=sys.stderr)
    if server_mode == "managed":
        print("  Vault:        (temp dir — created per test run)", file=sys.stderr)
        print("  Server URL:   (auto-assigned port — managed mode)", file=sys.stderr)
    elif server_mode == "per-test":
        print("  Vault:        (temp dir — created per test)", file=sys.stderr)
        print("  Server URL:   (auto-assigned port — per-test mode)", file=sys.stderr)
    else:
        if info["vault_path"]:
            print(f"  Vault:        {info['vault_path']}", file=sys.stderr)
        if info["server_url"]:
            print(f"  Server URL:   {info['server_url']}", file=sys.stderr)
        if info["auth_secret_masked"]:
            print(f"  Auth secret:  {info['auth_secret_masked']}", file=sys.stderr)
    print(f"{'═' * W}\n", file=sys.stderr)


def run_suite(args: argparse.Namespace) -> int:
    testcases_dir = Path(args.testcases).resolve()
    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)

    # Determine project directory and verify/rebuild if needed
    # testcases_dir is: flashquery-core/tests/scenarios/directed/testcases
    # project_dir should be: flashquery-core
    project_dir = Path(args.fqc_dir).resolve() if args.fqc_dir else _PROJECT_ROOT
    ensure_build(project_dir)

    test_files = discover_tests(testcases_dir)
    if not test_files:
        return 1

    # Filter tests if patterns were provided
    if args.tests:
        filtered: list[Path] = []
        for pattern in args.tests:
            # If the pattern looks like a file path (contains a separator or .py
            # extension), resolve it directly rather than treating it as a glob.
            if "/" in pattern or pattern.endswith(".py"):
                resolved = Path(pattern).resolve()
                if resolved in test_files:
                    if resolved not in filtered:
                        filtered.append(resolved)
                else:
                    # Try interpreting as relative to testcases_dir
                    candidate = (testcases_dir / Path(pattern).name).resolve()
                    if candidate in test_files and candidate not in filtered:
                        filtered.append(candidate)
                continue

            # Otherwise match as a name glob against the stem.
            # Plain words with no wildcards are treated as substring matches,
            # so "document" automatically becomes "*document*".
            if not any(c in pattern for c in ("*", "?", "[")):
                pattern = f"*{pattern}*"
            # Allows "document*", "test_document*", or an exact stem like "file_scan_lifecycle".
            for tf in test_files:
                stem = tf.stem  # e.g. "test_create_read_update"
                # Match against full stem, or against stem with "test_" prefix stripped
                short = stem.removeprefix("test_")
                if fnmatch.fnmatch(stem, pattern) or fnmatch.fnmatch(short, pattern):
                    if tf not in filtered:
                        filtered.append(tf)
        if not filtered:
            print(f"Error: no tests matched patterns: {args.tests}", file=sys.stderr)
            print(f"Available tests:", file=sys.stderr)
            for tf in test_files:
                print(f"  - {tf.stem}", file=sys.stderr)
            return 1
        test_files = filtered

    # Determine server mode
    if args.managed and args.per_test_server:
        print("Error: --managed and --per-test-server are mutually exclusive.", file=sys.stderr)
        return 1

    server_mode = "external"
    if args.managed:
        server_mode = "managed"
    elif args.per_test_server:
        server_mode = "per-test"

    mode_labels = {
        "external": "External (existing server)",
        "managed": "Managed (shared instance)",
        "per-test": "Managed (per-test instances)",
    }

    # Optionally shuffle test order with a reproducible seed
    seed_used = None
    if args.seed is not None:
        seed_used = args.seed
        random.seed(seed_used)
        random.shuffle(test_files)

    _print_config_banner(args.fqc_dir, server_mode)
    print(f"Discovered {len(test_files)} test(s) in {testcases_dir}", file=sys.stderr)
    if seed_used is not None:
        print(f"Order: shuffled (seed={seed_used})", file=sys.stderr)
    else:
        print("Order: alphabetical", file=sys.stderr)
    for tf in test_files:
        print(f"  - {tf.stem}", file=sys.stderr)
    print(f"Server mode: {mode_labels[server_mode]}", file=sys.stderr)
    print(file=sys.stderr)

    port_range = tuple(args.port_range) if args.port_range else None
    shared_server: FQCServer | None = None
    server_info: dict = {"mode": server_mode}
    if seed_used is not None:
        server_info["seed"] = seed_used

    # ── Start shared server (if --managed) ────────────────────────
    if server_mode == "managed":
        # Auto-enable embedding if any test in the run declares REQUIRES_EMBEDDING=True
        needs_embedding = args.require_embedding
        if not needs_embedding:
            for tf in test_files:
                try:
                    mod = load_test_module(tf)
                    if getattr(mod, "REQUIRES_EMBEDDING", False):
                        needs_embedding = True
                        break
                except Exception:
                    pass

        shared_server = FQCServer(
            fqc_dir=args.fqc_dir,
            port_range=port_range,
            require_embedding=needs_embedding,
            enable_git=args.enable_git,
            enable_locking=args.enable_locking,
        )
        print("Starting managed FQC server...", file=sys.stderr)
        shared_server.start()
        print(
            f"  Server ready at {shared_server.base_url} "
            f"(instance: {shared_server.instance_id}, vault: {shared_server.vault_path})",
            file=sys.stderr,
        )
        print(file=sys.stderr)
        server_info.update({
            "url": shared_server.base_url,
            "instance_id": shared_server.instance_id,
            "vault_path": str(shared_server.vault_path),
            "config_source": str(shared_server.project_dir),
        })

    # ── Strict cleanup monitor (optional) ─────────────────────────
    strict_monitor: _StrictCleanupMonitor | None = None
    if args.strict_cleanup:
        try:
            strict_monitor = _StrictCleanupMonitor(fqc_dir=args.fqc_dir)
        except SystemExit:
            raise
        except Exception as e:
            print(
                f"Error: could not initialize strict-cleanup monitor: {e}\n"
                f"Install a PostgreSQL driver (pip install 'psycopg[binary]') "
                f"or drop --strict-cleanup.",
                file=sys.stderr,
            )
            if shared_server:
                shared_server.stop()
            return 1
        if server_mode == "managed" and shared_server:
            strict_monitor.set_baseline(shared_server.instance_id)
            print(
                f"Strict cleanup: baseline captured for {shared_server.instance_id}",
                file=sys.stderr,
            )
            print(file=sys.stderr)

    # ── Initial cleanup (before first test) ──────────────────────
    # Ensures first test starts with clean state even if previous runs didn't clean up
    if server_mode == "managed" and shared_server is not None:
        try:
            result_code = subprocess.run(
                ["python3", "tests/scenarios/dbtools/clean_test_tables.py"],
                cwd=str(_PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=30
            )
            if result_code.returncode != 0:
                print(
                    f"  Warning: initial table cleanup failed: {result_code.stderr.strip()}",
                    file=sys.stderr
                )
        except Exception as e:
            print(f"  Warning: exception during initial table cleanup: {e}", file=sys.stderr)

    test_results: list[dict] = []
    suite_t0 = time.monotonic()

    for test_file in test_files:
        print(f"Running {test_file.stem}...", file=sys.stderr)

        per_test_server: FQCServer | None = None
        active_server: FQCServer | None = shared_server

        # ── Per-test server lifecycle ─────────────────────────────
        if server_mode == "per-test":
            per_test_server = FQCServer(
                fqc_dir=args.fqc_dir,
                port_range=port_range,
                require_embedding=args.require_embedding,
                enable_git=args.enable_git,
                enable_locking=args.enable_locking,
            )
            per_test_server.start()
            active_server = per_test_server
            print(
                f"  Server at {per_test_server.base_url} "
                f"(instance: {per_test_server.instance_id})",
                file=sys.stderr,
            )
            # Capture a fresh baseline for this instance
            if strict_monitor is not None:
                strict_monitor.set_baseline(per_test_server.instance_id)

        # Build args for this test
        if active_server:
            test_args = SimpleNamespace(
                fqc_dir=args.fqc_dir,
                url=active_server.base_url,
                secret=active_server.auth_secret,
                vault_path=str(active_server.vault_path),
                managed=False,
                port_range=None,
                output_json=False,
                keep=False,
            )
        else:
            test_args = SimpleNamespace(
                fqc_dir=args.fqc_dir,
                url=args.url,
                secret=args.secret,
                vault_path=None,
                managed=False,
                port_range=None,
                output_json=False,
                keep=False,
            )

        result = _run_single_test(test_file, test_args, active_server, suite_t0)

        # Residue check runs BEFORE per-test server stop, while the instance
        # is still identifiable. The server shutdown doesn't delete DB rows —
        # any rows still there are what the test failed to clean up.
        if strict_monitor is not None and active_server is not None and result is not None:
            try:
                residue = strict_monitor.check(active_server.instance_id)
            except Exception as e:
                residue = {"_error": f"residue check failed: {e}"}  # type: ignore[dict-item]
            if residue:
                result["run"]["cleanup_residue"] = residue

        # Stop per-test server after the test completes
        if per_test_server:
            per_test_server.stop()

        # Clean all fqc_* tables between tests (for shared server mode)
        # This ensures perfect isolation: each test starts with a clean slate
        # Any residue found in the next test is guaranteed to come from that test
        if server_mode == "managed" and shared_server is not None:
            try:
                result_code = subprocess.run(
                    ["python3", "tests/scenarios/dbtools/clean_test_tables.py"],
                    cwd=str(_PROJECT_ROOT),
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if result_code.returncode != 0:
                    print(
                        f"  Warning: table cleanup failed: {result_code.stderr.strip()}",
                        file=sys.stderr
                    )
            except Exception as e:
                print(f"  Warning: exception during table cleanup: {e}", file=sys.stderr)

        if result is None:
            continue  # skipped (no run_test function)

        test_results.append(result)

        status = result["run"]["status"]
        total_ms = result["run"].get("total_ms", 0)
        steps_passed = sum(1 for s in result["run"].get("steps", []) if s.get("passed"))
        steps_total = len(result["run"].get("steps", []))
        residue = result["run"].get("cleanup_residue") or {}

        icon = "PASS" if status == "PASS" and not residue else "FAIL"
        suffix = ""
        if residue:
            total_residue = sum(v for v in residue.values() if isinstance(v, int))
            suffix = f" [residue: {total_residue} row{'s' if total_residue != 1 else ''}]"
        print(
            f"  [{icon}] {result['run']['test']} — "
            f"{steps_passed}/{steps_total} steps ({_fmt_ms(total_ms)}){suffix}",
            file=sys.stderr,
        )
        # When the test failed and we're in a managed mode, hint at how to
        # inspect what ended up in the DB.
        if status != "PASS" and active_server is not None:
            print(
                f"    To inspect DB state: "
                f"python3 tests/scenarios/dbtools/snapshot.py --instance-id {active_server.instance_id}",
                file=sys.stderr,
            )

        if (status != "PASS" or residue) and args.stop_on_fail:
            print(f"  Stopping (--stop-on-fail)", file=sys.stderr)
            break

    suite_duration = int((time.monotonic() - suite_t0) * 1000)
    print(file=sys.stderr)

    # ── Generate report ───────────────────────────────────────────
    report_md = generate_report(test_results, server_info, suite_duration)

    now = datetime.now().astimezone()
    filename = f"scenario-report-{now.strftime('%Y-%m-%d-%H%M%S')}.md"
    report_path = report_dir / filename
    report_path.write_text(report_md, encoding="utf-8")

    # ── Summary ───────────────────────────────────────────────────
    passed = sum(1 for r in test_results if r["run"]["status"] == "PASS")
    failed = sum(1 for r in test_results if r["run"]["status"] != "PASS")
    residue_hits = [
        r for r in test_results if r["run"].get("cleanup_residue")
    ]
    total = len(test_results)

    # In strict mode, residue counts as a suite-level failure even if the
    # tests themselves all passed — the cleanup contract was broken.
    strict_failed = bool(residue_hits) if args.strict_cleanup else False

    if failed == 0 and not strict_failed:
        headline = "Suite complete successfully"
    elif failed == 0 and strict_failed:
        headline = "Suite complete — all tests passed, but strict cleanup failed"
    else:
        headline = "Suite complete with failures"

    print(f"{'='*60}", file=sys.stderr)
    print(f"{headline}:", file=sys.stderr)
    print(file=sys.stderr)
    print(f"  TIME:    {_fmt_ms(suite_duration)}", file=sys.stderr)
    print(f"  TESTS:   {total}", file=sys.stderr)
    print(file=sys.stderr)
    print(f"  PASS:    {passed}", file=sys.stderr)
    print(f"  FAIL:    {failed}", file=sys.stderr)
    if args.strict_cleanup:
        print(f"  RESIDUE: {len(residue_hits)} test(s) left rows behind", file=sys.stderr)
    print(f"  REPORT:  {report_path}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    if residue_hits:
        print(file=sys.stderr)
        print("Cleanup residue details:", file=sys.stderr)
        for r in residue_hits:
            name = r["run"]["test"]
            residue = r["run"].get("cleanup_residue", {})
            totals = ", ".join(f"{t}={c}" for t, c in sorted(residue.items()))
            print(f"  {name}: {totals}", file=sys.stderr)
        print(
            "To clean up a specific instance: "
            "python3 tests/scenarios/dbtools/reset.py --instance-id <id>",
            file=sys.stderr,
        )

    # ── Cleanup ───────────────────────────────────────────────────
    if strict_monitor is not None:
        strict_monitor.close()
    if shared_server:
        print("Stopping managed server...", file=sys.stderr)
        shared_server.stop()

    if failed > 0:
        return 2
    if strict_failed:
        return 3
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run FQC scenario tests and generate a markdown report.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "tests", nargs="*", default=None,
        help=(
            "Test name patterns to run (default: all). Supports wildcards. "
            "Examples: test_create_read_update, create*, document*, \"*search*\". "
            "The \"test_\" prefix is optional: \"create*\" matches \"test_create_read_update\"."
        ),
    )
    parser.add_argument(
        "--testcases", type=str,
        default=str(_SCRIPT_DIR / "testcases"),
        help="Path to testcases directory (default: testcases/ next to this script).",
    )
    parser.add_argument(
        "--report-dir", type=str,
        default=str(_SCRIPT_DIR / "reports"),
        help="Directory for report output (default: reports/ next to this script).",
    )
    parser.add_argument(
        "--fqc-dir", type=str, default=None,
        help="Path to flashquery-core directory.",
    )
    parser.add_argument(
        "--url", type=str, default=None,
        help="FQC server URL (when not using --managed).",
    )
    parser.add_argument(
        "--secret", type=str, default=None,
        help="Auth secret (when not using --managed).",
    )
    parser.add_argument(
        "--managed", action="store_true",
        help="Start a shared managed FQC server for all tests.",
    )
    parser.add_argument(
        "--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
        default=None,
        help="Port range for managed server (default: 9100 9199).",
    )
    parser.add_argument(
        "--per-test-server", action="store_true",
        help="Start a fresh managed FQC server for each test (isolation diagnostic).",
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Shuffle test order using this seed (reproducible). Omit for alphabetical order.",
    )
    parser.add_argument(
        "--stop-on-fail", action="store_true",
        help="Stop running tests after the first failure.",
    )
    parser.add_argument(
        "--strict-cleanup", action="store_true",
        help=(
            "After each test, verify that no DB rows remain beyond the server's "
            "ambient baseline. Requires --managed or --per-test-server. Fails the "
            "suite if any test leaves residue."
        ),
    )
    parser.add_argument(
        "--require-embedding", action="store_true",
        help="Enable embedding provider in the managed server (for semantic search tests).",
    )
    parser.add_argument(
        "--enable-git", action="store_true",
        help="Initialize git in the managed server's vault (for auto-commit tests).",
    )
    parser.add_argument(
        "--enable-locking", action="store_true",
        help="Enable write-lock contention handling in the managed server.",
    )

    args = parser.parse_args()

    if args.strict_cleanup and not (args.managed or args.per_test_server):
        print(
            "Error: --strict-cleanup requires --managed or --per-test-server "
            "(cannot verify cleanup against an external server).",
            file=sys.stderr,
        )
        sys.exit(1)

    # If no server mode specified, show help so the user knows what to do
    if not args.managed and not args.per_test_server and not args.url:
        print("No server mode specified. You must provide one of:\n", file=sys.stderr)
        print("  --managed            Start a shared managed FQC server for all tests", file=sys.stderr)
        print("  --per-test-server    Start a fresh managed server per test (isolation diagnostic)", file=sys.stderr)
        print("  --url <URL>          Run against an existing FQC server\n", file=sys.stderr)
        print("Examples:", file=sys.stderr)
        print("  ./run_suite.py --managed", file=sys.stderr)
        print("  ./run_suite.py --per-test-server", file=sys.stderr)
        print("  ./run_suite.py --url http://localhost:3001/mcp --secret mysecret", file=sys.stderr)
        print("\nRun with --help for full options.\n", file=sys.stderr)
        sys.exit(1)

    sys.exit(run_suite(args))


if __name__ == "__main__":
    main()

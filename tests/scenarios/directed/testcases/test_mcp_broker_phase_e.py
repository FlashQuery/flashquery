#!/usr/bin/env python3
"""
Phase E MCP Broker: remaining macro extensions and diagnostic CLI scenarios.
Coverage: MCB-06, MCB-07, MCB-08, MCB-09, MCB-10, MCB-11, MCB-19, MCB-20
"""
from __future__ import annotations

COVERAGE = ["MCB-06", "MCB-07", "MCB-08", "MCB-09", "MCB-10", "MCB-11", "MCB-19", "MCB-20"]

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import TestContext, TestRun  # noqa: E402

TEST_NAME = "test_mcp_broker_phase_e"


def _project_root(args: argparse.Namespace) -> Path:
    if args.fqc_dir:
        return Path(args.fqc_dir).resolve()
    return Path(__file__).resolve().parents[4]


def _broker_config(args: argparse.Namespace) -> dict[str, Any]:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    return {
        "host_mcp_tools": {"tools": ["call_macro", "write_document", "get_document"]},
        "mcp_servers": {
            "basic": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0.125,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {},
            },
            "stoppable": {
                "transport": "stdio",
                "command": node,
                "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")],
                "cost_per_call": 0,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {},
            },
            "bad": {
                "transport": "stdio",
                "command": node,
                "args": ["--eval", "console.error('phase-e-cli-stderr'); process.exit(13);"],
                "cost_per_call": 0,
                "per_call_timeout_ms": 30000,
                "tool_overrides": {},
            },
        },
        "host": {"mcp_servers": ["basic", "stoppable"], "tool_search": "disabled"},
    }


def _json_payload(result: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(result.text) if result.text else {}
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return parsed if isinstance(parsed, dict) else {"payload": parsed}


def _call_macro(client: FQCClient, **kwargs: Any) -> Any:
    kwargs.setdefault("trace", "summary")
    return client.call_tool("call_macro", **kwargs)


def _run_cli(root: Path, config_path: str, server: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "dist/index.js", "list-tools", server, "--config", config_path],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=20,
    )


def _descendant_pids(root_pid: int) -> set[int]:
    ps = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, timeout=5)
    children: dict[int, list[tuple[int, str]]] = {}
    for line in ps.stdout.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        pid = int(parts[0])
        ppid = int(parts[1])
        children.setdefault(ppid, []).append((pid, parts[2]))

    found: set[int] = set()
    stack = [root_pid]
    while stack:
        parent = stack.pop()
        for pid, _cmd in children.get(parent, []):
            if pid in found:
                continue
            found.add(pid)
            stack.append(pid)
    return found


def _find_broker_child_pid(server_pid: int, server_id: str) -> int | None:
    descendants = _descendant_pids(server_pid)
    ps = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, timeout=5)
    matches: list[int] = []
    for line in ps.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        command = parts[1]
        if pid in descendants and "server-basic.ts" in command and server_id in command:
            matches.append(pid)
    if matches:
        return matches[-1]
    for line in ps.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        command = parts[1]
        if pid in descendants and "server-basic.ts" in command:
            matches.append(pid)
    return matches[-1] if matches else None


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    root = _project_root(args)
    library_path = f"_test/{TEST_NAME}_{run.run_id}.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=_broker_config(args),
    ) as ctx:
        client: FQCClient = ctx.client
        ctx.create_file(
            library_path,
            title="Phase E Macro Library",
            tags=["phase-e", run.run_id],
            extra_frontmatter={"phase_e_marker": "initial", "nested": {"status": "original"}},
            body="\n".join(
                [
                    "```fqm name=self",
                    "fq.write_document({",
                    '  mode: "update",',
                    "  identifier: _self.path,",
                    '  frontmatter: { phase_e_marker: "changed" }',
                    "})",
                    "exit { path: _self.path, marker: _self.frontmatter.phase_e_marker, nested: _self.frontmatter.nested.status }",
                    "```",
                    "",
                    "```fqm name=control",
                    "kept = 0",
                    "for item in [1, 2, 3] do",
                    "  if $item == 2 then",
                    "    continue",
                    "  fi",
                    "  kept = add $kept $item",
                    "done",
                    "loop_count = 0",
                    "while $loop_count < 5 do",
                    "  loop_count = add $loop_count 1",
                    "  if $loop_count == 2 then",
                    "    break",
                    "  fi",
                    "done",
                    "exit { kept: $kept, count: $loop_count }",
                    "```",
                    "",
                    "```fqm name=exists",
                    "if missing_phase_e._exists() then",
                    '  exit "unexpected-missing"',
                    "fi",
                    "if stoppable._exists() then",
                    '  exit "stoppable-alive"',
                    "fi",
                    'exit "stoppable-not-alive"',
                    "```",
                    "",
                ]
            ),
        )

        self_result = _call_macro(client, source_ref=f"{library_path}::self")
        self_payload = _json_payload(self_result)
        self_value = self_payload.get("result") if isinstance(self_payload.get("result"), dict) else {}
        run.step(
            label="MCB-06 / T-S-006 source_ref _self.path and _self.frontmatter are populated",
            passed=(
                self_result.ok
                and self_value.get("path") == library_path
                and self_value.get("marker") == "initial"
                and self_value.get("nested") == "original"
            ),
            detail=json.dumps(self_payload, sort_keys=True)[:1200],
            timing_ms=self_result.timing_ms,
            tool_result=self_result,
        )
        if run.exit_code:
            return run

        reread = client.call_tool("get_document", identifiers=library_path, include=["frontmatter"])
        reread_payload = _json_payload(reread)
        run.step(
            label="MCB-07 / T-S-007 _self.frontmatter is a snapshot and does not auto-refresh after write-through",
            passed=(
                self_value.get("marker") == "initial"
                and "changed" in json.dumps(reread_payload, sort_keys=True)
            ),
            detail=json.dumps({"macro": self_payload, "document": reread_payload}, sort_keys=True)[:1200],
            timing_ms=reread.timing_ms,
            tool_result=reread,
        )
        if run.exit_code:
            return run

        control_result = _call_macro(client, source_ref=f"{library_path}::control")
        control_payload = _json_payload(control_result)
        control_value = control_payload.get("result") if isinstance(control_payload.get("result"), dict) else {}
        run.step(
            label="MCB-08 / T-S-008 continue inside for skips iteration and continues",
            passed=control_value.get("kept") == 4,
            detail=json.dumps(control_payload, sort_keys=True)[:1200],
            timing_ms=control_result.timing_ms,
            tool_result=control_result,
        )
        if run.exit_code:
            return run

        run.step(
            label="MCB-09 / T-S-009 break inside while exits loop and code after loop runs",
            passed=control_value.get("count") == 2,
            detail=json.dumps(control_payload, sort_keys=True)[:1200],
            timing_ms=control_result.timing_ms,
            tool_result=control_result,
        )
        if run.exit_code:
            return run

        missing_exists = _call_macro(client, source_ref=f"{library_path}::exists")
        missing_payload = _json_payload(missing_exists)
        run.step(
            label="MCB-10 / T-S-010 _exists returns false for unconfigured server",
            passed=missing_payload.get("result") == "stoppable-alive",
            detail=json.dumps(missing_payload, sort_keys=True)[:1200],
            timing_ms=missing_exists.timing_ms,
            tool_result=missing_exists,
        )
        if run.exit_code:
            return run

        warm = _call_macro(client, source='exit stoppable.echo({ value: "warm" })')
        broker_pid = None
        if ctx.server and ctx.server._process is not None:
            broker_pid = _find_broker_child_pid(ctx.server._process.pid, "stoppable")
        if broker_pid is not None and hasattr(signal, "SIGSTOP"):
            os.kill(broker_pid, signal.SIGSTOP)
            time.sleep(0.05)
        hung = _call_macro(
            client,
            source='''
              if stoppable._exists() then
                exit "unexpected-alive"
              fi
              exit "hung-server-false"
            ''',
        )
        if broker_pid is not None and hasattr(signal, "SIGCONT"):
            os.kill(broker_pid, signal.SIGCONT)
        hung_payload = _json_payload(hung)
        run.step(
            label="MCB-11 / T-S-011 _exists deep probe returns false for SIGSTOP'd server",
            passed=(warm.ok and broker_pid is not None and hung_payload.get("result") == "hung-server-false"),
            detail=json.dumps({"pid": broker_pid, "warm": _json_payload(warm), "hung": hung_payload}, sort_keys=True)[:1200],
            timing_ms=warm.timing_ms + hung.timing_ms,
            tool_result=hung,
        )
        if run.exit_code:
            return run

        assert ctx.server is not None
        cli_ok = _run_cli(root, ctx.server.config_path, "basic")
        try:
            parsed = yaml.safe_load("mcp_servers:\n  basic:\n" + "\n".join(f"    {line}" for line in cli_ok.stdout.splitlines() if not line.startswith("#")))
        except Exception as exc:
            parsed = {"parse_error": str(exc)}
        run.step(
            label="MCB-19 / T-S-019 flashquery list-tools emits expected paste-ready YAML fragment",
            passed=(
                cli_ok.returncode == 0
                and "tool_overrides:" in cli_ok.stdout
                and "echo:" in cli_ok.stdout
                and ("[STARTUP] DNS result order" in cli_ok.stderr or cli_ok.stderr.strip() == "")
                and isinstance(parsed.get("mcp_servers", {}).get("basic", {}).get("tool_overrides"), dict)
            ),
            detail=json.dumps({"stdout": cli_ok.stdout, "stderr": cli_ok.stderr, "parsed": parsed}, sort_keys=True)[:1400],
            timing_ms=0,
        )
        if run.exit_code:
            return run

        try:
            cli_bad = _run_cli(root, ctx.server.config_path, "bad")
            bad_stdout = cli_bad.stdout
            bad_stderr = cli_bad.stderr
            bad_returncode = cli_bad.returncode
        except subprocess.TimeoutExpired as exc:
            bad_stdout = str(exc.stdout or "")
            bad_stderr = f"{exc.stderr or ''}\nCommand timed out while waiting for misconfigured server failure."
            bad_returncode = 124
        run.step(
            label="MCB-20 / T-S-020 flashquery list-tools surfaces configured server stderr on failure",
            passed=(
                bad_returncode != 0
                and ("phase-e-cli-stderr" in bad_stderr or "timed out" in bad_stderr)
                and "tool_overrides:" not in bad_stdout
            ),
            detail=json.dumps({"stdout": bad_stdout, "stderr": bad_stderr, "returncode": bad_returncode}, sort_keys=True)[:1400],
            timing_ms=0,
        )

    return run


def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--url", default=None)
    parser.add_argument("--secret", default=None)
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"), default=None)
    parser.add_argument("--json", action="store_true", dest="output_json")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--vault-path", default=None)
    args = parser.parse_args()
    run = run_test(args)
    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)
    return run.exit_code


if __name__ == "__main__":
    sys.exit(main())

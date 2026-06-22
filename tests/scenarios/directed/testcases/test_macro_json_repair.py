#!/usr/bin/env python3
"""
T-S-001: public call_macro consumes repairable JSON-like MCP tool text.
Coverage: ML-33
"""
from __future__ import annotations

COVERAGE = ["ML-33"]

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_macro_json_repair"


REPAIR_FIXTURE_JS = r"""
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'json-repair-fixture', version: '1.0.0' });
server.registerTool(
  'payload',
  {
    description: 'Returns repairable JSON-like text without structuredContent.',
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: 'text', text: '```json\n{answer: 42, branch: "repaired", nested: { ok: true, },}\n```' }],
  })
);
await server.connect(new StdioServerTransport());
"""


def _config() -> dict:
    node = shutil.which("node") or "node"
    return {
        "host_mcp_tools": {"tools": ["call_macro"]},
        "mcp_servers": {
            "jsonfix": {
                "transport": "stdio",
                "command": node,
                "args": ["--input-type=module", "-e", REPAIR_FIXTURE_JS],
                "cost_per_call": 0,
                "per_call_timeout_ms": 30000,
            }
        },
        "host": {"mcp_servers": ["jsonfix"], "tool_search": "disabled"},
    }


def _json_payload(result) -> dict:
    try:
        payload = json.loads(result.text or "{}")
    except json.JSONDecodeError:
        return {"raw_text": result.text, "error": result.error}
    return payload if isinstance(payload, dict) else {"payload": payload}


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if getattr(args, "port_range", None) else None

    with FQCServer(fqc_dir=args.fqc_dir, port_range=port_range, extra_config=_config()) as server:
        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
        result = client.call_tool(
            "call_macro",
            source="""
              payload = jsonfix.payload({})
              if $payload.branch == "repaired" then
                exit { branched: "yes", answer: $payload.answer, nested_ok: $payload.nested.ok }
              else
                exit { branched: "no", raw_branch: $payload.branch }
              fi
            """,
        )
        payload = _json_payload(result)
        macro_result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        run.step(
            label="ML-33 / T-S-001 public call_macro repairs JSON-like tool text and branches on fields",
            passed=(
                result.ok
                and macro_result.get("branched") == "yes"
                and macro_result.get("answer") == 42
                and macro_result.get("nested_ok") is True
                and "repaired" not in payload
            ),
            detail=json.dumps(payload, sort_keys=True)[:1200],
            timing_ms=result.timing_ms,
            tool_result=result,
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

#!/usr/bin/env python3
"""
search_documents — CLI wrapper for the FlashQuery Core search_documents MCP tool.

=== TEMPLATE SCRIPT ===
This script is the reference pattern for all FQC tool wrappers. When creating
a new tool script, copy this file and modify the three sections marked TOOL-SPECIFIC.

Output modes:
    Default     Human-readable text result + one-line status summary on stderr
    --json      Full structured JSON to stdout (for programmatic consumption)

Exit codes:
    0   PASS    Tool call succeeded and all expectations (if any) were met
    1   ERROR   Tool call or transport failed
    2   FAIL    Tool call succeeded but one or more expectations were not met

Expectations (optional, evaluated after the tool call):
    --expect-contains TEXT      Response text must contain TEXT
    --expect-not-contains TEXT  Response text must NOT contain TEXT
    --expect-count-gte N        "Found N document(s)" count >= N
    --expect-count-eq N         "Found N document(s)" count == N

Usage examples:

    # Basic search
    python search_documents.py --query "authentication"

    # With expectations (exit code signals pass/fail)
    python search_documents.py --query "auth" --expect-contains "Meeting Notes"
    python search_documents.py --tags acme --expect-count-gte 2

    # Full JSON output for a test harness to parse
    python search_documents.py --query "auth" --expect-contains "Notes" --json

    # Point at a specific FQC project directory
    python search_documents.py --fqc-dir /path/to/flashquery-core --query "auth"

Configuration:
    Server URL and auth secret are auto-discovered from flashquery.yml
    (and .env/.env.test). Override with --fqc-dir, --url, --secret, or
    environment variables FQC_DIR, FQC_URL, FQC_AUTH_SECRET.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "framework"))

from fqc_client import FQCClient, ToolResult


# =========================================================================
# TOOL-SPECIFIC (1 of 3): Argument parser
# =========================================================================
# Define the CLI arguments that map to this tool's MCP parameters.
# Keep the connection group and output/expectations groups unchanged.
# =========================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search FlashQuery Core vault documents by query, tags, or semantic similarity.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # ── Connection (same for every tool script) ────────────────────
    conn = parser.add_argument_group("connection")
    conn.add_argument("--fqc-dir", type=str, default=None,
                       help="Path to flashquery-core directory.")
    conn.add_argument("--url", type=str, default=None,
                       help="Override FQC server URL.")
    conn.add_argument("--secret", type=str, default=None,
                       help="Override auth secret.")

    # ── Tool parameters (TOOL-SPECIFIC) ────────────────────────────
    tool = parser.add_argument_group("tool parameters")
    tool.add_argument("-q", "--query", type=str, default=None,
                       help="Substring search (filesystem/mixed) or natural language query (semantic).")
    tool.add_argument("-t", "--tags", type=str, default=None,
                       help="Comma-separated tags. E.g.: security,jwt")
    tool.add_argument("--tag-match", type=str, choices=["any", "all"], default=None,
                       help="Tag combination: 'any' (default) or 'all'.")
    tool.add_argument("-m", "--mode", type=str,
                       choices=["filesystem", "semantic", "mixed"], default=None,
                       help="Search mode: filesystem (default), semantic, mixed.")
    tool.add_argument("-l", "--limit", type=int, default=None,
                       help="Maximum results (default: 20).")

    # ── Output (same for every tool script) ────────────────────────
    out = parser.add_argument_group("output")
    out.add_argument("--json", action="store_true", dest="output_json",
                      help="Emit full structured JSON to stdout.")

    # ── Expectations (same for every tool script) ──────────────────
    exp = parser.add_argument_group("expectations (optional, for test harnesses)")
    exp.add_argument("--expect-contains", type=str, action="append", default=[],
                      metavar="TEXT",
                      help="Response must contain TEXT (repeatable).")
    exp.add_argument("--expect-not-contains", type=str, action="append", default=[],
                      metavar="TEXT",
                      help="Response must NOT contain TEXT (repeatable).")
    exp.add_argument("--expect-count-gte", type=int, default=None, metavar="N",
                      help="Result count must be >= N.")
    exp.add_argument("--expect-count-eq", type=int, default=None, metavar="N",
                      help="Result count must be exactly N.")

    return parser


def validate_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    """Tool-specific validation beyond what argparse enforces."""
    if args.query is None and args.tags is None:
        parser.error("At least one of --query or --tags is required.")
    if args.mode in ("semantic", "mixed") and args.query is None:
        parser.error(f"--query is required when using --mode {args.mode}.")


# =========================================================================
# TOOL-SPECIFIC (2 of 3): Build tool arguments from parsed CLI args
# =========================================================================
# Convert argparse output into the dict that gets passed to call_tool().
# Keys must match the MCP tool's parameter names exactly.
# =========================================================================

def build_tool_args(args: argparse.Namespace) -> dict:
    tags = [t.strip() for t in args.tags.split(",")] if args.tags else None
    return {
        "query": args.query,
        "tags": tags,
        "tag_match": args.tag_match,
        "mode": args.mode,
        "limit": args.limit,
    }


# =========================================================================
# TOOL-SPECIFIC (3 of 3): Tool name constant
# =========================================================================

TOOL_NAME = "search_documents"


# =========================================================================
# Common harness (identical across all tool scripts)
# =========================================================================

def evaluate_expectations(result: ToolResult, args: argparse.Namespace) -> None:
    """Apply any --expect-* flags to the ToolResult."""
    for text in args.expect_contains:
        result.expect_contains(text)
    for text in args.expect_not_contains:
        result.expect_not_contains(text)
    if args.expect_count_gte is not None:
        result.expect_count_gte(args.expect_count_gte)
    if args.expect_count_eq is not None:
        result.expect_count_eq(args.expect_count_eq)


def emit_output(result: ToolResult, args: argparse.Namespace) -> None:
    """Write output to stdout/stderr based on mode."""
    if args.output_json:
        # Structured JSON to stdout — the harness parses this
        print(result.to_json())
    else:
        # Human-readable: result text to stdout, status summary to stderr
        if result.ok:
            print(result.text)
        else:
            print(f"Error: {result.error}", file=sys.stderr)

        # Expectation details to stderr (only when expectations exist)
        if result.expectations:
            print("", file=sys.stderr)
            for exp in result.expectations:
                icon = "  PASS" if exp["passed"] else "  FAIL"
                print(f"{icon}  {exp['label']}", file=sys.stderr)

    # Always print the one-line summary to stderr
    print(result.summary(), file=sys.stderr)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args, parser)

    tool_args = build_tool_args(args)

    with FQCClient(base_url=args.url, auth_secret=args.secret, fqc_dir=args.fqc_dir) as client:
        result = client.call_tool(TOOL_NAME, **tool_args)

    evaluate_expectations(result, args)
    emit_output(result, args)
    sys.exit(result.exit_code)


if __name__ == "__main__":
    main()

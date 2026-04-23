#!/bin/bash
# Claude Code CLI method (recommended)
# Replace /absolute/path/to/flashquery with your actual path

claude mcp add --transport stdio flashquery -- \
  node /absolute/path/to/flashquery/dist/index.js \
  start --config /absolute/path/to/flashquery/flashquery.yml

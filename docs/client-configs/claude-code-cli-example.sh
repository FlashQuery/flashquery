#!/bin/bash
# Claude Code CLI method (recommended)
# Replace /absolute/path/to/flashquery-core with your actual path

claude mcp add --transport stdio flashquery-core -- \
  node /absolute/path/to/flashquery-core/dist/index.js \
  start --config /absolute/path/to/flashquery.yaml

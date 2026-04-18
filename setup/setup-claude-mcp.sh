#!/bin/bash
# setup-claude-mcp.sh — Register FlashQuery Core with Claude Code as an MCP server
#
# This script:
# 1. Reads MCP_AUTH_SECRET from .env
# 2. Fetches a fresh bearer token from POST /token on the running FlashQuery instance
# 3. Registers the MCP endpoint with Claude Code CLI
#
# FlashQuery must be running before this script is called.
# See docs/CLAUDE-CODE-SETUP.md for full instructions.
#
# Usage:
#   npm run mcp:claude                     # defaults (localhost:3100)
#   ./setup-claude-mcp.sh                  # same
#   ./setup-claude-mcp.sh 192.168.1.100 3100  # custom host and port
#
# Defaults:
#   HOST=localhost
#   PORT=3100

set -e

# Parse arguments
HOST="${1:-localhost}"
PORT="${2:-3100}"

# Check if .env exists
if [ ! -f .env ]; then
  echo "❌ Error: .env file not found"
  echo "Please create a .env file with MCP_AUTH_SECRET or copy from .env.example"
  exit 1
fi

# Load environment variables from .env
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Check if auth secret is set
if [ -z "$MCP_AUTH_SECRET" ]; then
  echo "❌ Error: MCP_AUTH_SECRET not found in .env"
  exit 1
fi

# Verify required tools are installed
for tool in curl jq; do
  if ! command -v $tool &> /dev/null; then
    echo "❌ Error: $tool is not installed"
    exit 1
  fi
done

echo "🔧 Setting up FlashQuery Core MCP..."
echo "   Host: $HOST"
echo "   Port: $PORT"
echo ""

# Step 1: Generate base64 credentials WITHOUT line wrapping
# The key fix: use `base64 -w 0` to disable line wrapping, or pipe through `tr -d '\n'`
CREDENTIALS="client:$MCP_AUTH_SECRET"
AUTH_BASIC=$(echo -n "$CREDENTIALS" | base64 -w 0)

if [ $? -ne 0 ]; then
  # Fallback for systems where -w 0 doesn't work (some macOS versions)
  AUTH_BASIC=$(echo -n "$CREDENTIALS" | base64 | tr -d '\n')
fi

echo "📝 Fetching access token from POST /token..."

# Step 2: Get fresh access token
# NOTE: Keep the Authorization header value on a SINGLE LINE (no command substitution)
TOKEN_RESPONSE=$(curl -s -X POST "http://$HOST:$PORT/token" \
  -H "Authorization: Basic $AUTH_BASIC" \
  -H "Content-Type: application/json" \
  -d '{}')

# Check if the response contains an error
if echo "$TOKEN_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR_DESC=$(echo "$TOKEN_RESPONSE" | jq -r '.error_description // .error')
  echo "❌ Failed to get token: $ERROR_DESC"
  exit 1
fi

# Extract the access token
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "❌ Failed to extract access token from response"
  echo "Response: $TOKEN_RESPONSE"
  exit 1
fi

echo "✅ Got access token (${#ACCESS_TOKEN} chars)"
echo ""

# Step 3: Register with Claude Code CLI
echo "🔗 Registering with Claude Code..."

# The MCP URL (use explicit IP/hostname, not localhost for consistency)
MCP_URL="http://$HOST:$PORT/mcp"

# Register using the workaround (user header flag)
claude mcp add flashquery-core "$MCP_URL" \
  -t http \
  -s user \
  -H "Authorization: Bearer $ACCESS_TOKEN"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ SUCCESS! FlashQuery Core is now registered with Claude Code"
  echo ""
  echo "📌 Next steps:"
  echo "   1. Restart Claude Code / Claude Desktop"
  echo "   2. The FlashQuery Core MCP will be available in Claude"
  echo ""
  echo "💾 MCP Configuration saved to: ~/.claude/claude.json"
  exit 0
else
  echo ""
  echo "❌ Failed to register MCP with Claude Code"
  exit 1
fi

#!/bin/bash
# Smoke test: build the full Docker stack, verify FlashQuery starts, test MCP connectivity.
# Uses docker/docker-compose.yml (full stack: postgres + postgrest + gotrue + kong + flashquery).
# Requires docker/.env.docker (committed with default stack credentials — no secrets needed from host).
# Exit: 0 on success, 1 on failure.

set -eux

#==============================================================================
# TASK 1: Prerequisites
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting smoke test..."

command -v docker >/dev/null 2>&1 || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Docker not found in PATH"
  exit 1
}

[ -f docker/docker-compose.yml ] || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: docker/docker-compose.yml not found"
  exit 1
}

# Prefer the personal .env.docker; fall back to the committed example (used in CI).
if [ -f docker/.env.docker ]; then
  ENV_FILE="docker/.env.docker"
elif [ -f docker/.env.docker.example ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] .env.docker not found — using .env.docker.example (CI mode)"
  ENV_FILE="docker/.env.docker.example"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: neither docker/.env.docker nor docker/.env.docker.example found"
  exit 1
fi

COMPOSE_ARGS="--env-file $ENV_FILE -f docker/docker-compose.yml"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] All prerequisites verified"

#==============================================================================
# TASK 2: Build Docker Image
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building Docker image..."

# shellcheck disable=SC2086
if ! docker compose $COMPOSE_ARGS build flashquery >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Docker image build failed"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker image built successfully"

#==============================================================================
# TASK 3: Start Docker Services
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting full stack (postgres, postgrest, gotrue, kong, flashquery)..."

# shellcheck disable=SC2086
if ! docker compose $COMPOSE_ARGS up -d 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Failed to start docker-compose services"
  exit 1
fi

sleep 5

# shellcheck disable=SC2086
if ! docker compose $COMPOSE_ARGS ps 2>/dev/null | grep -q "flashquery"; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: flashquery service not running"
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS logs flashquery 2>&1 | head -30
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS down -v >/dev/null 2>&1
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Services started"

#==============================================================================
# TASK 4: Poll FlashQuery Health Endpoint
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Polling FlashQuery health endpoint (max 60 seconds)..."

MAX_WAIT=60
ELAPSED=0

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  if curl -sf --max-time 3 http://localhost:3100/health >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] FlashQuery is healthy (${ELAPSED}s)"
    break
  fi
  ELAPSED=$((ELAPSED + 2))
  sleep 2
done

if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: FlashQuery did not become healthy within ${MAX_WAIT}s"
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS logs flashquery > /tmp/fqc-failure.log 2>&1
  tail -30 /tmp/fqc-failure.log
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS down -v >/dev/null 2>&1
  exit 1
fi

#==============================================================================
# TASK 5: Test MCP Connectivity
#==============================================================================
# Verifies the full request path: FlashQuery → Kong → PostgREST → Postgres.
# Retries for up to 120 seconds because Kong/PostgREST start after FlashQuery
# becomes healthy and need a few extra seconds to be ready.

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Testing MCP connectivity (max 120 seconds for stack stabilization)..."

INIT_PAYLOAD='{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}},"id":1}'
TOOL_PAYLOAD='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_memories","arguments":{"tags":["smoke-test"]}},"id":2}'

# Bearer token matches MCP_AUTH_SECRET in .env.docker.example / docker-compose.yml default.
MCP_AUTH_SECRET="${MCP_AUTH_SECRET:-ci-smoke-test-secret}"

MAX_WAIT=120
ELAPSED=0
MCP_PASSED=0
TOOL_RESP=""

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  # Initialize a new MCP session (required before any tool call on streamable-http transport)
  INIT_RESP=$(curl -si --max-time 10 -X POST http://localhost:3100/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer ${MCP_AUTH_SECRET}" \
    -d "$INIT_PAYLOAD" 2>/dev/null || true)

  # Extract the session ID from response headers
  SESSION_ID=$(echo "$INIT_RESP" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n')

  if [ -n "$SESSION_ID" ]; then
    # Session established — make a tool call that touches the database
    TOOL_RESP=$(curl -s --max-time 10 -X POST http://localhost:3100/mcp \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "Authorization: Bearer ${MCP_AUTH_SECRET}" \
      -H "mcp-session-id: $SESSION_ID" \
      -d "$TOOL_PAYLOAD" 2>/dev/null || true)

    if echo "$TOOL_RESP" | grep -q '"result"'; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] MCP test passed: session established, tool call succeeded (${ELAPSED}s)"
      MCP_PASSED=1
      break
    fi
  fi

  ELAPSED=$((ELAPSED + 5))
  sleep 5
done

if [ "$MCP_PASSED" -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: MCP test failed after ${MAX_WAIT}s"
  if [ -n "$TOOL_RESP" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Last tool response: $TOOL_RESP"
  fi
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS logs flashquery > /tmp/fqc-failure.log 2>&1
  tail -30 /tmp/fqc-failure.log
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS down -v >/dev/null 2>&1
  exit 1
fi

#==============================================================================
# TASK 6: Cleanup & Summary
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaning up docker-compose services..."
# shellcheck disable=SC2086
docker compose $COMPOSE_ARGS down -v >/dev/null 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Smoke test completed successfully"
exit 0

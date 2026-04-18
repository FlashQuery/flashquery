#!/bin/bash
# Smoke test script for FlashQuery Docker image
# Orchestrates: docker build + docker-compose setup + health check polling + MCP functional test + cleanup
# Exit: 0 on success, 1 on failure

set -eux

#==============================================================================
# TASK 1: Setup & Validation
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting smoke test..."

# Verify Docker is available
command -v docker >/dev/null 2>&1 || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Docker not found in PATH"
  exit 1
}

# Verify docker-compose files exist
[ -f docker/docker-compose.db-only.yml ] || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: docker/docker-compose.db-only.yml not found"
  exit 1
}

[ -f docker/docker-compose.flashquery-only.yml ] || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: docker/docker-compose.flashquery-only.yml not found"
  exit 1
}

# Verify .env.test exists
[ -f .env.test ] || {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: .env.test not found"
  exit 1
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] All prerequisites verified"

#==============================================================================
# TASK 2: Build Docker Image
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building Docker image from Dockerfile..."

if ! docker build -f Dockerfile -t flashquery-core:test . >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Docker image build failed"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker image built successfully (flashquery-core:test)"

#==============================================================================
# TASK 3: Start Docker Services
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting docker-compose services (db + fqc)..."

# Start services using both compose files
if ! docker compose -f docker/docker-compose.db-only.yml -f docker/docker-compose.flashquery-only.yml up -d >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Failed to start docker-compose services"
  exit 1
fi

# Brief delay to allow services to start their initialization
sleep 2

# Verify services are running
if ! docker compose ps 2>/dev/null | grep -q flashquery-core; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: flashquery-core service failed to start"
  docker compose logs flashquery-core 2>&1 | head -20
  docker compose down -v >/dev/null 2>&1
  exit 1
fi

if ! docker compose ps 2>/dev/null | grep -q postgres; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: postgres service failed to start"
  docker compose logs postgres 2>&1 | head -20
  docker compose down -v >/dev/null 2>&1
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Services started successfully"

#==============================================================================
# TASK 4: Poll Health Endpoint
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Polling health endpoint (max 30 seconds)..."

MAX_WAIT=30
ELAPSED=0
INTERVAL=1

while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -f http://localhost:3100/health >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] FlashQuery is healthy"
    break
  fi
  ELAPSED=$((ELAPSED + INTERVAL))
  sleep $INTERVAL
done

# Check if health check succeeded
if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: FlashQuery did not become healthy within 30 seconds"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Preserving FlashQuery logs for debugging..."
  docker compose logs flashquery-core > /tmp/fqc-failure.log 2>&1
  docker compose down -v >/dev/null 2>&1
  exit 1
fi

#==============================================================================
# TASK 5: Test MCP Functionality
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Testing MCP save_memory functionality..."

# Build and send MCP save_memory request
MCP_PAYLOAD='{"jsonrpc":"2.0","method":"save_memory","params":{"memory":"Smoke test entry","tags":["smoke-test"]},"id":1}'

if ! curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d "$MCP_PAYLOAD" 2>/dev/null | tee /tmp/mcp_response.json | grep -q '"id"'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: MCP response missing memory ID"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Response was:"
  cat /tmp/mcp_response.json
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Preserving FlashQuery logs for debugging..."
  docker compose logs flashquery-core > /tmp/fqc-failure.log 2>&1
  docker compose down -v >/dev/null 2>&1
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] MCP smoke test passed"

#==============================================================================
# TASK 6: Cleanup & Summary
#==============================================================================

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaning up docker-compose services..."

docker compose down -v >/dev/null 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Smoke test completed successfully"

exit 0

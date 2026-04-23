#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found — skipping compose validation"
  exit 0
fi

ENV_FILE=".env.preflight"
printf 'POSTGRES_PASSWORD=ci-stub\nSUPABASE_ANON_KEY=ci-stub\nSUPABASE_SERVICE_ROLE_KEY=ci-stub\n' > "$ENV_FILE"

cleanup() { rm -f "$ENV_FILE"; }
trap cleanup EXIT

for f in docker/docker-compose.yml docker/docker-compose.db-only.yml docker/docker-compose.flashquery-only.yml; do
  echo "Validating $f..."
  docker compose --env-file "$ENV_FILE" -f "$f" config --quiet
done

echo "Docker Compose files OK"

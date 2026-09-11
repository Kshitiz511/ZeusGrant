#!/usr/bin/env bash
# Start the full local stack: database, both API services, and the console.
#
# The two services run bare (no /api prefix) because the Vite dev server
# proxies /api/core and /api/cc to them and strips the prefix. That mirrors
# production, where one function mounts both under those paths.
#
# PYTHONPATH is set explicitly: the workspace packages are installed as
# editable, but the .pth files do not resolve when uvicorn is launched from
# the repo root, so imports fail without it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PYTHONPATH="packages/config/src:packages/adapters/src:packages/service-kit/src:services/platform-core/src:services/contract-compliance/src"

echo "==> Database"
docker compose up -d postgres > /dev/null
# Compose reports healthy only once Postgres accepts connections; starting the
# services before that point makes them exit on a connection refusal.
until [ "$(docker inspect -f '{{.State.Health.Status}}' zeus-platform-postgres-1 2>/dev/null)" = "healthy" ]; do
  sleep 1
done
echo "    postgres healthy on :5433"

echo "==> Migrations"
ZEUS_MIGRATE_URL="postgresql://zeus:zeus@localhost:5433/zeus" \
  uv run python scripts/migrate.py | tail -2

# Free the ports first. A half-dead server from a previous run still holds the
# port and answers requests, which looks exactly like the new code not working.
for port in 8000 8001; do
  lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
done
sleep 1

echo "==> Services"
uv run uvicorn zeus_platform_core.app:app --port 8000 --reload > /tmp/zeus-core.log 2>&1 &
uv run uvicorn zeus_contract_compliance.app:app --port 8001 --reload > /tmp/zeus-cc.log 2>&1 &

for port in 8000 8001; do
  for _ in $(seq 1 30); do
    curl -sf "http://localhost:$port/health" > /dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://localhost:$port/health" > /dev/null 2>&1 \
    && echo "    :$port up" \
    || { echo "    :$port FAILED — see /tmp/zeus-*.log"; exit 1; }
done

echo "==> Console"
echo "    logs: /tmp/zeus-core.log  /tmp/zeus-cc.log"
exec npm --prefix apps/console run dev

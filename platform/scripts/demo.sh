#!/usr/bin/env bash
# End-to-end smoke test for the Zeus platform running under docker compose.
# Mints a dev token, creates a contract, and runs AI obligation extraction.
set -euo pipefail

CORE="${CORE:-http://127.0.0.1:8000}"
CC="${CC:-http://127.0.0.1:8001}"
TENANT="${TENANT:-11111111-1111-1111-1111-111111111111}"
USER_ID="${USER_ID:-22222222-2222-2222-2222-222222222222}"

echo "==> Minting dev token for tenant $TENANT"
TOKEN=$(curl -s -X POST "$CORE/dev/token" \
  -H 'content-type: application/json' \
  -d "{\"user_id\":\"$USER_ID\",\"tenant_id\":\"$TENANT\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "    token: ${TOKEN:0:24}..."

echo "==> Creating contract"
CID=$(curl -s -X POST "$CC/contracts" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "title": "MSA with Acme",
    "counterparty": "Acme Corp",
    "body": "The Vendor shall deliver the quarterly compliance report by March 31, 2026. Customer must pay invoice #204 within 30 days of receipt. Vendor shall maintain SOC 2 certification throughout the term."
  }' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "    contract id: $CID"

echo "==> Analyzing (AI obligation extraction via Ollama gemma3)"
curl -s -X POST "$CC/contracts/$CID/analyze" \
  -H "authorization: Bearer $TOKEN" \
  | python3 -m json.tool

echo "==> Obligations now stored:"
curl -s "$CC/contracts/$CID/obligations" \
  -H "authorization: Bearer $TOKEN" \
  | python3 -m json.tool

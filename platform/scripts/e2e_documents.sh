#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# End-to-end smoke test for the document ingestion + obligation workflow.
#
# Exercises the real stack (docker compose up) through public HTTP only:
#   signup -> tenant token -> create contract -> upload DOCX -> analyze
#   -> update obligation status -> read audit trail -> tenant isolation check
#
# Usage: ./scripts/e2e_documents.sh
# ---------------------------------------------------------------------------
set -euo pipefail

CORE=${CORE:-http://localhost:8000}
CC=${CC:-http://localhost:8001}
FIXTURE=${FIXTURE:-/tmp/zeus-msa.docx}

jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# --- provision two independent tenants -------------------------------------
signup() {
  local email="$1"
  curl -sS -X POST "$CORE/auth/signup" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Sup3rSecret!pass\",\"workspace_name\":\"E2E Corp\"}"
}

tenant_token() {
  local user_token="$1" tenant="$2"
  curl -sS -X POST "$CORE/tenancy/token" \
    -H "authorization: Bearer $user_token" \
    -H 'content-type: application/json' \
    -d "{\"tenant_id\":\"$tenant\"}" | jqp "d['access_token']"
}

step "Signing up tenant A"
A_SIGNUP=$(signup "e2e-a-$(date +%s)@example.com")
A_USER=$(echo "$A_SIGNUP" | jqp "d['access_token']")
A_TENANT=$(echo "$A_SIGNUP" | jqp "d['tenants'][0]['tenant_id']")
A_TOKEN=$(tenant_token "$A_USER" "$A_TENANT")
echo "tenant A = $A_TENANT"

step "Creating a contract"
CID=$(curl -sS -X POST "$CC/contracts" \
  -H "authorization: Bearer $A_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"E2E MSA","counterparty":"Acme Vendor"}' | jqp "d['id']")
echo "contract = $CID"

step "Rejecting an unsupported upload"
CODE=$(printf 'MZ\x00\x00binary' > /tmp/zeus-bad.exe && curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$CC/contracts/$CID/documents" \
  -H "authorization: Bearer $A_TOKEN" -F "file=@/tmp/zeus-bad.exe")
echo "unsupported upload -> HTTP $CODE (expected 422)"
[ "$CODE" = "422" ] || { echo "FAIL: unsupported file was not rejected"; exit 1; }

step "Uploading the DOCX contract"
curl -sS -X POST "$CC/contracts/$CID/documents" \
  -H "authorization: Bearer $A_TOKEN" -F "file=@$FIXTURE" | python3 -m json.tool

step "Rejecting a duplicate upload"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CC/contracts/$CID/documents" \
  -H "authorization: Bearer $A_TOKEN" -F "file=@$FIXTURE")
echo "duplicate upload -> HTTP $CODE (expected 409)"
[ "$CODE" = "409" ] || { echo "FAIL: duplicate was not rejected"; exit 1; }

step "Contract body now comes from the document"
curl -sS "$CC/contracts/$CID" -H "authorization: Bearer $A_TOKEN" \
  | jqp "d['body_source'], d['body'][:120]"

step "Analyzing with the configured LLM"
time curl -sS -X POST "$CC/contracts/$CID/analyze" \
  -H "authorization: Bearer $A_TOKEN" | python3 -m json.tool

step "Marking the first obligation done"
OID=$(curl -sS "$CC/contracts/$CID/obligations" -H "authorization: Bearer $A_TOKEN" | jqp "d[0]['id']")
curl -sS -X PATCH "$CC/obligations/$OID" \
  -H "authorization: Bearer $A_TOKEN" -H 'content-type: application/json' \
  -d '{"status":"done"}' | jqp "d['status']"

step "Tenant-wide task feed (open only)"
curl -sS "$CC/obligations?status=open" -H "authorization: Bearer $A_TOKEN" \
  | jqp "[(o['contract_title'], o['description'][:60]) for o in d]"

step "Audit trail"
curl -sS "$CC/audit" -H "authorization: Bearer $A_TOKEN" \
  | jqp "[(e['action'], e['detail']) for e in d]"

# --- isolation: a second tenant must not see tenant A's data ---------------
step "Signing up tenant B and checking isolation"
B_SIGNUP=$(signup "e2e-b-$(date +%s)@example.com")
B_USER=$(echo "$B_SIGNUP" | jqp "d['access_token']")
B_TENANT=$(echo "$B_SIGNUP" | jqp "d['tenants'][0]['tenant_id']")
B_TOKEN=$(tenant_token "$B_USER" "$B_TENANT")

COUNT=$(curl -sS "$CC/contracts" -H "authorization: Bearer $B_TOKEN" | jqp "len(d)")
echo "tenant B sees $COUNT contract(s) (expected 0)"
[ "$COUNT" = "0" ] || { echo "FAIL: cross-tenant leak in list"; exit 1; }

CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$CC/contracts/$CID" -H "authorization: Bearer $B_TOKEN")
echo "tenant B direct fetch of A's contract -> HTTP $CODE (expected 404)"
[ "$CODE" = "404" ] || { echo "FAIL: cross-tenant read succeeded"; exit 1; }

AUDIT_B=$(curl -sS "$CC/audit" -H "authorization: Bearer $B_TOKEN" | jqp "len(d)")
echo "tenant B sees $AUDIT_B audit entries (expected 0)"
[ "$AUDIT_B" = "0" ] || { echo "FAIL: cross-tenant audit leak"; exit 1; }

printf '\n\033[1;32mAll end-to-end checks passed.\033[0m\n'

"""Route-level tests for document upload, lifecycle edits and the audit trail.

Uses the real FastAPI app with fakes injected: fake database, in-memory cache
seeded with entitlement claims, stub auth, and an in-memory Storage. The point
is to prove the HTTP contract — status codes, validation boundaries, storage
side effects and audit writes — not to re-test SQL.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Extraction, Session
from zeus_adapters.queue.memory_queue import MemoryQueue
from zeus_contract_compliance.app import create_app
from zeus_contract_compliance.container import Container

TENANT = "22222222-2222-2222-2222-222222222222"
USER = "11111111-1111-1111-1111-111111111111"
CONTRACT_ID = "c-1"


class StubAuth:
    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id=USER, email="u@example.com", tenant_id=TENANT, roles=[])

    async def issue_claims(self, user_id, tenant_id, roles):  # pragma: no cover
        return "stub"


class FakeLlm:
    async def generate(self, messages, *, model=None, temperature=0.2):  # pragma: no cover
        raise NotImplementedError

    async def extract(self, schema, text, *, instructions=None) -> Extraction:
        return Extraction(
            data={"obligations": [{"description": "Deliver Q1 report", "priority": "high"}]},
            model="fake-model",
            prompt_tokens=100,
            completion_tokens=25,
        )

    async def embed(self, text):  # pragma: no cover
        raise NotImplementedError


class FakeStorage:
    """In-memory Storage with the same contract as the real adapters."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    async def put(self, bucket: str, key: str, data: bytes, *, content_type: str) -> str:
        self.objects[(bucket, key)] = data
        return key

    async def get(self, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    async def signed_url(self, bucket: str, key: str, *, ttl_seconds: int = 3600) -> str:
        return f"memory://{bucket}/{key}"

    async def delete(self, bucket: str, key: str) -> None:
        self.objects.pop((bucket, key), None)


class _Secret:
    def __init__(self, value: str) -> None:
        self._value = value

    def get_secret_value(self) -> str:
        return self._value


class World:
    """Mutable state the fake database reads and writes, so routes observe
    their own side effects across a request."""

    def __init__(self) -> None:
        self.contract: dict[str, Any] | None = {
            "id": CONTRACT_ID,
            "tenant_id": TENANT,
            "title": "MSA",
            "counterparty": None,
            "body": "Vendor shall deliver the Q1 report by March 31.",
            "status": "draft",
            "body_source": "manual",
            "last_analyzed_at": None,
            "created_at": None,
        }
        self.documents: list[dict[str, Any]] = []
        self.obligations: list[dict[str, Any]] = []
        self.audit: list[dict[str, Any]] = []


def _seed_claims(cache: MemoryCache) -> None:
    claims = {
        "tenant_id": TENANT,
        "modules": {
            "contract_compliance": {
                "status": "active",
                "plan_id": "cc_growth",
                "limits": {"contracts_max": 10},
            }
        },
    }
    cache._store[f"entitlements:{TENANT}"] = (json.dumps(claims), None)  # noqa: SLF001


def _wire_db(db: FakeDatabase, world: World) -> None:
    # --- contracts ---
    db.on_fetch_one("FROM contract_compliance.contracts", lambda a: world.contract)

    def _update_contract(args: tuple[Any, ...]) -> dict[str, Any] | None:
        # args = (tenant_id, contract_id, *values) in SET-clause order.
        if world.contract is None:
            return None
        return world.contract

    db.on_fetch_one("UPDATE contract_compliance.contracts", _update_contract)

    def _delete_contract(args: tuple[Any, ...]) -> dict[str, Any] | None:
        if world.contract is None:
            return None
        world.contract = None
        return {"id": CONTRACT_ID}

    db.on_fetch_one("DELETE FROM contract_compliance.contracts", _delete_contract)

    # --- documents ---
    db.on_fetch_one(
        "AND checksum = $3",
        lambda a: next((d for d in world.documents if d["checksum"] == a[2]), None),
    )
    db.on_fetch_one(
        ", storage_key",
        lambda a: next((d for d in world.documents if d["id"] == a[1]), None),
    )

    def _insert_document(args: tuple[Any, ...]) -> dict[str, Any]:
        doc = {
            "id": f"d-{len(world.documents)}",
            "tenant_id": args[0],
            "contract_id": args[1],
            "filename": args[2],
            "content_type": args[3],
            "byte_size": args[4],
            "storage_key": args[5],
            "checksum": args[6],
            "extracted_chars": args[7],
            "created_at": None,
        }
        world.documents.append(doc)
        return doc

    db.on_fetch_one("INSERT INTO contract_compliance.documents", _insert_document)

    def _delete_document(args: tuple[Any, ...]) -> dict[str, Any] | None:
        match = next((d for d in world.documents if d["id"] == args[1]), None)
        if match is None:
            return None
        world.documents.remove(match)
        return {"id": match["id"]}

    db.on_fetch_one("DELETE FROM contract_compliance.documents", _delete_document)
    db.on_fetch("SELECT storage_key", lambda a: list(world.documents))
    db.on_fetch("FROM contract_compliance.documents", lambda a: list(world.documents))

    # --- obligations ---
    db.on_fetch_one(
        "INSERT INTO contract_compliance.obligations",
        lambda a: _append_obligation(world, a),
    )
    db.on_fetch_one(
        "UPDATE contract_compliance.obligations",
        lambda a: _apply_obligation_update(world, a),
    )
    db.on_fetch_one(
        "DELETE FROM contract_compliance.obligations",
        lambda a: _remove_obligation(world, a),
    )
    db.on_fetch_one(
        "FROM contract_compliance.obligations",
        lambda a: next((o for o in world.obligations if o["id"] == a[1]), None),
    )
    db.on_fetch("JOIN contract_compliance.contracts", lambda a: _tenant_feed(world, a))
    db.on_fetch("FROM contract_compliance.obligations", lambda a: list(world.obligations))

    # --- audit ---
    db.on_execute(
        "INSERT INTO contract_compliance.audit_log",
        lambda a: world.audit.append(
            {
                "id": len(world.audit) + 1,
                "tenant_id": a[0],
                "actor_id": a[1],
                "action": a[2],
                "entity_type": a[3],
                "entity_id": a[4],
                "detail": a[5],
                "created_at": None,
            }
        )
        or "OK",
    )
    db.on_fetch("FROM contract_compliance.audit_log", lambda a: list(reversed(world.audit)))


def _append_obligation(world: World, args: tuple[Any, ...]) -> dict[str, Any]:
    row = {
        "id": f"o-{len(world.obligations)}",
        "contract_id": args[0],
        "tenant_id": args[1],
        "description": args[2],
        "due_date": args[3],
        "responsible": args[4],
        "priority": args[5],
        "status": args[6] if len(args) > 6 else "open",
        "source": "manual",
    }
    world.obligations.append(row)
    return row


def _apply_obligation_update(world: World, args: tuple[Any, ...]) -> dict[str, Any] | None:
    row = next((o for o in world.obligations if o["id"] == args[1]), None)
    if row is None:
        return None
    # The route sends values positionally after (tenant_id, obligation_id); the
    # test only needs to prove a write happened, so record status when present.
    for value in args[2:]:
        if value in {"open", "in_progress", "done"}:
            row["status"] = value
        elif value in {"low", "medium", "high"}:
            row["priority"] = value
    return row


def _remove_obligation(world: World, args: tuple[Any, ...]) -> dict[str, Any] | None:
    row = next((o for o in world.obligations if o["id"] == args[1]), None)
    if row is None:
        return None
    world.obligations.remove(row)
    return {"id": row["id"]}


def _tenant_feed(world: World, args: tuple[Any, ...]) -> list[dict[str, Any]]:
    wanted = args[1]
    rows = [o for o in world.obligations if wanted is None or o["status"] == wanted]
    return [{**o, "contract_title": "MSA"} for o in rows]


@pytest.fixture
def world() -> World:
    return World()


@pytest.fixture
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def client(world: World, storage: FakeStorage) -> TestClient:
    db = FakeDatabase()
    _wire_db(db, world)

    cache = MemoryCache()
    _seed_claims(cache)

    container = Container(
        db=db,
        cache=cache,
        auth=StubAuth(),
        llm=FakeLlm(),
        queue=MemoryQueue(),
        storage=storage,
    )
    container.settings.worker_secret = _Secret("worker-secret")
    container.settings.storage.bucket = "evidence"
    return TestClient(create_app(container))


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer good-token"}


def _upload(client: TestClient, name: str, data: bytes, **params):
    return client.post(
        f"/contracts/{CONTRACT_ID}/documents",
        headers=_auth(),
        files={"file": (name, io.BytesIO(data), "application/octet-stream")},
        params=params,
    )


# --- upload -----------------------------------------------------------------


def test_upload_stores_object_and_records_metadata(client, world, storage):
    resp = _upload(client, "msa.txt", b"Vendor shall deliver the Q1 report by March 31.")
    assert resp.status_code == 201

    body = resp.json()
    assert body["filename"] == "msa.txt"
    assert body["extracted_chars"] > 0
    # The storage key is an internal detail and must never be returned.
    assert "storage_key" not in body

    assert len(storage.objects) == 1
    (bucket, key), blob = next(iter(storage.objects.items()))
    assert bucket == "evidence"
    # Key is derived server-side from tenant/contract, not from user input.
    assert key.startswith(f"{TENANT}/{CONTRACT_ID}/")
    assert b"Q1 report" in blob


def test_upload_requires_authentication(client):
    resp = client.post(
        f"/contracts/{CONTRACT_ID}/documents",
        files={"file": ("msa.txt", io.BytesIO(b"text"), "text/plain")},
    )
    assert resp.status_code == 401


def test_upload_replaces_contract_body_for_analysis(client, world):
    _upload(client, "msa.txt", b"Supplier must submit audited accounts by June 30.")
    # The route asked the repository to swap the body over to the document.
    assert any(
        call[1].startswith("\n            UPDATE contract_compliance.contracts")
        or "UPDATE contract_compliance.contracts" in call[1]
        for call in client.app.state.container.db.calls
    )


def test_upload_rejects_unsupported_type(client, storage):
    resp = _upload(client, "payload.exe", b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 64)
    assert resp.status_code == 422
    # Nothing was written for a rejected upload.
    assert storage.objects == {}


def test_upload_rejects_oversized_file(client, storage):
    client.app.state.container.settings.storage.max_upload_mb = 1
    resp = _upload(client, "big.txt", b"a" * (2 * 1024 * 1024))
    assert resp.status_code == 413
    assert storage.objects == {}


def test_duplicate_upload_is_conflict(client):
    data = b"Vendor shall deliver the Q1 report by March 31."
    assert _upload(client, "msa.txt", data).status_code == 201
    resp = _upload(client, "msa-copy.txt", data)
    assert resp.status_code == 409


def test_upload_to_unknown_contract_is_404(client, world):
    world.contract = None
    assert _upload(client, "msa.txt", b"some text here").status_code == 404


# --- download / delete ------------------------------------------------------


def test_download_returns_original_bytes_as_attachment(client):
    raw = b"Vendor shall deliver the Q1 report by March 31."
    doc_id = _upload(client, "msa.txt", raw).json()["id"]

    resp = client.get(
        f"/contracts/{CONTRACT_ID}/documents/{doc_id}/download", headers=_auth()
    )
    assert resp.status_code == 200
    assert resp.content == raw
    assert resp.headers["content-disposition"] == 'attachment; filename="msa.txt"'
    # Prevents the browser from re-interpreting the payload as another type.
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_download_requires_authentication(client):
    doc_id = _upload(client, "msa.txt", b"Vendor shall deliver reports.").json()["id"]
    assert client.get(f"/contracts/{CONTRACT_ID}/documents/{doc_id}/download").status_code == 401


def test_delete_document_removes_object_too(client, storage):
    doc_id = _upload(client, "msa.txt", b"Vendor shall deliver reports.").json()["id"]
    assert storage.objects

    resp = client.delete(f"/contracts/{CONTRACT_ID}/documents/{doc_id}", headers=_auth())
    assert resp.status_code == 204
    # No orphaned bytes left behind.
    assert storage.objects == {}


# --- contract lifecycle -----------------------------------------------------


def test_patch_contract_only_sends_provided_fields(client, world):
    resp = client.patch(
        f"/contracts/{CONTRACT_ID}", headers=_auth(), json={"title": "MSA v2"}
    )
    assert resp.status_code == 200

    update_call = next(
        c for c in client.app.state.container.db.calls
        if "UPDATE contract_compliance.contracts" in c[1]
    )
    # tenant_id, contract_id, then exactly one changed value.
    assert update_call[2] == (TENANT, CONTRACT_ID, "MSA v2")


def test_patch_contract_body_marks_source_manual(client):
    client.patch(f"/contracts/{CONTRACT_ID}", headers=_auth(), json={"body": "New text"})
    update_call = next(
        c for c in client.app.state.container.db.calls
        if "UPDATE contract_compliance.contracts" in c[1]
    )
    assert "manual" in update_call[2]


def test_delete_contract_cleans_up_documents(client, storage):
    _upload(client, "msa.txt", b"Vendor shall deliver reports.")
    assert storage.objects

    resp = client.delete(f"/contracts/{CONTRACT_ID}", headers=_auth())
    assert resp.status_code == 204
    assert storage.objects == {}


def test_delete_unknown_contract_is_404(client, world):
    world.contract = None
    assert client.delete(f"/contracts/{CONTRACT_ID}", headers=_auth()).status_code == 404


# --- obligation workflow ----------------------------------------------------


def test_create_manual_obligation(client, world):
    resp = client.post(
        f"/contracts/{CONTRACT_ID}/obligations",
        headers=_auth(),
        json={"description": "Submit audited accounts", "priority": "high"},
    )
    assert resp.status_code == 201
    assert resp.json()["source"] == "manual"
    assert len(world.obligations) == 1


def test_obligation_description_is_required(client):
    resp = client.post(
        f"/contracts/{CONTRACT_ID}/obligations", headers=_auth(), json={"description": ""}
    )
    assert resp.status_code == 422


def test_update_obligation_status(client, world):
    obligation_id = client.post(
        f"/contracts/{CONTRACT_ID}/obligations",
        headers=_auth(),
        json={"description": "Submit accounts"},
    ).json()["id"]

    resp = client.patch(
        f"/obligations/{obligation_id}", headers=_auth(), json={"status": "done"}
    )
    assert resp.status_code == 200
    assert world.obligations[0]["status"] == "done"


def test_update_unknown_obligation_is_404(client):
    resp = client.patch("/obligations/missing", headers=_auth(), json={"status": "done"})
    assert resp.status_code == 404


def test_delete_obligation(client, world):
    obligation_id = client.post(
        f"/contracts/{CONTRACT_ID}/obligations",
        headers=_auth(),
        json={"description": "Submit accounts"},
    ).json()["id"]

    assert client.delete(f"/obligations/{obligation_id}", headers=_auth()).status_code == 204
    assert world.obligations == []


def test_tenant_wide_obligation_feed_includes_contract_title(client):
    client.post(
        f"/contracts/{CONTRACT_ID}/obligations",
        headers=_auth(),
        json={"description": "Submit accounts"},
    )
    resp = client.get("/obligations", headers=_auth())
    assert resp.status_code == 200
    assert resp.json()[0]["contract_title"] == "MSA"


def test_obligation_feed_rejects_invalid_status_filter(client):
    assert client.get("/obligations?status=nonsense", headers=_auth()).status_code == 422


# --- audit trail ------------------------------------------------------------


def test_mutations_are_written_to_the_audit_log(client, world):
    _upload(client, "msa.txt", b"Vendor shall deliver the Q1 report by March 31.")
    client.patch(f"/contracts/{CONTRACT_ID}", headers=_auth(), json={"title": "MSA v2"})

    actions = [entry["action"] for entry in world.audit]
    assert "document.uploaded" in actions
    assert "contract.updated" in actions
    # Every entry is attributed to the authenticated user.
    assert all(entry["actor_id"] == USER for entry in world.audit)


def test_audit_detail_records_field_names_not_values(client, world):
    client.patch(f"/contracts/{CONTRACT_ID}", headers=_auth(), json={"title": "Secret name"})
    entry = next(e for e in world.audit if e["action"] == "contract.updated")
    assert "Secret name" not in entry["detail"]
    assert "title" in entry["detail"]


def test_audit_endpoint_returns_the_trail(client):
    client.patch(f"/contracts/{CONTRACT_ID}", headers=_auth(), json={"title": "MSA v2"})
    resp = client.get("/audit", headers=_auth())
    assert resp.status_code == 200
    assert resp.json()[0]["action"] == "contract.updated"


def test_audit_requires_entitlement(client, world):
    client.app.state.container.cache._store.clear()  # noqa: SLF001
    client.app.state.container.db.on_fetch("FROM platform.entitlements", lambda a: [])
    assert client.get("/audit", headers=_auth()).status_code == 403


# --- analysis ---------------------------------------------------------------


def test_analyze_rejects_empty_contract_body(client, world):
    world.contract["body"] = "   "
    resp = client.post(f"/contracts/{CONTRACT_ID}/analyze", headers=_auth())
    assert resp.status_code == 422


def test_analyze_records_an_audit_entry(client, world):
    client.post(f"/contracts/{CONTRACT_ID}/analyze", headers=_auth())
    assert any(e["action"] == "contract.analyzed" for e in world.audit)

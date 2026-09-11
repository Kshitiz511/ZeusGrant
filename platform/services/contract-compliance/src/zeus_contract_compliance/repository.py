"""Data access for contracts, obligations, documents and the audit log.

Thin and parameterized by design: no caller-supplied value is ever interpolated
into SQL, and partial updates build their SET clause from a hardcoded column
allowlist rather than from caller-supplied keys.

Every statement still filters by ``tenant_id`` even though RLS enforces the
same predicate. Belt and braces: the query is correct on its own, and Postgres
fails closed if it ever is not.
"""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import Database

from zeus_contract_compliance.domain import (
    AuditEntry,
    Contract,
    Document,
    Obligation,
    ObligationCreate,
    ObligationDraft,
    ObligationWithContract,
)

_CONTRACT_COLS = (
    "id::text, tenant_id::text, title, counterparty, body, status, "
    "body_source, last_analyzed_at, created_at"
)
_OBLIGATION_COLS = (
    "id::text, contract_id::text, tenant_id::text, description, due_date, "
    "responsible, priority, status, source"
)
_DOCUMENT_COLS = (
    "id::text, tenant_id::text, contract_id::text, filename, content_type, "
    "byte_size, checksum, extracted_chars, created_at"
)


def _build_set_clause(
    updates: dict[str, Any], allowed: frozenset[str], *, first_param: int
) -> tuple[str, list[Any]]:
    """Render ``col = $n`` fragments for an allowlisted partial update.

    Raises ``ValueError`` for any column outside ``allowed`` so a mis-wired
    caller fails loudly instead of generating unexpected SQL.
    """
    fragments: list[str] = []
    values: list[Any] = []
    for column, value in updates.items():
        if column not in allowed:
            raise ValueError(f"Column not updatable: {column!r}")
        fragments.append(f"{column} = ${first_param + len(values)}")
        values.append(value)
    return ", ".join(fragments), values


class ContractRepository:
    _UPDATABLE = frozenset({"title", "counterparty", "body", "status", "body_source"})

    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(
        self,
        *,
        tenant_id: str,
        title: str,
        counterparty: str | None,
        body: str | None,
        created_by: str | None,
    ) -> Contract:
        row = await self._db.fetch_one(
            f"""
            INSERT INTO contract_compliance.contracts
                (tenant_id, title, counterparty, body, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING {_CONTRACT_COLS}
            """,
            tenant_id,
            title,
            counterparty,
            body,
            created_by,
        )
        return Contract(**row)

    async def list_for_tenant(self, tenant_id: str) -> list[Contract]:
        rows = await self._db.fetch(
            f"""
            SELECT {_CONTRACT_COLS}
            FROM contract_compliance.contracts
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            """,
            tenant_id,
        )
        return [Contract(**row) for row in rows]

    async def get(self, tenant_id: str, contract_id: str) -> Contract | None:
        row = await self._db.fetch_one(
            f"""
            SELECT {_CONTRACT_COLS}
            FROM contract_compliance.contracts
            WHERE tenant_id = $1 AND id = $2
            """,
            tenant_id,
            contract_id,
        )
        return Contract(**row) if row else None

    async def update(
        self, tenant_id: str, contract_id: str, updates: dict[str, Any]
    ) -> Contract | None:
        if not updates:
            return await self.get(tenant_id, contract_id)

        set_clause, values = _build_set_clause(updates, self._UPDATABLE, first_param=3)
        row = await self._db.fetch_one(
            f"""
            UPDATE contract_compliance.contracts
               SET {set_clause}, updated_at = now()
             WHERE tenant_id = $1 AND id = $2
            RETURNING {_CONTRACT_COLS}
            """,
            tenant_id,
            contract_id,
            *values,
        )
        return Contract(**row) if row else None

    async def mark_analyzed(self, tenant_id: str, contract_id: str) -> None:
        await self._db.execute(
            """
            UPDATE contract_compliance.contracts
               SET last_analyzed_at = now(), updated_at = now()
             WHERE tenant_id = $1 AND id = $2
            """,
            tenant_id,
            contract_id,
        )

    async def delete(self, tenant_id: str, contract_id: str) -> bool:
        """Delete a contract. Obligations and documents cascade in the schema."""
        row = await self._db.fetch_one(
            """
            DELETE FROM contract_compliance.contracts
             WHERE tenant_id = $1 AND id = $2
            RETURNING id::text
            """,
            tenant_id,
            contract_id,
        )
        return row is not None

    async def count_for_tenant(self, tenant_id: str) -> int:
        row = await self._db.fetch_one(
            "SELECT COUNT(*) AS n FROM contract_compliance.contracts WHERE tenant_id = $1",
            tenant_id,
        )
        return int(row["n"]) if row else 0


class ObligationRepository:
    _UPDATABLE = frozenset({"description", "due_date", "responsible", "priority", "status"})

    def __init__(self, db: Database) -> None:
        self._db = db

    async def list_for_contract(self, tenant_id: str, contract_id: str) -> list[Obligation]:
        rows = await self._db.fetch(
            f"""
            SELECT {_OBLIGATION_COLS}
            FROM contract_compliance.obligations
            WHERE tenant_id = $1 AND contract_id = $2
            ORDER BY due_date NULLS LAST, priority DESC
            """,
            tenant_id,
            contract_id,
        )
        return [Obligation(**row) for row in rows]

    async def list_for_tenant(
        self, tenant_id: str, *, status: str | None = None, limit: int = 200
    ) -> list[ObligationWithContract]:
        """Tenant-wide feed backing the Tasks view.

        ``status`` is bound as a parameter and compared with NULL-tolerant
        logic, so there is no branching SQL to get wrong.
        """
        rows = await self._db.fetch(
            """
            SELECT o.id::text, o.contract_id::text, o.tenant_id::text, o.description,
                   o.due_date, o.responsible, o.priority, o.status, o.source,
                   c.title AS contract_title
              FROM contract_compliance.obligations o
              JOIN contract_compliance.contracts c ON c.id = o.contract_id
             WHERE o.tenant_id = $1
               AND ($2::text IS NULL OR o.status = $2)
             ORDER BY o.due_date NULLS LAST, o.priority DESC
             LIMIT $3
            """,
            tenant_id,
            status,
            limit,
        )
        return [ObligationWithContract(**row) for row in rows]

    async def get(self, tenant_id: str, obligation_id: str) -> Obligation | None:
        row = await self._db.fetch_one(
            f"""
            SELECT {_OBLIGATION_COLS}
            FROM contract_compliance.obligations
            WHERE tenant_id = $1 AND id = $2
            """,
            tenant_id,
            obligation_id,
        )
        return Obligation(**row) if row else None

    async def create(
        self, *, tenant_id: str, contract_id: str, payload: ObligationCreate
    ) -> Obligation:
        row = await self._db.fetch_one(
            f"""
            INSERT INTO contract_compliance.obligations
                (contract_id, tenant_id, description, due_date, responsible,
                 priority, status, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
            RETURNING {_OBLIGATION_COLS}
            """,
            contract_id,
            tenant_id,
            payload.description,
            payload.due_date,
            payload.responsible,
            str(payload.priority),
            str(payload.status),
        )
        return Obligation(**row)

    async def update(
        self, tenant_id: str, obligation_id: str, updates: dict[str, Any]
    ) -> Obligation | None:
        if not updates:
            return await self.get(tenant_id, obligation_id)

        set_clause, values = _build_set_clause(updates, self._UPDATABLE, first_param=3)
        row = await self._db.fetch_one(
            f"""
            UPDATE contract_compliance.obligations
               SET {set_clause}
             WHERE tenant_id = $1 AND id = $2
            RETURNING {_OBLIGATION_COLS}
            """,
            tenant_id,
            obligation_id,
            *values,
        )
        return Obligation(**row) if row else None

    async def delete(self, tenant_id: str, obligation_id: str) -> bool:
        row = await self._db.fetch_one(
            """
            DELETE FROM contract_compliance.obligations
             WHERE tenant_id = $1 AND id = $2
            RETURNING id::text
            """,
            tenant_id,
            obligation_id,
        )
        return row is not None

    async def bulk_insert_ai(
        self, *, tenant_id: str, contract_id: str, drafts: list[ObligationDraft]
    ) -> int:
        """Persist AI-proposed obligations. Returns the number inserted."""
        for d in drafts:
            await self._db.execute(
                """
                INSERT INTO contract_compliance.obligations
                    (contract_id, tenant_id, description, due_date, responsible,
                     priority, source)
                VALUES ($1, $2, $3, $4, $5, $6, 'ai')
                """,
                contract_id,
                tenant_id,
                d.description,
                d.due_date,
                d.responsible,
                str(d.priority),
            )
        return len(drafts)

    async def delete_ai_for_contract(self, tenant_id: str, contract_id: str) -> int:
        """Clear previously extracted obligations before a re-analysis.

        Manual obligations and any AI obligation a human has already worked on
        (status moved off ``open``) are preserved — re-running the model must
        never destroy human effort.
        """
        rows = await self._db.fetch(
            """
            DELETE FROM contract_compliance.obligations
             WHERE tenant_id = $1 AND contract_id = $2
               AND source = 'ai' AND status = 'open'
            RETURNING id::text
            """,
            tenant_id,
            contract_id,
        )
        return len(rows)


class DocumentRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(
        self,
        *,
        tenant_id: str,
        contract_id: str,
        filename: str,
        content_type: str,
        byte_size: int,
        storage_key: str,
        checksum: str,
        extracted_chars: int,
        uploaded_by: str | None,
    ) -> Document:
        row = await self._db.fetch_one(
            f"""
            INSERT INTO contract_compliance.documents
                (tenant_id, contract_id, filename, content_type, byte_size,
                 storage_key, checksum, extracted_chars, uploaded_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING {_DOCUMENT_COLS}
            """,
            tenant_id,
            contract_id,
            filename,
            content_type,
            byte_size,
            storage_key,
            checksum,
            extracted_chars,
            uploaded_by,
        )
        return Document(**row)

    async def list_for_contract(self, tenant_id: str, contract_id: str) -> list[Document]:
        rows = await self._db.fetch(
            f"""
            SELECT {_DOCUMENT_COLS}
            FROM contract_compliance.documents
            WHERE tenant_id = $1 AND contract_id = $2
            ORDER BY created_at DESC
            """,
            tenant_id,
            contract_id,
        )
        return [Document(**row) for row in rows]

    async def get_with_key(self, tenant_id: str, document_id: str) -> dict[str, Any] | None:
        """Return document metadata including the storage key.

        The key is an internal detail and is never included in an API response;
        it exists so the download route can fetch the bytes.
        """
        return await self._db.fetch_one(
            f"""
            SELECT {_DOCUMENT_COLS}, storage_key
            FROM contract_compliance.documents
            WHERE tenant_id = $1 AND id = $2
            """,
            tenant_id,
            document_id,
        )

    async def delete(self, tenant_id: str, document_id: str) -> bool:
        row = await self._db.fetch_one(
            """
            DELETE FROM contract_compliance.documents
             WHERE tenant_id = $1 AND id = $2
            RETURNING id::text
            """,
            tenant_id,
            document_id,
        )
        return row is not None

    async def list_storage_keys(self, tenant_id: str, contract_id: str) -> list[str]:
        """Keys for every object attached to a contract.

        Read before a cascading delete so the objects can be removed once the
        metadata rows are gone.
        """
        rows = await self._db.fetch(
            """
            SELECT storage_key
              FROM contract_compliance.documents
             WHERE tenant_id = $1 AND contract_id = $2
            """,
            tenant_id,
            contract_id,
        )
        return [row["storage_key"] for row in rows]

    async def find_by_checksum(
        self, tenant_id: str, contract_id: str, checksum: str
    ) -> Document | None:
        row = await self._db.fetch_one(
            f"""
            SELECT {_DOCUMENT_COLS}
            FROM contract_compliance.documents
            WHERE tenant_id = $1 AND contract_id = $2 AND checksum = $3
            """,
            tenant_id,
            contract_id,
            checksum,
        )
        return Document(**row) if row else None


class AiUsageRepository:
    """Append-only record of every model call, for per-tenant cost attribution.

    Recorded on failure as well as success: a tenant whose extractions keep
    failing still costs money and is the signal that something is wrong.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    async def record(
        self,
        *,
        tenant_id: str,
        contract_id: str | None,
        actor_id: str | None,
        operation: str,
        model: str,
        chunks: int = 1,
        chunks_failed: int = 0,
        estimated_input_tokens: int = 0,
        obligations_found: int = 0,
        obligations_dropped: int = 0,
        latency_ms: int = 0,
        succeeded: bool = True,
        error: str | None = None,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO contract_compliance.ai_usage
                (tenant_id, contract_id, actor_id, operation, model, chunks,
                 chunks_failed, estimated_input_tokens, obligations_found,
                 obligations_dropped, latency_ms, succeeded, error)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """,
            tenant_id,
            contract_id,
            actor_id,
            operation,
            model,
            chunks,
            chunks_failed,
            estimated_input_tokens,
            obligations_found,
            obligations_dropped,
            latency_ms,
            succeeded,
            (error or None) and str(error)[:1000],
        )

    async def summary_for_tenant(self, tenant_id: str, *, days: int = 30) -> dict[str, Any]:
        """Rolling usage totals used by the console and billing review."""
        row = await self._db.fetch_one(
            """
            SELECT count(*)                          AS calls,
                   coalesce(sum(estimated_input_tokens), 0) AS estimated_input_tokens,
                   coalesce(sum(obligations_found), 0)      AS obligations_found,
                   coalesce(avg(latency_ms), 0)::int        AS avg_latency_ms,
                   count(*) FILTER (WHERE NOT succeeded)    AS failures
              FROM contract_compliance.ai_usage
             WHERE tenant_id = $1
               AND created_at >= now() - make_interval(days => $2)
            """,
            tenant_id,
            days,
        )
        return dict(row) if row else {}


class AuditRepository:
    """Append-only. Deliberately exposes no update or delete method."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def record(
        self,
        *,
        tenant_id: str,
        actor_id: str | None,
        action: str,
        entity_type: str,
        entity_id: str | None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO contract_compliance.audit_log
                (tenant_id, actor_id, action, entity_type, entity_id, detail)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            """,
            tenant_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            json.dumps(detail or {}, default=str),
        )

    async def list_for_tenant(self, tenant_id: str, *, limit: int = 100) -> list[AuditEntry]:
        rows = await self._db.fetch(
            """
            SELECT id, tenant_id::text, actor_id::text, action, entity_type,
                   entity_id::text, detail, created_at
              FROM contract_compliance.audit_log
             WHERE tenant_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2
            """,
            tenant_id,
            limit,
        )
        return [AuditEntry(**{**row, "detail": _as_dict(row.get("detail"))}) for row in rows]


def _as_dict(value: Any) -> dict[str, Any]:
    """jsonb arrives as a dict or a JSON string depending on the driver."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}

"""Data access for contracts and obligations. Thin, parameterized SQL only."""

from __future__ import annotations

from zeus_adapters.interfaces import Database

from zeus_contract_compliance.domain import (
    Contract,
    Obligation,
    ObligationDraft,
)


class ContractRepository:
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
            """
            INSERT INTO contract_compliance.contracts
                (tenant_id, title, counterparty, body, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id::text, tenant_id::text, title, counterparty, body, status, created_at
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
            """
            SELECT id::text, tenant_id::text, title, counterparty, body, status, created_at
            FROM contract_compliance.contracts
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            """,
            tenant_id,
        )
        return [Contract(**row) for row in rows]

    async def get(self, tenant_id: str, contract_id: str) -> Contract | None:
        row = await self._db.fetch_one(
            """
            SELECT id::text, tenant_id::text, title, counterparty, body, status, created_at
            FROM contract_compliance.contracts
            WHERE tenant_id = $1 AND id = $2
            """,
            tenant_id,
            contract_id,
        )
        return Contract(**row) if row else None

    async def count_for_tenant(self, tenant_id: str) -> int:
        row = await self._db.fetch_one(
            "SELECT COUNT(*) AS n FROM contract_compliance.contracts WHERE tenant_id = $1",
            tenant_id,
        )
        return int(row["n"]) if row else 0


class ObligationRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def list_for_contract(self, tenant_id: str, contract_id: str) -> list[Obligation]:
        rows = await self._db.fetch(
            """
            SELECT id::text, contract_id::text, tenant_id::text, description, due_date,
                   responsible, priority, status, source
            FROM contract_compliance.obligations
            WHERE tenant_id = $1 AND contract_id = $2
            ORDER BY due_date NULLS LAST, priority DESC
            """,
            tenant_id,
            contract_id,
        )
        return [Obligation(**row) for row in rows]

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

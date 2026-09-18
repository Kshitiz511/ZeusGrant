#!/usr/bin/env python3
"""Phase 7 probe: document page counting against real Postgres.

The unit tests use a fake database, so they cannot tell you whether the CHECK
constraints actually reject a zero-page document, whether the backfill computed
what it claimed, or whether the monthly sum is answered from the covering index
rather than a sequential scan. Those depend on real DDL and a real planner.

Everything runs inside a transaction that is rolled back, so the database is
left exactly as it was found.

Refuses to run against anything but a local database -- see D21.

    PYTHONPATH=... .venv/bin/python scripts/probe_phase7_pages.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

LOCAL_DSN = "postgresql://zeus:zeus@localhost:5433/zeus"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}  {detail}")


def _guard(dsn: str) -> None:
    host = dsn.split("@")[-1].split("/")[0]
    if not host.startswith(("localhost", "127.0.0.1")):
        sys.exit(f"refusing to run against non-local host: {host}")


async def main() -> int:
    import asyncpg

    dsn = os.environ.get("ZEUS_PROBE_DSN", LOCAL_DSN)
    _guard(dsn)
    print(f"probing {dsn.split('@')[-1]}\n")

    conn = await asyncpg.connect(dsn)
    tx = conn.transaction()
    await tx.start()
    try:
        tenant = uuid.uuid4()
        contract = uuid.uuid4()
        await conn.execute(
            "INSERT INTO contract_compliance.contracts (id, tenant_id, title) "
            "VALUES ($1, $2, 'probe')",
            contract,
            tenant,
        )

        async def add(*, chars: int, pages: int, basis: str = "estimated", when: str = "now()"):
            return await conn.fetchval(
                f"""
                INSERT INTO contract_compliance.documents
                    (tenant_id, contract_id, filename, content_type, byte_size,
                     storage_key, checksum, extracted_chars, pages, page_basis,
                     created_at)
                VALUES ($1, $2, 'f.pdf', 'application/pdf', 1, $3, $3, $4, $5, $6, {when})
                RETURNING id
                """,
                tenant,
                contract,
                uuid.uuid4().hex,
                chars,
                pages,
                basis,
            )

        # --- defaults and constraints ---------------------------------------
        doc = await conn.fetchrow(
            """
            INSERT INTO contract_compliance.documents
                (tenant_id, contract_id, filename, content_type, byte_size,
                 storage_key, checksum, extracted_chars)
            VALUES ($1, $2, 'd.txt', 'text/plain', 1, $3, $3, 10)
            RETURNING pages, page_basis
            """,
            tenant,
            contract,
            uuid.uuid4().hex,
        )
        check("pages defaults to 1", doc["pages"] == 1, str(doc["pages"]))
        check(
            "page_basis defaults to 'estimated'",
            doc["page_basis"] == "estimated",
            doc["page_basis"],
        )

        # A constraint violation aborts the enclosing transaction, so every
        # deliberately-failing insert runs inside its own savepoint. Without
        # this the first rejection ends the probe rather than passing it.
        async def expect_rejected(label: str, **kw) -> None:
            sp = conn.transaction()
            await sp.start()
            try:
                await add(**kw)
            except asyncpg.CheckViolationError:
                await sp.rollback()
                check(label, True)
                return
            except Exception as exc:
                await sp.rollback()
                check(label, False, f"wrong error: {type(exc).__name__}")
                return
            await sp.rollback()
            check(label, False, "insert succeeded")

        for bad_pages, label in ((0, "zero"), (-3, "negative")):
            await expect_rejected(f"{label} pages rejected", chars=1, pages=bad_pages)

        await expect_rejected("unknown page_basis rejected", chars=1, pages=1, basis="guessed")

        for basis in ("counted", "estimated"):
            try:
                await add(chars=1, pages=1, basis=basis)
                check(f"page_basis '{basis}' accepted", True)
            except Exception as exc:
                check(f"page_basis '{basis}' accepted", False, str(exc))

        # --- the monthly sum -------------------------------------------------
        t2 = uuid.uuid4()
        c2 = uuid.uuid4()
        await conn.execute(
            "INSERT INTO contract_compliance.contracts (id, tenant_id, title) "
            "VALUES ($1, $2, 'probe2')",
            c2,
            t2,
        )

        async def add_for(tid, cid, pages: int, when: str):
            await conn.execute(
                f"""
                INSERT INTO contract_compliance.documents
                    (tenant_id, contract_id, filename, content_type, byte_size,
                     storage_key, checksum, extracted_chars, pages, created_at)
                VALUES ($1, $2, 'f.pdf', 'application/pdf', 1, $3, $3, 1, $4, {when})
                """,
                tid,
                cid,
                uuid.uuid4().hex,
                pages,
            )

        await add_for(t2, c2, 10, "now()")
        await add_for(t2, c2, 7, "now()")
        # Last month: must not count toward this month's quota.
        await add_for(t2, c2, 500, "date_trunc('month', now()) - interval '1 day'")

        SUM = """
            SELECT COALESCE(sum(pages), 0)::bigint AS n
              FROM contract_compliance.documents
             WHERE tenant_id = $1
               AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc')
        """
        total = await conn.fetchval(SUM, t2)
        check("monthly sum adds this month's pages", total == 17, str(total))
        check("last month's pages excluded", total < 500, str(total))

        other = await conn.fetchval(SUM, tenant)
        check(
            "sum is scoped to one tenant",
            other != total,
            f"tenant={other} other={total}",
        )

        empty = await conn.fetchval(SUM, uuid.uuid4())
        check("unknown tenant sums to 0, not NULL", empty == 0, str(empty))

        # --- the index actually gets used ------------------------------------
        # Without this the quota check is a sequential scan over every document
        # ever uploaded, on the upload path.
        await conn.execute("SET LOCAL enable_seqscan = off")
        plan = "\n".join(
            r["QUERY PLAN"] for r in await conn.fetch("EXPLAIN " + SUM, t2)
        )
        check(
            "monthly sum can use idx_cc_documents_tenant_month",
            "idx_cc_documents_tenant_month" in plan,
            plan.replace("\n", " | ")[:160],
        )
        check(
            "sum is index-only (pages is INCLUDEd)",
            "Index Only Scan" in plan,
            plan.replace("\n", " | ")[:160],
        )
        await conn.execute("SET LOCAL enable_seqscan = on")

        # --- the backfill -----------------------------------------------------
        # Recompute 0006's expression and confirm it matches the code's rule.
        for chars, expected in ((0, 1), (1, 1), (2999, 1), (3000, 1), (3001, 2), (9000, 3)):
            got = await conn.fetchval(
                "SELECT GREATEST(1, CEIL($1::numeric / 3000)::integer)", chars
            )
            check(f"backfill: {chars} chars -> {expected} page(s)", got == expected, str(got))

        # --- tenant isolation still holds -------------------------------------
        await conn.execute("SET LOCAL ROLE zeus_app")
        await conn.execute("SELECT set_config('app.current_tenant', $1, true)", str(t2))
        visible = await conn.fetchval(
            "SELECT count(*) FROM contract_compliance.documents WHERE tenant_id = $1",
            tenant,
        )
        check("RLS hides another tenant's documents", visible == 0, str(visible))
        mine = await conn.fetchval(
            "SELECT COALESCE(sum(pages),0)::bigint FROM contract_compliance.documents"
        )
        check("RLS still lets a tenant sum its own pages", mine == 517, str(mine))
        await conn.execute("RESET ROLE")

    finally:
        await tx.rollback()
        await conn.close()

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

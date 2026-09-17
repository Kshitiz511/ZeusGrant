"""Plans and their limit catalog."""

from __future__ import annotations

import json

from zeus_adapters.interfaces import Database

from zeus_platform_core.domain.entitlements import PlanLimitCatalog


class PlanRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def limit_catalog(self) -> PlanLimitCatalog:
        """Return {plan_id: {limit_key: limit_value}} for all plans."""
        rows = await self._db.fetch(
            "SELECT plan_id, limit_key, limit_value FROM platform.plan_limits"
        )
        catalog: PlanLimitCatalog = {}
        for row in rows:
            catalog.setdefault(row["plan_id"], {})[row["limit_key"]] = row["limit_value"]
        return catalog

    async def plan_module(self, plan_id: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT module_id FROM platform.plans WHERE id = $1", plan_id
        )
        return row["module_id"] if row else None

    async def list_modules(self) -> list[dict]:
        """Every module in the catalogue, so a bad module_id is a 400 and not an
        integrity error surfacing as a 500."""
        rows = await self._db.fetch(
            "SELECT id, name FROM platform.modules ORDER BY id"
        )
        return [dict(row) for row in rows]

    async def plan_for_price(self, stripe_price_id: str) -> dict | None:
        return await self._db.fetch_one(
            """
            SELECT id AS plan_id, module_id FROM platform.plans
            WHERE stripe_price_id_monthly = $1 OR stripe_price_id_annual = $1
            """,
            stripe_price_id,
        )

    async def list_purchasable(self) -> list[dict]:
        """Plans the console can offer, with their limits attached.

        Two exclusions, both deliberate:
        * inactive plans, which are retired pricing kept only for existing
          subscribers;
        * plans with no Stripe price, because offering a plan that cannot be
          bought is worse than not offering it.
        """
        rows = await self._db.fetch(
            """
            SELECT p.id AS plan_id, p.module_id, p.name,
                   p.monthly_cents, p.annual_cents,
                   p.stripe_price_id_monthly, p.stripe_price_id_annual,
                   coalesce(
                       jsonb_object_agg(l.limit_key, l.limit_value)
                           FILTER (WHERE l.limit_key IS NOT NULL),
                       '{}'::jsonb
                   ) AS limits
              FROM platform.plans p
              LEFT JOIN platform.plan_limits l ON l.plan_id = p.id
             WHERE p.is_active
               AND (p.stripe_price_id_monthly IS NOT NULL
                    OR p.stripe_price_id_annual IS NOT NULL)
             GROUP BY p.id
             ORDER BY p.module_id, coalesce(p.monthly_cents, p.annual_cents, 0)
            """
        )
        out = []
        for row in rows:
            record = dict(row)
            # asyncpg returns jsonb as a string; the router expects a mapping.
            limits = record.get("limits")
            if isinstance(limits, str):
                record["limits"] = json.loads(limits)
            out.append(record)
        return out

    # -- platform-admin catalogue management ----------------------------------

    async def list_all(self) -> list[dict]:
        """Every plan, including inactive and unsellable ones.

        Deliberately not ``list_purchasable``: that one hides inactive plans
        and plans with no Stripe price, which are precisely the rows an
        operator needs to see in order to fix them. A management screen that
        applies the storefront's filters cannot show you what is broken.

        ``subscriber_count`` is included because the two most dangerous edits
        -- changing a price and deactivating a plan -- are only safe to reason
        about if you know how many customers are on the plan.
        """
        rows = await self._db.fetch(
            """
            SELECT p.id AS plan_id, p.module_id, p.name,
                   p.monthly_cents, p.annual_cents,
                   p.stripe_price_id_monthly, p.stripe_price_id_annual,
                   p.is_active,
                   coalesce(
                       jsonb_object_agg(l.limit_key, l.limit_value)
                           FILTER (WHERE l.limit_key IS NOT NULL),
                       '{}'::jsonb
                   ) AS limits,
                   (SELECT count(*) FROM platform.subscriptions s
                     WHERE s.plan_id = p.id) AS subscriber_count
              FROM platform.plans p
              LEFT JOIN platform.plan_limits l ON l.plan_id = p.id
             GROUP BY p.id
             ORDER BY p.module_id, coalesce(p.monthly_cents, p.annual_cents, 0)
            """
        )
        return [_with_limits(row) for row in rows]

    async def get(self, plan_id: str) -> dict | None:
        row = await self._db.fetch_one(
            """
            SELECT p.id AS plan_id, p.module_id, p.name,
                   p.monthly_cents, p.annual_cents,
                   p.stripe_price_id_monthly, p.stripe_price_id_annual,
                   p.is_active,
                   coalesce(
                       jsonb_object_agg(l.limit_key, l.limit_value)
                           FILTER (WHERE l.limit_key IS NOT NULL),
                       '{}'::jsonb
                   ) AS limits,
                   (SELECT count(*) FROM platform.subscriptions s
                     WHERE s.plan_id = p.id) AS subscriber_count
              FROM platform.plans p
              LEFT JOIN platform.plan_limits l ON l.plan_id = p.id
             WHERE p.id = $1
             GROUP BY p.id
            """,
            plan_id,
        )
        return _with_limits(row) if row else None

    async def create(
        self,
        *,
        plan_id: str,
        module_id: str,
        name: str,
        monthly_cents: int | None,
        annual_cents: int | None,
        stripe_price_id_monthly: str | None,
        stripe_price_id_annual: str | None,
        is_active: bool,
    ) -> dict | None:
        """Insert a plan. Returns None if the id is already taken.

        ``ON CONFLICT DO NOTHING`` rather than an upsert: creating a plan that
        silently overwrote an existing one would re-price its subscribers as a
        side effect of a typo in the id field.
        """
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.plans
                   (id, module_id, name, monthly_cents, annual_cents,
                    stripe_price_id_monthly, stripe_price_id_annual, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING
            RETURNING id AS plan_id
            """,
            plan_id,
            module_id,
            name,
            monthly_cents,
            annual_cents,
            stripe_price_id_monthly,
            stripe_price_id_annual,
            is_active,
        )
        return dict(row) if row else None

    async def update(self, plan_id: str, fields: dict) -> dict | None:
        """Patch named columns of one plan, returning the row before and after.

        Only keys in :data:`EDITABLE_PLAN_COLUMNS` are accepted, and the column
        names are interpolated from that frozen set rather than from the
        caller's input -- the values still go through bound parameters. A
        caller-supplied column name reaching an f-string here would be SQL
        injection through the admin API.

        ``module_id`` is not editable. Moving a plan between modules would
        change what its existing subscribers are entitled to without any
        billing event, which is not an edit, it is a silent re-grant.
        """
        unknown = set(fields) - EDITABLE_PLAN_COLUMNS
        if unknown:
            raise ValueError(f"not editable: {sorted(unknown)}")
        if not fields:
            return None

        before = await self.get(plan_id)
        if before is None:
            return None

        columns = sorted(fields)
        assignments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(columns))
        await self._db.execute(
            f"UPDATE platform.plans SET {assignments} WHERE id = $1",  # noqa: S608
            plan_id,
            *(fields[col] for col in columns),
        )
        return {"before": before, "after": await self.get(plan_id)}

    async def set_limits(self, plan_id: str, limits: dict[str, int | None]) -> dict | None:
        """Replace a plan's limit set wholesale.

        Replacement rather than merge, because this is the plan's definition
        rather than an adjustment to one tenant: a key the caller omitted is a
        key the plan no longer has. (Per-tenant overrides, which *are*
        adjustments, merge instead -- see ``tenant_limit_overrides``.)

        Delete and insert rather than upsert-plus-prune so the two halves
        cannot disagree about which keys survived.
        """
        before = await self.get(plan_id)
        if before is None:
            return None

        await self._db.execute("DELETE FROM platform.plan_limits WHERE plan_id = $1", plan_id)
        for key, value in sorted(limits.items()):
            await self._db.execute(
                """
                INSERT INTO platform.plan_limits (plan_id, limit_key, limit_value)
                VALUES ($1, $2, $3)
                """,
                plan_id,
                key,
                value,
            )
        return {"before": before, "after": await self.get(plan_id)}


#: Columns an operator may patch. Frozen, and used to build the SET clause, so
#: nothing a caller sends can become part of the SQL text.
EDITABLE_PLAN_COLUMNS = frozenset(
    {
        "name",
        "monthly_cents",
        "annual_cents",
        "stripe_price_id_monthly",
        "stripe_price_id_annual",
        "is_active",
    }
)


def _with_limits(row) -> dict:
    """Normalise a plan row, decoding the aggregated jsonb limits."""
    record = dict(row)
    limits = record.get("limits")
    if isinstance(limits, str):
        record["limits"] = json.loads(limits)
    return record


class ModelPricingRepository:
    """Per-model token prices, the input to every cost figure in the product.

    Kept separate from :class:`PlanRepository` because it answers a different
    question: plans are what we charge customers, this is what the provider
    charges us. Conflating them would make the margin calculation read from
    one object and mean two things.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    async def list_all(self) -> list[dict]:
        """Every priced model, with how much it has been used.

        The usage counts come from ``ai_usage`` so an operator can tell a model
        that is merely configured from one that is actually costing money --
        and, more usefully, spot rows whose price is wrong because the spend
        looks implausible.
        """
        return await self._db.fetch(
            """
            SELECT m.model,
                   m.input_per_million_usd,
                   m.output_per_million_usd,
                   m.updated_at,
                   m.updated_by::text AS updated_by,
                   u.email            AS updated_by_email,
                   (SELECT count(*) FROM platform.ai_usage a
                     WHERE a.model = m.model)              AS call_count,
                   (SELECT coalesce(sum(a.cost_usd), 0) FROM platform.ai_usage a
                     WHERE a.model = m.model)              AS total_cost_usd
              FROM platform.model_pricing m
              LEFT JOIN platform.users u ON u.id = m.updated_by
             ORDER BY m.model
            """
        )

    async def unpriced_models(self) -> list[dict]:
        """Models that have been called but have no price row.

        This is the list that matters most on the screen. Every call to a model
        here records NULL cost, so it is spend the product cannot see -- which
        is exactly the condition that hides a runaway bill. Surfacing it is the
        whole reason the usage ledger stores the model name.
        """
        return await self._db.fetch(
            """
            SELECT a.model, count(*) AS call_count, max(a.created_at) AS last_used_at
              FROM platform.ai_usage a
              LEFT JOIN platform.model_pricing m ON m.model = a.model
             WHERE m.model IS NULL
             GROUP BY a.model
             ORDER BY count(*) DESC
            """
        )

    async def get(self, model: str) -> dict | None:
        return await self._db.fetch_one(
            """
            SELECT model, input_per_million_usd, output_per_million_usd
            FROM platform.model_pricing WHERE model = $1
            """,
            model,
        )

    async def upsert(
        self,
        *,
        model: str,
        input_per_million_usd,
        output_per_million_usd,
        updated_by: str | None,
    ) -> dict:
        """Set a model's price, returning the previous values if there were any.

        Returns ``previous`` separately rather than folding it into the row, so
        the audit record can state what changed rather than only what it now is.
        """
        before = await self.get(model)
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.model_pricing
                   (model, input_per_million_usd, output_per_million_usd, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (model) DO UPDATE
               SET input_per_million_usd  = EXCLUDED.input_per_million_usd,
                   output_per_million_usd = EXCLUDED.output_per_million_usd,
                   updated_by             = EXCLUDED.updated_by,
                   updated_at             = now()
            RETURNING model, input_per_million_usd, output_per_million_usd
            """,
            model,
            input_per_million_usd,
            output_per_million_usd,
            updated_by,
        )
        assert row is not None
        return {**dict(row), "previous": dict(before) if before else None}

    async def delete(self, model: str) -> dict | None:
        """Remove a price. Returns the deleted row, or None if there was none.

        Deleting does not erase history: ``ai_usage.cost_usd`` was computed at
        call time and stays as recorded. It only means future calls to this
        model record NULL cost, which is why the route warns rather than
        silently accepting it.
        """
        row = await self._db.fetch_one(
            """
            DELETE FROM platform.model_pricing WHERE model = $1
            RETURNING model, input_per_million_usd, output_per_million_usd
            """,
            model,
        )
        return dict(row) if row else None

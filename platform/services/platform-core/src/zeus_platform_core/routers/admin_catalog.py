"""Platform-admin control of the plan catalogue and model prices.

Two catalogues that look similar and mean opposite things: `plans` is what we
charge customers, `model_pricing` is what the provider charges us. They are
kept in separate routers' worth of routes here but one module, because an
operator changing one almost always wants to look at the other.

---------------------------------------------------------------------------
WHAT EDITING A PLAN DOES NOT DO
---------------------------------------------------------------------------
**Changing a price does not re-price existing subscribers.** Stripe governs
what a customer actually pays; the amount stored here is the catalogue figure
shown on the pricing page. Editing `monthly_cents` changes the shop window, not
the invoice. Every response that changes a price says so explicitly, because an
operator who believes otherwise will either think they have given a discount
they have not given, or raise a price and expect revenue that never arrives.

**Deactivating a plan does not revoke access.** `is_active` controls whether the
plan is *offered*; entitlements come from the subscription. Existing subscribers
keep exactly what they bought. This is the behaviour you want -- retiring a
price should never log a paying customer out -- but it is not what "deactivate"
sounds like, so it is stated in the response.

**Changing a Stripe price id does not migrate anyone.** Subscriptions already
created point at the old price in Stripe. The new id only affects future
checkouts.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from zeus_platform_core.routers.admin_audit import audit_action
from zeus_platform_core.security import AdminDep, ContainerDep
from zeus_platform_core.services.billing_service import BillingNotConfiguredError

router = APIRouter(prefix="/admin", tags=["admin"])

#: Warnings attached to plan mutations. Held as constants so the wording is
#: identical everywhere and cannot drift into something weaker in one route.
PRICE_WARNING = (
    "Catalogue price only. Existing subscribers continue to pay what Stripe "
    "bills them; this does not re-price anyone."
)
DEACTIVATE_WARNING = (
    "Plan is hidden from checkout. Existing subscribers keep their access and "
    "continue to be billed."
)


class PlanCreate(BaseModel):
    plan_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    module_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    monthly_cents: int | None = Field(default=None, ge=0)
    annual_cents: int | None = Field(default=None, ge=0)
    stripe_price_id_monthly: str | None = None
    stripe_price_id_annual: str | None = None
    is_active: bool = True


class PlanPatch(BaseModel):
    """Every field optional, and `None` is a meaningful value for most of them.

    `model_fields_set` is used rather than truthiness so that clearing a price
    (setting it to null) is distinguishable from not mentioning it. Without
    that distinction there would be no way to unset a Stripe id through the
    API, and a plan wrongly marked sellable could not be corrected.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    monthly_cents: int | None = Field(default=None, ge=0)
    annual_cents: int | None = Field(default=None, ge=0)
    stripe_price_id_monthly: str | None = None
    stripe_price_id_annual: str | None = None
    is_active: bool | None = None


class PlanLimits(BaseModel):
    # None as a value means unlimited, matching plan_limits and the override
    # table. An absent key means the plan does not define that limit at all.
    limits: dict[str, int | None]


class ModelPriceSet(BaseModel):
    # ge=0 rather than gt=0: a genuinely free model is a real thing, and
    # rejecting zero would force an operator to either lie or leave it unpriced,
    # and unpriced records NULL cost, which is worse.
    input_per_million_usd: Decimal = Field(ge=0, max_digits=12, decimal_places=4)
    output_per_million_usd: Decimal = Field(ge=0, max_digits=12, decimal_places=4)


# --- plans ------------------------------------------------------------------


@router.get("/plans")
async def list_plans(container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    """The whole catalogue, including plans the storefront hides.

    `unsellable` is computed here rather than left to the reader: a plan that
    is active but has no Stripe price is silently dropped from `/billing/plans`,
    which looks from the outside like the pricing page being broken. Naming the
    condition is the difference between a five-minute fix and an afternoon.
    """
    plans = await container.plans.list_all()
    unsellable = [
        p["plan_id"]
        for p in plans
        if p["is_active"]
        and not p["stripe_price_id_monthly"]
        and not p["stripe_price_id_annual"]
    ]
    return {
        "plans": plans,
        "unsellable_active_plans": unsellable,
        "note": PRICE_WARNING,
    }


@router.get("/plans/{plan_id}")
async def get_plan(plan_id: str, container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    plan = await container.plans.get(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan not found")
    return {"plan": plan, "note": PRICE_WARNING}


@router.post("/plans", status_code=201)
async def create_plan(
    body: PlanCreate,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
    validate_prices: bool = Query(default=True),
) -> dict[str, object]:
    """Add a plan to the catalogue.

    The module is checked first because `plans.module_id` has a foreign key: a
    bad value would surface as an integrity error, which is a 500 the operator
    cannot act on rather than the 400 that tells them what they typed wrong.
    """
    modules = {m["id"] for m in await container.plans.list_modules()}
    if body.module_id not in modules:
        raise HTTPException(
            status_code=400,
            detail=f"unknown module '{body.module_id}'; known: {sorted(modules)}",
        )

    warnings = await _validate_price_ids(
        container,
        enabled=validate_prices,
        monthly=body.stripe_price_id_monthly,
        annual=body.stripe_price_id_annual,
        monthly_cents=body.monthly_cents,
        annual_cents=body.annual_cents,
    )

    created = await container.plans.create(
        plan_id=body.plan_id,
        module_id=body.module_id,
        name=body.name,
        monthly_cents=body.monthly_cents,
        annual_cents=body.annual_cents,
        stripe_price_id_monthly=body.stripe_price_id_monthly,
        stripe_price_id_annual=body.stripe_price_id_annual,
        is_active=body.is_active,
    )
    if created is None:
        raise HTTPException(status_code=409, detail=f"plan '{body.plan_id}' already exists")

    await audit_action(
        container,
        request,
        admin,
        "plan.created",
        target_type="plan",
        target_id=body.plan_id,
        before=None,
        after=body.model_dump(mode="json"),
    )
    return {"plan": await container.plans.get(body.plan_id), "warnings": warnings}


@router.patch("/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    body: PlanPatch,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
    validate_prices: bool = Query(default=True),
) -> dict[str, object]:
    """Edit a plan's catalogue entry.

    `exclude_unset` is what makes a null meaningful: it sends only the fields
    the caller actually named, so clearing a Stripe id is possible and an
    omitted field is left alone rather than being nulled by default.
    """
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    existing = await container.plans.get(plan_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="plan not found")

    warnings = await _validate_price_ids(
        container,
        enabled=validate_prices,
        monthly=fields.get("stripe_price_id_monthly"),
        annual=fields.get("stripe_price_id_annual"),
        monthly_cents=fields.get("monthly_cents", existing["monthly_cents"]),
        annual_cents=fields.get("annual_cents", existing["annual_cents"]),
    )

    try:
        changed = await container.plans.update(plan_id, fields)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if changed is None:
        raise HTTPException(status_code=404, detail="plan not found")

    # Say what this did not do, in the terms the operator is thinking in. The
    # subscriber count makes the warning concrete rather than boilerplate.
    subscribers = int(existing["subscriber_count"])
    if "monthly_cents" in fields or "annual_cents" in fields:
        warnings.append(f"{PRICE_WARNING} {subscribers} subscriber(s) are unaffected.")
    if fields.get("is_active") is False:
        warnings.append(f"{DEACTIVATE_WARNING} {subscribers} subscriber(s) keep access.")

    await audit_action(
        container,
        request,
        admin,
        "plan.updated",
        target_type="plan",
        target_id=plan_id,
        before=_auditable(changed["before"]),
        after=_auditable(changed["after"]),
    )
    return {"plan": changed["after"], "warnings": warnings}


@router.put("/plans/{plan_id}/limits")
async def set_plan_limits(
    plan_id: str,
    body: PlanLimits,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Replace a plan's limits.

    This takes effect for existing subscribers, unlike a price change, because
    limits are resolved from the plan on every entitlement computation. Their
    cached entitlements are therefore invalidated -- otherwise the change would
    appear to do nothing for up to the cache TTL and an operator would apply it
    twice.
    """
    changed = await container.plans.set_limits(plan_id, body.limits)
    if changed is None:
        raise HTTPException(status_code=404, detail="plan not found")

    affected = await container.subscriptions.tenant_ids_on_plan(plan_id)
    for tenant_id in affected:
        await container.entitlements.invalidate(tenant_id)

    await audit_action(
        container,
        request,
        admin,
        "plan.limits.set",
        target_type="plan",
        target_id=plan_id,
        before={"limits": changed["before"]["limits"]},
        after={"limits": changed["after"]["limits"]},
    )
    return {
        "plan": changed["after"],
        "tenants_invalidated": len(affected),
        "note": "Limit changes apply to existing subscribers immediately.",
    }


# --- model prices ------------------------------------------------------------


@router.get("/models")
async def list_models(container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    """Configured model prices, plus models being called with no price at all.

    The second list is the point of this screen. A model with no price records
    NULL cost on every call, so its spend is invisible in every rollup -- the
    exact condition that hides a runaway bill. It is returned alongside rather
    than behind a separate endpoint so it cannot be missed.
    """
    return {
        "models": await container.model_pricing.list_all(),
        "unpriced_models": await container.model_pricing.unpriced_models(),
    }


@router.put("/models/{model}")
async def set_model_price(
    model: str,
    body: ModelPriceSet,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Set a model's token price.

    The name is normalised with the same function the metering path uses.
    Callers disagree about whether to write `gpt-5-mini` or `openai:gpt-5-mini`;
    if this route stored the raw string, a price could be saved that the
    recorder would never find, and the operator would see their edit accepted
    and their costs stay NULL.

    The cache key is deleted immediately after the write. Without that, D7's
    symptom returns: the price is correct in the database and wrong in every
    warm instance until its TTL lapses.
    """
    from zeus_service_kit.metering import normalise_model, price_cache_key

    normalised = normalise_model(model)
    if not normalised:
        raise HTTPException(status_code=400, detail="model name is empty")

    result = await container.model_pricing.upsert(
        model=normalised,
        input_per_million_usd=body.input_per_million_usd,
        output_per_million_usd=body.output_per_million_usd,
        updated_by=admin.user_id,
    )
    await container.cache.delete(price_cache_key(normalised))

    await audit_action(
        container,
        request,
        admin,
        "model_price.set",
        target_type="model",
        target_id=normalised,
        before=_price_audit(result["previous"]),
        after={
            "input_per_million_usd": str(body.input_per_million_usd),
            "output_per_million_usd": str(body.output_per_million_usd),
        },
    )
    return {
        "model": normalised,
        "input_per_million_usd": str(result["input_per_million_usd"]),
        "output_per_million_usd": str(result["output_per_million_usd"]),
        "created": result["previous"] is None,
        "note": (
            "Applies to future calls only. Costs already recorded in ai_usage "
            "were computed at call time and are not restated."
        ),
    }


@router.delete("/models/{model}")
async def delete_model_price(
    model: str,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Remove a model's price.

    Deliberately blunt about the consequence: from here on, calls to this model
    record NULL cost and disappear from every spend figure. That is occasionally
    what you want (a model you no longer use) and is otherwise a mistake, so the
    response says which it will be rather than returning a bare 204.
    """
    from zeus_service_kit.metering import normalise_model, price_cache_key

    normalised = normalise_model(model)
    removed = await container.model_pricing.delete(normalised)
    if removed is None:
        raise HTTPException(status_code=404, detail="model price not found")

    await container.cache.delete(price_cache_key(normalised))

    await audit_action(
        container,
        request,
        admin,
        "model_price.deleted",
        target_type="model",
        target_id=normalised,
        before=_price_audit(removed),
        after=None,
    )
    return {
        "model": normalised,
        "deleted": True,
        "warning": (
            "Future calls to this model will record no cost and will not appear "
            "in spend totals."
        ),
    }


# --- billing credentials ------------------------------------------------------


@router.post("/billing/test-connection")
async def test_billing_connection(
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Prove the configured Stripe credentials work. Creates nothing.

    The provider is reset first so this tests the key that is *currently*
    configured rather than one cached from before a rotation -- which would
    make the check confidently report success for a key no longer in use.

    A failure is returned as a 200 with `ok: false` rather than a 5xx. This is a
    diagnostic: the request succeeded, and the answer is that the credentials
    do not work. Raising would make it indistinguishable in logs and monitoring
    from the admin API itself being broken.
    """
    container.billing.reset_provider()
    try:
        result = await container.billing.test_connection()
    except BillingNotConfiguredError:
        return {"ok": False, "error": "Payments are not configured in this environment."}
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    await audit_action(
        container,
        request,
        admin,
        "billing.connection_tested",
        target_type="billing",
        target_id=str(result.get("account_id") or "unknown"),
        before=None,
        # No secret is recorded: the account id and mode are what a reader
        # needs, and the key itself would make the audit log a place to steal
        # credentials from.
        after={"livemode": result.get("livemode")},
    )
    return result


# --- helpers ------------------------------------------------------------------


async def _validate_price_ids(
    container,
    *,
    enabled: bool,
    monthly: str | None,
    annual: str | None,
    monthly_cents: int | None,
    annual_cents: int | None,
) -> list[str]:
    """Check price ids against Stripe, returning warnings rather than raising.

    Warnings, not errors, and the distinction is deliberate. Refusing the save
    would mean an operator cannot fix the catalogue while Stripe is unreachable,
    or in an environment where Stripe is not configured at all -- and the
    seeded ids are already placeholders, so a hard check would make the
    catalogue uneditable until every one of them is replaced. Reporting loudly
    and saving anyway keeps the operator in control while making a typo
    impossible to miss.

    Validation is skipped silently when billing is not configured, because in
    that environment "cannot verify" is the expected state and an alarming
    warning on every save teaches people to ignore warnings.
    """
    if not enabled:
        return []

    warnings: list[str] = []
    for label, price_id, expected_cents, expected_interval in (
        ("monthly", monthly, monthly_cents, "month"),
        ("annual", annual, annual_cents, "year"),
    ):
        if not price_id:
            continue
        try:
            price = await container.billing.get_price(price_id)
        except BillingNotConfiguredError:
            return warnings
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator
            warnings.append(f"Could not verify {label} price '{price_id}': {exc}")
            continue

        if price is None:
            warnings.append(
                f"Stripe does not recognise {label} price '{price_id}'. "
                f"Checkout for this plan will fail."
            )
            continue
        if not price.get("active"):
            warnings.append(f"Stripe {label} price '{price_id}' is archived.")
        if expected_cents is not None and price.get("unit_amount") != expected_cents:
            warnings.append(
                f"Stripe {label} price '{price_id}' charges "
                f"{price.get('unit_amount')} but the catalogue says {expected_cents}. "
                f"Customers will be billed the Stripe amount."
            )
        if price.get("interval") and price["interval"] != expected_interval:
            warnings.append(
                f"Stripe {label} price '{price_id}' bills per "
                f"{price['interval']}, not per {expected_interval}."
            )
    return warnings


def _auditable(plan: dict) -> dict:
    """The fields of a plan worth recording in the audit trail.

    Excludes `subscriber_count`, which is a live count rather than part of the
    plan: recording it would make an audit row appear to show a change every
    time somebody subscribed.
    """
    return {k: v for k, v in plan.items() if k != "subscriber_count"}


def _price_audit(price: dict | None) -> dict | None:
    """Model prices as strings, because Decimal is not JSON-serialisable."""
    if price is None:
        return None
    return {
        "input_per_million_usd": str(price["input_per_million_usd"]),
        "output_per_million_usd": str(price["output_per_million_usd"]),
    }

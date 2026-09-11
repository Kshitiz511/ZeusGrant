"""Billing endpoints: plan catalog, embedded checkout, portal, and the webhook.

Checkout is per-module (one price), so services are purchased independently.
The webhook verifies the signature, normalizes the event, applies the change
and rewarms entitlements — the moment access turns on or off.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from zeus_platform_core.security import ContainerDep, TenantIdDep
from zeus_platform_core.services.billing_service import (
    BillingNotConfiguredError,
    UnresolvableChangeError,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    price_id: str
    return_url: str
    trial_days: int | None = Field(default=None, ge=1, le=365)


class CheckoutResponse(BaseModel):
    client_secret: str | None = None
    id: str | None = None


class PortalRequest(BaseModel):
    return_url: str


class PortalResponse(BaseModel):
    url: str


class PlanOption(BaseModel):
    plan_id: str
    module_id: str
    name: str
    # Both cadences are returned so the console can offer either without a
    # second round trip.
    monthly_cents: int | None = None
    annual_cents: int | None = None
    stripe_price_id_monthly: str | None = None
    stripe_price_id_annual: str | None = None
    limits: dict = Field(default_factory=dict)


@router.get("/plans", response_model=list[PlanOption])
async def list_plans(container: ContainerDep, tenant_id: TenantIdDep) -> list[PlanOption]:
    """Plans available for purchase, with their limits.

    Tenant-scoped only so the catalog is not enumerable by anonymous callers.
    """
    return [PlanOption(**row) for row in await container.plans.list_purchasable()]


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest, container: ContainerDep, tenant_id: TenantIdDep
) -> CheckoutResponse:
    try:
        session = await container.billing.create_checkout(
            tenant_id=tenant_id,
            price_id=body.price_id,
            return_url=body.return_url,
            trial_days=body.trial_days,
        )
    except UnresolvableChangeError as exc:
        # Refuse to start a checkout we could not honour.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except BillingNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return CheckoutResponse(client_secret=session.client_secret, id=session.id)


@router.post("/portal", response_model=PortalResponse)
async def create_portal(
    body: PortalRequest, container: ContainerDep, tenant_id: TenantIdDep
) -> PortalResponse:
    """Stripe-hosted portal where a customer manages or cancels their plan."""
    try:
        url = await container.billing.create_portal(
            tenant_id=tenant_id, return_url=body.return_url
        )
    except UnresolvableChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except BillingNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return PortalResponse(url=url)


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(request: Request, container: ContainerDep) -> dict[str, object]:
    """Apply a Stripe billing event.

    Status codes matter here, because Stripe uses them to decide whether to
    retry:

    * **400** — the signature is invalid. Not retryable; likely an attacker or a
      misconfigured secret.
    * **500** — we could not apply a legitimate change. Retrying is exactly what
      we want, because the alternative is a paying customer with no access.
    * **200** — handled, duplicated, stale, or an event type we do not act on.
    """
    signature = request.headers.get("stripe-signature", "")
    payload = await request.body()
    try:
        change = container.billing.parse_webhook(payload, signature)
    except BillingNotConfiguredError as exc:
        # Distinct from a bad signature: this is our misconfiguration, and a
        # 503 keeps the event in Stripe's retry queue until it is fixed.
        log.error("Billing webhook received but Stripe is not configured.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001 - invalid signature or malformed body
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature."
        ) from exc

    try:
        return await container.billing.handle_webhook(change)
    except UnresolvableChangeError as exc:
        # The customer has been charged but we cannot grant access. Never
        # answer 200 here: that tells Stripe all is well and the failure
        # disappears. A 500 keeps it in Stripe's retry queue and on the
        # dashboard's failed-webhook list until a human resolves it.
        log.error("Unresolvable billing event %s: %s", change.event_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Billing event could not be applied.",
        ) from exc

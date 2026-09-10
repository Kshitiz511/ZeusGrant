"""Billing endpoints: embedded checkout and the Stripe webhook.

Checkout is per-module (one price), so services are purchased independently.
The webhook verifies the signature, normalizes the event, applies the change
and rewarms entitlements — the moment access turns on or off.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from zeus_platform_core.security import ContainerDep, TenantIdDep

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    price_id: str
    return_url: str
    trial_days: int | None = None


class CheckoutResponse(BaseModel):
    client_secret: str | None = None
    id: str | None = None


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    body: CheckoutRequest, container: ContainerDep, tenant_id: TenantIdDep
) -> CheckoutResponse:
    session = await container.billing.create_checkout(
        tenant_id=tenant_id,
        price_id=body.price_id,
        return_url=body.return_url,
        trial_days=body.trial_days,
    )
    return CheckoutResponse(client_secret=session.client_secret, id=session.id)


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(request: Request, container: ContainerDep) -> dict[str, bool]:
    signature = request.headers.get("stripe-signature", "")
    payload = await request.body()
    try:
        change = container.billing.parse_webhook(payload, signature)
    except Exception as exc:  # noqa: BLE001 - invalid signature or malformed body
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature."
        ) from exc

    applied = await container.billing.apply_change(change)
    return {"applied": applied}

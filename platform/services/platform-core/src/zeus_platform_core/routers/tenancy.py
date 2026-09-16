"""Tenancy endpoints: provisioning, tenant selection and workspace membership.

The membership routes are the tenant-facing half of administration -- who is in
a workspace and what they may do there. They are guarded by
``require_tenant_admin`` rather than by entitlements, because managing your own
team is not a module anybody buys.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from zeus_platform_core.domain.models import Role
from zeus_platform_core.security import (
    PLATFORM_ADMIN_ROLE,
    ContainerDep,
    MembershipRoleDep,
    SessionDep,
    TenantAdminDep,
    TenantIdDep,
    TenantOwnerDep,
)
from zeus_platform_core.services.tenancy_service import SeatLimitReached, TenancyError

router = APIRouter(prefix="/tenancy", tags=["tenancy"])


class ProvisionRequest(BaseModel):
    tenant_name: str | None = None


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str
    role: str


class TokenRequest(BaseModel):
    tenant_id: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: str
    role: str


class MemberOut(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None
    role: str
    created_at: datetime | None = None


class RoleUpdate(BaseModel):
    role: Role


class TransferRequest(BaseModel):
    user_id: str


class InviteRequest(BaseModel):
    # Plain str rather than EmailStr: the service lower-cases and validates the
    # address anyway, and pydantic's EmailStr would pull in email-validator for
    # a check that is already happening one layer down.
    email: str
    role: Role = Role.member


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    expires_at: datetime | None = None
    created_at: datetime | None = None
    invited_by_email: str | None = None
    #: Present only on creation. The admin can copy it when mail does not
    #: arrive, which keeps the flow usable during an email outage.
    accept_url: str | None = None
    email_sent: bool | None = None


class AcceptRequest(BaseModel):
    token: str


class SeatsOut(BaseModel):
    used: int
    pending: int
    #: ``None`` means unlimited, the convention used throughout plan_limits.
    limit: int | None = None
    remaining: int | None = None


def _bad_request(exc: TenancyError) -> HTTPException:
    """Map a service refusal onto a status code.

    A seat limit is 402, not 403: the caller is allowed to invite people, they
    have simply run out of room, and the fix is a plan change rather than a
    permission change.
    """
    code = (
        status.HTTP_402_PAYMENT_REQUIRED
        if isinstance(exc, SeatLimitReached)
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(status_code=code, detail=str(exc))


@router.post("/provision", response_model=TenantOut)
async def provision(
    body: ProvisionRequest, container: ContainerDep, session: SessionDep
) -> TenantOut:
    """Create a tenant owned by the caller (or return their first one)."""
    tenant = await container.tenancy.ensure_tenant(
        user_id=session.user_id, email=session.email or ""
    )
    return TenantOut(id=tenant.id, name=tenant.name, slug=tenant.slug, role="owner")


@router.get("/mine")
async def my_tenants(container: ContainerDep, session: SessionDep) -> list[dict]:
    return await container.tenants.list_user_tenants(session.user_id)


@router.post("/token", response_model=TokenResponse)
async def exchange_token(
    body: TokenRequest, container: ContainerDep, session: SessionDep
) -> TokenResponse:
    """Exchange an authenticated session for a **tenant-scoped** token.

    The caller must be a member of ``tenant_id``. The returned JWT carries the
    tenant claim and the caller's role, so module services get proper tenant
    context without an ``X-Tenant-Id`` header. This is the round-trip that
    turns "logged-in user" into "acting within a specific tenant".
    """
    role = await container.tenants.get_membership_role(
        tenant_id=body.tenant_id, user_id=session.user_id
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant.",
        )
    # Roles are rebuilt from authoritative sources on every mint, NOT carried
    # forward from the incoming token. This route takes a token and returns a
    # more privileged one, so anything it copies across is something the holder
    # of a token can keep forever. Membership role comes from the database, and
    # so does platform_admin -- which means revoking either takes effect on the
    # next mint rather than whenever the current token happens to expire.
    roles = [role]
    if await container.tenants.is_platform_admin(session.user_id):
        roles.append(PLATFORM_ADMIN_ROLE)
    token = await container.auth.issue_claims(session.user_id, body.tenant_id, sorted(roles))
    return TokenResponse(
        access_token=token, tenant_id=body.tenant_id, role=role
    )


# --- membership -------------------------------------------------------------


@router.get("/me")
async def my_role(role: MembershipRoleDep, tenant_id: TenantIdDep) -> dict:
    """The caller's role in the active workspace.

    The console decides which administration screens to show from this. That
    is presentation only -- every route below re-checks server-side, because a
    hidden button is not an access control.
    """
    return {"tenant_id": tenant_id, "role": role}


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    container: ContainerDep, tenant_id: TenantIdDep, _: TenantAdminDep
) -> list[MemberOut]:
    rows = await container.tenancy.list_members(tenant_id)
    return [MemberOut(**row) for row in rows]


@router.get("/seats", response_model=SeatsOut)
async def seats(
    container: ContainerDep, tenant_id: TenantIdDep, _: TenantAdminDep
) -> SeatsOut:
    return SeatsOut(**await container.tenancy.seat_usage(tenant_id))


@router.patch("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def change_role(
    user_id: str,
    body: RoleUpdate,
    container: ContainerDep,
    tenant_id: TenantIdDep,
    session: SessionDep,
    _: TenantAdminDep,
) -> None:
    if user_id == session.user_id:
        # An admin demoting themselves could leave a workspace with nobody
        # able to administer it. Removing that footgun costs nothing.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )
    try:
        await container.tenancy.change_role(
            tenant_id=tenant_id, user_id=user_id, role=body.role
        )
    except TenancyError as exc:
        raise _bad_request(exc) from exc


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: str,
    container: ContainerDep,
    tenant_id: TenantIdDep,
    session: SessionDep,
    _: TenantAdminDep,
) -> None:
    if user_id == session.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself from a workspace you administer.",
        )
    try:
        await container.tenancy.remove_member(tenant_id=tenant_id, user_id=user_id)
    except TenancyError as exc:
        raise _bad_request(exc) from exc


@router.post("/members/transfer", status_code=status.HTTP_204_NO_CONTENT)
async def transfer_ownership(
    body: TransferRequest,
    container: ContainerDep,
    tenant_id: TenantIdDep,
    session: SessionDep,
    _: TenantOwnerDep,
) -> None:
    """Hand the workspace to another member. Owner only."""
    try:
        await container.tenancy.transfer_ownership(
            tenant_id=tenant_id,
            from_user_id=session.user_id,
            to_user_id=body.user_id,
        )
    except TenancyError as exc:
        raise _bad_request(exc) from exc


# --- invites ----------------------------------------------------------------


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    container: ContainerDep, tenant_id: TenantIdDep, _: TenantAdminDep
) -> list[InviteOut]:
    return [InviteOut(**row) for row in await container.tenancy.list_invites(tenant_id)]


@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: InviteRequest,
    container: ContainerDep,
    tenant_id: TenantIdDep,
    session: SessionDep,
    _: TenantAdminDep,
) -> InviteOut:
    tenant = await container.tenants.get_by_id(tenant_id)
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such workspace.")
    try:
        invite = await container.tenancy.invite_member(
            tenant_id=tenant_id,
            tenant_name=tenant.name,
            email=body.email,
            role=body.role,
            invited_by=session.user_id,
        )
    except TenancyError as exc:
        raise _bad_request(exc) from exc
    return InviteOut(**invite)


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: str,
    container: ContainerDep,
    tenant_id: TenantIdDep,
    _: TenantAdminDep,
) -> None:
    try:
        await container.tenancy.revoke_invite(tenant_id=tenant_id, invite_id=invite_id)
    except TenancyError as exc:
        raise _bad_request(exc) from exc


@router.post("/invites/accept")
async def accept_invite(
    body: AcceptRequest, container: ContainerDep, session: SessionDep
) -> dict:
    """Join a workspace from an invite link.

    Deliberately *not* behind a tenant dependency. The caller is not a member
    of the target workspace yet, so requiring tenant context would make the
    invite impossible to accept. Authentication is still required: the invite
    is bound to the signed-in account, and to the address it was sent to.
    """
    try:
        return await container.tenancy.accept_invite(
            token=body.token,
            user_id=session.user_id,
            user_email=session.email or "",
        )
    except TenancyError as exc:
        raise _bad_request(exc) from exc

"""Admin control-plane endpoints: LLM keys, config and the prompt registry.

Foundation for the admin dashboard. Secret values (API keys) are stored
encrypted at rest via the ConfigRepository's SecretBox — plaintext never
touches the database and is never returned by read endpoints.

Every mutation here writes a row to ``platform.admin_audit`` before returning.
That is done through ``_audit`` below rather than inline at each call site, so
adding a route means adding one line and not remembering a convention. The
audit write is deliberately *not* wrapped in a try/except: if it fails, the
admin action fails too. A system that appears audited and silently is not is
worse than one that is visibly not.

Secrets are never recorded. Where a value is sensitive the audit row carries
``{"changed": true}`` in place of it — see ``repositories.audit.redact``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from zeus_adapters.models import Session

from zeus_platform_core.container import Container
from zeus_platform_core.repositories.audit import redact
from zeus_platform_core.routers.admin_audit import audit_action
from zeus_platform_core.security import AdminDep, ContainerDep
from zeus_platform_core.services.runtime_config import UnknownConfigKey

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[])


async def _audit(
    container: Container,
    request: Request,
    admin: Session,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    """Thin alias for :func:`admin_audit.audit_action`.

    Kept so the call sites below stay short, and so every admin router shares
    one implementation rather than each growing its own slightly different copy.
    """
    await audit_action(
        container,
        request,
        admin,
        action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
    )


class SettingSet(BaseModel):
    value: str


class ConfigSet(BaseModel):
    key: str
    value: str
    is_secret: bool = False


class PromptCreate(BaseModel):
    name: str
    body: str


class PromptActivate(BaseModel):
    name: str
    version: int


@router.get("/settings")
async def list_settings(container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    """Catalogue of dashboard-managed settings with provenance, never plaintext."""
    rows = await container.runtime_config.status()
    return {
        "settings": [
            {
                "key": r.key,
                "label": r.label,
                "group": r.group,
                "is_secret": r.is_secret,
                "source": r.source,
                "value": r.preview,
                "help": r.help_text,
            }
            for r in rows
        ]
    }


@router.put("/settings/{key:path}")
async def put_setting(
    key: str,
    body: SettingSet,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, bool]:
    try:
        await container.runtime_config.set(key, body.value, updated_by=admin.user_id)
    except UnknownConfigKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    container.invalidate_settings()
    # Redacted unconditionally rather than only for keys flagged secret. This
    # endpoint sets provider credentials alongside ordinary settings, and
    # deciding per-key which are sensitive is a judgement that will eventually
    # be made wrong once. What the audit trail needs is that the value changed.
    await _audit(
        container,
        request,
        admin,
        "setting.update",
        target_type="setting",
        target_id=key,
        after=redact(),
    )
    return {"ok": True}


@router.delete("/settings/{key:path}")
async def delete_setting(
    key: str, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, bool]:
    """Drop the override so the environment value applies again."""
    try:
        await container.runtime_config.clear(key)
    except UnknownConfigKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    container.invalidate_settings()
    await _audit(
        container,
        request,
        admin,
        "setting.clear",
        target_type="setting",
        target_id=key,
    )
    return {"ok": True}


@router.put("/config")
async def set_config(
    body: ConfigSet, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, bool]:
    await container.config.set(
        body.key, body.value, is_secret=body.is_secret, updated_by=admin.user_id
    )
    await _audit(
        container,
        request,
        admin,
        "config.set",
        target_type="config",
        target_id=body.key,
        after=redact() if body.is_secret else {"value": body.value},
    )
    return {"ok": True}


@router.get("/config/{key}")
async def get_config(key: str, container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    value = await container.config.get(key)
    # Never echo secret plaintext back; report presence only.
    return {"key": key, "present": value is not None}


@router.post("/prompts")
async def add_prompt(
    body: PromptCreate, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    version = await container.prompts.add_version(
        name=body.name, body=body.body, created_by=admin.user_id
    )
    # The prompt body is recorded in full. It is not a secret, and a changed
    # prompt is the likeliest explanation for a sudden change in model
    # behaviour -- "which words changed" is the entire question when
    # investigating one.
    await _audit(
        container,
        request,
        admin,
        "prompt.add_version",
        target_type="prompt",
        target_id=body.name,
        after={"version": version, "body": body.body},
    )
    return {"name": body.name, "version": version}


@router.post("/prompts/activate")
async def activate_prompt(
    body: PromptActivate, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, bool]:
    await container.prompts.activate(name=body.name, version=body.version)
    await _audit(
        container,
        request,
        admin,
        "prompt.activate",
        target_type="prompt",
        target_id=body.name,
        after={"version": body.version},
    )
    return {"ok": True}


@router.get("/audit")
async def list_audit(
    container: ContainerDep, admin: AdminDep, limit: int = 100
) -> dict[str, object]:
    """Recent admin actions, newest first.

    Reading the audit log is itself an admin action but is deliberately not
    audited. Recording every read would bury the mutations that matter under
    noise generated by the screen built to display them.
    """
    return {"entries": await container.audit.recent(limit=limit)}

"""Admin control-plane endpoints: LLM keys, config and the prompt registry.

Foundation for the admin dashboard. Secret values (API keys) are stored
encrypted at rest via the ConfigRepository's SecretBox — plaintext never
touches the database and is never returned by read endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from zeus_platform_core.security import AdminDep, ContainerDep
from zeus_platform_core.services.runtime_config import UnknownConfigKey

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[])


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
    key: str, body: SettingSet, container: ContainerDep, admin: AdminDep
) -> dict[str, bool]:
    try:
        await container.runtime_config.set(key, body.value, updated_by=admin.user_id)
    except UnknownConfigKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    container.invalidate_settings()
    return {"ok": True}


@router.delete("/settings/{key:path}")
async def delete_setting(key: str, container: ContainerDep, admin: AdminDep) -> dict[str, bool]:
    """Drop the override so the environment value applies again."""
    try:
        await container.runtime_config.clear(key)
    except UnknownConfigKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    container.invalidate_settings()
    return {"ok": True}


@router.put("/config")
async def set_config(body: ConfigSet, container: ContainerDep, admin: AdminDep) -> dict[str, bool]:
    await container.config.set(
        body.key, body.value, is_secret=body.is_secret, updated_by=admin.user_id
    )
    return {"ok": True}


@router.get("/config/{key}")
async def get_config(key: str, container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    value = await container.config.get(key)
    # Never echo secret plaintext back; report presence only.
    return {"key": key, "present": value is not None}


@router.post("/prompts")
async def add_prompt(
    body: PromptCreate, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    version = await container.prompts.add_version(
        name=body.name, body=body.body, created_by=admin.user_id
    )
    return {"name": body.name, "version": version}


@router.post("/prompts/activate")
async def activate_prompt(
    body: PromptActivate, container: ContainerDep, admin: AdminDep
) -> dict[str, bool]:
    await container.prompts.activate(name=body.name, version=body.version)
    return {"ok": True}

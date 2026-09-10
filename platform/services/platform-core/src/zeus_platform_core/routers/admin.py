"""Admin control-plane endpoints: LLM keys, config and the prompt registry.

Foundation for the admin dashboard. Secret values (API keys) are stored
encrypted at rest via the ConfigRepository's SecretBox — plaintext never
touches the database and is never returned by read endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from zeus_platform_core.security import AdminDep, ContainerDep

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[])


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

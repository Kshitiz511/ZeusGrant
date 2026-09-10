"""Supabase implementation of :class:`AuthProvider`.

Supabase Auth (GoTrue) issues standard JWTs signed with the project's JWT
secret. We verify locally (no network round-trip) and normalize the payload
into a provider-agnostic :class:`Session`. Because GoTrue is open source,
this same shape maps cleanly onto a Keycloak adapter later.
"""

from __future__ import annotations

import time

import jwt

from zeus_adapters.interfaces import AuthProvider
from zeus_adapters.models import Session


class SupabaseAuthProvider(AuthProvider):
    def __init__(self, *, jwt_secret: str, issuer_url: str | None = None) -> None:
        self._jwt_secret = jwt_secret
        self._issuer_url = issuer_url

    async def verify(self, token: str) -> Session:
        payload = jwt.decode(
            token,
            self._jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_aud": False},
        )
        app_meta = payload.get("app_metadata", {}) or {}
        return Session(
            user_id=payload["sub"],
            email=payload.get("email"),
            tenant_id=app_meta.get("tenant_id") or payload.get("tenant_id"),
            roles=app_meta.get("roles", []) or [],
            claims=payload,
        )

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        now = int(time.time())
        payload = {
            "sub": user_id,
            "tenant_id": tenant_id,
            "app_metadata": {"tenant_id": tenant_id, "roles": roles},
            "iat": now,
            "exp": now + 3600,
            "aud": "authenticated",
        }
        return jwt.encode(payload, self._jwt_secret, algorithm="HS256")

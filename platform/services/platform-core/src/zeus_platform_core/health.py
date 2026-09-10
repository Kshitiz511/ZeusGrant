"""Health and readiness endpoints.

``/health`` is a liveness probe. ``/health/config`` reports which providers
are selected and whether each is configured, without ever leaking secret
values. This is how we verify the de-lock-in wiring at a glance.
"""

from __future__ import annotations

from fastapi import APIRouter
from zeus_config import get_settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config")
async def config_report() -> dict[str, object]:
    s = get_settings()

    def configured(*values: object) -> bool:
        return all(v is not None for v in values)

    cache_ok = configured(s.cache.redis_url) if s.cache.provider == "redis" else True
    queue_ok = configured(s.queue.qstash_token) if s.queue.provider == "qstash" else True
    billing_ok = configured(s.billing.stripe_secret_key, s.billing.stripe_webhook_secret)

    return {
        "env": s.env.value,
        "secrets_encryption": configured(s.secrets_encryption_key),
        "providers": {
            "llm": {"selected": s.llm.provider, "model": s.llm.model},
            "cache": {"selected": s.cache.provider, "configured": cache_ok},
            "queue": {"selected": s.queue.provider, "configured": queue_ok},
            "auth": {
                "selected": s.auth.provider,
                "configured": configured(s.auth.supabase_jwt_secret),
            },
            "storage": {"selected": s.storage.provider, "bucket": s.storage.bucket},
            "billing": {"selected": s.billing.provider, "configured": billing_ok},
        },
    }

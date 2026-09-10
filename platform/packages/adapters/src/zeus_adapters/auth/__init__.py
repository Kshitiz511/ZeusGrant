"""Factory selecting an :class:`AuthProvider` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import AuthProvider


def build_auth_provider(settings: Settings) -> AuthProvider:
    provider = settings.auth.provider.lower()

    if provider == "supabase":
        secret = settings.auth.supabase_jwt_secret
        if not secret:
            raise ValueError("ZEUS_SUPABASE_JWT_SECRET is required for the supabase auth provider.")
        from zeus_adapters.auth.supabase_auth import SupabaseAuthProvider

        return SupabaseAuthProvider(
            jwt_secret=secret.get_secret_value(), issuer_url=settings.auth.supabase_url
        )

    # Keycloak adapter slots in here in Phase 2 without touching callers.
    raise ValueError(f"Unknown auth provider: {provider!r}. Expected supabase.")

"""Factory selecting a :class:`Storage` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import Storage


def build_storage(settings: Settings) -> Storage:
    provider = settings.storage.provider.lower()

    if provider == "local":
        from zeus_adapters.storage.local_storage import LocalStorage

        return LocalStorage(root=settings.storage.local_path)

    if provider == "supabase":
        url = settings.auth.supabase_url
        key = settings.auth.supabase_service_role_key
        if not url or not key:
            raise ValueError(
                "ZEUS_SUPABASE_URL and ZEUS_SUPABASE_SERVICE_ROLE_KEY are required for storage."
            )
        from zeus_adapters.storage.supabase_storage import SupabaseStorage

        return SupabaseStorage(url=url, service_role_key=key.get_secret_value())

    raise ValueError(f"Unknown storage provider: {provider!r}. Expected local or supabase.")

"""Vendor-neutral adapters for the Zeus Platform.

Import the interfaces to type against, or the ``build_*`` factories to get a
concrete, config-selected implementation. Nothing here hardcodes a vendor.
"""

from zeus_adapters.auth import build_auth_provider
from zeus_adapters.billing import build_billing_provider
from zeus_adapters.cache import build_cache
from zeus_adapters.db import build_database
from zeus_adapters.interfaces import (
    AuthProvider,
    BillingProvider,
    Cache,
    Database,
    LlmProvider,
    Queue,
    Storage,
)
from zeus_adapters.llm import build_llm_provider
from zeus_adapters.queue import build_queue
from zeus_adapters.storage import build_storage

__all__ = [
    # interfaces
    "LlmProvider",
    "Cache",
    "Database",
    "Queue",
    "AuthProvider",
    "Storage",
    "BillingProvider",
    # factories
    "build_llm_provider",
    "build_cache",
    "build_database",
    "build_queue",
    "build_auth_provider",
    "build_storage",
    "build_billing_provider",
]

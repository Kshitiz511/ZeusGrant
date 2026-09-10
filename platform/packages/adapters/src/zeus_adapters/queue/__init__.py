"""Factory selecting a :class:`Queue` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import Queue


def build_queue(settings: Settings) -> Queue:
    provider = settings.queue.provider.lower()

    if provider == "memory":
        from zeus_adapters.queue.memory_queue import MemoryQueue

        return MemoryQueue()

    if provider == "qstash":
        token = settings.queue.qstash_token
        if not token:
            raise ValueError("ZEUS_QSTASH_TOKEN is required for the qstash queue provider.")
        from zeus_adapters.queue.qstash_queue import QStashQueue

        return QStashQueue(token=token.get_secret_value(), base_url=settings.queue.qstash_url)

    raise ValueError(f"Unknown queue provider: {provider!r}. Expected memory | qstash.")

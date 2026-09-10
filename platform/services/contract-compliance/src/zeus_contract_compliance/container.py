"""Composition root for the Contract Compliance service.

Builds shared adapters from settings (DB, cache, auth, LLM) and the service's
repositories. Adapters are injectable so tests can substitute fakes.
"""

from __future__ import annotations

from functools import cached_property

from zeus_adapters import (
    build_auth_provider,
    build_cache,
    build_database,
    build_llm_provider,
    build_queue,
)
from zeus_adapters.interfaces import AuthProvider, Cache, Database, LlmProvider, Queue
from zeus_config import Settings, get_settings
from zeus_service_kit import ServiceSecurity

from zeus_contract_compliance.extraction import ExtractionService
from zeus_contract_compliance.repository import ContractRepository, ObligationRepository


class Container:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: Database | None = None,
        cache: Cache | None = None,
        auth: AuthProvider | None = None,
        llm: LlmProvider | None = None,
        queue: Queue | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._db_override = db
        self._cache_override = cache
        self._auth_override = auth
        self._llm_override = llm
        self._queue_override = queue

    @cached_property
    def db(self) -> Database:
        return self._db_override or build_database(self.settings)

    @cached_property
    def cache(self) -> Cache:
        return self._cache_override or build_cache(self.settings)

    @cached_property
    def auth(self) -> AuthProvider:
        return self._auth_override or build_auth_provider(self.settings)

    @cached_property
    def llm(self) -> LlmProvider:
        return self._llm_override or build_llm_provider(self.settings)

    @cached_property
    def queue(self) -> Queue:
        return self._queue_override or build_queue(self.settings)

    @cached_property
    def contracts(self) -> ContractRepository:
        return ContractRepository(self.db)

    @cached_property
    def obligations(self) -> ObligationRepository:
        return ObligationRepository(self.db)

    @cached_property
    def extraction(self) -> ExtractionService:
        return ExtractionService(llm=self.llm, db=self.db)

    @cached_property
    def security(self) -> ServiceSecurity:
        return ServiceSecurity(auth=self.auth, cache=self.cache, db=self.db)

    async def startup(self) -> None:
        await self.db.connect()

    async def shutdown(self) -> None:
        await self.db.disconnect()

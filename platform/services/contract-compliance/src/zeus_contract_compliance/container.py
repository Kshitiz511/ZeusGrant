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
    build_storage,
)
from zeus_adapters.interfaces import (
    AuthProvider,
    Cache,
    Database,
    LlmProvider,
    Queue,
    Storage,
)
from zeus_config import Settings, get_settings
from zeus_service_kit import ServiceSecurity
from zeus_service_kit.dispatch import JobNotifier
from zeus_service_kit.jobs import JobRepository
from zeus_service_kit.metering import AiUsageRecorder
from zeus_service_kit.worker import Worker

from zeus_contract_compliance.domain import MODULE_ID, WAKE_TOPIC
from zeus_contract_compliance.extraction import ExtractionService
from zeus_contract_compliance.ingestion import IngestionService
from zeus_contract_compliance.repository import (
    AiUsageRepository,
    AuditRepository,
    ContractRepository,
    DocumentRepository,
    ObligationRepository,
)


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
        storage: Storage | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._db_override = db
        self._cache_override = cache
        self._auth_override = auth
        self._llm_override = llm
        self._queue_override = queue
        self._storage_override = storage

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
    def jobs(self) -> JobRepository:
        """This module's job ledger, wired to wake its own worker.

        The notifier is attached here rather than at each call site so that no
        enqueue can be written that forgets it. The ledger is the record of
        what work exists; the queue only makes a worker start sooner than the
        next scheduled sweep.
        """
        secret = self.settings.worker_secret
        return JobRepository(
            self.db,
            MODULE_ID,
            notify=JobNotifier(
                lambda: self.queue,
                WAKE_TOPIC,
                secret=secret.get_secret_value() if secret else None,
            ),
        )

    def build_worker(self, *, kinds: list[str] | None = None) -> Worker:
        """A worker bound to this container.

        Not cached: each call returns a worker with its own identity, so two
        concurrent HTTP drains cannot claim jobs under the same worker id and
        overwrite each other's leases.
        """
        from zeus_contract_compliance.job_handlers import registry

        return Worker(jobs=self.jobs, container=self, handlers=registry, kinds=kinds)

    @cached_property
    def storage(self) -> Storage:
        return self._storage_override or build_storage(self.settings)

    @cached_property
    def contracts(self) -> ContractRepository:
        return ContractRepository(self.db)

    @cached_property
    def obligations(self) -> ObligationRepository:
        return ObligationRepository(self.db)

    @cached_property
    def documents(self) -> DocumentRepository:
        return DocumentRepository(self.db)

    @cached_property
    def audit(self) -> AuditRepository:
        return AuditRepository(self.db)

    @cached_property
    def ingestion(self) -> IngestionService:
        return IngestionService(
            storage=self.storage,
            documents=self.documents,
            contracts=self.contracts,
            bucket=self.settings.storage.bucket,
            max_bytes=self.settings.storage.max_upload_bytes,
        )

    @cached_property
    def ai_usage(self) -> AiUsageRepository:
        return AiUsageRepository(self.db)

    @cached_property
    def metering(self) -> AiUsageRecorder:
        """Platform-wide usage ledger.

        Superseded ``ai_usage`` for billing: that table stored a character-count
        estimate and no output tokens or cost, and being module-scoped it could
        not answer the owner's cross-tenant question at all.
        """
        return AiUsageRecorder(
            self.db,
            self.cache,
            # Env-driven here, not admin-driven. This service has no config
            # store of its own, and giving a module service write access to
            # platform-wide settings to read one number would be a much worse
            # trade than it reading the deployed default.
            ttl_seconds=lambda: self.settings.cache.model_price_ttl_seconds,
        )

    @cached_property
    def extraction(self) -> ExtractionService:
        llm_settings = self.settings.llm
        return ExtractionService(
            llm=self.llm,
            db=self.db,
            model=llm_settings.model,
            chunk_chars=llm_settings.chunk_chars,
            chunk_overlap_chars=llm_settings.chunk_overlap_chars,
            max_chunks=llm_settings.max_chunks,
        )

    @cached_property
    def security(self) -> ServiceSecurity:
        return ServiceSecurity(
            auth=self.auth,
            cache=self.cache,
            db=self.db,
            member_ttl_seconds=lambda: self.settings.cache.membership_ttl_seconds,
        )

    async def startup(self) -> None:
        await self.db.connect()

    async def shutdown(self) -> None:
        await self.db.disconnect()

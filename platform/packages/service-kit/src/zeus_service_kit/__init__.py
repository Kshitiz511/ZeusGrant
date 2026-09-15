"""Shared building blocks for Zeus module services.

Every sellable module (Grant Intelligence, Contract Compliance, Audit Vault,
...) is its own FastAPI microservice. They all need the same things: verify
the caller's token, independently confirm the tenant is entitled to that
module, and run slow work outside the request path without losing it.

This kit provides all three so the enforcement and durability logic exists
once, not per service. A fourth module gets them by importing, which is what
makes adding a service cheap enough to be worth selling on its own.
"""

from zeus_service_kit.jobs import Job, JobRepository
from zeus_service_kit.security import ActorDep, ServiceSecurity, module_active
from zeus_service_kit.worker import (
    HandlerRegistry,
    JobContext,
    JobLost,
    Worker,
    default_worker_id,
)

__all__ = [
    "ActorDep",
    "HandlerRegistry",
    "Job",
    "JobContext",
    "JobLost",
    "JobRepository",
    "ServiceSecurity",
    "Worker",
    "default_worker_id",
    "module_active",
]

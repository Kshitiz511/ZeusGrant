"""Shared building blocks for Zeus module services.

Every sellable module (Contract Compliance, Audit Vault, ...) is its own
FastAPI microservice. They all need the same two things: verify the caller's
token and independently confirm the tenant is entitled to that module. This
kit provides both so the enforcement logic exists once, not per service.
"""

from zeus_service_kit.security import ServiceSecurity, module_active

__all__ = ["ServiceSecurity", "module_active"]

"""Grant Intelligence's job handler registry.

One registry per sellable module, deliberately. Both services are mounted into
a single ASGI app in production, so a process-wide registry would let this
module's worker pick up Contract Compliance handlers and vice versa. The
ledger already refuses cross-module claims; this keeps the Python side honest
for the same reason, rather than relying on the database to catch a mistake
the code should not be able to make.

Importing this module is what makes the handlers exist. The imports at the
bottom are therefore load-bearing, not decoration.
"""

from __future__ import annotations

from zeus_service_kit.worker import HandlerRegistry

#: Must match a row in platform.modules. Jobs carry it so queue depth, AI
#: spend and SLA are answerable per service rather than pooled across the
#: platform.
MODULE_ID = "grant_intelligence"

#: QStash topic whose URL group points at this module's drain endpoint
#: (``POST /api/core/grants/worker/run``). One topic per module, so a service
#: is woken only for its own work and the two cannot trigger each other.
WAKE_TOPIC = "grant-intelligence-worker"

registry = HandlerRegistry()

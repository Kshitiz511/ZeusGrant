"""Waking a worker after a job is enqueued.

The ledger and the queue do different jobs, and conflating them is how this
went wrong the first time:

* **The ledger is the truth.** It knows what work exists, whether it has run,
  who holds the lease, and how many scans a tenant has used this month. It
  survives restarts and can be queried.
* **The queue is only a doorbell.** It carries no state. Its single job is to
  make something start draining sooner than the next scheduled sweep.

Getting that split wrong in either direction breaks something real. Without
the queue, a serverless deployment has no long-lived process to poll, so jobs
sit queued forever and nothing ever notices. Without the ledger, a dropped
message loses the work silently and a redelivered one runs it twice.

Two consequences follow, and both are deliberate:

1. **A failed notify never fails the enqueue.** The job is already committed.
   Losing the doorbell costs latency until the next scheduled sweep; raising
   here would cost the user their request for something already recorded.
2. **A deduplicated enqueue does not notify.** The live job it collapsed into
   already rang the bell. Ringing again would be a second wake-up for one
   piece of work.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Protocol

log = logging.getLogger(__name__)


class _Publisher(Protocol):
    """The slice of :class:`zeus_adapters.interfaces.Queue` used here."""

    async def publish(self, topic: str, payload: dict[str, Any]) -> str: ...


class JobNotifier:
    """Publishes a wake-up for one module's worker.

    ``topic`` maps to a QStash URL group whose destination is that module's
    drain endpoint. One topic per module, so a service is woken only for its
    own work and the two cannot be triggered by each other's traffic.

    The publisher is supplied as a factory and resolved on first use, after
    the secret check. Building it eagerly meant that reading this module's
    ledger required a fully configured queue -- so a local run with no QStash
    token returned 500 from endpoints that never intended to publish anything.
    """

    def __init__(
        self,
        queue_factory: Callable[[], _Publisher],
        topic: str,
        *,
        secret: str | None = None,
        max_jobs: int = 5,
    ) -> None:
        self._queue_factory = queue_factory
        self._topic = topic
        self._secret = secret
        self._max_jobs = max_jobs

    async def __call__(self, job: Any) -> None:
        if not self._secret:
            # The drain endpoint refuses unauthenticated calls, so publishing
            # without a secret would only produce a 403 at the far end. Skip
            # quietly: this is the normal state for a local run where a
            # long-lived worker is polling anyway.
            log.debug("jobs.notify_skipped reason=no_worker_secret job=%s", job.id)
            return

        payload = {
            "secret": self._secret,
            "max_jobs": self._max_jobs,
            # Carried for log correlation only. The worker claims whatever is
            # next in its module rather than trusting an id from a message,
            # which keeps a forged or replayed payload from selecting work.
            "job_id": job.id,
            "module_id": job.module_id,
        }
        try:
            # Inside the try on purpose: a queue that cannot even be built is
            # the same problem as one that will not accept a message, and both
            # should cost latency rather than the caller's request.
            await self._queue_factory().publish(self._topic, payload)
        except Exception:
            # See the module docstring: the work is committed, so this is a
            # latency problem, not a correctness one. The scheduled sweep will
            # pick it up.
            log.warning(
                "jobs.notify_failed topic=%s job=%s kind=%s "
                "(job is queued and will run on the next sweep)",
                self._topic, job.id, job.kind, exc_info=True,
            )

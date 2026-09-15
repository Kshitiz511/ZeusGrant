"""Background worker: claim a job, run it, report the outcome.

Design constraints, in the order they mattered:

  * Never overload the database. One job at a time per worker by default, a
    poll interval with backoff when idle, and a hard cap on concurrency. Ten
    workers spinning on an empty queue would issue thousands of pointless
    round trips a minute.
  * Never lose a job. Anything raised by a handler is caught and reported to
    the ledger; an uncaught exception that killed the loop would leave the job
    'running' until its lease expired, delaying the retry by minutes.
  * Never let two workers write one job's result. The lease is checked on every
    heartbeat, and a lost lease stops the handler rather than letting it finish
    and overwrite the replacement's work.

The worker runs both as a standalone process (long-lived, for a VM or
container) and as a single bounded pass triggered by HTTP (for serverless,
where nothing may run for more than the platform's function timeout).

A worker drains exactly one module, because its :class:`JobRepository` is
bound to one. Two services deployed into the same process therefore cannot
take each other's work, which is what keeps them independently sellable: a
stuck grant ingest cannot delay a contract analysis for a customer who never
bought Grant Intelligence.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import random
import socket
import time
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from zeus_service_kit.jobs import Job, JobRepository

log = logging.getLogger(__name__)

#: How long a claimed job is held before another worker may take it. Must
#: comfortably exceed the heartbeat interval or a healthy worker loses its own
#: job mid-run.
LEASE_SECONDS = 300

#: Heartbeat cadence. A third of the lease, so two consecutive missed beats
#: still leave time to recover before the lease lapses.
HEARTBEAT_SECONDS = 90

#: Idle polling. Starts fast so an interactive job is picked up quickly, then
#: backs off so an idle deployment is nearly free.
POLL_MIN_SECONDS = 1.0
POLL_MAX_SECONDS = 30.0


JobHandler = Callable[["JobContext"], Awaitable[dict[str, Any] | None]]


class JobLost(Exception):
    """Raised when this worker no longer holds the lease.

    Distinct from a handler error because it must not consume a retry attempt:
    the job is already being run by someone else.
    """


@dataclass(slots=True)
class JobContext:
    """What a handler is given. Deliberately small.

    Handlers receive a progress callback rather than the repository, so they
    cannot mark their own job finished. Completion is the worker's decision,
    made once, in one place.
    """

    job: Job
    container: Any
    _worker: Worker

    @property
    def payload(self) -> dict[str, Any]:
        return self.job.payload

    @property
    def tenant_id(self) -> str | None:
        return self.job.tenant_id

    async def progress(self, done: int, total: int | None = None) -> None:
        """Report progress and renew the lease.

        Long handlers must call this. A load that takes twelve minutes without
        a heartbeat will have its lease expire at five, and a second worker
        will start the same load alongside the first.
        """
        ok = await self._worker.jobs.heartbeat(
            self.job.id,
            self._worker.worker_id,
            lease_seconds=LEASE_SECONDS,
            done=done,
            total=total,
        )
        if not ok:
            raise JobLost(f"lease lost for job {self.job.id}")


class HandlerRegistry:
    """Maps job kinds to the code that runs them.

    Deliberately not a process-wide singleton. Both services are mounted into
    one ASGI app in production, so a shared registry would make every module's
    handlers reachable from every module's worker — one import away from the
    isolation between sellable services being silently undone. Each service
    creates its own instance instead.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, JobHandler] = {}

    def register(self, kind: str) -> Callable[[JobHandler], JobHandler]:
        def decorator(fn: JobHandler) -> JobHandler:
            if kind in self._handlers:
                raise ValueError(f"handler already registered for {kind!r}")
            self._handlers[kind] = fn
            return fn

        return decorator

    def get(self, kind: str) -> JobHandler | None:
        return self._handlers.get(kind)

    @property
    def kinds(self) -> list[str]:
        return sorted(self._handlers)


def default_worker_id() -> str:
    """Stable enough to read in logs, unique enough to never collide.

    Host and PID identify which process holds a lease when two are misbehaving;
    the random suffix covers containers that share a hostname and recycle PIDs.
    """
    return f"{socket.gethostname()}:{os.getpid()}:{random.randint(0x1000, 0xFFFF):04x}"


class Worker:
    def __init__(
        self,
        *,
        jobs: JobRepository,
        container: Any,
        handlers: HandlerRegistry,
        worker_id: str | None = None,
        kinds: list[str] | None = None,
    ) -> None:
        self.jobs = jobs
        self.container = container
        self.handlers = handlers
        self.worker_id = worker_id or default_worker_id()
        # None means "anything this module owns". A deployment can dedicate
        # workers to ingest so a 28-second bulk load never blocks an
        # interactive rescore.
        self.kinds = kinds
        self._stopping = asyncio.Event()

    def stop(self) -> None:
        self._stopping.set()

    async def run_forever(self) -> None:
        """Poll until stopped. For a long-lived process."""
        log.info(
            "worker.start id=%s module=%s kinds=%s",
            self.worker_id, self.jobs.module_id, self.kinds or "all",
        )
        delay = POLL_MIN_SECONDS
        while not self._stopping.is_set():
            try:
                ran = await self.run_once()
            except Exception:
                # The loop itself must never die. A database blip should cost a
                # poll, not the worker.
                log.exception("worker.loop_error id=%s", self.worker_id)
                ran = False
                delay = POLL_MAX_SECONDS

            if ran:
                delay = POLL_MIN_SECONDS  # more work likely waiting
            else:
                delay = min(delay * 2, POLL_MAX_SECONDS)
                # Jitter stops N workers that started together from polling in
                # lockstep forever, which turns independent pollers into a
                # synchronised thundering herd.
                jittered = delay * (0.5 + random.random())
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stopping.wait(), timeout=jittered)

        log.info("worker.stop id=%s", self.worker_id)

    async def drain(self, *, max_jobs: int = 10, max_seconds: float = 45.0) -> dict[str, Any]:
        """Run up to ``max_jobs`` then return. For serverless invocation.

        Bounded by wall clock as well as count because the platform kills the
        function at its timeout regardless of what we are doing. Stopping at 45
        seconds under a 60-second limit leaves room to finish the job in hand
        and report it, rather than being killed mid-write and leaving a lease
        to expire.
        """
        started = time.monotonic()
        done = 0
        while done < max_jobs and (time.monotonic() - started) < max_seconds:
            if not await self.run_once():
                break
            done += 1
        return {
            "worker_id": self.worker_id,
            "module_id": self.jobs.module_id,
            "jobs_run": done,
            "seconds": round(time.monotonic() - started, 2),
        }

    async def run_once(self) -> bool:
        """Claim and run a single job. False means the queue was empty."""
        job = await self.jobs.claim(
            self.worker_id, lease_seconds=LEASE_SECONDS, kinds=self.kinds
        )
        if job is None:
            return False

        handler = self.handlers.get(job.kind)
        if handler is None:
            # Unknown kind. Fail without retrying: three attempts will not make
            # a handler appear, and the retries only obscure the real problem,
            # which is a deployment missing code the queue expects.
            log.error("worker.no_handler kind=%s job=%s", job.kind, job.id)
            await self.jobs.finish(
                job.id,
                self.worker_id,
                succeeded=False,
                error=f"No handler registered for kind '{job.kind}'",
                retry_delay_seconds=0,
            )
            return True

        log.info(
            "job.start id=%s kind=%s tenant=%s attempt=%d/%d",
            job.id, job.kind, job.tenant_id, job.attempts, job.max_attempts,
        )
        started = time.monotonic()
        ctx = JobContext(job=job, container=self.container, _worker=self)

        # Heartbeat in the background so a handler that does not report progress
        # still holds its lease. Handlers that loop should call ctx.progress,
        # but the worker must not depend on them remembering to.
        beat = asyncio.create_task(self._heartbeat(job))
        try:
            result = await handler(ctx)
        except JobLost:
            # Someone else owns this now. Do not touch the ledger: finish_job
            # would be rejected anyway, and a retry must not be consumed.
            log.warning("job.lease_lost id=%s kind=%s", job.id, job.kind)
            return True
        except asyncio.CancelledError:
            # Process shutting down. Leave the lease to expire so the job is
            # retried promptly rather than marked failed for being interrupted.
            log.warning("job.cancelled id=%s kind=%s", job.id, job.kind)
            raise
        except Exception as exc:  # noqa: BLE001 - a handler fault must not kill the worker
            elapsed = time.monotonic() - started
            log.exception("job.failed id=%s kind=%s after=%.1fs", job.id, job.kind, elapsed)
            # Store the traceback, truncated. Debugging a nightly failure from
            # "ValueError" alone is guesswork; the whole trace in a text column
            # is how tables get bloated by a crash loop.
            detail = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"[:4000]
            await self.jobs.finish(
                job.id,
                self.worker_id,
                succeeded=False,
                error=detail,
                retry_delay_seconds=_backoff(job.attempts),
            )
            return True
        finally:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat

        elapsed = time.monotonic() - started
        await self.jobs.finish(
            job.id, self.worker_id, succeeded=True, result=result or {}
        )
        log.info("job.done id=%s kind=%s in=%.1fs", job.id, job.kind, elapsed)
        return True

    async def _heartbeat(self, job: Job) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            try:
                ok = await self.jobs.heartbeat(
                    job.id, self.worker_id, lease_seconds=LEASE_SECONDS
                )
            except Exception:
                # A failed heartbeat is not fatal on its own; the lease still
                # has two thirds of its life left and the next beat may succeed.
                log.warning("job.heartbeat_error id=%s", job.id, exc_info=True)
                continue
            if not ok:
                log.warning("job.heartbeat_rejected id=%s", job.id)
                return


def _backoff(attempts: int) -> int:
    """Exponential backoff with a ceiling: 60s, 120s, 240s ... capped at 1h.

    A job failing because a source API is down should not hammer it every
    minute, and the cap stops a long-lived failure from drifting into a retry
    delay measured in days.
    """
    return min(60 * (2 ** max(0, attempts - 1)), 3600)

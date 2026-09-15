"""Standalone worker process.

    uv run python -m zeus_platform_core.worker_main
    uv run python -m zeus_platform_core.worker_main --kinds grants_gov.ingest

Use this where a process can live indefinitely. Serverless deployments call the
HTTP drain endpoint instead, since nothing there may run past the function
timeout.

Shutdown is graceful: SIGTERM stops the loop after the current job finishes,
rather than killing it mid-write and leaving a lease to expire. That difference
is a job retried in seconds versus one stuck for five minutes.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal

from zeus_platform_core.container import Container

log = logging.getLogger("zeus.worker")


async def _run(kinds: list[str] | None, once: bool) -> None:
    container = Container()
    await container.startup()
    worker = container.build_worker(kinds=kinds)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        # add_signal_handler rather than signal.signal: the default handler
        # raises inside whatever coroutine happens to be running, which can
        # interrupt a database write. This sets a flag the loop checks between
        # jobs instead.
        loop.add_signal_handler(sig, worker.stop)

    try:
        if once:
            summary = await worker.drain(max_jobs=1000, max_seconds=3600)
            log.info("drained %s", summary)
        else:
            await worker.run_forever()
    finally:
        await container.shutdown()


def main() -> None:
    parser = argparse.ArgumentParser(description="Zeus background worker")
    parser.add_argument(
        "--kinds",
        nargs="*",
        default=None,
        help="Only run these job kinds. Omit to run everything. Dedicating "
             "workers to ingest keeps a 28-second bulk load from delaying an "
             "interactive rescore.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Drain the queue and exit, rather than polling forever.",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )

    # Ctrl-C during shutdown is the user asking twice. Nothing to report.
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_run(args.kinds, args.once))


if __name__ == "__main__":
    main()

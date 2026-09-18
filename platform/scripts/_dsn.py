#!/usr/bin/env python3
"""Where a script connects, and saying so out loud.

Every operational script in this directory needs a DSN, and several of them
resolved it by quietly reading ``.env.production.local``. That is how D21
happened: ``migrate.py`` applied DDL to the live database because the shortest
command in the file defaulted to production and the host scrolled past unread.

D21 was fixed in ``migrate.py`` alone. It was not fixed in the eleven other
scripts that resolve a DSN the same way, so ``verify_schema.py`` spent Phase 7
silently reporting on production while appearing to describe the laptop --
reading, not writing, so nothing broke, which is luck rather than design.

This module is the shared answer:

  * **Local by default.** Production requires an explicit flag.
  * **The host is always printed**, before anything runs, to stderr so a pipe
    through ``tail`` cannot hide it. That, specifically, is what hid D21.
  * **Writes to production require a typed confirmation**, and fail closed
    when there is no terminal to type at.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"

#: The docker-compose Postgres the tests and probes use.
LOCAL_DSN = "postgresql://zeus:zeus@localhost:5433/zeus"

#: Same database, unprivileged role. Use this to check what the *application*
#: can see -- a superuser bypasses RLS and will happily tell you isolation
#: works when it does not.
LOCAL_APP_DSN = "postgresql://zeus_app:zeus_app@localhost:5433/zeus"


def host_of(dsn: str) -> str:
    return dsn.split("@")[-1].split("/")[0]


def is_local(dsn: str) -> bool:
    return host_of(dsn).startswith(("localhost", "127.0.0.1", "[::1]", "postgres:"))


def production_dsn() -> str | None:
    """The hosted DSN from the environment or the untracked env file."""
    dsn = os.environ.get("ZEUS_MIGRATE_URL")
    if dsn:
        return dsn
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("ZEUS_MIGRATE_URL="):
            return line.split("=", 1)[1].strip() or None
    return None


def resolve_dsn(*, production: bool, local_default: str = LOCAL_DSN) -> str:
    """Pick a target and announce it.

    Printed to **stderr** deliberately: these scripts are routinely piped
    through ``tail`` or ``grep``, and a banner on stdout is exactly the banner
    that got scrolled away when 0018 went to production by accident.
    """
    if production:
        dsn = production_dsn()
        if not dsn:
            sys.exit(
                "--production was given but no ZEUS_MIGRATE_URL is set, "
                f"and {ENV_FILE.name} does not define one."
            )
    else:
        dsn = local_default

    label = "PRODUCTION" if not is_local(dsn) else "local"
    print(f"target: {label}  {host_of(dsn)}", file=sys.stderr)
    return dsn


def confirm_production(dsn: str, *, action: str, assume_yes: bool = False) -> None:
    """Require the hostname to be typed back before writing to production.

    ``assume_yes`` exists for CI, which has no terminal. Without a terminal and
    without that flag this refuses rather than prompting into the void -- a
    prompt nobody can answer must fail closed, not hang or silently proceed.
    """
    if is_local(dsn):
        return
    host = host_of(dsn)
    if assume_yes:
        print(f"--yes given; {action} against {host}", file=sys.stderr)
        return
    if not sys.stdin.isatty():
        sys.exit(f"refusing to {action} against {host} with no terminal to confirm at.")
    typed = input(f"About to {action} against PRODUCTION ({host}).\nType the host to confirm: ")
    if typed.strip() != host:
        sys.exit("confirmation did not match; nothing was done.")


def require_local(dsn: str, *, what: str = "this script") -> None:
    """Refuse outright. For probes that create rows they cannot clean up."""
    if not is_local(dsn):
        sys.exit(f"{what} refuses to run against non-local host: {host_of(dsn)}")

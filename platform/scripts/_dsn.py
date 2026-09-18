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
    return env_dsn() or file_dsn()


def env_dsn() -> str | None:
    """A DSN exported into the environment, if any.

    This wins over everything else. Someone who exported a DSN meant it, and
    CI sets it to point at its own ephemeral Postgres. It is still announced
    and still locality-checked, so exporting a production URL can make a write
    intentional but never silent.
    """
    return os.environ.get("ZEUS_MIGRATE_URL") or None


def file_dsn() -> str | None:
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("ZEUS_MIGRATE_URL="):
            return line.split("=", 1)[1].strip() or None
    return None


def resolve_dsn(*, production: bool, local_default: str = LOCAL_DSN) -> str:
    """Pick a target and announce it.

    Order: an exported ``ZEUS_MIGRATE_URL``, then ``--production`` reading the
    env file, then local.

    Printed to **stderr** deliberately: these scripts are routinely piped
    through ``tail`` or ``grep``, and a banner on stdout is exactly the banner
    that got scrolled away when 0018 went to production by accident.
    """
    dsn = env_dsn()
    source = "ZEUS_MIGRATE_URL"
    if dsn is None:
        if production:
            dsn = file_dsn()
            source = ENV_FILE.name
            if not dsn:
                sys.exit(
                    "--production was given but no ZEUS_MIGRATE_URL is set, "
                    f"and {ENV_FILE.name} does not define one."
                )
        else:
            dsn = local_default
            source = "default"

    label = "PRODUCTION" if not is_local(dsn) else "local"
    print(f"target: {label}  {host_of(dsn)}  (from {source})", file=sys.stderr)
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


def env_value(name: str) -> str | None:
    """A named setting from the environment, else the untracked env file.

    Scripts need more than one DSN -- ``ZEUS_MIGRATE_URL`` is the owner role,
    ``ZEUS_DATABASE_URL`` is the unprivileged runtime role -- and which one a
    script uses changes what it is able to see. A check for tenant isolation
    run as the owner will report success whatever the policies say.
    """
    return os.environ.get(name) or _from_file(name)


def _from_file(name: str) -> str | None:
    if not ENV_FILE.exists():
        return None
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip() or None
    return None


def announce(dsn: str, *, role: str = "", purpose: str = "") -> str:
    """Print the target to stderr and return the DSN unchanged.

    For scripts whose whole purpose *is* production -- provisioning a role,
    auditing the live database. They do not need a flag, they need to say so
    out loud. Returned unchanged so it can wrap a connect call inline.
    """
    label = "local" if is_local(dsn) else "PRODUCTION"
    bits = [f"target: {label}  {host_of(dsn)}"]
    if role:
        bits.append(f"as {role}")
    if purpose:
        bits.append(f"({purpose})")
    print("  ".join(bits), file=sys.stderr)
    return dsn


def required_dsn(name: str, *, role: str = "", purpose: str = "") -> str:
    """``env_value`` that exits if unset, and announces what it found."""
    dsn = env_value(name)
    if not dsn:
        sys.exit(f"{name} is not set and {ENV_FILE.name} does not define it.")
    return announce(dsn, role=role, purpose=purpose)

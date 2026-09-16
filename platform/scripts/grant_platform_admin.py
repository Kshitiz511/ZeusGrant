#!/usr/bin/env python
"""Grant or revoke the platform-admin privilege. Run by hand, never over HTTP.

    python scripts/grant_platform_admin.py --list
    python scripts/grant_platform_admin.py you@example.com
    python scripts/grant_platform_admin.py you@example.com --revoke

WHY THIS IS A SCRIPT AND NOT AN ENDPOINT
----------------------------------------
The first platform admin has a bootstrap problem: an endpoint that creates
platform admins must itself be guarded by platform admin, and nobody holds it
yet. The usual escapes -- a hardcoded email in a migration, a setup route that
is open until first use, an environment variable checked at startup -- all
create a path to the highest privilege in the system that is not a deliberate,
recorded human act. A script run against the production database by somebody
holding its credentials already requires the thing we would otherwise be
inventing a mechanism to prove.

Every grant and revoke writes to platform.admin_audit, including the very first
one. An audit trail with a gap at the beginning is a trail that cannot answer
the most interesting question about itself.

TAKES EFFECT ON THE NEXT TOKEN MINT
-----------------------------------
The flag is read from the database when a token is issued, not carried forward
from an existing one. A grant applies at the target's next login or refresh; a
revoke likewise. Neither is retroactive against a token already in someone's
hands, so revoke and then assume the privilege persists until that token
expires.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for pkg in (
    "packages/config/src",
    "packages/adapters/src",
    "packages/service-kit/src",
    "services/platform-core/src",
):
    sys.path.insert(0, str(REPO / pkg))

from zeus_adapters.db.postgres_db import PostgresDatabase  # noqa: E402
from zeus_platform_core.repositories.audit import AuditRepository  # noqa: E402
from zeus_platform_core.repositories.tenants import TenantRepository  # noqa: E402


def _dsn() -> str:
    """The database to act on, stated explicitly rather than guessed.

    No default. Granting the highest privilege in the system to the wrong
    database because an environment variable was unset is a failure worth
    making impossible, and the cost of preventing it is one exported variable.
    """
    dsn = os.environ.get("ZEUS_DATABASE_URL") or os.environ.get("ZEUS_MIGRATE_URL")
    if not dsn:
        sys.exit(
            "Set ZEUS_DATABASE_URL (or ZEUS_MIGRATE_URL) to the target database.\n"
            "For production:  export $(grep ZEUS_MIGRATE_URL .env.production.local | xargs)"
        )
    return dsn


def _host(dsn: str) -> str:
    """Host and database name only -- never the password, which is in the DSN."""
    from urllib.parse import urlparse

    p = urlparse(dsn)
    return f"{p.hostname}/{(p.path or '').lstrip('/')}"


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("email", nargs="?", help="Account to grant or revoke.")
    ap.add_argument("--revoke", action="store_true", help="Remove the privilege.")
    ap.add_argument("--list", action="store_true", help="Show current admins and exit.")
    ap.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
    args = ap.parse_args()

    if not args.email and not args.list:
        ap.error("Give an email address, or --list.")

    dsn = _dsn()
    db = PostgresDatabase(dsn=dsn)
    await db.connect()
    try:
        tenants = TenantRepository(db)
        audit = AuditRepository(db)

        current = await tenants.list_platform_admins()
        print(f"Database: {_host(dsn)}")
        print(f"Platform admins currently: {len(current)}")
        for row in current:
            print(f"  - {row['email']}")

        if args.list:
            return 0

        user = await tenants.get_user_by_email(args.email)
        if user is None:
            # Deliberately not created here. This script changes privilege on an
            # existing account; making one would mean a user with no verified
            # email and no password holding the highest privilege in the system.
            print(f"\nNo account with email {args.email!r}. They must sign up first.")
            return 1

        user_id = str(user["id"])
        enabled = not args.revoke
        verb = "REVOKE from" if args.revoke else "GRANT to"

        print(f"\n{verb}: {user['email']} ({user_id})")
        if not args.yes and input("Type 'yes' to proceed: ").strip().lower() != "yes":
            print("Aborted. Nothing changed.")
            return 1

        changed = await tenants.set_platform_admin(user_id, enabled=enabled)
        if not changed:
            print(f"No change: {user['email']} already "
                  f"{'lacks' if args.revoke else 'holds'} the privilege.")
            return 0

        # Written after the change and before reporting success, so a failure
        # to audit surfaces as a failure of the whole operation rather than as
        # a privilege change nobody recorded.
        await audit.record(
            action="platform_admin.revoke" if args.revoke else "platform_admin.grant",
            actor_user_id=None,
            actor_email=f"script:{os.environ.get('USER', 'unknown')}",
            target_type="user",
            target_id=user_id,
            before={"is_platform_admin": args.revoke},
            after={"is_platform_admin": enabled},
        )

        print(f"Done. {user['email']} {'no longer holds' if args.revoke else 'now holds'} "
              "the platform-admin privilege.")
        print("Takes effect at their next login or token refresh.")
        return 0
    finally:
        await db.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

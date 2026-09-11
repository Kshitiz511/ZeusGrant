"""Send one real email through the configured provider.

Kept as a script rather than a test: it spends a real send against the
account quota and needs live credentials, so it must never run in CI.

Usage:
    uv run python scripts/probe_email.py you@example.com
"""

from __future__ import annotations

import asyncio
import sys

from zeus_adapters.email import build_email_sender
from zeus_config.settings import get_settings


async def main() -> int:
    if len(sys.argv) != 2:
        print("usage: probe_email.py <recipient>")
        return 2
    to = sys.argv[1]

    settings = get_settings()
    print(f"provider : {settings.email.provider}")
    print(f"from     : {settings.email.from_address}")
    print(f"to       : {to}")

    sender = build_email_sender(settings)
    try:
        await sender.send(
            to=to,
            subject="123456 is your Zeus verification code",
            text=(
                "Hi,\n\n"
                "Your verification code is 123456\n\n"
                "It expires in 15 minutes.\n\n"
                "If you didn't create a Zeus account, you can ignore this email.\n"
            ),
        )
    except Exception as exc:  # noqa: BLE001 - the provider's message is the point
        print(f"\nFAILED: {exc}")
        return 1
    print("\nSent. Check the inbox, and the spam folder.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

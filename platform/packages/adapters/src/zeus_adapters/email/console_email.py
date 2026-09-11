"""Development :class:`EmailSender` that logs instead of delivering.

Lets the whole verification flow be exercised locally without an email
provider account or DNS records. It refuses to run in production, because a
silently-discarded verification code there would lock every new user out of
their account with no visible error.
"""

from __future__ import annotations

import logging

from zeus_adapters.interfaces import EmailSender

log = logging.getLogger(__name__)


class ConsoleEmailSender(EmailSender):
    async def send(
        self, *, to: str, subject: str, text: str, html: str | None = None
    ) -> None:
        log.warning(
            "EMAIL NOT SENT (console transport)\n  to: %s\n  subject: %s\n%s",
            to,
            subject,
            text,
        )

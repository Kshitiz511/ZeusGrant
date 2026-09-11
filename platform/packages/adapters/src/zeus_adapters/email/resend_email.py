"""Resend-backed :class:`EmailSender`.

Resend is a thin HTTPS API, so this is a direct httpx call rather than another
SDK dependency. Their free tier covers transactional volume at this stage.
"""

from __future__ import annotations

import httpx

from zeus_adapters.interfaces import EmailSender

_ENDPOINT = "https://api.resend.com/emails"


class ResendEmailSender(EmailSender):
    def __init__(self, *, api_key: str, from_address: str, timeout: float = 10.0) -> None:
        self._api_key = api_key
        self._from = from_address
        self._timeout = timeout

    async def send(
        self, *, to: str, subject: str, text: str, html: str | None = None
    ) -> None:
        payload: dict[str, object] = {
            "from": self._from,
            "to": [to],
            "subject": subject,
            "text": text,
        }
        if html:
            payload["html"] = html

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                _ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        if response.status_code >= 400:
            # The body carries Resend's reason (unverified domain, invalid
            # recipient). Losing it would turn every failure into the same
            # unactionable "email failed".
            raise RuntimeError(
                f"Resend rejected the message ({response.status_code}): {response.text[:300]}"
            )

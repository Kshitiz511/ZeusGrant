"""Factory selecting an :class:`EmailSender` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import EmailSender


def build_email_sender(settings: Settings) -> EmailSender:
    provider = settings.email.provider.lower()

    if provider == "console":
        from zeus_adapters.email.console_email import ConsoleEmailSender

        return ConsoleEmailSender()

    if provider == "resend":
        key = settings.email.resend_api_key
        if not key:
            raise ValueError("ZEUS_RESEND_API_KEY is required for the resend email provider.")
        from zeus_adapters.email.resend_email import ResendEmailSender

        return ResendEmailSender(
            api_key=key.get_secret_value(),
            from_address=settings.email.from_address,
        )

    raise ValueError(f"Unknown email provider: {provider!r}. Expected console | resend.")

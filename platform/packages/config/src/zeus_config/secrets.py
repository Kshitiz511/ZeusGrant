"""Encryption at rest for admin-managed secrets.

Infrastructure secrets (Supabase, Stripe, Redis) come from environment
variables and never touch the database. But secrets that admins edit at
runtime from the dashboard — most importantly LLM API keys and, later,
per-tenant provider keys — must be stored in Postgres. Those are wrapped
with :class:`SecretBox` so the database only ever holds ciphertext.

A single master key (``ZEUS_SECRETS_ENCRYPTION_KEY``) is held in the
environment. Rotating it re-encrypts stored values; the ciphertext format
is versioned to make rotation safe.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "zsb1:"  # zeus secret box, format v1


class SecretBoxError(RuntimeError):
    """Raised when encryption or decryption cannot be performed."""


class SecretBox:
    """Symmetric encrypt/decrypt for values stored in the database.

    Example::

        box = SecretBox(master_key)
        stored = box.encrypt("sk-live-...")   # -> "zsb1:gAAAA..."
        raw = box.decrypt(stored)             # -> "sk-live-..."
    """

    def __init__(self, master_key: str) -> None:
        if not master_key:
            raise SecretBoxError(
                "ZEUS_SECRETS_ENCRYPTION_KEY is not set. Generate one with "
                "`python -c \"from cryptography.fernet import Fernet; "
                'print(Fernet.generate_key().decode())"`.'
            )
        try:
            self._fernet = Fernet(master_key.encode("utf-8"))
        except (ValueError, TypeError) as exc:
            raise SecretBoxError(
                "Invalid master key; expected a urlsafe base64 Fernet key."
            ) from exc

    def encrypt(self, plaintext: str) -> str:
        token = self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")
        return f"{_PREFIX}{token}"

    def decrypt(self, ciphertext: str) -> str:
        if not ciphertext.startswith(_PREFIX):
            raise SecretBoxError("Unrecognized ciphertext format.")
        token = ciphertext[len(_PREFIX) :]
        try:
            return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise SecretBoxError("Could not decrypt; wrong key or corrupted value.") from exc

    @staticmethod
    def generate_key() -> str:
        """Return a fresh master key (for provisioning)."""
        return Fernet.generate_key().decode("utf-8")

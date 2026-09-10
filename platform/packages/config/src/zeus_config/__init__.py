"""Typed configuration and secure secrets for the Zeus Platform.

Nothing sensitive is hardcoded. All values flow from environment variables
through :func:`get_settings`. Admin-managed secrets (e.g. LLM keys editable
from the future admin dashboard) are encrypted at rest via :mod:`SecretBox`.
"""

from zeus_config.secrets import SecretBox
from zeus_config.settings import Settings, get_settings

__all__ = ["Settings", "get_settings", "SecretBox"]

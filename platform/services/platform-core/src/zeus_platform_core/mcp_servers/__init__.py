"""MCP servers exposing platform capability as deterministic tools.

Named ``mcp_servers`` rather than ``mcp`` on purpose. A package called ``mcp``
sitting inside an importable tree invites confusion with the installed ``mcp``
library, and anyone debugging an import error here would waste an hour on it.
"""

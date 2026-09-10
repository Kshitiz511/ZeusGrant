"""Dev entrypoint: `uv run zeus-core`."""

from __future__ import annotations

import uvicorn
from zeus_config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "zeus_platform_core.app:app",
        host="0.0.0.0",
        port=8000,
        reload=not settings.is_production,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()

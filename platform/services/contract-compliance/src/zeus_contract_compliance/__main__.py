"""Dev entrypoint: `uv run zeus-contract-compliance`."""

from __future__ import annotations

import uvicorn
from zeus_config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "zeus_contract_compliance.app:app",
        host="0.0.0.0",
        port=8001,
        reload=not settings.is_production,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()

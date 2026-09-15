"""Download and load the Grants.gov daily extract.

Usage:
    uv run python scripts/ingest_grants_gov.py            # fetch today's extract
    uv run python scripts/ingest_grants_gov.py path.xml   # load a local file

This is the manual form of what will become a queued job. It is deliberately a
script and not an HTTP endpoint: the file is 306 MB unzipped and takes minutes
to load, which is far past the 60-second function limit in production.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import tempfile
import time
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from zeus_adapters.db import build_database
from zeus_config.settings import get_settings
from zeus_platform_core.sources.grants_gov import parse
from zeus_platform_core.sources.loader import OpportunityLoader

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("ingest")

_EXTRACT_URL = "https://prod-grants-gov-chatbot.s3.amazonaws.com/extracts/GrantsDBExtract{date}v2.zip"


def download_latest(dest_dir: Path) -> Path:
    """Fetch the most recent daily extract.

    Today's file is not always published yet, so this walks back a few days
    rather than failing. A two-day-old catalogue is far better than none.
    """
    for days_back in range(4):
        stamp = (datetime.now(UTC) - timedelta(days=days_back)).strftime("%Y%m%d")
        url = _EXTRACT_URL.format(date=stamp)
        log.info("trying %s", url)
        with httpx.stream("GET", url, timeout=300.0, follow_redirects=True) as response:
            if response.status_code != 200:
                continue
            zip_path = dest_dir / f"grants-{stamp}.zip"
            with zip_path.open("wb") as fh:
                for chunk in response.iter_bytes(chunk_size=1 << 20):
                    fh.write(chunk)
        log.info("downloaded %s (%.0f MB)", zip_path.name, zip_path.stat().st_size / 1e6)

        with zipfile.ZipFile(zip_path) as zf:
            names = [n for n in zf.namelist() if n.endswith(".xml")]
            if not names:
                raise RuntimeError(f"no XML inside {zip_path.name}")
            zf.extract(names[0], dest_dir)
        return dest_dir / names[0]

    raise RuntimeError("no Grants.gov extract published in the last 4 days")


async def main() -> int:
    settings = get_settings()
    db = build_database(settings)
    await db.connect()

    with tempfile.TemporaryDirectory() as tmp:
        xml_path = Path(sys.argv[1]) if len(sys.argv) > 1 else download_latest(Path(tmp))

        size_mb = xml_path.stat().st_size / 1e6
        log.info("loading %s (%.0f MB)", xml_path.name, size_mb)

        started = time.time()
        loader = OpportunityLoader(db)
        result = await loader.load(parse(xml_path))
        elapsed = time.time() - started

    log.info(
        "done in %.0fs: %d inserted, %d updated, %d failed",
        elapsed,
        result.inserted,
        result.updated,
        result.failed,
    )
    await db.disconnect()
    return 1 if result.failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

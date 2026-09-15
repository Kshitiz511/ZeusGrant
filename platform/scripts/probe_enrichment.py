#!/usr/bin/env python3
"""One real enrichment call, to prove the LLM path works end to end.

Deliberately minimal. This spends money on the OpenAI key, so it reads exactly
one eligibility paragraph rather than a batch, and the second half of the test
checks that a repeat call is served from cache and costs nothing.

    ./.venv/bin/python scripts/probe_enrichment.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path[:0] = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), p)
    for p in (
        "packages/config/src",
        "packages/adapters/src",
        "packages/service-kit/src",
        "services/platform-core/src",
    )
]

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}  {detail}")


async def main() -> int:
    from zeus_platform_core.container import Container

    container = Container()
    await container.startup()

    try:
        model = f"{container.settings.llm.provider}:{container.settings.llm.model}"
        print(f"\nModel: {model}")
        print("=" * 60)

        # Pick a real record where the codes genuinely do not answer the
        # question -- code 25 means "see the text field", and there are 49,223
        # of those. Using invented text would prove nothing about real data.
        row = await container.db.fetch_one(
            """
            SELECT id, title, eligibility_note
              FROM platform.opportunities
             WHERE eligibility_codes && ARRAY['25']
               AND eligibility_note IS NOT NULL
               AND length(eligibility_note) BETWEEN 200 AND 1500
               AND NOT is_forecast
               AND (closes_on IS NULL OR closes_on >= current_date)
             ORDER BY closes_on ASC NULLS LAST
             LIMIT 1
            """
        )
        if row is None:
            print("No suitable record found.")
            return 1

        print(f"\nRecord: {row['title'][:60]}")
        print(f"Prose:  {row['eligibility_note'][:220].strip()}...\n")

        codes = await container.opportunities.eligibility_codes()
        agent = container.enrichment

        # Clear any prior reading so this is a genuine call, not a cache hit
        # that would make a broken model path look healthy.
        await container.db.execute(
            "DELETE FROM platform.enrichment_cache WHERE opportunity_id = $1::uuid",
            str(row["id"]),
        )

        print("1. First call (real model request)")
        t0 = time.monotonic()
        result = await agent.read_eligibility(
            text=row["eligibility_note"], codes=codes, opportunity_id=str(row["id"])
        )
        elapsed = time.monotonic() - t0

        check("model returned a reading", result.reading is not None)
        check("first call was not cached", result.cached is False)
        print(f"        took {elapsed:.1f}s")

        r = result.reading
        valid = {c["code"] for c in codes}
        check("no invented applicant codes", set(r.applicant_codes).issubset(valid),
              f"{set(r.applicant_codes) - valid}")
        check("confidence is in range", 0.0 <= r.confidence <= 1.0, str(r.confidence))
        check("summary is present", bool(r.summary.strip()))
        check("summary is short enough to show", len(r.summary) <= 400, str(len(r.summary)))
        check("states look like state codes",
              all(len(s) == 2 and s.isupper() for s in r.geographic_restriction),
              str(r.geographic_restriction))

        print(f"\n        codes:      {r.applicant_codes}")
        print(f"        excluded:   {r.excluded_codes}")
        print(f"        states:     {r.geographic_restriction or 'none stated'}")
        print(f"        confidence: {r.confidence}")
        print(f"        summary:    {r.summary[:150]}")

        print("\n2. Second call (must be free)")
        t0 = time.monotonic()
        again = await agent.read_eligibility(
            text=row["eligibility_note"], codes=codes, opportunity_id=str(row["id"])
        )
        cached_elapsed = time.monotonic() - t0

        check("second call served from cache", again.cached is True)
        check("cache is much faster", cached_elapsed < elapsed / 2,
              f"{cached_elapsed:.2f}s vs {elapsed:.1f}s")
        check("cached result is identical",
              again.reading.model_dump() == r.model_dump())
        print(f"        took {cached_elapsed:.2f}s")

        print("\n3. Concept expansion")
        t0 = time.monotonic()
        terms = await agent.expand_concepts(["after school", "youth development"])
        check("returns alternative phrasings", len(terms) >= 3, str(terms))
        check("stays within the stated cap", len(terms) <= 20, str(len(terms)))
        print(f"        took {time.monotonic() - t0:.1f}s")
        print(f"        {', '.join(terms[:8])}")

        print("\n" + "=" * 60)
        print(f"  {passed} passed, {failed} failed")
        return 1 if failed else 0
    finally:
        await container.shutdown()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

#!/usr/bin/env python3
"""Measure what one extraction actually costs.

Runs the real extraction pipeline against the real model with a representative
contract, and reports the token counts the provider reported. No estimation --
the point of this script is to replace a guess with a measurement.

Usage:
    OPENAI_API_KEY=sk-... uv run --with openai python scripts/measure_tokens.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "adapters" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "config" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "service-kit" / "src"))
sys.path.insert(0, str(ROOT / "services" / "contract-compliance" / "src"))

# A mid-size services agreement. Chosen to be realistic rather than convenient:
# it has obligations spread across sections, some with dates and some without,
# which is what real uploads look like.
SAMPLE_CONTRACT = """
MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into as of January 15,
2026 ("Effective Date") by and between Northwind Analytics Inc., a Delaware
corporation ("Provider"), and Cascade Health Partners LLC ("Client").

1. SERVICES
1.1 Provider shall deliver the data integration platform described in Exhibit A
no later than March 31, 2026.
1.2 Provider shall provide Tier 2 technical support during Client's business
hours, responding to all Severity 1 incidents within four (4) hours.
1.3 Provider shall deliver a written implementation plan within thirty (30) days
of the Effective Date.

2. CLIENT OBLIGATIONS
2.1 Client shall designate a project sponsor within ten (10) business days of
the Effective Date.
2.2 Client shall provide Provider with access to its test environment and all
reasonably necessary documentation.
2.3 Client shall pay all undisputed invoices within forty-five (45) days of
receipt.

3. FEES AND PAYMENT
3.1 Client shall pay Provider an annual platform fee of $240,000, invoiced
quarterly in advance.
3.2 Provider shall submit invoices no later than the fifth business day of each
quarter.
3.3 Late payments shall accrue interest at 1.5% per month.

4. DATA PROTECTION
4.1 Provider shall maintain SOC 2 Type II certification throughout the Term and
shall furnish its most recent report to Client upon request, and in any event
annually by June 30.
4.2 Provider shall notify Client of any suspected security incident affecting
Client Data within twenty-four (24) hours of discovery.
4.3 Provider shall encrypt all Client Data at rest and in transit.
4.4 Upon termination, Provider shall return or destroy all Client Data within
sixty (60) days and certify such destruction in writing.

5. SERVICE LEVELS
5.1 Provider shall maintain 99.9% monthly uptime, measured excluding scheduled
maintenance.
5.2 Provider shall deliver a monthly service level report by the tenth day of
the following month.
5.3 Service credits shall be applied automatically where uptime falls below the
committed level.

6. TERM AND TERMINATION
6.1 The initial Term is three (3) years from the Effective Date.
6.2 Either party may terminate for material breach upon thirty (30) days written
notice, provided the breaching party has failed to cure within that period.
6.3 Client may terminate for convenience upon ninety (90) days written notice.

7. INSURANCE
7.1 Provider shall maintain commercial general liability insurance of not less
than $2,000,000 per occurrence and shall name Client as an additional insured.
7.2 Provider shall furnish certificates of insurance annually.

8. COMPLIANCE
8.1 Each party shall comply with all applicable laws, including HIPAA where
Provider acts as a Business Associate.
8.2 Provider shall execute the Business Associate Agreement attached as
Exhibit C prior to receiving any Protected Health Information.
"""


async def main() -> int:
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("ZEUS_OPENAI_API_KEY")
    if not api_key:
        print("Set OPENAI_API_KEY.")
        return 1

    model = os.environ.get("ZEUS_LLM_MODEL", "gpt-5-mini")
    # Repeat the sample to approximate a larger upload. Repetition is not fully
    # representative of content, but it is representative of *volume*, which is
    # what decides whether a run fits inside the 60s function cap.
    scale = int(os.environ.get("SCALE", "1"))
    contract = SAMPLE_CONTRACT * scale

    from zeus_adapters.db.fake_db import FakeDatabase
    from zeus_adapters.llm.openai_provider import OpenAiProvider
    from zeus_contract_compliance.extraction import ExtractionService

    provider = OpenAiProvider(api_key=api_key, model=model, timeout_seconds=120)

    # FakeDatabase returns None for the prompt lookup, so the service falls back
    # to its built-in prompt -- the same one a fresh install uses. The
    # measurement therefore reflects default configuration, not a tuned one.
    service = ExtractionService(llm=provider, db=FakeDatabase(), model=model)

    chars = len(contract)
    print(f"\nModel:    {model}")
    print(f"Contract: {chars:,} chars (~{chars // 4:,} tokens by the old estimate)\n")

    result = await service.extract_detailed(contract)

    print(f"  obligations found : {len(result.obligations)}")
    print(f"  chunks            : {result.chunks} ({result.chunks_failed} failed)")
    print(f"  dropped           : {result.dropped}")
    print(f"  latency           : {result.latency_ms:,} ms")
    print(f"  prompt tokens     : {result.prompt_tokens:,}")
    print(f"  completion tokens : {result.completion_tokens:,}")
    total = (result.prompt_tokens or 0) + (result.completion_tokens or 0)
    print(f"  total tokens      : {total:,}")

    # Published gpt-5-mini rates. Stated here only to turn the measurement into
    # a number you can reason about -- the database stays unseeded so nothing
    # bills against an unverified rate.
    in_rate, out_rate = 0.25, 2.00
    cost = (result.prompt_tokens or 0) / 1e6 * in_rate + (
        result.completion_tokens or 0
    ) / 1e6 * out_rate
    print(f"\n  cost at ${in_rate}/${out_rate} per 1M : ${cost:.6f}")
    print(f"  → 1,000 such runs           : ${cost * 1000:.2f}")

    if result.latency_ms > 55_000:
        print("\n  WARNING: latency is near the 60s Vercel function cap.")

    print("\n  Sample obligations:")
    for ob in result.obligations[:5]:
        due = f" (due {ob.due_date})" if ob.due_date else ""
        print(f"    - {ob.description[:70]}{due}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

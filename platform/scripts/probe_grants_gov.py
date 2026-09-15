"""Measure the parser against the real extract: correctness, speed, memory."""

from __future__ import annotations

import resource
import sys
import time
from datetime import date

from zeus_platform_core.sources.grants_gov import parse

path = sys.argv[1]
t0 = time.time()
n = forecasts = open_now = rolling = with_codes = 0
today = date.today()
first = None
uids = set()
dupes = 0

for o in parse(path):
    n += 1
    if o.source_uid in uids:
        dupes += 1
    uids.add(o.source_uid)
    if o.is_forecast:
        forecasts += 1
    if o.closes_on and o.closes_on >= today:
        open_now += 1
    if o.closes_on is None:
        rolling += 1
    if o.eligibility_codes:
        with_codes += 1
    if first is None and not o.is_forecast and o.closes_on and o.closes_on >= today:
        first = o

peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024
print(f"parsed       : {n:,} in {time.time() - t0:.1f}s")
print(f"peak memory  : {peak:.0f} MB")
print(f"duplicate ids: {dupes:,}")
print(f"forecasts    : {forecasts:,}")
print(f"open today   : {open_now:,}")
print(f"rolling      : {rolling:,}")
print(f"with codes   : {with_codes:,}")
print()
print("--- first open record ---")
print("  title     :", first.title[:70])
print("  agency    :", first.agency_name)
print("  number    :", first.opportunity_number)
print("  posted    :", first.posted_on)
print("  closes    :", first.closes_on)
print("  floor/ceil:", first.award_floor, "/", first.award_ceiling)
print("  codes     :", first.eligibility_codes)
print("  cfda      :", first.cfda_numbers)
print("  costshare :", first.cost_sharing_required)
print("  url       :", first.source_url)

#!/usr/bin/env python3
"""Exercise the MCP tools directly, without an MCP client.

Calls each tool function the same way the protocol layer would, so a broken
query is caught here rather than inside an agent conversation where the failure
surfaces as the model apologising instead of an exception.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

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
    from zeus_platform_core.mcp_servers.grants_server import build_server

    print("\nBuilding MCP server")
    print("=" * 60)
    server = build_server()

    tools = await server.list_tools()
    names = sorted(t.name for t in tools)
    print(f"\n{len(names)} tools exposed: {', '.join(names)}\n")

    expected = {
        "search_opportunities", "get_opportunity", "list_eligibility_codes",
        "score_for_tenant", "get_org_profile", "catalogue_stats",
    }
    check("all expected tools registered", expected.issubset(set(names)),
          f"missing {expected - set(names)}")

    # Every tool needs a description: an MCP client shows these to the model,
    # and a tool with no description is a tool the model will not choose.
    undescribed = [t.name for t in tools if not t.description]
    check("every tool has a description", not undescribed, f"{undescribed}")

    async def call(name: str, args: dict):
        result = await server.call_tool(name, args)

        # Three shapes across SDK versions: mcp 2.x returns a CallToolResult
        # object, some 1.x builds return (content, structured), older ones a
        # bare content list. Read whichever is present rather than pinning the
        # SDK, since the tool code itself is version-independent.
        structured = getattr(result, "structured_content", None)
        if structured is not None:
            return structured

        if isinstance(result, tuple):
            content, structured = result
            if structured is not None:
                return structured
        else:
            content = getattr(result, "content", result)

        for block in content or []:
            text = getattr(block, "text", None)
            if text:
                try:
                    return json.loads(text)
                except ValueError:
                    return {"text": text}
        return {}

    print("\n1. catalogue_stats")
    stats = await call("catalogue_stats", {})
    check("returns the catalogue size", stats.get("total", 0) > 80_000, str(stats)[:150])
    print(f"        {stats.get('total'):,} records, {stats.get('open_now')} open")

    print("\n2. list_eligibility_codes")
    codes = await call("list_eligibility_codes", {})
    check("returns 17 codes", len(codes.get("codes", [])) == 17,
          f"got {len(codes.get('codes', []))}")

    print("\n3. search_opportunities")
    found = await call("search_opportunities", {"query": "youth education", "limit": 5})
    check("finds matching grants", found.get("count", 0) > 0, str(found)[:150])
    check("truncation is declared", "truncated" in found)
    opps = found.get("opportunities", [])
    if opps:
        print(f"        top: {opps[0].get('title', '')[:58]}")
        # The summariser must not leak the heavy fields into a model's context.
        check("summary omits the description", "description" not in opps[0])
        check("summary omits raw source data", "raw" not in opps[0])

    print("\n4. search with a filter")
    filtered = await call("search_opportunities", {
        "query": "health", "closing_within_days": 30, "limit": 5,
    })
    check("filtered search runs", filtered.get("count", 0) >= 0, str(filtered)[:150])
    print(f"        {filtered.get('count')} closing within 30 days")

    print("\n5. get_opportunity")
    if opps:
        detail = await call("get_opportunity", {"opportunity_id": opps[0]["id"]})
        check("returns the full record", "description" in detail, str(detail)[:150])
        check("includes eligibility prose", "eligibility_note" in detail)

    print("\n6. missing record is reported, not raised")
    missing = await call(
        "get_opportunity",
        {"opportunity_id": "00000000-0000-0000-0000-000000000000"},
    )
    check("returns a structured error", missing.get("error") == "not_found", str(missing)[:150])

    print("\n7. tenant tools")
    import subprocess
    tenant = subprocess.run(
        ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus", "-d", "zeus",
         "-t", "-A", "-c",
         "SELECT tenant_id FROM platform.org_profiles WHERE cardinality(focus_areas) > 0 "
         "ORDER BY updated_at DESC LIMIT 1"],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip()

    if tenant:
        profile = await call("get_org_profile", {"tenant_id": tenant})
        check("profile readable", profile.get("is_scoreable") is True, str(profile)[:150])

        scored = await call("score_for_tenant", {"tenant_id": tenant, "limit": 5})
        check("scores returned", scored.get("count", 0) > 0, str(scored)[:200])
        matches = scored.get("matches", [])
        if matches:
            check("each score carries reasons", all(m.get("reasons") for m in matches))
            print(f"        top match {matches[0].get('score')}/100")
    else:
        print("        (no scoreable tenant; run e2e_grants.py first)")

    print("\n8. unknown tenant is handled")
    nobody = await call(
        "score_for_tenant",
        {"tenant_id": "00000000-0000-0000-0000-000000000000"},
    )
    check("reports no profile rather than failing", nobody.get("error") == "no_profile",
          str(nobody)[:150])

    print("\n" + "=" * 60)
    print(f"  {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

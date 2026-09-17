"""Break-test harness: deliberately defeat a guarantee, confirm a test notices.

A test that has never been seen to fail is not evidence of anything. This
applies each patch below in turn, runs the suite, restores the file, and
reports whether the suite actually failed. Run it, read the output, delete
nothing -- it is cheap to keep and it is the only thing that distinguishes a
real test from a decorative one.

Usage (from platform/):
    unset PYTHONPATH && PYTHONPATH=... .venv/bin/python scripts/break_test_phase5.py
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "services/platform-core/src/zeus_platform_core"
KIT = ROOT / "packages/service-kit/src/zeus_service_kit"

PATCHES: list[tuple[str, pathlib.Path, str, str]] = [
    # --- Phase 6: job observability -----------------------------------------
    (
        "heartbeat reads .get on a bool again (the D20 bug)",
        KIT / "jobs.py",
        "        return bool(row and row.get(\"ok\"))",
        "        return bool(row or {}).get(\"ok\", False)  # BREAK",
    ),
    (
        "a lost lease is reported as held, so two workers write one job",
        KIT / "jobs.py",
        "        return bool(row and row.get(\"ok\"))",
        "        return True  # BREAK",
    ),
    (
        "progress no longer raises when the lease is gone, so cancel cannot bite",
        KIT / "worker.py",
        "        if not ok:\n            raise JobLost",
        "        if False:\n            raise JobLost  # BREAK",
    ),
    (
        "the job list returns payloads, leaking tenant data into a casual read",
        SRC / "repositories/jobs_admin.py",
        "_LIST_COLUMNS = \"\"\"\n    id, kind,",
        "_LIST_COLUMNS = \"\"\"\n    payload, result,  -- BREAK\n    id, kind,",
    ),
    (
        "opening a job is no longer audited",
        SRC / "routers/admin_jobs.py",
        '        "job.viewed",',
        '        "job.opened",  # BREAK',
    ),
    (
        "cancelling a finished job reports success instead of a conflict",
        SRC / "routers/admin_jobs.py",
        '    if job["status"] != "cancelled":',
        "    if False:  # BREAK",
    ),
    (
        "a superseded retry falls through to a 500",
        SRC / "routers/admin_jobs.py",
        '    if outcome == "superseded":',
        "    if False:  # BREAK",
    ),
    (
        "the stuck filter forgets jobs whose worker died",
        SRC / "repositories/jobs_admin.py",
        "    (status = 'running' AND locked_until < now())",
        "    (FALSE)  -- BREAK",
    ),
    (
        "an empty queue reports a healthy zero per cent failure rate",
        SRC / "repositories/jobs_admin.py",
        '"failure_rate_24h": round(failed / total, 4) if total else None,',
        '"failure_rate_24h": round(failed / total, 4) if total else 0.0,  # BREAK',
    ),
    (
        "the reap sweep becomes unbounded",
        SRC / "routers/admin_jobs.py",
        "max_rows: int = Field(default=1000, ge=1, le=10000)",
        "max_rows: int = Field(default=1000)  # BREAK",
    ),
    (
        "suspension no longer empties the entitlement snapshot",
        SRC / "domain/entitlements.py",
        "    if tenant_status not in ACTIVE_TENANT_STATUSES:",
        "    if False:  # BREAK",
    ),
    (
        "overrides replace the plan's limits instead of merging into them",
        SRC / "domain/entitlements.py",
        "        limits.update(overrides)",
        "        limits = dict(overrides)  # BREAK",
    ),
    (
        "bootstrap guard names an env var that does not exist (the D14 bug)",
        SRC / "services/runtime_config.py",
        '        "ZEUS_SUPABASE_JWT_SECRET",',
        '        "ZEUS_JWT_SECRET",  # BREAK',
    ),
    (
        "the suspend route drops its admin guard",
        SRC / "routers/admin_tenants.py",
        "@router.post(\"/{tenant_id}/status\")",
        "@router.post(\"/{tenant_id}/status\")  # BREAK\nasync def _unused() -> None: ...\n",
    ),
    (
        "the limit-override write is no longer audited",
        SRC / "routers/admin_tenants.py",
        '        "tenant.limit.set",',
        '        "tenant.limit.set.BREAK",',
    ),
    # --- Phase 5b: catalogue and model prices --------------------------------
    (
        "a model price edit no longer clears the cache key (defect D7 returns)",
        SRC / "routers/admin_catalog.py",
        "    await container.cache.delete(price_cache_key(normalised))\n\n"
        '    await audit_action(\n        container,\n        request,\n'
        '        admin,\n        "model_price.set",',
        '    await audit_action(  # BREAK\n        container,\n        request,\n'
        '        admin,\n        "model_price.set",',
    ),
    (
        "module_id becomes editable, silently re-granting a plan's subscribers",
        SRC / "repositories/plans.py",
        '        "is_active",\n    }\n)',
        '        "is_active",\n        "module_id",  # BREAK\n    }\n)',
    ),
    (
        "setting plan limits stops invalidating the subscribers' caches",
        SRC / "routers/admin_catalog.py",
        "    for tenant_id in affected:\n"
        "        await container.entitlements.invalidate(tenant_id)",
        "    for tenant_id in affected:  # BREAK\n        pass",
    ),
    (
        "a price change stops warning that subscribers are not re-priced",
        SRC / "routers/admin_catalog.py",
        '        warnings.append(f"{PRICE_WARNING} {subscribers} subscriber(s) are unaffected.")',
        "        pass  # BREAK",
    ),
    (
        "an unrecognised Stripe price id is accepted in silence",
        SRC / "routers/admin_catalog.py",
        '        if price is None:\n            warnings.append(',
        '        if False:  # BREAK\n            warnings.append(',
    ),
    (
        "plan limits merge instead of being replaced, so a removed key survives",
        SRC / "repositories/plans.py",
        '        await self._db.execute("DELETE FROM platform.plan_limits '
        'WHERE plan_id = $1", plan_id)',
        "        pass  # BREAK",
    ),
    (
        "test-connection no longer resets the provider, so a rotated key is untested",
        SRC / "routers/admin_catalog.py",
        "    container.billing.reset_provider()",
        "    pass  # BREAK",
    ),
    # --- Phase 5c: bounds, live TTLs, cache flush, key rotation --------------
    (
        "the membership TTL loses its ceiling, so an auth cache can be set to a day",
        SRC / "services/runtime_config.py",
        '        env_var="ZEUS_CACHE_MEMBERSHIP_TTL_SECONDS",\n'
        '        settings_path="cache.membership_ttl_seconds",\n'
        '        value_type="int",\n'
        "        minimum=10,\n"
        "        maximum=300,",
        '        env_var="ZEUS_CACHE_MEMBERSHIP_TTL_SECONDS",\n'
        '        settings_path="cache.membership_ttl_seconds",\n'
        '        value_type="int",\n'
        "        minimum=10,\n"
        "        maximum=None,  # BREAK",
    ),
    (
        "bounds stop being checked on write, so a bad value reaches the database",
        SRC / "services/runtime_config.py",
        "        spec.validate(value)\n        await self._config.set(",
        "        await self._config.set(  # BREAK",
    ),
    (
        "an out-of-bounds stored value is trusted on the read path",
        SRC / "services/runtime_config.py",
        "        if stored is not None and not spec.in_range(stored):",
        "        if False:  # BREAK",
    ),
    (
        "the entitlements TTL is captured once instead of read per write",
        SRC / "services/entitlements_service.py",
        "            ttl_seconds=self._ttl_seconds(),",
        "            ttl_seconds=_DEFAULT_TTL_SECONDS,  # BREAK",
    ),
    (
        "the model price TTL is captured once instead of read per write",
        SRC.parents[3] / "packages/service-kit/src/zeus_service_kit/metering.py",
        "                price_cache_key(model), value, ttl_seconds=self._ttl_seconds()",
        "                price_cache_key(model), value, ttl_seconds=PRICE_CACHE_TTL_SECONDS",
    ),
    (
        "the cache flush accepts any prefix, so a wildcard can sign everyone out",
        SRC / "routers/admin.py",
        "    if prefix not in FLUSHABLE_PREFIXES:",
        "    if False:  # BREAK",
    ),
    (
        "the cache flush is no longer audited",
        SRC / "routers/admin.py",
        '        "cache.flushed",',
        '        "cache.flushed.BREAK",',
    ),
    (
        "rotating a Stripe key no longer rebuilds the client (the 8.5 gap returns)",
        SRC / "routers/admin.py",
        "    if not key.startswith(\"billing.\"):\n        return",
        "    if True:  # BREAK\n        return",
    ),
    (
        "settings stop refreshing on the request path (defect D18 returns)",
        SRC / "app.py",
        "        await request.app.state.container.effective_settings()",
        "        pass  # BREAK",
    ),
]


def run_suite() -> bool:
    """True if the suite passed."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "services", "packages", "-q", "--no-header"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    if not run_suite():
        print("baseline suite is already failing; fix that first")
        return 2

    print("baseline: green\n")
    survived: list[str] = []

    for description, path, old, new in PATCHES:
        original = path.read_text()
        if old not in original:
            print(f"SKIP  {description}\n      anchor not found in {path.name}")
            survived.append(description)
            continue
        try:
            path.write_text(original.replace(old, new, 1))
            passed = run_suite()
        finally:
            path.write_text(original)

        if passed:
            print(f"SURVIVED  {description}")
            survived.append(description)
        else:
            print(f"caught    {description}")

    print()
    if survived:
        print(f"{len(survived)} break(s) went unnoticed -- those guarantees are untested:")
        for item in survived:
            print(f"  - {item}")
        return 1

    print("every deliberate break was caught.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

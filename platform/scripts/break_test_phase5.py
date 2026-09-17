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

PATCHES: list[tuple[str, pathlib.Path, str, str]] = [
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

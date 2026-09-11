"""Push infrastructure environment variables to Vercel.

Values are read from .env.production.local and piped to `vercel env add` over
stdin: never echoed, never passed as argv (which is visible in the process
table) and never written to shell history.

Two categories are deliberately withheld:

* **Dashboard-managed settings** (OpenAI key, model, Stripe keys). These are
  entered in the admin UI and stored encrypted, so they never pass through a
  shell at all. Any value still carrying a TODO marker is skipped for the same
  reason.
* **ZEUS_MIGRATE_URL.** That DSN authenticates as Supabase's ``postgres`` role,
  which carries BYPASSRLS. Migrations run from a developer machine, not from a
  request handler, so shipping it to the function would hand an attacker a
  credential that defeats tenant isolation for no operational benefit.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

# Runtime never needs these; see the module docstring.
EXCLUDE = {"ZEUS_MIGRATE_URL"}

# Owned by the admin dashboard (services/platform-core/.../runtime_config.py).
DASHBOARD_MANAGED = {
    "ZEUS_OPENAI_API_KEY",
    "ZEUS_STRIPE_SECRET_KEY",
    "ZEUS_STRIPE_WEBHOOK_SECRET",
    "ZEUS_LLM_MODEL",
    "ZEUS_LLM_PROVIDER",
}

TARGETS = ("production", "preview")


def load(path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def run(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=stdin, capture_output=True, text=True, check=False)


def main() -> int:
    env_file = pathlib.Path(".env.production.local")
    if not env_file.exists():
        print("Missing .env.production.local. Run scripts/make_prod_env.py first.")
        return 1

    values = load(env_file)

    runtime = values.get("ZEUS_DATABASE_URL", "")
    role = runtime.split("://", 1)[-1].split(":", 1)[0].split(".", 1)[0]
    if role == "postgres":
        print(
            "Refusing: ZEUS_DATABASE_URL uses the 'postgres' role, which has "
            "BYPASSRLS and would defeat tenant isolation in production."
        )
        return 1

    for required in ("ZEUS_SUPABASE_JWT_SECRET", "ZEUS_SECRETS_ENCRYPTION_KEY"):
        if not values.get(required):
            print(f"Refusing: {required} is required in production but is empty.")
            return 1

    to_push = {
        key: value
        for key, value in values.items()
        if key not in EXCLUDE
        and key not in DASHBOARD_MANAGED
        and value
        and not value.startswith("TODO")
    }

    print(f"Runtime DB role: {role}")
    print(f"Pushing {len(to_push)} variables to {', '.join(TARGETS)}\n")

    failures: list[str] = []
    for key, value in sorted(to_push.items()):
        marks = []
        for target in TARGETS:
            # Remove first so re-running is idempotent rather than erroring.
            run(["vercel", "env", "rm", key, target, "--yes"])
            result = run(["vercel", "env", "add", key, target], stdin=value)
            if result.returncode != 0:
                failures.append(f"{key}/{target}")
                marks.append("FAIL")
            else:
                marks.append("ok")
        print(f"  {key:<34} {' '.join(marks)}")

    skipped = sorted(
        k for k in values if k in DASHBOARD_MANAGED or values.get(k, "").startswith("TODO")
    )
    print("\nNot pushed (enter in the admin dashboard after deploy):")
    for key in skipped:
        print(f"  {key}")
    print(f"\nNot pushed (runtime must not hold a BYPASSRLS credential): {', '.join(EXCLUDE)}")

    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

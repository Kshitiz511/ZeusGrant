"""Minimal GPT-5-mini connectivity probe with a hard output cap.

Reads ZEUS_OPENAI_API_KEY from platform/.env (or the environment) and makes a
single tiny request capped at max_completion_tokens=10, so the test can never
consume more than ~10 output tokens.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys


def load_env() -> None:
    env_file = pathlib.Path(__file__).resolve().parents[1] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


async def main() -> None:
    load_env()
    key = os.environ.get("ZEUS_OPENAI_API_KEY", "")
    if not key or key == "PASTE_YOUR_KEY_HERE":
        sys.exit("No key: put ZEUS_OPENAI_API_KEY in platform/.env")

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=key, timeout=30)
    resp = await client.chat.completions.create(
        model=os.environ.get("ZEUS_LLM_MODEL", "gpt-5-mini"),
        messages=[{"role": "user", "content": "Say: pong"}],
        max_completion_tokens=10,  # hard cap — the model cannot exceed this
        reasoning_effort="minimal",  # don't burn the tiny budget on reasoning
    )
    u = resp.usage
    print("MODEL:", resp.model)
    print("TEXT:", (resp.choices[0].message.content or "").strip())
    print(
        f"TOKENS: prompt={u.prompt_tokens} completion={u.completion_tokens} "
        f"total={u.total_tokens}"
    )


if __name__ == "__main__":
    asyncio.run(main())

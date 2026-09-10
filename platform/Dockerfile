# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Zeus platform service image. Parameterized so every FastAPI service reuses
# it — pass SERVICE (the package dir under services/) and MODULE (the ASGI
# import path). Serverless stays the prod target; this is for local parity.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS base

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy the whole workspace (packages + services) so uv can resolve the
# workspace members. Build context is the `platform/` directory.
COPY pyproject.toml uv.lock ./
COPY packages ./packages
COPY services ./services

# Install the full workspace with all extras (providers) available.
RUN uv sync --frozen --all-extras

# The concrete provider libs live behind zeus-adapters optional extras, which
# `uv sync --all-extras` (root package only) does not pull in. Install the
# runtime providers explicitly so Postgres/Redis/LLM adapters import cleanly.
RUN uv pip install "asyncpg>=0.29" "redis>=5.0" "openai>=1.40"

# Which service to run and its ASGI app path.
ARG MODULE=zeus_platform_core.app:create_app
ENV ZEUS_ASGI_APP=${MODULE}

EXPOSE 8000

# Factory-style app; each service exposes create_app().
CMD ["sh", "-c", "uv run --no-sync uvicorn ${ZEUS_ASGI_APP} --factory --host 0.0.0.0 --port 8000"]

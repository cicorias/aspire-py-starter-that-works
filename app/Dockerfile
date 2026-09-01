FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app

COPY pyproject.toml /app/

RUN --mount=type=cache,target=/tmp/uv-cache \
    --mount=type=secret,id=uv-config,target=/run/secrets/uv-config,required=false \
    if [ -f /run/secrets/uv-config ]; then export UV_CONFIG_FILE=/run/secrets/uv-config; fi; \
    uv sync --no-install-project --no-dev

COPY . /app
RUN --mount=type=cache,target=/tmp/uv-cache \
    --mount=type=secret,id=uv-config,target=/run/secrets/uv-config,required=false \
    if [ -f /run/secrets/uv-config ]; then export UV_CONFIG_FILE=/run/secrets/uv-config; fi; \
    uv sync --no-dev

FROM python:3.13-slim-bookworm AS app

RUN groupadd --system --gid 999 appuser \
    && useradd --system --gid 999 --uid 999 --create-home appuser

COPY --from=builder --chown=appuser:appuser /app /app

ENV PATH=/app/.venv/bin:${PATH}
ENV VIRTUAL_ENV=/app/.venv
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser
WORKDIR /app

ENTRYPOINT ["uvicorn"]

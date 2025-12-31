# syntax=docker/dockerfile:1
# ---- Base -------------------------------------------------
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# ---- System deps (rarely change) --------------------------
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---- Python deps (CACHE CRITICAL) -------------------------
COPY apps/ai-core/requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# ---- App code (changes often) -----------------------------
COPY apps/ai-core/ .

# ---- Runtime ----------------------------------------------
ENV PYTHONPATH=/app/src
CMD ["python", "-m", "ai_core.main"]

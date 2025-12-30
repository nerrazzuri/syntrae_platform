# syntax=docker/dockerfile:1.6
# Multi-stage build for Python FastAPI application

# Stage 1: Build stage
ARG PY_BASE_IMAGE=python:3.11-slim-bookworm
ARG PY_RUN_IMAGE=python:3.11-slim-bookworm
FROM ${PY_BASE_IMAGE} AS builder

WORKDIR /app

# Install system dependencies with cache
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update -o Acquire::Retries=5 && \
    apt-get install -y --no-install-recommends \
    build-essential \
    gfortran \
    libatlas-base-dev \
    liblapack-dev \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --user -U pip setuptools wheel

# Install Torch
RUN --mount=type=cache,target=/root/.cache/pip \
    pip --default-timeout=180 install --no-cache-dir --user \
    --index-url https://download.pytorch.org/whl/cpu \
    torch \
    --extra-index-url https://pypi.org/simple

# Copy requirements from apps/ai-core
COPY apps/ai-core/requirements-ml.txt ./requirements-ml.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip --default-timeout=180 install --no-cache-dir --user --prefer-binary -r requirements-ml.txt

COPY apps/ai-core/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip --default-timeout=180 install --no-cache-dir --user --prefer-binary -r requirements.txt

ENV HF_HOME=/root/.cache/huggingface \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/root/.cache/sentence-transformers \
    HF_HUB_TIMEOUT=120 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    RERANK_CROSS_ENCODER=cross-encoder/ms-marco-MiniLM-L6-v2

RUN mkdir -p /root/.cache/huggingface /root/.cache/sentence-transformers

# Prewarm
ARG PREWARM_MODELS=false
RUN python - <<'PY' || true
import os
if os.environ.get('PREWARM_MODELS', 'false').lower() == 'true':
    os.environ.setdefault('HF_HOME', '/root/.cache/huggingface')
    os.environ.setdefault('TRANSFORMERS_CACHE', '/root/.cache/huggingface')
    os.environ.setdefault('SENTENCE_TRANSFORMERS_HOME', '/root/.cache/sentence-transformers')
    model = os.environ.get('RERANK_CROSS_ENCODER', 'cross-encoder/ms-marco-MiniLM-L6-v2')
    try:
        from sentence_transformers import CrossEncoder
        ce = CrossEncoder(model)
        print('CrossEncoder prewarmed:', model)
    except Exception as e:
        print('CrossEncoder prewarm failed:', e)
else:
    print('Skipping model prewarm')
PY

# Stage 2: Production stage
FROM ${PY_RUN_IMAGE}

RUN groupadd -r appuser && useradd -m -r -g appuser appuser

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update -o Acquire::Retries=5 && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tini \
    tesseract-ocr \
    tesseract-ocr-eng && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /home/appuser/.local
COPY --from=builder /root/.cache /home/appuser/.cache

# Copy application code
COPY apps/ai-core/src/ ./src/

RUN mkdir -p logs /home/appuser/.cache && chown -R appuser:appuser /app /home/appuser/.cache /home/appuser/.local

USER appuser

ENV PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1
ENV PATH=/home/appuser/.local/bin:$PATH
ENV HF_HOME=/home/appuser/.cache/huggingface \
    TRANSFORMERS_CACHE=/home/appuser/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/home/appuser/.cache/sentence-transformers \
    HF_HUB_TIMEOUT=120 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    RERANK_CROSS_ENCODER=cross-encoder/ms-marco-MiniLM-L6-v2

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/v1/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "ai_core.main:app", "--host", "0.0.0.0", "--port", "8000"]

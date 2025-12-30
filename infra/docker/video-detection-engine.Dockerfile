# syntax=docker/dockerfile:1
FROM python:3.10-slim as builder

WORKDIR /app

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (user mode to easily copy)
# 1. Torch (Heavy)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --user torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 2. Other requirements
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --user \
    fastapi \
    uvicorn \
    python-multipart \
    opencv-python-headless \
    moviepy \
    scikit-learn \
    joblib \
    sentence-transformers \
    easyocr \
    pillow \
    numpy \
    pandas \
    SpeechRecognition

# Stage 2: Runner
FROM python:3.10-slim

WORKDIR /app

# Runtime deps (ffmpeg for moviepy, etc)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local

# Update PATH to include user bin
ENV PATH=/root/.local/bin:$PATH

# Copy code
COPY apps/video-detection-engine/video_detection_engine/ /app/

ENV PYTHONPATH=/app
ENV STORAGE_ROOT=/data/storage

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

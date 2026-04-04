# syntax=docker/dockerfile:1
# ---- Base -------------------------------------------------
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

# ---- System deps ------------------------------------------
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ---- Torch FIRST (isolated layer: TIME BOMB DEFUSED) ------
# This layer changes RARELY. Segregating it means app code changes 
# NEVER trigger a torch re-download.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# ---- Other deps (Context: requirements.txt) ---------------
# We copy ONLY requirements first.
# Note: requirements.txt is located deep in the source tree
COPY apps/video-detection-engine/video_detection_engine/requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# ---- App code (changes often) -----------------------------
COPY apps/video-detection-engine/ /app/apps/video-detection-engine/

# ---- Runtime ----------------------------------------------
# Ensure pythonpath includes app root
ENV PYTHONPATH=/app/apps/video-detection-engine
ENV STORAGE_ROOT=/data/storage

EXPOSE 8000

# Working directory adjustment?
# If main.py is in apps/video-detection-engine/video_detection_engine/api/main.py
# The previous command was: CMD ["uvicorn", "api.main:app", ...]
# And WORKDIR was /app.
# If we copy `apps/video-detection-engine/` to `/app/apps/video-detection-engine/`
# We should probably set WORKDIR to `/app/apps/video-detection-engine/video_detection_engine`?
# Let's check the deep structure: apps/video-detection-engine/video_detection_engine/api/main.py
# So if WORKDIR is `/app/apps/video-detection-engine/video_detection_engine`, then `uvicorn api.main:app` works.

WORKDIR /app/apps/video-detection-engine/video_detection_engine

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

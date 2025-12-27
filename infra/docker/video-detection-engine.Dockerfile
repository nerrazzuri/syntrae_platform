# Stage 1: Builder
FROM python:3.10-slim as builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
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

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy code from correct path
COPY apps/video-detection-engine/video_detection_engine/ /app/

ENV PYTHONPATH=/app
ENV STORAGE_ROOT=/data/storage

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

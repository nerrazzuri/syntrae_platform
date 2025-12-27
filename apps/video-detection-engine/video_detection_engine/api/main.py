import logging
from fastapi import FastAPI
from .routers import ingest, inference

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Video Detection Engine API", version="1.0.0")

app.include_router(ingest.router, prefix="/api/v1/ingest", tags=["Ingest"])
app.include_router(inference.router, prefix="/api/v1/inference", tags=["Inference"])

@app.get("/health")
def health_check():
    return {"status": "ok"}

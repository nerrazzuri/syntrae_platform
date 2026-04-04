import os
import subprocess
import json as json_lib
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class ThreadReplyRequest(BaseModel):
    platform: str
    video_id: str
    comment_id: str
    message_text: str


def _normalize_xhs_comment_id(comment_id: str) -> str:
    normalized = str(comment_id or "").strip()
    if normalized.startswith("xhs-cmt-"):
        return normalized[len("xhs-cmt-"):]
    return normalized


@router.post("/thread-reply")
async def send_thread_reply(payload: ThreadReplyRequest, request: Request):
    secret_header = request.headers.get("x-internal-secret")
    expected_secret = os.getenv("AI_CORE_INTERNAL_SECRET")

    if not expected_secret or secret_header != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    platform = payload.platform.lower()
    if platform not in {"rednote", "xiaohongshu", "xhs"}:
        raise HTTPException(status_code=400, detail=f"Unsupported delivery platform: {payload.platform}")

    note_id = str(payload.video_id or "").strip()
    comment_id = _normalize_xhs_comment_id(payload.comment_id)
    message_text = str(payload.message_text or "").strip()

    if not note_id or not comment_id or not message_text:
        raise HTTPException(status_code=400, detail="video_id, comment_id, and message_text are required")

    try:
        result = subprocess.run(
            ["xhs", "reply", note_id, "--comment-id", comment_id, "-c", message_text, "--json"],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="xhs CLI is not installed in the worker image")
    except Exception as exc:
        logger.error("XHS thread reply invocation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"XHS thread reply invocation failed: {exc}")

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        logger.error("XHS thread reply failed: %s", stderr)
        raise HTTPException(status_code=502, detail=f"XHS thread reply failed: {stderr or 'unknown error'}")

    parsed = {}
    stdout = (result.stdout or "").strip()
    if stdout:
        try:
            parsed = json_lib.loads(stdout)
        except json_lib.JSONDecodeError:
            parsed = {"raw": stdout}

    if isinstance(parsed, dict) and parsed.get("ok") is False:
        error_detail = parsed.get("error", {}).get("message") or parsed
        raise HTTPException(status_code=502, detail=f"XHS thread reply failed: {error_detail}")

    return {
        "status": "sent",
        "platform": "rednote",
        "video_id": note_id,
        "comment_id": comment_id,
        "provider_response": parsed or {"raw": stdout},
    }

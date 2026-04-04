import os
import json as json_lib
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from xhs_cli.client import XhsClient
from xhs_cli.exceptions import XhsApiError

router = APIRouter()
logger = logging.getLogger(__name__)
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/storage"))


class ThreadReplyRequest(BaseModel):
    platform: str
    workspace_id: str | None = None
    brand_id: str | None = None
    video_id: str
    comment_id: str
    message_text: str


def _normalize_xhs_comment_id(comment_id: str) -> str:
    normalized = str(comment_id or "").strip()
    if normalized.startswith("xhs-cmt-"):
        return normalized[len("xhs-cmt-"):]
    return normalized


def _resolve_xhs_session_path(workspace_id: str, brand_id: str) -> Path:
    return STORAGE_ROOT / "sessions" / workspace_id / brand_id / "rednote" / "session.json"


def _load_xhs_cookies(session_path: Path) -> dict[str, str]:
    if not session_path.exists():
        raise HTTPException(status_code=404, detail=f"XHS session file not found: {session_path}")

    payload = json_lib.loads(session_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
        return {
            str(cookie.get("name")): str(cookie.get("value"))
            for cookie in payload.get("cookies", [])
            if isinstance(cookie, dict) and cookie.get("name") and cookie.get("value")
        }
    if isinstance(payload, dict):
        return {str(key): str(value) for key, value in payload.items() if value is not None}
    raise HTTPException(status_code=400, detail="Unsupported XHS session payload")


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
    if not payload.workspace_id or not payload.brand_id:
        raise HTTPException(status_code=400, detail="workspace_id and brand_id are required for XHS reply delivery")

    session_path = _resolve_xhs_session_path(payload.workspace_id, payload.brand_id)
    cookies = _load_xhs_cookies(session_path)
    try:
        with XhsClient(cookies) as client:
            parsed = client.reply_comment(note_id, comment_id, message_text)
    except XhsApiError as exc:
        logger.error("XHS thread reply failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"XHS thread reply failed: {exc}")
    except Exception as exc:
        logger.error("XHS thread reply invocation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"XHS thread reply invocation failed: {exc}")

    return {
        "status": "sent",
        "platform": "rednote",
        "video_id": note_id,
        "comment_id": comment_id,
        "session_path": str(session_path),
        "provider_response": parsed or {},
    }

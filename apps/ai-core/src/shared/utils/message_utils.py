"""
Message normalization utilities for multi-channel support.
"""
from typing import Dict, Any


def normalize_whatsapp(payload: Dict[str, Any]) -> Dict[str, Any]:
    entry = payload.get("entry", [{}])[0]
    changes = entry.get("changes", [{}])[0]
    value = changes.get("value", {})
    messages = value.get("messages", [{}])
    msg = messages[0] if messages else {}
    text = msg.get("text", {}).get("body", "")
    from_id = msg.get("from", "")
    return {
        "channel": "whatsapp",
        "tenantId": value.get("metadata", {}).get(
            "display_phone_number", "default-tenant"
        ),
        "userId": from_id,
        "message": text,
        "context": {
            "conversationId": msg.get("id"),
        },
    }
